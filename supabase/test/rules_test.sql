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
-- "silently nothing happened" checks (row level security hides rows instead of erroring)
create function public.t_noop(q text, msg text) returns void language plpgsql as $$
declare n int;
begin
  execute q; get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  no effect: %', msg; else raise exception 'FAIL  changed % row(s): %', n, msg; end if;
end $$;
grant execute on function public.t_block(text, text), public.t_ok(boolean, text), public.t_noop(text, text) to authenticated;

set role authenticated;
\set R '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set X '00000000-0000-0000-0000-0000000000ff'

-- ===== Raees (owner) creates the flat; Ali has no phone =====
select set_config('request.jwt.claim.sub', :'R', false);
select public.create_flat('Markhor', array['Raees', 'Sohaib', 'Ali'], 1) as fid \gset
select code from public.flats where id = :'fid' \gset
select id as raees from public.members where name = 'Raees' \gset
select id as sohaib from public.members where name = 'Sohaib' \gset
select id as ali from public.members where name = 'Ali' \gset
select public.t_ok(length(:'code') = 6, 'flat created with join code ' || :'code');

-- ===== outsider =====
select set_config('request.jwt.claim.sub', :'X', false);
select public.t_ok((select count(*) from public.members) = 0, 'outsider sees no members');
select public.t_block('select public.join_flat(''ZZZZZZ'')', 'joining with a wrong code');

-- ===== Sohaib joins =====
select set_config('request.jwt.claim.sub', :'B', false);
select public.join_flat(lower(:'code')) is not null as j1 \gset
select public.t_block(format('select public.claim_member(%L)', :'raees'), 'Sohaib takes Raees''s name');
select public.claim_member(:'sohaib');
select public.t_ok((select user_id from public.members where id = :'sohaib') = auth.uid(), 'Sohaib linked to his name');

-- members & flat: no tampering
select public.t_block(format('update public.members set name = %L where id = %L', 'Fool', :'raees'), 'Sohaib renames Raees');
select public.t_block(format('update public.members set active = false where id = %L', :'ali'), 'Sohaib removes Ali');
update public.members set name = 'Sohaib K' where id = :'sohaib';
select public.t_ok((select name from public.members where id = :'sohaib') = 'Sohaib K', 'Sohaib renames himself');
select public.t_block(format('insert into public.members (flat_id, name) values (%L, %L)', :'fid', 'Fake guy'), 'Sohaib adds a fake member');
select public.t_noop(format('update public.flats set name = %L where id = %L', 'Hacked', :'fid'), 'Sohaib renames the flat');

-- expenses: only what you paid
select public.t_block(format('insert into public.expenses (flat_id, amount, paid_by, date, meal, shares) values (%L, 300, %L, current_date, %L, %L)', :'fid', :'raees', 'lunch',
  jsonb_build_object(:'raees', 100, :'sohaib', 100, :'ali', 100)), 'Sohaib adds an expense "paid by Raees"');
select public.t_block(format('insert into public.expenses (flat_id, amount, paid_by, date, meal, shares) values (%L, 300, %L, current_date, %L, %L)', :'fid', :'ali', 'lunch',
  jsonb_build_object(:'raees', 100, :'sohaib', 100, :'ali', 100)), 'Sohaib adds an expense "paid by Ali"');
select public.t_block(format('insert into public.expenses (flat_id, amount, paid_by, date, meal, shares) values (%L, 1000, %L, current_date, %L, %L)', :'fid', :'sohaib', 'other',
  jsonb_build_object(:'raees', 333, :'sohaib', 333, :'ali', 333)), 'shares 999 for amount 1000');
insert into public.expenses (flat_id, amount, paid_by, date, meal, note, shares)
  values (:'fid', 1000, :'sohaib', current_date, 'lunch', 'roti', jsonb_build_object(:'sohaib', 334, :'raees', 333, :'ali', 333));
select id as sexp from public.expenses where note = 'roti' \gset
select public.t_ok(true, 'Sohaib adds what he paid (334/333/333)');

