-- 003 — Report a wrong expense.
-- Anyone who is part of an expense (has a share) can report it as wrong, with a short note.
-- The person who added it can then remove it or say it's correct (clears the report).
-- The flat owner can also remove an expense that someone ELSE reported as wrong.
-- Nobody can edit an expense's amount, payer or shares: delete and add again instead.

alter table public.expenses
  add column if not exists disputed_by uuid references public.members(id) on delete set null,
  add column if not exists dispute_note text check (dispute_note is null or char_length(dispute_note) <= 100),
  add column if not exists disputed_at timestamptz;

create or replace function public.expenses_update_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.flat_id, new.amount, new.paid_by, new.date, new.meal, new.note, new.shares,
      new.receipt_path, new.created_by, new.created_by_member, new.created_at)
     is distinct from
     (old.id, old.flat_id, old.amount, old.paid_by, old.date, old.meal, old.note, old.shares,
      old.receipt_path, old.created_by, old.created_by_member, old.created_at) then
    raise exception 'An expense can''t be edited. Delete it and add it again.';
  end if;

  if old.disputed_by is null and new.disputed_by is not null then
    -- reporting it as wrong
    if not public.is_my_member(new.disputed_by) then
      raise exception 'You can only report as yourself';
    end if;
    if not (old.shares ? new.disputed_by::text) then
      raise exception 'Only people who are part of this expense can report it';
    end if;
    if old.created_by = auth.uid() then
      raise exception 'You added this expense, so you can delete it instead';
    end if;
    new.disputed_at := now();
  elsif old.disputed_by is not null and new.disputed_by is null then
    -- "it's correct" by whoever added it, or withdrawn by whoever reported it
    if not (old.created_by = auth.uid() or public.is_my_member(old.disputed_by)) then
      raise exception 'Only the person who added it or who reported it can clear this';
    end if;
    new.dispute_note := null;
    new.disputed_at := null;
  elsif new.disputed_by is distinct from old.disputed_by
     or new.dispute_note is distinct from old.dispute_note
     or new.disputed_at is distinct from old.disputed_at then
    raise exception 'This expense has already been reported';
  end if;
  return new;
end $$;

drop trigger if exists expenses_update_guard on public.expenses;
create trigger expenses_update_guard before update on public.expenses
  for each row execute function public.expenses_update_guard();

drop policy if exists "expenses: report or clear" on public.expenses;
create policy "expenses: report or clear" on public.expenses for update to authenticated
  using (public.is_flat_member(flat_id)) with check (public.is_flat_member(flat_id));

drop policy if exists "expenses: delete what you added" on public.expenses;
create policy "expenses: delete own, or owner removes a reported one" on public.expenses for delete to authenticated
  using (
    created_by = (select auth.uid())
    or (public.is_flat_owner(flat_id) and disputed_by is not null and not public.is_my_member(disputed_by)));

create index if not exists expenses_disputed_by_idx on public.expenses (disputed_by);
