-- 001 — Flat Hisaab initial schema (as applied to the live project on 2026-11-07)
-- Every rule that matters is enforced here on the server, not just in the app:
--   * only people who joined a flat (with its code) can see or change its data
--   * a payment can only be approved/rejected by the person who received it
--   * an expense's shares must add up exactly to its amount
--   * a name can only be linked to one phone, and only by that phone

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table public.flats (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  code text not null unique,
  owner_id uuid not null,
  created_at timestamptz not null default now()
);

create table public.flat_users (
  flat_id uuid not null references public.flats(id) on delete cascade,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (flat_id, user_id)
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  user_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (flat_id, user_id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats(id) on delete cascade,
  amount integer not null check (amount > 0 and amount <= 10000000),
  paid_by uuid not null references public.members(id),
  date date not null,
  meal text not null check (meal in ('nashta', 'lunch', 'dinner', 'other')),
  note text not null default '' check (char_length(note) <= 60),
  shares jsonb not null,
  receipt_path text,
  created_by uuid,
  created_by_member uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats(id) on delete cascade,
  from_member uuid not null references public.members(id),
  to_member uuid not null references public.members(id),
  amount integer not null check (amount > 0 and amount <= 10000000),
  method text not null default 'Cash' check (method in ('Cash', 'JazzCash', 'Easypaisa', 'Bank')),
  date date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  receipt_path text,
  created_by uuid,
  created_by_member uuid references public.members(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_member <> to_member)
);

create table public.attendance (
  flat_id uuid not null references public.flats(id) on delete cascade,
  date date not null,
  member_id uuid not null references public.members(id) on delete cascade,
  nashta boolean not null default true,
  lunch boolean not null default true,
  dinner boolean not null default true,
  primary key (flat_id, date, member_id)
);

create index on public.flat_users (user_id);
create index on public.members (flat_id);
create index on public.expenses (flat_id, date);
create index on public.expenses (paid_by);
create index on public.expenses (created_by_member);
create index on public.payments (flat_id, date);
create index on public.payments (from_member);
create index on public.payments (to_member);
create index on public.payments (created_by_member);
create index on public.attendance (flat_id, date);
create index on public.attendance (member_id);

-- ---------- helper functions ----------
create or replace function public.is_flat_member(f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.flat_users where flat_id = f and user_id = auth.uid());
$$;

create or replace function public.is_flat_owner(f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.flats where id = f and owner_id = auth.uid());
$$;

create or replace function public.my_member_id(f uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members where flat_id = f and user_id = auth.uid() limit 1;
$$;

create or replace function public.member_in_flat(m uuid, f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = m and flat_id = f);
$$;

-- ---------- triggers ----------
-- flats: code and owner never change
create or replace function public.flats_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.code is distinct from old.code or new.owner_id is distinct from old.owner_id or new.id <> old.id then
    raise exception 'Only the flat name can be changed';
  end if;
  return new;
end $$;
create trigger flats_guard before update on public.flats for each row execute function public.flats_guard();

-- members: linking a name to a phone
create or replace function public.members_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is not null and new.user_id is distinct from auth.uid() then
      raise exception 'You can only link a name to your own phone';
    end if;
    return new;
  end if;
  if new.flat_id <> old.flat_id or new.id <> old.id then
    raise exception 'Members cannot move between flats';
  end if;
  if new.user_id is distinct from old.user_id then
    if not (
      (old.user_id is null and new.user_id = auth.uid())                 -- claim a free name
      or (old.user_id = auth.uid() and new.user_id is null)              -- release my own name
      or (new.user_id is null and public.is_flat_owner(old.flat_id))     -- flat owner unlinks a lost phone
    ) then
      raise exception 'That name is linked to another phone';
    end if;
  end if;
  return new;
end $$;
create trigger members_guard before insert or update on public.members for each row execute function public.members_guard();

-- expenses: members belong to the flat, shares are exact
create or replace function public.expenses_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  k text; v jsonb; total bigint := 0; n int := 0;
begin
  if not public.member_in_flat(new.paid_by, new.flat_id) then
    raise exception 'Payer is not in this flat';
  end if;
  if jsonb_typeof(new.shares) <> 'object' then
    raise exception 'Shares must be an object';
  end if;
  for k, v in select * from jsonb_each(new.shares) loop
    if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> floor((v::text)::numeric) or (v::text)::numeric < 0 then
      raise exception 'Each share must be a whole number of rupees';
    end if;
    if not public.member_in_flat(k::uuid, new.flat_id) then
      raise exception 'Share for someone who is not in this flat';
    end if;
    total := total + (v::text)::bigint; n := n + 1;
  end loop;
  if n = 0 then raise exception 'Split between at least one person'; end if;
  if total <> new.amount then
    raise exception 'Shares (%) must add up exactly to the amount (%)', total, new.amount;
  end if;
  new.created_by := auth.uid();
  new.created_by_member := public.my_member_id(new.flat_id);
  new.created_at := now();
  return new;
end $$;
create trigger expenses_guard before insert on public.expenses for each row execute function public.expenses_guard();

-- payments: only the receiver approves
create or replace function public.payments_insert_guard() returns trigger
language plpgsql set search_path = '' as $$
declare receiver uuid;
begin
  if not public.member_in_flat(new.from_member, new.flat_id) or not public.member_in_flat(new.to_member, new.flat_id) then
    raise exception 'Both people must be in this flat';
  end if;
  select user_id into receiver from public.members where id = new.to_member;
  if receiver is not null and receiver = auth.uid() then
    new.status := 'approved';       -- I record money I received myself: counts straight away
    new.decided_at := now();
  else
    new.status := 'pending';        -- everyone else waits for the receiver
    new.decided_at := null;
  end if;
  new.created_by := auth.uid();
  new.created_by_member := public.my_member_id(new.flat_id);
  new.created_at := now();
  return new;
end $$;
create trigger payments_insert_guard before insert on public.payments for each row execute function public.payments_insert_guard();

create or replace function public.payments_update_guard() returns trigger
language plpgsql set search_path = '' as $$
declare receiver uuid;
begin
  if (new.id, new.flat_id, new.from_member, new.to_member, new.amount, new.method, new.date, new.receipt_path, new.created_by, new.created_at)
     is distinct from
     (old.id, old.flat_id, old.from_member, old.to_member, old.amount, old.method, old.date, old.receipt_path, old.created_by, old.created_at) then
    raise exception 'A payment cannot be edited, only approved or rejected';
  end if;
  if old.status <> 'pending' or new.status not in ('approved', 'rejected') then
    raise exception 'Only pending payments can be approved or rejected';
  end if;
  select user_id into receiver from public.members where id = old.to_member;
  if receiver is null or receiver <> auth.uid() then
    raise exception 'Only the person who received the money can approve it';
  end if;
  new.decided_at := now();
  return new;
end $$;
create trigger payments_update_guard before update on public.payments for each row execute function public.payments_update_guard();

-- ---------- row level security ----------
alter table public.flats enable row level security;
alter table public.flat_users enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.payments enable row level security;
alter table public.attendance enable row level security;

create policy "flats: members read" on public.flats for select to authenticated using (public.is_flat_member(id));
create policy "flats: members rename" on public.flats for update to authenticated using (public.is_flat_member(id)) with check (public.is_flat_member(id));

create policy "flat_users: members read" on public.flat_users for select to authenticated using (public.is_flat_member(flat_id));
create policy "flat_users: leave" on public.flat_users for delete to authenticated using (user_id = auth.uid());

create policy "members: read" on public.members for select to authenticated using (public.is_flat_member(flat_id));
create policy "members: add" on public.members for insert to authenticated with check (public.is_flat_member(flat_id));
create policy "members: edit" on public.members for update to authenticated using (public.is_flat_member(flat_id)) with check (public.is_flat_member(flat_id));

create policy "expenses: read" on public.expenses for select to authenticated using (public.is_flat_member(flat_id));
create policy "expenses: add" on public.expenses for insert to authenticated with check (public.is_flat_member(flat_id));
create policy "expenses: delete own" on public.expenses for delete to authenticated using (
  public.is_flat_member(flat_id) and (
    created_by = auth.uid() or paid_by = public.my_member_id(flat_id) or public.is_flat_owner(flat_id)));

create policy "payments: read" on public.payments for select to authenticated using (public.is_flat_member(flat_id));
create policy "payments: add" on public.payments for insert to authenticated with check (public.is_flat_member(flat_id));
create policy "payments: decide" on public.payments for update to authenticated using (public.is_flat_member(flat_id)) with check (public.is_flat_member(flat_id));
create policy "payments: delete" on public.payments for delete to authenticated using (
  public.is_flat_member(flat_id) and (
    public.is_flat_owner(flat_id)
    or (status <> 'approved' and (created_by = auth.uid() or from_member = public.my_member_id(flat_id)))));

create policy "attendance: read" on public.attendance for select to authenticated using (public.is_flat_member(flat_id));
create policy "attendance: add" on public.attendance for insert to authenticated with check (public.is_flat_member(flat_id) and public.member_in_flat(member_id, flat_id));
create policy "attendance: edit" on public.attendance for update to authenticated using (public.is_flat_member(flat_id)) with check (public.is_flat_member(flat_id) and public.member_in_flat(member_id, flat_id));

-- ---------- functions the app calls ----------
create or replace function public.new_flat_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.flats where code = c);
  end loop;
  return c;
end $$;

create or replace function public.create_flat(p_name text, p_members text[], p_me int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid; i int; nm text; cnt int := 0;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then p_name := 'Flat'; end if;
  insert into public.flats (name, code, owner_id) values (left(btrim(p_name), 40), public.new_flat_code(), auth.uid()) returning id into f;
  insert into public.flat_users (flat_id, user_id) values (f, auth.uid());
  for i in 1..coalesce(array_length(p_members, 1), 0) loop
    nm := left(btrim(coalesce(p_members[i], '')), 30);
    if nm <> '' then
      insert into public.members (flat_id, name, user_id, created_at)
      values (f, nm, case when i = p_me then auth.uid() else null end, now() + make_interval(secs => i / 1000.0));
      cnt := cnt + 1;
    end if;
  end loop;
  if cnt < 2 then raise exception 'Add at least 2 members'; end if;
  return f;
end $$;

create or replace function public.join_flat(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into f from public.flats where code = upper(btrim(p_code));
  if f is null then raise exception 'No flat with that code'; end if;
  insert into public.flat_users (flat_id, user_id) values (f, auth.uid()) on conflict do nothing;
  return f;
end $$;

-- link "this phone" to a name in the flat (releases any other name this phone had there)
create or replace function public.claim_member(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f uuid; current_owner uuid;
begin
  select flat_id, user_id into f, current_owner from public.members where id = p_member;
  if f is null or not public.is_flat_member(f) then raise exception 'Not in this flat'; end if;
  if current_owner is not null and current_owner <> auth.uid() then raise exception 'That name is linked to another phone'; end if;
  update public.members set user_id = null where flat_id = f and user_id = auth.uid() and id <> p_member;
  update public.members set user_id = auth.uid() where id = p_member and user_id is null;
end $$;

create or replace function public.unlink_member(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f uuid;
begin
  select flat_id into f from public.members where id = p_member;
  if f is null or not public.is_flat_owner(f) then raise exception 'Only the flat owner can unlink a phone'; end if;
  update public.members set user_id = null where id = p_member;
end $$;

revoke all on function public.create_flat(text, text[], int) from public, anon;
revoke all on function public.join_flat(text) from public, anon;
revoke all on function public.claim_member(uuid) from public, anon;
revoke all on function public.unlink_member(uuid) from public, anon;
revoke all on function public.new_flat_code() from public, anon, authenticated;
revoke all on function public.is_flat_member(uuid) from public, anon;
revoke all on function public.is_flat_owner(uuid) from public, anon;
revoke all on function public.my_member_id(uuid) from public, anon;
revoke all on function public.member_in_flat(uuid, uuid) from public, anon;
grant execute on function public.is_flat_member(uuid) to authenticated;
grant execute on function public.is_flat_owner(uuid) to authenticated;
grant execute on function public.my_member_id(uuid) to authenticated;
grant execute on function public.member_in_flat(uuid, uuid) to authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.create_flat(text, text[], int) to authenticated;
grant execute on function public.join_flat(text) to authenticated;
grant execute on function public.claim_member(uuid) to authenticated;
grant execute on function public.unlink_member(uuid) to authenticated;

-- ---------- screenshots (private storage bucket, one folder per flat) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "receipts: flat members read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] in (select flat_id::text from public.flat_users where user_id = auth.uid()));
create policy "receipts: flat members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] in (select flat_id::text from public.flat_users where user_id = auth.uid()));
create policy "receipts: flat members delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] in (select flat_id::text from public.flat_users where user_id = auth.uid()));

-- ---------- live updates ----------
alter publication supabase_realtime add table public.flats, public.members, public.expenses, public.payments, public.attendance;
