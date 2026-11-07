-- 002 — Nobody can change someone else's data.
--   * You can only add an expense that YOU paid (the flat owner may also add one
--     for a member who has no phone linked).
--   * You can only record a payment you made or one you received.
--   * You can only mark your own attendance (the owner can mark anyone).
--   * Only the owner renames the flat, adds/removes members or changes names;
--     anyone can still rename himself, and add himself once when he joins.
--   * You can only delete entries you created (payments only while not approved).
--   * A screenshot can only be deleted by whoever uploaded it.

create or replace function public.is_my_member(m uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = m and user_id = auth.uid());
$$;

create or replace function public.member_unlinked(m uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = m and user_id is null);
$$;

revoke all on function public.is_my_member(uuid) from public, anon;
revoke all on function public.member_unlinked(uuid) from public, anon;
grant execute on function public.is_my_member(uuid) to authenticated;
grant execute on function public.member_unlinked(uuid) to authenticated;

-- flats: only the owner renames
drop policy if exists "flats: members rename" on public.flats;
create policy "flats: owner renames" on public.flats for update to authenticated
  using (public.is_flat_owner(id)) with check (public.is_flat_owner(id));

-- members: owner adds people; anyone adds himself once
drop policy if exists "members: add" on public.members;
create policy "members: owner adds, or add yourself" on public.members for insert to authenticated with check (
  public.is_flat_member(flat_id) and (
    (public.is_flat_owner(flat_id) and user_id is null)
    or (user_id = (select auth.uid()) and public.my_member_id(flat_id) is null)));

-- members: name / active only by the owner or that person
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
  if (new.name is distinct from old.name or new.active is distinct from old.active)
     and not (public.is_flat_owner(old.flat_id) or coalesce(old.user_id = auth.uid(), false)) then
    raise exception 'Only the flat owner or that person can change this';
  end if;
  if new.user_id is distinct from old.user_id then
    if not (
      (old.user_id is null and new.user_id = auth.uid())
      or (old.user_id = auth.uid() and new.user_id is null)
      or (new.user_id is null and public.is_flat_owner(old.flat_id))
    ) then
      raise exception 'That name is linked to another phone';
    end if;
  end if;
  return new;
end $$;

-- attendance: your own, or the owner for anyone
drop policy if exists "attendance: add" on public.attendance;
drop policy if exists "attendance: edit" on public.attendance;
create policy "attendance: own or owner adds" on public.attendance for insert to authenticated with check (
  public.is_flat_member(flat_id) and public.member_in_flat(member_id, flat_id)
  and (public.is_my_member(member_id) or public.is_flat_owner(flat_id)));
create policy "attendance: own or owner edits" on public.attendance for update to authenticated
  using (public.is_flat_member(flat_id) and (public.is_my_member(member_id) or public.is_flat_owner(flat_id)))
  with check (public.is_flat_member(flat_id) and public.member_in_flat(member_id, flat_id)
    and (public.is_my_member(member_id) or public.is_flat_owner(flat_id)));

-- expenses: only what you paid; delete only what you added
drop policy if exists "expenses: add" on public.expenses;
create policy "expenses: add what you paid" on public.expenses for insert to authenticated with check (
  public.is_flat_member(flat_id) and (
    public.is_my_member(paid_by)
    or (public.is_flat_owner(flat_id) and public.member_unlinked(paid_by))));
drop policy if exists "expenses: delete own" on public.expenses;
create policy "expenses: delete what you added" on public.expenses for delete to authenticated
  using (created_by = (select auth.uid()));

-- payments: only ones you made or received; only the receiver decides; delete own pending
drop policy if exists "payments: add" on public.payments;
create policy "payments: add your own" on public.payments for insert to authenticated with check (
  public.is_flat_member(flat_id) and (public.is_my_member(from_member) or public.is_my_member(to_member)));
drop policy if exists "payments: decide" on public.payments;
create policy "payments: receiver decides" on public.payments for update to authenticated
  using (public.is_flat_member(flat_id) and public.is_my_member(to_member))
  with check (public.is_flat_member(flat_id) and public.is_my_member(to_member));
drop policy if exists "payments: delete" on public.payments;
create policy "payments: delete your unapproved" on public.payments for delete to authenticated
  using (created_by = (select auth.uid()) and status <> 'approved');

-- screenshots: only the uploader deletes
drop policy if exists "receipts: flat members delete" on storage.objects;
create policy "receipts: uploader deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and owner_id = (select auth.uid())::text);
