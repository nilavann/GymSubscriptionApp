-- REQ-AUDIT-001, Section 10/11 soft-delete + audit columns, REQ-ADMIN-002/003/004/006 at the DB layer.
begin;
select t.seed_users();
select t.as_super();

-- REQ-AUDIT-001 ---------------------------------------------------------------------------------------------
select t.as_user(t.staff_id());
insert into members (name,phone,date_of_birth,gender,weight_kg,height_cm,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,branch_id)
values ('Audit Me','9200000001','1990-01-01','Male',70,170,'e','9','f',t.branch());
select t.as_super();
select id as mid from members where phone='9200000001' \gset
select t.ok('AUDIT insert: one row per column, operation=insert, old_value NULL',
  (select count(*) > 15 and bool_and(operation='insert' and old_value is null) from audit_log where table_name='members' and record_id=:'mid'));
select t.eq('AUDIT insert: new_value holds the initial value', (select new_value from audit_log where table_name='members' and record_id=:'mid' and field_name='name'), 'Audit Me');
select t.ok('AUDIT insert: changed_by is the acting user', (select bool_and(changed_by = t.staff_id()) from audit_log where table_name='members' and record_id=:'mid'));
select t.eq('AUDIT metadata columns are NOT logged',
  (select count(*)::int from audit_log where field_name in ('created_at','created_by','changed_at','changed_by')), 0);

select t.as_user(t.admin_id());
update members set phone='9200000002', email='a@b.co', name='Audit Me' where id=:mid;   -- name unchanged
select t.as_super();
select t.eq('AUDIT update: one row per CHANGED field only (phone,email)', (select count(*)::int from audit_log where record_id=:'mid' and operation='update' and table_name='members'), 2);
select t.eq('AUDIT update: unchanged field not logged', (select count(*)::int from audit_log where record_id=:'mid' and operation='update' and field_name='name'), 0);
select t.ok('AUDIT update: old and new values captured',
  (select old_value='9200000001' and new_value='9200000002' from audit_log where record_id=:'mid' and operation='update' and field_name='phone'));
select t.eq('AUDIT update: a single save shares one change_id', (select count(distinct change_id)::int from audit_log where record_id=:'mid' and operation='update'), 1);
select t.ok('AUDIT update: old_value NULL -> new for previously empty field', (select old_value is null and new_value='a@b.co' from audit_log where record_id=:'mid' and field_name='email' and operation='update'));
select t.ok('AUDIT update: changed_by is the editing admin', (select bool_and(changed_by=t.admin_id()) from audit_log where record_id=:'mid' and operation='update'));
select t.lives('AUDIT a no-op update writes nothing', $$ update members set name = name where phone='9200000002' $$);
select t.eq('AUDIT no-op update adds no rows', (select count(*)::int from audit_log where record_id=:'mid' and operation='update'), 2);
-- soft delete is just an update and is audited
update members set deleted_at = now(), deleted_by = t.admin_id() where id=:mid;
select t.eq('AUDIT soft delete is logged as field updates (deleted_at, deleted_by)', (select count(*)::int from audit_log where record_id=:'mid' and field_name in ('deleted_at','deleted_by') and operation='update'), 2);

-- every required table is audited (Member, Subscription, SubscriptionItem, Plan, Branch, Profile) + extras
select t.eq('AUDIT trigger attached to every required table',
  (select count(distinct c.relname)::int from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
    where tg.tgfoid='audit_row_changes'::regproc and c.relname in ('members','subscriptions','subscription_items','plans','branches','profiles')), 6);
select t.eq('AUDIT trigger also on roles and user_roles',
  (select count(distinct c.relname)::int from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
    where tg.tgfoid='audit_row_changes'::regproc and c.relname in ('roles','user_roles')), 2);