-- attendance: own only
select public.t_block(format('insert into public.attendance (flat_id, date, member_id, lunch) values (%L, current_date, %L, false)', :'fid', :'ali'), 'Sohaib marks Ali as not eating');
insert into public.attendance (flat_id, date, member_id, lunch) values (:'fid', current_date, :'sohaib', false);
select public.t_ok(true, 'Sohaib marks himself');

-- payments: only your own
select public.t_block(format('insert into public.payments (flat_id, from_member, to_member, amount, date) values (%L, %L, %L, 50, current_date)', :'fid', :'raees', :'ali'), 'Sohaib records a payment between Raees and Ali');
insert into public.payments (flat_id, from_member, to_member, amount, date, status) values (:'fid', :'sohaib', :'raees', 200, current_date, 'approved');
select id as p1 from public.payments where amount = 200 \gset
select public.t_ok((select status from public.payments where id = :'p1') = 'pending', 'Sohaib''s payment forced to pending');
select public.t_noop(format('update public.payments set status = %L where id = %L', 'approved', :'p1'), 'Sohaib approves his own payment');

-- receipts
insert into storage.objects (bucket_id, name) values ('receipts', :'fid' || '/sohaib.jpg');

-- ===== Zain joins and adds himself =====
select set_config('request.jwt.claim.sub', :'C', false);
select public.join_flat(:'code') is not null as j2 \gset
insert into public.members (flat_id, name, user_id) values (:'fid', 'Zain', auth.uid());
select public.t_ok((select count(*) from public.members where name = 'Zain') = 1, 'Zain adds himself');
select public.t_block(format('insert into public.members (flat_id, name, user_id) values (%L, %L, auth.uid())', :'fid', 'Zain 2'), 'Zain adds himself a second time');
select public.t_noop(format('update public.payments set status = %L where id = %L', 'approved', :'p1'), 'Zain approves a payment to Raees');
select public.t_noop(format('delete from public.expenses where id = %L', :'sexp'), 'Zain deletes Sohaib''s expense');
select public.t_noop(format('delete from storage.objects where name = %L', :'fid' || '/sohaib.jpg'), 'Zain deletes Sohaib''s screenshot');

-- ===== Raees (owner, receiver) =====
select set_config('request.jwt.claim.sub', :'R', false);
update public.payments set status = 'approved' where id = :'p1';
select public.t_ok((select status from public.payments where id = :'p1') = 'approved', 'Raees (receiver) approves');
select public.t_block(format('update public.payments set status = %L where id = %L', 'rejected', :'p1'), 'changing an approved payment');
select public.t_noop(format('delete from public.expenses where id = %L', :'sexp'), 'even the owner can''t delete Sohaib''s expense');
insert into public.expenses (flat_id, amount, paid_by, date, meal, shares)
  values (:'fid', 90, :'ali', current_date, 'other', jsonb_build_object(:'raees', 30, :'sohaib', 30, :'ali', 30));
select public.t_ok(true, 'owner adds an expense for Ali (no phone)');
insert into public.attendance (flat_id, date, member_id, dinner) values (:'fid', current_date, :'ali', false);
select public.t_ok(true, 'owner marks Ali''s attendance');
update public.members set name = 'Ali Bhai' where id = :'ali';
select public.t_ok((select name from public.members where id = :'ali') = 'Ali Bhai', 'owner renames a member');
update public.flats set name = 'Markhor Flat' where id = :'fid';
select public.t_ok((select name from public.flats where id = :'fid') = 'Markhor Flat', 'owner renames the flat');
insert into public.payments (flat_id, from_member, to_member, amount, method, date) values (:'fid', :'ali', :'raees', 30, 'Cash', current_date);
select public.t_ok((select status from public.payments where amount = 30) = 'approved', 'cash Raees received is approved automatically');

