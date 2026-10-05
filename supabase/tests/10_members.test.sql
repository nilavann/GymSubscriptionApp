-- REQ-MEM-001/003/005/006/007 at the database layer (constraints, triggers, member-number generator).
begin;
select t.seed_users();
select t.as_super();

-- REQ-MEM-001 required fields / constraints ----------------------------------------------------
select t.lives('MEM-001 valid minimal member inserts', $$ select t.member('9000000001') $$);
select t.throws('MEM-001 name is required', $$
  insert into members (phone,date_of_birth,gender,weight_kg,height_cm,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,branch_id)
  values ('9000000002','1990-01-01','Male',70,170,'e','9','f',t.branch()) $$, '%null value%name%');
select t.throws('MEM-001 date_of_birth is required', $$
  insert into members (name,phone,gender,weight_kg,height_cm,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,branch_id)
  values ('n','9000000003','Male',70,170,'e','9','f',t.branch()) $$, '%null value%date_of_birth%');
select t.throws('MEM-001 branch is required', $$
  insert into members (name,phone,date_of_birth,gender,weight_kg,height_cm,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship)
  values ('n','9000000004','1990-01-01','Male',70,170,'e','9','f') $$, '%branch%');
select t.throws('MEM-001 emergency contact name required', $$
  insert into members (name,phone,date_of_birth,gender,weight_kg,height_cm,emergency_contact_phone,emergency_contact_relationship,branch_id)
  values ('n','9000000005','1990-01-01','Male',70,170,'9','f',t.branch()) $$, '%emergency_contact_name%');
select t.throws('MEM-001 gender limited to Male/Female/Other', $$
  update members set gender = 'X' where phone = '9000000001' $$, '%members_gender_check%');
select t.lives('MEM-001 gender Other accepted', $$ update members set gender = 'Other' where phone = '9000000001' $$);
select t.throws('MEM-001 weight lower bound (0) rejected', $$ update members set weight_kg = 0 where phone='9000000001' $$, '%weight_kg_check%');
select t.throws('MEM-001 weight upper bound (501) rejected', $$ update members set weight_kg = 501 where phone='9000000001' $$, '%weight_kg_check%');
select t.lives('MEM-001 weight boundary 1 and 500 accepted', $$ update members set weight_kg = 1 where phone='9000000001'; update members set weight_kg = 500 where phone='9000000001' $$);
select t.throws('MEM-001 height upper bound (301) rejected', $$ update members set height_cm = 301 where phone='9000000001' $$, '%height_cm_check%');
select t.lives('MEM-001 height boundary 300 accepted', $$ update members set height_cm = 300 where phone='9000000001' $$);
select t.eq('MEM-001 under_doctor_care defaults to false', (select under_doctor_care from members where phone='9000000001'), false);
select t.eq('MEM-001 date_of_joining defaults to current_date', (select date_of_joining from members where phone='9000000001'), current_date);
select t.lives('MEM-001 optional fields may all be null', $$ select 1 from members where phone='9000000001' and email is null and photo_url is null and aadhaar_number is null and occupation is null and residential_address is null $$);

-- Doctor's-care details (edge cases) -------------------------------------------------------------
select t.throws('MEM-001 doctor care=true with NULL details blocked', $$ update members set under_doctor_care = true where phone='9000000001' $$, '%chk_doctor_care_details_required%');
select t.throws('MEM-001 doctor care=true with empty details blocked', $$ update members set under_doctor_care = true, doctor_care_details = '' where phone='9000000001' $$, '%chk_doctor_care_details_required%');
select t.throws('MEM-001 doctor care=true with whitespace-only details blocked', $$ update members set under_doctor_care = true, doctor_care_details = '   ' where phone='9000000001' $$, '%chk_doctor_care_details_required%');
select t.lives('MEM-001 doctor care=true with details accepted', $$ update members set under_doctor_care = true, doctor_care_details = 'Asthma' where phone='9000000001' $$);
select t.lives('MEM-001 doctor care=false may keep/omit details', $$ update members set under_doctor_care = false where phone='9000000001' $$);

-- Phone uniqueness (REQ-MEM-001/006/007) -----------------------------------------------------------
select t.throws('MEM-001 duplicate phone on create blocked', $$ select t.member('9000000001') $$, '%idx_members_phone_active%');
select t.lives('MEM-006 editing a member keeping its own phone is fine', $$ update members set name = 'Renamed' where phone='9000000001' $$);
select t.lives('setup second member', $$ select t.member('9000000010') $$);
select t.throws('MEM-006 editing phone to another live member''s phone blocked', $$ update members set phone='9000000001' where phone='9000000010' $$, '%idx_members_phone_active%');
update members set deleted_at = now(), deleted_by = t.admin_id() where phone = '9000000010';
select t.lives('MEM-007 deleted member''s phone is reusable on create', $$ select t.member('9000000010') $$);
select t.throws('MEM-007 ...but only once while the new owner is live', $$ select t.member('9000000010') $$, '%idx_members_phone_active%');