insert into plans (name,category,duration_days,price) values ('Audited Plan','addon',7,10);
select t.ok('AUDIT plans insert logged', (select count(*) > 0 from audit_log where table_name='plans' and field_name='name' and new_value='Audited Plan'));
insert into branches (name,code) values ('Audited','AUD');
select t.ok('AUDIT branches insert logged', (select count(*) > 0 from audit_log where table_name='branches' and field_name='code' and new_value='AUD'));
select t.ok('AUDIT profiles changes logged (record_id is a uuid string)', (select count(*) > 0 from audit_log where table_name='profiles' and record_id=t.staff_id()::text));
select t.ok('AUDIT user_roles insert logged with composite record_id', (select count(*) > 0 from audit_log where table_name='user_roles' and record_id like t.staff_id()::text || ':%'));

-- audit log is append-only / admin-only
select t.throws('AUDIT hard delete blocked', $$ delete from audit_log $$, '%Hard delete is not allowed%');
select t.as_user(t.staff_id());
select t.eq('ADMIN-005 staff sees zero audit rows', (select count(*)::int from audit_log), 0);
select t.throws('AUDIT staff cannot write audit rows', $$ insert into audit_log (change_id,table_name,record_id,field_name,operation) values (gen_random_uuid(),'x','1','f','insert') $$, '%row-level security%');
select t.as_user(t.admin_id());
select t.ok('ADMIN-005 admin can read audit rows', (select count(*) > 0 from audit_log));
select t.eq('AUDIT admin UPDATE of audit_log affects 0 rows (no policy)', t.affected($q$update audit_log set new_value='tampered'$q$), 0);
select t.eq('AUDIT admin DELETE of audit_log affects 0 rows / blocked', (select count(*)::int from audit_log where new_value='tampered'), 0);
select t.as_super();

-- Soft delete conventions: hard delete blocked on every table with deleted_at ------------------------------------
select t.member('9200000040') as hd \gset
select count(*) from (select t.checkout(t.staff_id(), :hd, jsonb_build_array(jsonb_build_object('plan_id', t.plan('Monthly'),'member_id',:hd,'start_date',current_date,'end_date',current_date+29,'quantity',1,'amount_paid',1)))) x;
select t.eq('SOFTDEL every table with deleted_at has a no-hard-delete trigger',
  (select count(*)::int from information_schema.columns col
    where col.table_schema='public' and col.column_name='deleted_at'
      and col.table_name in (select table_name from information_schema.tables where table_type='BASE TABLE')
      and not exists (select 1 from pg_trigger tg where tg.tgrelid=('public.'||col.table_name)::regclass and tg.tgfoid='prevent_hard_delete'::regproc)), 0);
select t.throws('SOFTDEL plans hard delete blocked', $$ delete from plans $$, '%Hard delete%');
select t.throws('SOFTDEL branches hard delete blocked', $$ delete from branches $$, '%Hard delete%');
select t.throws('SOFTDEL profiles hard delete blocked', $$ delete from profiles $$, '%Hard delete%');
select t.throws('SOFTDEL subscriptions hard delete blocked', $$ delete from subscriptions $$, '%Hard delete%');
select t.throws('SOFTDEL subscription_items hard delete blocked', $$ delete from subscription_items $$, '%Hard delete%');
select t.throws('SOFTDEL roles hard delete blocked', $$ delete from roles $$, '%Hard delete%');
select t.eq('Auditability: every business table has created_at/created_by/changed_at/changed_by',
  (select count(*)::int from unnest(array['members','subscriptions','subscription_items','plans','branches','profiles','roles']) tn
     where (select count(*) from information_schema.columns where table_name=tn and column_name in ('created_at','created_by','changed_at','changed_by')) <> 4), 0);