-- ===== Sohaib can't delete his approved payment; can delete own expense =====
select set_config('request.jwt.claim.sub', :'B', false);
select public.t_noop(format('delete from public.payments where id = %L', :'p1'), 'Sohaib deletes his approved payment');
delete from public.expenses where id = :'sexp';
select public.t_ok((select count(*) from public.expenses where id = :'sexp') = 0, 'Sohaib deletes his own expense');
delete from storage.objects where name = :'fid' || '/sohaib.jpg';
select public.t_ok((select count(*) from storage.objects) = 0, 'Sohaib deletes his own screenshot');

-- ===== 003: report a wrong expense =====
select id as zain from public.members where name = 'Zain' \gset
select set_config('request.jwt.claim.sub', :'B', false);
insert into public.expenses (flat_id, amount, paid_by, date, meal, note, shares)
  values (:'fid', 900, :'sohaib', current_date, 'other', 'wrong1', jsonb_build_object(:'sohaib', 300, :'raees', 300, :'zain', 300));
insert into public.expenses (flat_id, amount, paid_by, date, meal, note, shares)
  values (:'fid', 600, :'sohaib', current_date, 'other', 'wrong2', jsonb_build_object(:'sohaib', 300, :'raees', 300));
insert into public.expenses (flat_id, amount, paid_by, date, meal, note, shares)
  values (:'fid', 600, :'sohaib', current_date, 'other', 'wrong3', jsonb_build_object(:'sohaib', 300, :'zain', 300));
select id as w1 from public.expenses where note = 'wrong1' \gset
select id as w2 from public.expenses where note = 'wrong2' \gset
select id as w3 from public.expenses where note = 'wrong3' \gset
select public.t_block(format('update public.expenses set disputed_by = %L where id = %L', :'sohaib', :'w1'), 'Sohaib reports his own expense (should just delete it)');

select set_config('request.jwt.claim.sub', :'C', false);
select public.t_block(format('update public.expenses set disputed_by = %L where id = %L', :'sohaib', :'w1'), 'Zain reports in Sohaib''s name');
select public.t_block(format('update public.expenses set disputed_by = %L where id = %L', :'zain', :'w2'), 'Zain reports an expense he is not part of');
update public.expenses set disputed_by = :'zain', dispute_note = 'I was not there' where id = :'w1';
select public.t_ok((select disputed_at is not null and dispute_note = 'I was not there' from public.expenses where id = :'w1'), 'Zain reports wrong1 with a note');
select public.t_block(format('update public.expenses set amount = 1 where id = %L', :'w1'), 'Zain changes the amount');
select public.t_noop(format('delete from public.expenses where id = %L', :'w1'), 'Zain deletes a reported expense he did not add');
update public.expenses set disputed_by = :'zain' where id = :'w3';

select set_config('request.jwt.claim.sub', :'R', false);
select public.t_block(format('update public.expenses set disputed_by = %L where id = %L', :'raees', :'w1'), 'Raees reports wrong1 again (already reported)');
select public.t_block(format('update public.expenses set disputed_by = null where id = %L', :'w3'), 'owner clears someone else''s report on someone else''s expense');
delete from public.expenses where id = :'w1';
select public.t_ok((select count(*) from public.expenses where id = :'w1') = 0, 'owner removes an expense Zain reported');
update public.expenses set disputed_by = :'raees' where id = :'w2';
select public.t_noop(format('delete from public.expenses where id = %L', :'w2'), 'owner can''t remove an expense only he reported');

select set_config('request.jwt.claim.sub', :'B', false);
update public.expenses set disputed_by = null where id = :'w2';
select public.t_ok((select disputed_by is null and dispute_note is null from public.expenses where id = :'w2'), 'Sohaib (who added it) marks it correct');
select set_config('request.jwt.claim.sub', :'C', false);
update public.expenses set disputed_by = null where id = :'w3';
select public.t_ok((select disputed_by is null from public.expenses where id = :'w3'), 'Zain withdraws his own report');
select set_config('request.jwt.claim.sub', :'X', false);
select public.t_noop(format('update public.expenses set disputed_by = null where id = %L', :'w2'), 'outsider touches an expense');
\echo ALL RULE TESTS PASSED
