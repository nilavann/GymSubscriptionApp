-- REQ-ADMIN-008 (Merge import) at the database layer: import_workbook() — privileges, key matching, update rules,
-- all-or-nothing / skip-invalid, dry run, attribution and audit, subscriptions through create_subscription_with_items.
-- Plain SQL on purpose (no psql variables), so it runs under run.sh's psql AND under any other Postgres runner.
begin;
select t.seed_users();
select t.as_super();

-- ---- helpers -------------------------------------------------------------------------------------------------------
create function t.imp(p_payload jsonb, p_update boolean default false, p_skip boolean default false, p_dry boolean default false)
returns jsonb language sql as $$ select import_workbook(t.admin_id(), p_payload, p_update, p_skip, p_dry) $$;

create function t.outcome(p_res jsonb, p_sheet text, p_row integer) returns text language sql as $$
  select r ->> 'outcome' from jsonb_array_elements(p_res -> 'rows') r where r ->> 'sheet' = p_sheet and (r ->> 'row')::integer = p_row $$;
create function t.msg(p_res jsonb, p_sheet text, p_row integer) returns text language sql as $$
  select r ->> 'message' from jsonb_array_elements(p_res -> 'rows') r where r ->> 'sheet' = p_sheet and (r ->> 'row')::integer = p_row $$;
create function t.rid(p_res jsonb, p_sheet text, p_row integer) returns bigint language sql as $$
  select (r ->> 'id')::bigint from jsonb_array_elements(p_res -> 'rows') r where r ->> 'sheet' = p_sheet and (r ->> 'row')::integer = p_row $$;