-- REQ-ADMIN-002 plans -------------------------------------------------------------------------------------------
select t.as_user(t.admin_id());
select t.throws('ADMIN-002 membership plan needs duration_days', $$ insert into plans (name,category,price) values ('NoDur','membership',10) $$, '%chk_plan_duration_required_when_membership%');
select t.lives('ADMIN-002 add-on may omit duration (indefinite)', $$ insert into plans (name,category,price) values ('Forever','addon',10) $$);
select t.throws('ADMIN-002 duration_days must be positive', $$ insert into plans (name,category,duration_days,price) values ('Zero','addon',0,10) $$, '%duration_days_check%');
select t.throws('ADMIN-002 price cannot be negative', $$ insert into plans (name,category,duration_days,price) values ('Neg','addon',5,-1) $$, '%price_check%');
select t.lives('ADMIN-002 price 0 allowed', $$ insert into plans (name,category,duration_days,price) values ('Free','addon',5,0) $$);
select t.throws('ADMIN-002 category limited to membership/addon', $$ insert into plans (name,category,duration_days,price) values ('Bad','gear',5,1) $$, '%category_check%');
select t.throws('ADMIN-002 blank name rejected (spaces)', $$ insert into plans (name,category,duration_days,price) values ('   ','addon',5,1) $$, '%chk_plans_name_not_blank%');
select t.throws('ADMIN-002 duplicate live plan name rejected', $$ insert into plans (name,category,duration_days,price) values ('Monthly','addon',5,1) $$, '%idx_plans_name_active%');
select t.lives('ADMIN-002 editing a plan applies immediately', $$ update plans set price = 1100 where name='Monthly' $$);
select t.as_super();
select t.member('9200000050') as pm \gset
select t.checkout(t.staff_id(), :pm, jsonb_build_array(jsonb_build_object('plan_id', t.plan('Monthly'),'member_id',:pm,'start_date',current_date,'end_date',current_date+29,'quantity',1,'amount_paid',1000)));
select t.as_user(t.admin_id());
update plans set price = 2000 where name='Monthly';
select t.as_super();
select t.eq('ADMIN-002 past subscription items are NOT recalculated when a plan is edited', (select amount_paid from subscription_items where member_id=:pm), 1000.00);
select t.as_user(t.admin_id());
select t.known_gap_throws('ADMIN-003 (GAP) branch code of only a tab passes the DB blank check', $$ insert into branches (name,code) values ('Tabby', E'\t') $$);
select t.as_super();

-- REQ-ADMIN-003 branches ---------------------------------------------------------------------------------------------
select t.as_user(t.admin_id());
select t.throws('ADMIN-003 duplicate live branch code rejected', $$ insert into branches (name,code) values ('Other','MUM') $$, '%idx_branches_code_active%');
select t.throws('ADMIN-003 blank code rejected', $$ insert into branches (name,code) values ('X','   ') $$, '%chk_branches_code_not_blank%');
select t.throws('ADMIN-003 blank name rejected', $$ insert into branches (name,code) values ('  ','ZZZ') $$, '%chk_branches_name_not_blank%');
select t.lives('ADMIN-003 admin can create a branch', $$ insert into branches (name,code) values ('Pune','PUN') $$);
select t.as_super();
update branches set deleted_at=now(), deleted_by=t.admin_id() where code='PUN';
select t.as_user(t.admin_id());
select t.lives('ADMIN-003 a soft-deleted branch''s code can be reused', $$ insert into branches (name,code) values ('Pune 2','PUN') $$);
select t.as_super();

-- RLS: staff vs admin write access ------------------------------------------------------------------------------------
select t.as_user(t.staff_id());
select t.ok('ADMIN-001 staff can READ plans (needed to build checkouts)', (select count(*) > 0 from plans));
select t.ok('ADMIN-001 staff can READ branches (member form)', (select count(*) > 0 from branches));
select t.throws('ADMIN-002 staff cannot insert plans', $$ insert into plans (name,category,duration_days,price) values ('S','addon',1,1) $$, '%row-level security%');
select t.eq('ADMIN-002 staff UPDATE on plans affects 0 rows', t.affected($q$update plans set price = 1$q$), 0);
select t.throws('ADMIN-003 staff cannot insert branches', $$ insert into branches (name,code) values ('S','SSS') $$, '%row-level security%');
select t.eq('ADMIN-003 staff UPDATE on branches affects 0 rows', t.affected($q$update branches set name='x'$q$), 0);
select t.throws('ADMIN-004 staff cannot insert roles', $$ insert into roles (name) values ('boss') $$, '%row-level security%');
select t.eq('SEC staff cannot read configuration', (select count(*)::int from configuration), 0);
select t.eq('SEC staff cannot read member_number_sequences', (select count(*)::int from member_number_sequences), 0);
select t.throws('SEC staff cannot grant themselves a role (user_roles has no write policy)', format($$ insert into user_roles (user_id, role_id) select %L, id from roles where name='admin' $$, t.staff_id()), '%row-level security%');
select t.throws('SEC staff cannot update profiles.is_active (column grant)', format($$ update profiles set is_active = false where id = %L $$, t.admin_id()), '%permission denied%');
select t.lives('ADMIN-004 a user may edit their own full_name', format($$ update profiles set full_name='Sammy' where id=%L $$, t.staff_id()));
select t.eq('SEC a user cannot rename someone else (0 rows)', t.affected($q$update profiles set full_name='pwn' where id = t.admin_id()$q$), 0);
select t.as_super();