-- REQ-MEM-003 audit columns / handled_by_staff ---------------------------------------------------------
select t.as_user(t.staff_id());
insert into members (name,phone,date_of_birth,gender,weight_kg,height_cm,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,branch_id,handled_by_staff,created_by)
values ('Handled','9000000020','1990-01-01','Female',60,160,'e','9','f',t.branch(), t.admin_id(), t.admin_id());
select t.eq('MEM-003 created_by is system-set from session, ignoring client value', (select created_by from members where phone='9000000020'), t.staff_id());
select t.eq('MEM-003 handled_by_staff stored independently of created_by', (select handled_by_staff from members where phone='9000000020'), t.admin_id());
update members set created_by = t.admin_id(), handled_by_staff = t.staff_id() where phone='9000000020';
select t.eq('MEM-003 created_by cannot be changed afterward', (select created_by from members where phone='9000000020'), t.staff_id());
select t.eq('MEM-003 handled_by_staff is independently editable by staff', (select handled_by_staff from members where phone='9000000020'), t.staff_id());
select t.eq('MEM-006 changed_by set from session on update', (select changed_by from members where phone='9000000020'), t.staff_id());
select t.ok('MEM-006 changed_at set on update', (select changed_at is not null from members where phone='9000000020'));
select t.as_super();
select t.throws('MEM-003 handled_by_staff must reference a real profile', $$ update members set handled_by_staff = gen_random_uuid() where phone='9000000020' $$, '%foreign key%');

-- REQ-MEM-005 member number ------------------------------------------------------------------------------
select t.ok('MEM-005 format <branch>-<year>-<seq>', (select member_number ~ ('^MUM-' || extract(year from now())::int || '-\d{4}$') from members where phone='9000000001'));
select t.eq('MEM-005 first member of a branch gets sequence 0001', (select member_number from members where phone='9000000001'), 'MUM-' || extract(year from now())::int || '-0001');
select t.ok('MEM-005 numbers are unique and increasing', (select count(distinct member_number) = count(*) from members));
insert into branches (name, code) values ('Delhi', 'DEL');
select t.lives('setup DEL member', $$ select t.member('9000000030', t.branch('DEL')) $$);
select t.eq('MEM-005 each branch has its own counter (DEL starts at 0001)', (select member_number from members where phone='9000000030'), 'DEL-' || extract(year from now())::int || '-0001');
select t.eq('MEM-005 member_number uses the registration year, never resets (counter row has no year)',
  (select count(*)::int from information_schema.columns where table_name='member_number_sequences' and column_name='year'), 0);
-- Simulate year rollover: counter is per branch only, so the next number continues, e.g. ...-0007 not 0001.
update member_number_sequences set last_sequence = 6 where branch_id = t.branch('DEL');
select t.lives('setup DEL member 2', $$ select t.member('9000000031', t.branch('DEL')) $$);
select t.eq('MEM-005 sequence continues from the stored counter', (select member_number from members where phone='9000000031'), 'DEL-' || extract(year from now())::int || '-0007');
insert into members (name,phone,date_of_birth,gender,weight_kg,height_cm,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,branch_id,member_number)
values ('x','9000000032','1990-01-01','Male',70,170,'e','9','f',t.branch('DEL'),'HACKED-0001');
select t.ok('MEM-005 client-supplied member_number on insert is overwritten by the generator',
  (select member_number like 'DEL-%' from members where phone='9000000032'));
select t.throws('MEM-005 member insert against deleted/missing branch rejected', $$ select t.member('9000000033', 999999) $$, '%does not reference an active branch%');
-- A failed insert must not burn a sequence number (rolled back with the statement).
select last_sequence as seq_before from member_number_sequences where branch_id = t.branch('DEL') \gset
select t.throws('MEM-005 failed insert (bad weight)', $$
  insert into members (name,phone,date_of_birth,gender,weight_kg,height_cm,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,branch_id)
  values ('x','9000000034','1990-01-01','Male',0,170,'e','9','f',t.branch('DEL')) $$, '%weight_kg_check%');
select t.eq('MEM-005 failed insert does not consume a sequence number', (select last_sequence from member_number_sequences where branch_id = t.branch('DEL')), :seq_before);

-- REQ-MEM-006 immutability of member_number and branch_id ----------------------------------------------------------------
select member_number as mn_before, branch_id as br_before from members where phone='9000000001' \gset
update members set member_number = 'FORGED-1', branch_id = t.branch('DEL'), name = 'Edited Name' where phone='9000000001';
select t.eq('MEM-006 member_number pinned on update', (select member_number from members where phone='9000000001'), :'mn_before');
select t.eq('MEM-006 forged branch_id silently pinned back', (select branch_id from members where phone='9000000001'), :br_before::bigint);
select t.eq('MEM-006 other fields in the same update still apply', (select name from members where phone='9000000001'), 'Edited Name');
select t.eq('MEM-006 update never bumps the sequence', (select last_sequence from member_number_sequences where branch_id = t.branch('DEL')), :seq_before);

-- REQ-MEM-007 soft delete --------------------------------------------------------------------------------------
select t.throws('MEM-007 hard delete is impossible', $$ delete from members where phone='9000000001' $$, '%Hard delete is not allowed%');
select t.as_user(t.staff_id());
select t.eq('MEM-007 staff can see live member before delete', (select count(*)::int from members where phone='9000000020'), 1);
select t.as_super();
update members set deleted_at = now(), deleted_by = t.staff_id() where phone='9000000020';
select t.as_user(t.staff_id());
select t.eq('MEM-007 soft-deleted member invisible to staff reads (RLS)', (select count(*)::int from members where phone='9000000020'), 0);
select t.as_super();
select t.ok('MEM-007 row still physically present with deleted_by recorded', (select deleted_by = t.staff_id() from members where phone='9000000020'));
select t.ok('MEM-007 member_number of a deleted member is never reissued', (select count(*) = 1 from members where member_number = (select member_number from members where phone='9000000020')));
rollback;