-- A valid member payload row; p_extra overrides/extends fields.
create function t.mp(p_row integer, p_phone text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('row', p_row, 'name', 'Imp ' || p_phone, 'phone', p_phone, 'date_of_birth', '1990-01-01',
    'gender', 'Female', 'weight_kg', 60, 'height_cm', 160, 'emergency_contact_name', 'EC',
    'emergency_contact_phone', '9999999999', 'emergency_contact_relationship', 'Friend', 'branch_code', 'MUM') || p_extra $$;

-- A one-item subscription payload (membership plan by name).
create function t.sp(p_row integer, p_phone text, p_plan text, p_start text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('row', p_row, 'member_phone', p_phone, 'items', jsonb_build_array(
    jsonb_build_object('plan_name', p_plan, 'member_phone', p_phone, 'start_date', p_start))) || p_extra $$;

create function t.live_members() returns bigint language sql as $$ select count(*) from members where deleted_at is null $$;
create function t.seq() returns integer language sql as $$ select coalesce((select last_sequence from member_number_sequences where branch_id = t.branch()), 0) $$;

-- ===================================================================================================================
-- A. Privileges — the F10 lesson: revoking from PUBLIC alone leaves Supabase's default grants to anon/authenticated.
-- ===================================================================================================================
select t.ok('IMP-SEC anon cannot execute import_workbook', not has_function_privilege('anon', 'import_workbook(uuid,jsonb,boolean,boolean,boolean)', 'execute'));
select t.ok('IMP-SEC authenticated cannot execute import_workbook', not has_function_privilege('authenticated', 'import_workbook(uuid,jsonb,boolean,boolean,boolean)', 'execute'));
select t.ok('IMP-SEC service_role can execute import_workbook', has_function_privilege('service_role', 'import_workbook(uuid,jsonb,boolean,boolean,boolean)', 'execute'));
select t.ok('IMP-SEC anon/authenticated cannot execute the message helper either', not has_function_privilege('anon', 'import_error_message(text,text,text)', 'execute') and not has_function_privilege('authenticated', 'import_error_message(text,text,text)', 'execute'));
select t.as_user(t.staff_id());
select t.throws('IMP-SEC a signed-in staff user calling the RPC directly is refused', $$ select import_workbook(t.staff_id(), '{}'::jsonb, false, false, false) $$, '%permission denied%');
select t.as_super();
select t.throws('IMP-SEC a non-admin caller id is refused even by the service role (defence in depth)', $$ select import_workbook(t.staff_id(), '{}'::jsonb, false, false, false) $$, '%Admin access required%');
select t.throws('IMP-SEC a deactivated admin id is refused', $$ select import_workbook(t.inactive_id(), '{}'::jsonb, false, false, false) $$, '%Admin access required%');
select t.throws('IMP payload must be a JSON object', $$ select import_workbook(t.admin_id(), '[]'::jsonb, false, false, false) $$, '%JSON object%');
select t.lives('IMP an empty object is a valid (empty) import', $$ select import_workbook(t.admin_id(), '{}'::jsonb, false, false, false) $$);

-- ===================================================================================================================
-- B. Branches and plans
-- ===================================================================================================================
create temp table r_b1 as select t.imp('{"branches":[{"row":2,"name":"Pune Camp","code":"PUN"},{"row":3,"name":"Goa","code":"GOA"}]}') as res;
select t.eq('IMP-BR new branches are created', (select array[t.outcome(res,'branches',2), t.outcome(res,'branches',3)] from r_b1), array['created','created']);
select t.eq('IMP committed=true on a clean import', (select (res ->> 'committed')::boolean from r_b1), true);
select t.eq('IMP-BR created branch is real and live', (select count(*)::int from branches where code in ('PUN','GOA') and deleted_at is null), 2);
select t.eq('IMP-BR created_by is the IMPORTING admin (attribution trick)', (select created_by from branches where code = 'PUN'), t.admin_id());

create temp table r_b2 as select t.imp('{"branches":[{"row":2,"name":"Renamed","code":"PUN"}]}') as res;
select t.eq('IMP-BR existing code is skipped by default (never duplicated, never renamed)', (select t.outcome(res,'branches',2) from r_b2), 'skipped_exists');
select t.eq('IMP-BR skipped branch keeps its name', (select name from branches where code = 'PUN'), 'Pune Camp');

create temp table r_b3 as select t.imp('{"branches":[{"row":2,"name":"Renamed","code":"PUN"}]}', true) as res;
select t.eq('IMP-BR update_existing renames the branch', (select t.outcome(res,'branches',2) from r_b3), 'updated');
select t.eq('IMP-BR the rename was applied', (select name from branches where code = 'PUN'), 'Renamed');
create temp table r_b4 as select t.imp('{"branches":[{"row":2,"name":"Renamed","code":"PUN"}]}', true) as res;
select t.eq('IMP-BR an identical update is "unchanged" (no write)', (select t.outcome(res,'branches',2) from r_b4), 'unchanged');

update branches set deleted_at = now(), deleted_by = t.admin_id() where code = 'GOA';
create temp table r_b5 as select t.imp('{"branches":[{"row":2,"name":"Goa Again","code":"GOA"}]}') as res;
select t.eq('IMP-BR a soft-deleted branch''s code counts as free and is created anew', (select t.outcome(res,'branches',2) from r_b5), 'created');
select t.eq('IMP-BR both the deleted and the new GOA exist as separate rows', (select count(*)::int from branches where code = 'GOA'), 2);
create temp table r_b6 as select t.imp('{"branches":[{"row":2,"name":"","code":"BLK"}]}') as res;
select t.eq('IMP-BR a blank name is an error row', (select t.outcome(res,'branches',2) from r_b6), 'error');
select t.eq('IMP-BR ...with a plain-language message ("Name is required", not a constraint dump)', (select t.msg(res,'branches',2) from r_b6), 'Name is required');

create temp table r_p1 as select t.imp('{"plans":[
  {"row":2,"name":"Student Monthly","category":"membership","duration_days":30,"price":700,"max_members":1},
  {"row":3,"name":"Locker","category":"addon","duration_days":null,"price":200}]}') as res;
select t.eq('IMP-PLAN new plans are created', (select array[t.outcome(res,'plans',2), t.outcome(res,'plans',3)] from r_p1), array['created','created']);
select t.eq('IMP-PLAN an add-on with no duration is indefinite', (select duration_days is null from plans where name = 'Locker'), true);
select t.eq('IMP-PLAN max_members defaults to 1', (select max_members from plans where name = 'Locker'), 1);
create temp table r_p2 as select t.imp('{"plans":[{"row":2,"name":"Student Monthly","category":"membership","duration_days":30,"price":999}]}') as res;
select t.eq('IMP-PLAN an existing plan name is skipped by default', (select t.outcome(res,'plans',2) from r_p2), 'skipped_exists');
select t.eq('IMP-PLAN ...and its price is untouched', (select price from plans where name = 'Student Monthly'), 700::numeric);
create temp table r_p3 as select t.imp('{"plans":[{"row":2,"name":"Student Monthly","category":"membership","price":850}]}', true) as res;
select t.eq('IMP-PLAN update_existing changes only the supplied fields', (select t.outcome(res,'plans',2) from r_p3), 'updated');
select t.eq('IMP-PLAN price updated, duration (blank) left alone', (select array[price::text, duration_days::text] from plans where name = 'Student Monthly'), array['850.00','30']);
create temp table r_p4 as select t.imp('{"plans":[{"row":2,"name":"Student Monthly","category":"addon","price":850}]}', true) as res;
select t.eq('IMP-PLAN a category change is refused, never silently ignored', (select t.outcome(res,'plans',2) from r_p4), 'error');
select t.ok('IMP-PLAN ...with a clear message', (select t.msg(res,'plans',2) from r_p4) ilike '%category cannot be changed%');
select t.eq('IMP-PLAN category was not changed', (select category from plans where name = 'Student Monthly'), 'membership');
create temp table r_p5 as select t.imp('{"plans":[{"row":2,"name":"Bad Membership","category":"membership","price":100}]}') as res;
select t.eq('IMP-PLAN a membership plan without a duration is an error row', (select t.outcome(res,'plans',2) from r_p5), 'error');
select t.ok('IMP-PLAN ...worded for a human', (select t.msg(res,'plans',2) from r_p5) ilike '%needs a duration%');

-- ===================================================================================================================
-- C. Members
-- ===================================================================================================================
select t.eq('(setup) the MUM counter starts where the seed left it', (select t.seq()), 0);
create temp table r_m1 as select t.imp(jsonb_build_object('members', jsonb_build_array(t.mp(2, '9100000001'), t.mp(3, '9100000002')))) as res;
select t.eq('IMP-MEM new members are created', (select array[t.outcome(res,'members',2), t.outcome(res,'members',3)] from r_m1), array['created','created']);
select t.ok('IMP-MEM member_number is GENERATED in the normal format (never taken from the file)',
  (select member_number ~ '^MUM-\d{4}-\d{4}$' from members where phone = '9100000001'));
select t.eq('IMP-MEM numbers are consecutive per the branch counter', (select array_agg(right(member_number, 4) order by member_number) from members where phone in ('9100000001','9100000002')), array['0001','0002']);
select t.eq('IMP-MEM created_by is the importing admin', (select created_by from members where phone = '9100000001'), t.admin_id());
select t.eq('IMP-MEM date_of_joining defaults to today when blank', (select date_of_joining from members where phone = '9100000001'), current_date);
select t.eq('IMP-MEM under_doctor_care defaults to false', (select under_doctor_care from members where phone = '9100000001'), false);
select t.ok('IMP-MEM the outcome carries the new member id (used for photo upload)', (select t.rid(res,'members',2) = (select id from members where phone = '9100000001') from r_m1));
select t.ok('IMP-AUDIT normal field-level audit rows were written, attributed to the importing admin',
  (select count(*) > 0 from audit_log where table_name = 'members' and operation = 'insert' and changed_by = t.admin_id() and record_id = (select id::text from members where phone = '9100000001')));

create temp table r_m2 as select t.imp(jsonb_build_object('members', jsonb_build_array(t.mp(2, '9100000001', '{"name":"Changed"}')))) as res;
select t.eq('IMP-MEM an existing phone is skipped by default', (select t.outcome(res,'members',2) from r_m2), 'skipped_exists');
select t.eq('IMP-MEM re-importing does not duplicate', (select count(*)::int from members where phone = '9100000001'), 1);
select t.eq('IMP-MEM ...and does not rename', (select name from members where phone = '9100000001'), 'Imp 9100000001');
select t.eq('IMP-MEM a skip does not touch the counter', (select t.seq()), 2);

create temp table r_m3 as select t.imp(jsonb_build_object('members', jsonb_build_array(
  t.mp(2, '9100000001', '{"name":"Renamed Member","occupation":"Teacher","email":"","gender":""}'))), true) as res;
select t.eq('IMP-MEM update_existing updates a member', (select t.outcome(res,'members',2) from r_m3), 'updated');
select t.eq('IMP-MEM supplied non-blank fields are applied', (select array[name, occupation] from members where phone = '9100000001'), array['Renamed Member','Teacher']);
select t.eq('IMP-MEM BLANK cells never overwrite (gender "" kept)', (select gender from members where phone = '9100000001'), 'Female');
select t.eq('IMP-MEM member_number and branch are unchanged by an update', (select array[member_number, branch_id::text] from members where phone = '9100000001'), array['MUM-' || extract(year from now())::int || '-0001', t.branch()::text]);
select t.eq('IMP-MEM changed_by is the importing admin on update', (select changed_by from members where phone = '9100000001'), t.admin_id());
create temp table r_m4 as select t.imp(jsonb_build_object('members', jsonb_build_array(t.mp(2, '9100000001', '{"name":"Renamed Member","occupation":"Teacher"}'))), true) as res;
select t.eq('IMP-MEM an update with nothing different is "unchanged"', (select t.outcome(res,'members',2) from r_m4), 'unchanged');
create temp table r_m5 as select t.imp(jsonb_build_object('members', jsonb_build_array(
  t.mp(2, '9100000001', jsonb_build_object('branch_code', 'PUN', 'photo_url', 'x/evil.jpg', 'member_number', 'HACK-0001')))), true) as res;
select t.eq('IMP-MEM a different branch_code / member_number / photo in the file changes nothing on an existing member',
  (select array[branch_id::text, member_number, coalesce(photo_url,'-')] from members where phone = '9100000001'),
  array[t.branch()::text, 'MUM-' || extract(year from now())::int || '-0001', '-']);

-- required fields are enforced by the database with human wording
create temp table r_m0 as select t.imp(jsonb_build_object('members', jsonb_build_array(
  t.mp(2, '9100000090', '{"name":null}'), t.mp(3, '9100000091', '{"weight_kg":null}'), t.mp(4, '9100000092', '{"emergency_contact_name":""}'),
  t.mp(5, '9100000093', '{"date_of_birth":null}'))), false, true) as res;
select t.eq('IMP-MEM a missing name reads "Name is required"', (select t.msg(res,'members',2) from r_m0), 'Name is required');
select t.eq('IMP-MEM a missing weight reads "Weight kg is required"', (select t.msg(res,'members',3) from r_m0), 'Weight kg is required');
select t.eq('IMP-MEM a blank emergency contact name is required', (select t.msg(res,'members',4) from r_m0), 'Emergency contact name is required');
select t.eq('IMP-MEM a missing date of birth reads "Date of birth is required"', (select t.msg(res,'members',5) from r_m0), 'Date of birth is required');
create temp table r_m0b as select t.imp(jsonb_build_object('members', jsonb_build_array(t.mp(2, '9100000094', '{"branch_code":""}'), t.mp(3, '9100000095', '{"branch_code":null}'))), false, true) as res;
select t.eq('IMP-MEM a blank branch code reads "Branch is required"', (select array[t.msg(res,'members',2), t.msg(res,'members',3)] from r_m0b), array['Branch is required','Branch is required']);
select t.eq('IMP-MEM none of them created a member', (select count(*)::int from members where phone in ('9100000090','9100000091','9100000092','9100000093')), 0);

-- unknown branch, doctor-care rule, atomicity of a failed row, counter not burned
select t.eq('(setup) counter before the failing rows', (select t.seq()), 2);
create temp table r_m6 as select t.imp(jsonb_build_object('members', jsonb_build_array(
  t.mp(2, '9100000010'),
  t.mp(3, '9100000011', '{"branch_code":"NOPE"}'),
  t.mp(4, '9100000012', '{"under_doctor_care":true}'),
  t.mp(5, '9100000013'))), false, true) as res;
select t.eq('IMP-MEM with skip_invalid the valid rows commit and the bad ones are reported',
  (select array[t.outcome(res,'members',2), t.outcome(res,'members',3), t.outcome(res,'members',4), t.outcome(res,'members',5)] from r_m6),
  array['created','error','error','created']);
select t.eq('IMP-MEM committed=true under skip_invalid despite errors', (select (res ->> 'committed')::boolean from r_m6), true);
select t.ok('IMP-MEM unknown branch has a clear message', (select t.msg(res,'members',3) from r_m6) like '%Branch "NOPE" not found%');
select t.ok('IMP-MEM doctor-care rule has a human message', (select t.msg(res,'members',4) from r_m6) like '%under doctor%');
select t.eq('IMP-MEM failed rows left no member behind', (select count(*)::int from members where phone in ('9100000011','9100000012')), 0);
select t.eq('IMP-MEM a failed row burns NO member number (counter advanced by the 2 successes only)', (select t.seq()), 4);
select t.eq('IMP-MEM so the numbers stay gap-free', (select array_agg(right(member_number, 4) order by member_number) from members where phone in ('9100000010','9100000013')), array['0003','0004']);

create temp table r_m7 as select t.imp(jsonb_build_object('members', jsonb_build_array(
  t.mp(2, '9100000020', jsonb_build_object('handled_by_email', 'STAFF@gym.test')),
  t.mp(3, '9100000021', '{"handled_by_email":"nobody@gym.test"}'),
  t.mp(4, '9100000022', '{"handled_by_email":"inactive@gym.test"}')))) as res;
select t.eq('IMP-MEM handled_by_email resolves case-insensitively to an active user', (select handled_by_staff from members where phone = '9100000020'), t.staff_id());
select t.eq('IMP-MEM an unknown email still imports the member, with the field empty', (select handled_by_staff is null from members where phone = '9100000021'), true);
select t.ok('IMP-MEM ...and reports a warning', (select (r ->> 'warning') like '%nobody@gym.test%' from jsonb_array_elements((select res from r_m7) -> 'rows') r where (r ->> 'row')::int = 3));
select t.eq('IMP-MEM a DEACTIVATED user is not accepted as handled-by', (select handled_by_staff is null from members where phone = '9100000022'), true);

update members set deleted_at = now(), deleted_by = t.admin_id() where phone = '9100000020';
create temp table r_m8 as select t.imp(jsonb_build_object('members', jsonb_build_array(t.mp(2, '9100000020')))) as res;
select t.eq('IMP-MEM a soft-deleted member''s phone is free: a new member is created, never resurrected', (select t.outcome(res,'members',2) from r_m8), 'created');
select t.eq('IMP-MEM the deleted one stays deleted', (select count(*)::int from members where phone = '9100000020' and deleted_at is not null), 1);

-- ===================================================================================================================
-- D. Subscriptions (through create_subscription_with_items)
-- ===================================================================================================================
create temp table r_s1 as select t.imp(jsonb_build_object('subscriptions', jsonb_build_array(
  jsonb_build_object('row', 2, 'member_phone', '9100000001', 'payment_mode', 'UPI', 'notes', 'imported', 'items', jsonb_build_array(
    jsonb_build_object('plan_name', 'Monthly', 'member_phone', '9100000001', 'start_date', '2026-01-15', 'end_date', '1999-01-01', 'amount_paid', 900),
    jsonb_build_object('plan_name', 'Zumba Class', 'member_phone', '9100000001', 'start_date', '2026-01-15', 'quantity', 2)))))) as res;
select t.eq('IMP-SUB a subscription with a membership + an add-on is created whole', (select t.outcome(res,'subscriptions',2) from r_s1), 'created');
select t.eq('IMP-SUB header carries the payment mode and notes', (select array[payment_mode, notes] from subscriptions where id = (select t.rid(res,'subscriptions',2) from r_s1)), array['UPI','imported']);
select t.eq('IMP-SUB end_date is RECOMPUTED (start + 30 - 1), never read from the file', (select end_date from subscription_items where subscription_id = (select t.rid(res,'subscriptions',2) from r_s1) and plan_id = t.plan('Monthly')), date '2026-02-13');
select t.eq('IMP-SUB quantity multiplies the duration (Zumba 30 days x 2: 15 Jan + 59 days = 15 Mar)', (select end_date from subscription_items where subscription_id = (select t.rid(res,'subscriptions',2) from r_s1) and plan_id = t.plan('Zumba Class')), date '2026-03-15');
select t.eq('IMP-SUB a given amount_paid is kept; a blank one defaults to price x quantity', (select array_agg(amount_paid::text order by plan_id) from subscription_items where subscription_id = (select t.rid(res,'subscriptions',2) from r_s1)), array['900.00','1600.00']);
select t.eq('IMP-SUB created_by is the importing admin', (select created_by from subscriptions where id = (select t.rid(res,'subscriptions',2) from r_s1)), t.admin_id());

create temp table r_s2 as select t.imp(jsonb_build_object('subscriptions', jsonb_build_array(
  jsonb_build_object('row', 2, 'member_phone', '9100000001', 'items', jsonb_build_array(
    jsonb_build_object('plan_name', 'Monthly', 'member_phone', '9100000001', 'start_date', '2026-01-15')))))) as res;
select t.eq('IMP-SUB a subscription whose item already exists (member+plan+start date) is skipped — re-import is a no-op', (select t.outcome(res,'subscriptions',2) from r_s2), 'skipped_exists');
select t.eq('IMP-SUB ...and nothing was added', (select count(*)::int from subscriptions where member_id = (select id from members where phone = '9100000001')), 1);

create temp table r_s3 as select t.imp(jsonb_build_object('subscriptions', jsonb_build_array(
  t.sp(2, '9100000002', 'Membership Fee', '2026-02-01'),
  t.sp(3, '9100000002', 'Monthly', '2026-02-01', '{"payment_mode":null}'),
  t.sp(4, '9100000099', 'Monthly', '2026-02-01'),
  t.sp(5, '9100000002', 'No Such Plan', '2026-02-01'))), false, true) as res;
select t.eq('IMP-SUB an add-on-only subscription is an error (exactly one membership item is required)', (select t.outcome(res,'subscriptions',2) from r_s3), 'error');
select t.ok('IMP-SUB ...worded clearly', (select t.msg(res,'subscriptions',2) from r_s3) like '%exactly one membership item%');
select t.eq('IMP-SUB a valid one in the same batch still commits (skip_invalid)', (select t.outcome(res,'subscriptions',3) from r_s3), 'created');
select t.eq('IMP-SUB payment_mode defaults to Cash', (select payment_mode from subscriptions where id = (select t.rid(res,'subscriptions',3) from r_s3)), 'Cash');
select t.ok('IMP-SUB an unknown member phone is an error', (select t.msg(res,'subscriptions',4) from r_s3) like '%Member with phone 9100000099 not found%');
select t.ok('IMP-SUB an unknown plan is an error', (select t.msg(res,'subscriptions',5) from r_s3) like '%Plan "No Such Plan" not found%');
select t.eq('IMP-SUB failed subscriptions left no orphan header (atomic)', (select count(*)::int from subscriptions s where s.member_id = (select id from members where phone = '9100000002') and not exists (select 1 from subscription_items i where i.subscription_id = s.id)), 0);

create temp table r_s4 as select t.imp(jsonb_build_object('subscriptions', jsonb_build_array(
  jsonb_build_object('row', 2, 'member_phone', '9100000010', 'items', jsonb_build_array(
    jsonb_build_object('plan_name', 'Monthly', 'member_phone', '9100000010', 'start_date', '2026-03-01'),
    jsonb_build_object('plan_name', 'Quarterly', 'member_phone', '9100000010', 'start_date', '2026-03-01')))))) as res;
select t.eq('IMP-SUB two membership items in one checkout is an error', (select t.outcome(res,'subscriptions',2) from r_s4), 'error');
select t.eq('IMP-SUB ...and nothing was written for it', (select count(*)::int from subscriptions where member_id = (select id from members where phone = '9100000010')), 0);

create temp table r_s5 as select t.imp(jsonb_build_object('subscriptions', jsonb_build_array(
  jsonb_build_object('row', 2, 'member_phone', '9100000010', 'items', jsonb_build_array(
    jsonb_build_object('plan_name', 'Monthly', 'member_phone', '9100000010', 'start_date', '2026-03-01'),
    jsonb_build_object('plan_name', 'Membership Fee', 'member_phone', '9100000010', 'start_date', '2026-03-01'))),
  jsonb_build_object('row', 3, 'member_phone', '9100000010', 'items', jsonb_build_array(
    jsonb_build_object('plan_name', 'Monthly', 'member_phone', '9100000010', 'start_date', '2026-05-01'),
    jsonb_build_object('plan_name', 'Membership Fee', 'member_phone', '9100000010', 'start_date', '2026-05-01'))))),
  false, true) as res;
select t.eq('IMP-SUB the first checkout with an indefinite add-on is created', (select t.outcome(res,'subscriptions',2) from r_s5), 'created');
select t.eq('IMP-SUB REQ-SUB-007: attaching the same indefinite plan again is rejected', (select t.outcome(res,'subscriptions',3) from r_s5), 'error');
select t.ok('IMP-SUB ...with the usual message', (select t.msg(res,'subscriptions',3) from r_s5) like '%already has an active indefinite item%');
select t.eq('IMP-SUB ...and the rejected checkout left nothing behind (no orphan header)', (select count(*)::int from subscriptions where member_id = (select id from members where phone = '9100000010')), 1);

create temp table r_s6 as select t.imp(jsonb_build_object('subscriptions', jsonb_build_array(
  jsonb_build_object('row', 2, 'member_phone', '9100000013', 'items', jsonb_build_array(
    jsonb_build_object('plan_name', 'Monthly', 'member_phone', '9100000013', 'shared_member_phone', '9100000010', 'start_date', '2026-06-01'))),
  jsonb_build_object('row', 3, 'member_phone', '9100000013', 'items', jsonb_build_array(
    jsonb_build_object('plan_name', 'Couple Monthly', 'member_phone', '9100000013', 'shared_member_phone', '9100000013', 'start_date', '2026-07-01'))),
  jsonb_build_object('row', 4, 'member_phone', '9100000013', 'items', jsonb_build_array(
    jsonb_build_object('plan_name', 'Couple Monthly', 'member_phone', '9100000013', 'shared_member_phone', '9100000010', 'start_date', '2026-08-01'))),
  jsonb_build_object('row', 5, 'member_phone', '9100000013', 'items', jsonb_build_array(
    jsonb_build_object('plan_name', 'Monthly', 'member_phone', '9100000013', 'quantity', 0, 'start_date', '2026-09-01'))),
  jsonb_build_object('row', 6, 'member_phone', '9100000013', 'items', jsonb_build_array(
    jsonb_build_object('plan_name', 'Day', 'member_phone', '9100000013', 'start_date', 'not-a-date'))))), false, true) as res;
select t.ok('IMP-SUB a shared member on a single-person plan is refused', (select t.msg(res,'subscriptions',2) from r_s6) like '%does not allow a shared member%');
select t.ok('IMP-SUB a shared member equal to the member is refused', (select t.msg(res,'subscriptions',3) from r_s6) like '%cannot be the same person%');
select t.eq('IMP-SUB a couple plan with a different shared member is created', (select t.outcome(res,'subscriptions',4) from r_s6), 'created');
select t.eq('IMP-SUB ...and records the shared member', (select shared_member_id from subscription_items where subscription_id = (select t.rid(res,'subscriptions',4) from r_s6)), (select id from members where phone = '9100000010'));
select t.ok('IMP-SUB quantity 0 is refused', (select t.msg(res,'subscriptions',5) from r_s6) like '%at least 1%');
select t.eq('IMP-SUB an unparseable date is an error row, not a crash', (select t.outcome(res,'subscriptions',6) from r_s6), 'error');

-- ===================================================================================================================
-- E. Modes: dry run, all-or-nothing, skip-invalid; order of sheets; cross-sheet references within one import
-- ===================================================================================================================
select t.eq('(setup) member count and counter before the dry run', (select array[t.live_members()::text, t.seq()::text]), array[t.live_members()::text, t.seq()::text]);
create temp table snap as select t.live_members() as members, t.seq() as seq, (select count(*) from subscriptions) as subs, (select count(*) from audit_log) as audit, (select count(*) from branches) as branches;
create temp table r_d1 as select t.imp(jsonb_build_object(
  'branches', jsonb_build_array(jsonb_build_object('row', 2, 'name', 'Dry Branch', 'code', 'DRY')),
  'members', jsonb_build_array(t.mp(2, '9100000030', '{"branch_code":"DRY"}'), t.mp(3, '9100000031')),
  'subscriptions', jsonb_build_array(t.sp(2, '9100000030', 'Monthly', '2026-04-01'))), false, false, true) as res;
select t.eq('IMP-DRY a dry run reports what WOULD happen (created/created/created)', (select array[t.outcome(res,'branches',2), t.outcome(res,'members',2), t.outcome(res,'subscriptions',2)] from r_d1), array['created','created','created']);
select t.eq('IMP-DRY ...but committed=false, dry_run=true, aborted=false', (select array[(res ->> 'committed'), (res ->> 'dry_run'), (res ->> 'aborted')] from r_d1), array['false','true','false']);
select t.eq('IMP-DRY a dry run changes NOTHING: members', (select t.live_members() = members from snap), true);
select t.eq('IMP-DRY ...the member-number counter is untouched', (select t.seq() = seq from snap), true);
select t.eq('IMP-DRY ...no subscription was written', (select (select count(*) from subscriptions) = subs from snap), true);
select t.eq('IMP-DRY ...no branch was written', (select (select count(*) from branches) = branches from snap), true);
select t.eq('IMP-DRY ...no audit rows were left behind', (select (select count(*) from audit_log) = audit from snap), true);
select t.eq('IMP-DRY a member may reference a branch created EARLIER IN THE SAME FILE (resolved inside the one transaction)', (select t.outcome(res,'members',2) from r_d1), 'created');

create temp table r_a1 as select t.imp(jsonb_build_object('members', jsonb_build_array(t.mp(2, '9100000040'), t.mp(3, '9100000041', '{"branch_code":"NOPE"}'), t.mp(4, '9100000042'))), false, false, false) as res;
select t.eq('IMP-ABORT one bad row with skip_invalid=false aborts the WHOLE import', (select array[(res ->> 'committed'), (res ->> 'aborted')] from r_a1), array['false','true']);
select t.eq('IMP-ABORT ...the outcome list still says which row failed and what the others would have done', (select array[t.outcome(res,'members',2), t.outcome(res,'members',3), t.outcome(res,'members',4)] from r_a1), array['created','error','created']);
select t.eq('IMP-ABORT ...and nothing at all was committed', (select count(*)::int from members where phone in ('9100000040','9100000041','9100000042')), 0);
select t.eq('IMP-ABORT ...the counter is unchanged', (select t.seq() = seq from snap), true);

create temp table r_k1 as select t.imp('{"branches":[{"row":2,"name":"Idem","code":"IDM"}],"plans":[{"row":2,"name":"Idem Plan","category":"addon","price":10}]}') as res;
create temp table r_k2 as select t.imp('{"branches":[{"row":2,"name":"Idem","code":"IDM"}],"plans":[{"row":2,"name":"Idem Plan","category":"addon","price":10}]}') as res;
select t.eq('IMP-IDEM importing the same file twice creates nothing the second time', (select array[t.outcome(res,'branches',2), t.outcome(res,'plans',2)] from r_k2), array['skipped_exists','skipped_exists']);

select t.eq('IMP a result row for every payload row, in sheet order', (select array_agg(r ->> 'sheet') from jsonb_array_elements((select res from r_d1) -> 'rows') r), array['branches','members','members','subscriptions']);

select t.eq('IMP soft-deleted rows are never deleted or revived by an import (deleted counts only ever grow by explicit deletes)',
  (select count(*)::int from members where deleted_at is not null), 1);

rollback;