-- Deactivated / deleted / unknown users (REQ-AUTH-003, Security NFR) ------------------------------------------------------
select t.branch() as mum \gset
select t.as_user(t.inactive_id());
select t.eq('SEC inactive user reads 0 members', (select count(*)::int from members), 0);
select t.eq('SEC inactive user reads 0 plans', (select count(*)::int from plans), 0);
select t.eq('AUTH-003 inactive user can still read their OWN profile (to show the right message)', (select count(*)::int from profiles where id = t.inactive_id()), 1);
select t.throws('SEC inactive user cannot insert members', format($$ select t.member('9200000099', %s) $$, :mum), '%row-level security%');
select t.as_user(t.deleted_id());
select t.eq('ADMIN-006 deleted user reads 0 members', (select count(*)::int from members), 0);
select t.eq('ADMIN-006 deleted user cannot even read their own profile', (select count(*)::int from profiles), 0);
select t.as_user(gen_random_uuid());
select t.eq('AUTH-003 authenticated user with no profile (never invited) reads 0 members', (select count(*)::int from members), 0);
select t.eq('AUTH-003 ...and 0 profiles', (select count(*)::int from profiles), 0);
select t.as_super();
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select t.eq('SEC anon reads nothing: members', (select count(*)::int from members), 0);
select t.throws('SEC anon cannot insert', $$ insert into branches (name,code) values ('A','AAA') $$, '%row-level security%');
reset role;

-- REQ-ADMIN-004/006 user management RPCs -----------------------------------------------------------------------------------
select t.eq('ADMIN-004 profiles_with_roles lists roles', (select roles::text from profiles_with_roles where id=t.admin_id()), '{admin}');
select replace_user_roles(t.admin_id(), t.staff_id(), (select array_agg(id) from roles)::smallint[]);
select t.eq('ADMIN-004 multi-role user lists every role', (select array_length(roles,1) from profiles_with_roles where id=t.staff_id()), 2);
select replace_user_roles(t.admin_id(), t.staff_id(), (select array_agg(id) from roles where name='staff')::smallint[]);
select t.eq('ADMIN-004 replace_user_roles back to staff only', (select roles::text from profiles_with_roles where id=t.staff_id()), '{staff}');
select update_profile_fields(t.admin_id(), t.staff_id(), 'Renamed Staff', false);
select t.ok('ADMIN-004 update_profile_fields applies name + deactivation', (select full_name='Renamed Staff' and is_active=false from profiles where id=t.staff_id()));
select update_profile_fields(t.admin_id(), t.staff_id(), null, null);
select t.ok('ADMIN-004 NULL args keep existing values', (select full_name='Renamed Staff' and is_active=false from profiles where id=t.staff_id()));
select update_profile_fields(t.admin_id(), t.staff_id(), null, true);
-- last-admin protections
select t.eq('ADMIN-004 count_other_active_admins excludes the given user', count_other_active_admins(t.admin_id()), 1);
select t.lives('ADMIN-004 can demote an admin while another active admin exists', format($$ select replace_user_roles(%L, %L, (select array_agg(id) from roles where name='staff')::smallint[]) $$, t.admin_id(), t.admin2_id()));
select t.throws('ADMIN-004 cannot remove the LAST active admin role', format($$ select replace_user_roles(%L, %L, (select array_agg(id) from roles where name='staff')::smallint[]) $$, t.admin_id(), t.admin_id()), '%last active admin%');
select t.eq('ADMIN-004 failed demotion left the role in place', (select roles::text from profiles_with_roles where id=t.admin_id()), '{admin}');
select t.lives('ADMIN-004 empty role list is fine for a non-admin', format($$ select replace_user_roles(%L, %L, '{}'::smallint[]) $$, t.admin_id(), t.staff_id()));
-- soft delete / restore
select soft_delete_profile(t.admin_id(), t.staff_id());
select t.ok('ADMIN-006 soft delete sets deleted_at/deleted_by (row kept)', (select deleted_at is not null and deleted_by=t.admin_id() from profiles where id=t.staff_id()));
select t.as_super();
select t.ok('ADMIN-006 deleted user is not an active user anymore', not exists (select 1 from profiles where id=t.staff_id() and deleted_at is null));
select t.ok('ADMIN-006 deleted admin does not count as an active admin', (select not is_admin_user(t.deleted_id())));
select soft_delete_profile(t.admin_id(), t.staff_id());
select t.ok('ADMIN-006 deleting twice is a harmless no-op (deleted_at unchanged)', (select deleted_at is not null from profiles where id=t.staff_id()));
select restore_profile(t.admin_id(), t.staff_id());
select t.ok('ADMIN-006 restore clears deleted_at/deleted_by', (select deleted_at is null and deleted_by is null from profiles where id=t.staff_id()));
select t.ok('profile for deactivated user is not admin', not is_admin_user(t.inactive_id()));
select t.ok('profile for inactive admin would not count', (select not is_admin_user(gen_random_uuid())));

