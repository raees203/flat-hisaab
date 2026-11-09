-- 004 — Payment accounts: where each flatmate wants to receive money.
-- Everyone can save his Easypaisa / JazzCash / bank / other accounts, so whoever owes him
-- can copy the number and pay.
--   * Only people who joined the flat can see its accounts.
--   * Only the phone linked to a name can add, change or delete that name's accounts.
--     Nobody else can, not even the flat owner.
--   * Numbers are checked here too: 03XXXXXXXXX for wallets, a valid IBAN (with its
--     checksum) or 6-20 digits for banks.
--   * Up to 5 accounts per person; exactly one of them is the preferred one.
--   * updated_at changes only when the details change (kind, bank, title, number), so the
--     app can warn payers about a number that was added or changed in the last few days.

create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  kind text not null check (kind in ('easypaisa', 'jazzcash', 'bank', 'other')),
  provider text not null default '' check (char_length(provider) <= 30),
  title text not null check (char_length(btrim(title)) between 2 and 40),
  number text not null check (char_length(number) between 4 and 34),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_accounts_flat_idx on public.payment_accounts (flat_id);
create unique index if not exists payment_accounts_one_preferred on public.payment_accounts (member_id) where is_primary;
create unique index if not exists payment_accounts_no_duplicates on public.payment_accounts (member_id, kind, number);

-- IBAN checksum (ISO 13616, mod 97) for Pakistani IBANs: PK + 2 check digits + 4-letter bank code + 16 characters
create or replace function public.iban_ok(v text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare s text; r int := 0; c text;
begin
  if v is null or v !~ '^PK[0-9]{2}[A-Z]{4}[0-9A-Z]{16}$' then return false; end if;
  s := substr(v, 5) || substr(v, 1, 4);
  for i in 1..length(s) loop
    c := substr(s, i, 1);
    if c ~ '[0-9]' then r := (r * 10 + c::int) % 97;
    else r := (r * 100 + ascii(c) - 55) % 97;
    end if;
  end loop;
  return r = 1;
end $$;

create or replace function public.payment_accounts_guard() returns trigger
language plpgsql set search_path = '' as $$
declare n int;
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.member_id <> old.member_id or new.flat_id <> old.flat_id) then
    raise exception 'An account can''t be moved to someone else';
  end if;
  if not public.member_in_flat(new.member_id, new.flat_id) then
    raise exception 'That person is not in this flat';
  end if;

  -- tidy and check the details
  new.title := btrim(regexp_replace(new.title, '\s+', ' ', 'g'));
  new.provider := btrim(regexp_replace(coalesce(new.provider, ''), '\s+', ' ', 'g'));
  new.number := regexp_replace(new.number, '[[:space:]-]', '', 'g');
  if char_length(new.title) not between 2 and 40 then
    raise exception 'Write the name on the account';
  end if;
  if new.kind in ('easypaisa', 'jazzcash') then
    new.provider := '';
    new.number := regexp_replace(new.number, '^(\+92|0092|92)(3[0-9]{9})$', '0\2');
    if new.number !~ '^03[0-9]{9}$' then
      raise exception 'Enter the mobile number like 03001234567';
    end if;
  elsif new.kind = 'bank' then
    new.number := upper(new.number);
    if new.provider = '' then raise exception 'Pick the bank'; end if;
    if new.number ~ '^PK' then
      if not public.iban_ok(new.number) then raise exception 'That IBAN isn''t valid. Check it again.'; end if;
    elsif new.number !~ '^[0-9]{6,20}$' then
      raise exception 'Enter the account number (6 to 20 digits) or the 24-character IBAN';
    end if;
  else
    if new.provider = '' then raise exception 'Write which app or service it is'; end if;
    if new.number !~ '^[0-9A-Za-z@._+]{4,34}$' then raise exception 'That account number doesn''t look right'; end if;
  end if;

  if exists (select 1 from public.payment_accounts
             where member_id = new.member_id and kind = new.kind and number = new.number and id <> new.id) then
    raise exception 'You already saved this account';
  end if;

  if tg_op = 'INSERT' then
    select count(*) into n from public.payment_accounts where member_id = new.member_id;
    if n >= 5 then raise exception 'You can save up to 5 accounts'; end if;
    if n = 0 then new.is_primary := true; end if;   -- the first one is the preferred one
    new.created_at := now();
    new.updated_at := now();
  else
    new.created_at := old.created_at;
    if (new.kind, new.provider, new.title, new.number) is distinct from (old.kind, old.provider, old.title, old.number) then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;   -- only "preferred" changed: not a change of details
    end if;
    -- someone always stays preferred; switch by making another one preferred
    -- (pg_trigger_depth() > 1 is this trigger itself un-marking the old one, below)
    if old.is_primary and not new.is_primary and pg_trigger_depth() = 1 then
      raise exception 'Make another account preferred instead';
    end if;
  end if;

  if new.is_primary and (tg_op = 'INSERT' or not old.is_primary) then
    update public.payment_accounts set is_primary = false
      where member_id = new.member_id and id <> new.id and is_primary;
  end if;
  return new;
end $$;

drop trigger if exists payment_accounts_guard on public.payment_accounts;
create trigger payment_accounts_guard before insert or update on public.payment_accounts
  for each row execute function public.payment_accounts_guard();

-- When the preferred account is deleted, the oldest remaining one becomes preferred.
create or replace function public.payment_accounts_after_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_primary and not exists (select 1 from public.payment_accounts where member_id = old.member_id and is_primary) then
    update public.payment_accounts set is_primary = true
      where id = (select id from public.payment_accounts where member_id = old.member_id order by created_at, id limit 1);
  end if;
  return null;
end $$;

drop trigger if exists payment_accounts_after_delete on public.payment_accounts;
create trigger payment_accounts_after_delete after delete on public.payment_accounts
  for each row execute function public.payment_accounts_after_delete();

alter table public.payment_accounts enable row level security;

drop policy if exists "accounts: flat members read" on public.payment_accounts;
create policy "accounts: flat members read" on public.payment_accounts for select to authenticated
  using (public.is_flat_member(flat_id));
drop policy if exists "accounts: add your own" on public.payment_accounts;
create policy "accounts: add your own" on public.payment_accounts for insert to authenticated
  with check (public.is_flat_member(flat_id) and public.is_my_member(member_id));
drop policy if exists "accounts: change your own" on public.payment_accounts;
create policy "accounts: change your own" on public.payment_accounts for update to authenticated
  using (public.is_flat_member(flat_id) and public.is_my_member(member_id))
  with check (public.is_flat_member(flat_id) and public.is_my_member(member_id));
drop policy if exists "accounts: delete your own" on public.payment_accounts;
create policy "accounts: delete your own" on public.payment_accounts for delete to authenticated
  using (public.is_flat_member(flat_id) and public.is_my_member(member_id));

revoke all on public.payment_accounts from anon;
grant select, insert, update, delete on public.payment_accounts to authenticated;
revoke all on function public.iban_ok(text) from public, anon;
grant execute on function public.iban_ok(text) to authenticated;

-- live updates: a changed number shows up on everyone's phone straight away
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_accounts') then
    alter publication supabase_realtime add table public.payment_accounts;
  end if;
end $$;
