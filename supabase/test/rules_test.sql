\set ON_ERROR_STOP on
\set QUIET on
create function public.t_block(q text, msg text) returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then raise notice 'PASS  blocked: %  [%]', msg, sqlerrm; return;
  end;
  raise exception 'FAIL  allowed: %', msg;
end $$;
create function public.t_ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS  %', msg; else raise exception 'FAIL  %', msg; end if;
end $$;
grant execute on function public.t_block(text, text), public.t_ok(boolean, text) to authenticated;

set role authenticated;

-- Raees creates the flat
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.create_flat('Markhor', array['Raees', 'Sohaib', 'Ali'], 1) as fid \gset
select code from public.flats where id = :'fid' \gset
select id as raees from public.members where name = 'Raees' \gset
select id as sohaib from public.members where name = 'Sohaib' \gset
select id as ali from public.members where name = 'Ali' \gset
select public.t_ok(length(:'code') = 6, 'flat created with 6-letter join code ' || :'code');
select public.t_ok((select user_id from public.members where id = :'raees') = auth.uid(), 'Raees linked to his own name');

-- Outsider cannot see or touch anything
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false);
select public.t_ok((select count(*) from public.members) = 0, 'outsider sees no members');
select public.t_ok((select count(*) from public.flats) = 0, 'outsider sees no flats');
select public.t_block(format('insert into public.expenses (flat_id, amount, paid_by, date, meal, shares) values (%L, 100, %L, current_date, %L, %L)', :'fid', :'raees', 'lunch', jsonb_build_object(:'raees', 100)), 'outsider adds an expense');
select public.t_block('select public.join_flat(''ZZZZZZ'')', 'joining with a wrong code');

-- Sohaib joins with the code and links his name
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.join_flat(lower(:'code')) is not null as joined \gset
select public.t_ok((select count(*) from public.members) = 3, 'Sohaib joined with the code (lowercase ok) and sees 3 members');
select public.t_block(format('select public.claim_member(%L)', :'raees'), 'Sohaib takes Raees''s name');
select public.claim_member(:'sohaib');
select public.t_ok((select user_id from public.members where id = :'sohaib') = auth.uid(), 'Sohaib linked to his own name');
select public.t_block(format('update public.members set user_id = auth.uid() where id = %L', :'raees'), 'Sohaib links Raees''s name by direct update');

-- Expenses: shares must add up exactly
select public.t_block(format('insert into public.expenses (flat_id, amount, paid_by, date, meal, shares) values (%L, 1000, %L, current_date, %L, %L)', :'fid', :'raees', 'other',
  jsonb_build_object(:'raees', 333, :'sohaib', 333, :'ali', 333)), 'shares 999 for amount 1000');
select public.t_block(format('insert into public.expenses (flat_id, amount, paid_by, date, meal, shares) values (%L, 1000, %L, current_date, %L, %L)', :'fid', :'raees', 'other',
  jsonb_build_object(:'raees', 333.5, :'sohaib', 333.5, :'ali', 333)), 'half-rupee shares');
select public.t_block(format('insert into public.expenses (flat_id, amount, paid_by, date, meal, shares) values (%L, 100, %L, current_date, %L, %L)', :'fid', :'raees', 'other',
  jsonb_build_object('00000000-0000-0000-0000-000000000123', 100)), 'share for someone outside the flat');
insert into public.expenses (flat_id, amount, paid_by, date, meal, shares)
  values (:'fid', 1000, :'raees', current_date, 'other', jsonb_build_object(:'raees', 334, :'sohaib', 333, :'ali', 333));
select public.t_ok((select created_by_member from public.expenses limit 1) = :'sohaib', 'exact 334/333/333 expense saved, recorded as added by Sohaib');

-- Payments: Sohaib pays Raees 333 and tries to approve it himself
insert into public.payments (flat_id, from_member, to_member, amount, method, date, status)
  values (:'fid', :'sohaib', :'raees', 333, 'JazzCash', current_date, 'approved') ;
select id as p1 from public.payments where amount = 333 \gset
select public.t_ok((select status from public.payments where id = :'p1') = 'pending', 'Sohaib''s payment forced to pending even though he sent "approved"');
select public.t_block(format('update public.payments set status = %L where id = %L', 'approved', :'p1'), 'Sohaib approves his own payment');

-- Zain joins (no name yet) and tries to approve
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.join_flat(:'code') is not null as j2 \gset
select public.t_block(format('update public.payments set status = %L where id = %L', 'approved', :'p1'), 'Zain approves a payment that was not made to him');

-- Raees (the receiver) approves
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.payments set status = 'approved' where id = :'p1';
select public.t_ok((select status = 'approved' and decided_at is not null from public.payments where id = :'p1'), 'Raees (receiver) approved it');
select public.t_block(format('update public.payments set status = %L where id = %L', 'rejected', :'p1'), 'changing an already-approved payment');
select public.t_block(format('update public.payments set amount = 1 where id = %L', :'p1'), 'editing a payment amount');

-- Sohaib pays Ali (Ali has no phone): even the flat owner can't approve it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into public.payments (flat_id, from_member, to_member, amount, date) values (:'fid', :'sohaib', :'ali', 50, current_date);
select id as p2 from public.payments where amount = 50 \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.t_block(format('update public.payments set status = %L where id = %L', 'approved', :'p2'), 'flat owner approves a payment made to Ali');

-- Raees records cash he received from Ali: counts straight away
insert into public.payments (flat_id, from_member, to_member, amount, method, date) values (:'fid', :'ali', :'raees', 333, 'Cash', current_date);
select public.t_ok((select status from public.payments where from_member = :'ali') = 'approved', 'cash Raees received himself is approved automatically');

-- Sohaib cannot delete his approved payment (would re-create a debt silently)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
delete from public.payments where id = :'p1';
select public.t_ok((select count(*) from public.payments where id = :'p1') = 1, 'Sohaib cannot delete an approved payment');

-- Owner can unlink a lost phone
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.unlink_member(:'sohaib');
select public.t_ok((select user_id from public.members where id = :'sohaib') is null, 'owner unlinked Sohaib''s phone');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.t_block(format('select public.unlink_member(%L)', :'raees'), 'non-owner unlinks someone');

-- Screenshots: only flat members can upload into the flat's folder
insert into storage.objects (bucket_id, name) values ('receipts', :'fid' || '/x.jpg');
select public.t_ok(true, 'flat member uploaded a screenshot');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false);
select public.t_block(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'receipts', :'fid' || '/y.jpg'), 'outsider uploads a screenshot');
select public.t_ok((select count(*) from storage.objects) = 0, 'outsider cannot see screenshots');

-- Attendance
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
insert into public.attendance (flat_id, date, member_id, lunch) values (:'fid', current_date, :'ali', false);
select public.t_ok((select not lunch from public.attendance), 'attendance saved');
\echo ALL RULE TESTS PASSED