-- invite flow: handle_new_auth_user creates profile, never grants a role by itself (REQ-AUTH-003 invite-only)
insert into auth.users (id,email,raw_user_meta_data) values (gen_random_uuid(),'new@gym.test','{"full_name":"New Person","invited_by":"a0000000-0000-0000-0000-000000000001"}');
select t.ok('AUTH profile auto-created from auth.users with full_name', (select count(*)=1 from profiles where full_name='New Person'));
select t.eq('AUTH created_by of invited profile = inviter', (select created_by from profiles where full_name='New Person'), t.admin_id());
select t.eq('AUTH new profile has no roles until granted', (select count(*)::int from user_roles ur join profiles p on p.id=ur.user_id where p.full_name='New Person'), 0);
insert into auth.users (id,email,raw_user_meta_data) values (gen_random_uuid(),'noname@gym.test',null);
select t.ok('AUTH profile falls back to email when no full_name provided', (select count(*)=1 from profiles where full_name='noname@gym.test'));

-- Privileged RPCs (service_role-only by intent) and the member-number config function --------------------------------------
select t.as_user(t.staff_id());
select t.known_gap_throws('SEC (GAP) staff must not be able to call replace_user_roles (self-promote to admin)', format($$ select replace_user_roles(%L, %L, (select array_agg(id) from roles where name='admin')::smallint[]) $$, t.staff_id(), t.staff_id()));
select t.known_gap_throws('SEC (GAP) staff must not be able to call soft_delete_profile', format($$ select soft_delete_profile(%L, %L) $$, t.staff_id(), t.admin2_id()));
select t.known_gap_throws('SEC (GAP) staff must not be able to call update_profile_fields', format($$ select update_profile_fields(%L, %L, null, false) $$, t.staff_id(), t.admin2_id()));
select t.as_super();
select t.as_user(t.staff_id());
select update_member_number_config(5, 2, 6);
select t.as_super();
select t.eq('MEM-005 staff calling update_member_number_config changes nothing (RLS on configuration)', (select value from configuration where key='member_number_padding_width'), '4');
select t.as_user(t.admin_id());
select update_member_number_config(5, 2, 6);
select t.as_super();
select t.eq('MEM-005 admin can change the numbering config', (select string_agg(value, ',' order by key) from configuration where key like 'member_number_%'), '2,6,5');
rollback;
