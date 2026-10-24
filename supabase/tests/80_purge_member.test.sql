-- REQ-MEM-008 permanent member delete (purge_member) and REQ-ADMIN-010 the reserved system_admin role, at the DB layer.
begin;
select t.seed_users();
select t.as_super();

-- make admin2 a system admin the way the runbook does (admin + system_admin); admin stays a plain admin
insert into user_roles (user_id, role_id, granted_by)
  select t.admin2_id(), id, t.admin_id() from roles where name = 'system_admin';

-- REQ-ADMIN-010 reserved role ------------------------------------------------------------------------------------------
select t.eq('SYSADMIN role is seeded exactly once', (select count(*)::int from roles where name='system_admin' and deleted_at is null), 1);
select t.ok('SYSADMIN is_system_admin_user: admin + system_admin', is_system_admin_user(t.admin2_id()));
select t.ok('SYSADMIN is_system_admin_user: a plain admin is not', not is_system_admin_user(t.admin_id()));
select t.ok('SYSADMIN is_system_admin_user: staff is not', not is_system_admin_user(t.staff_id()));
select t.throws('SYSADMIN role cannot be renamed', $$ update roles set name='x' where name='system_admin' $$, '%reserved%');
select t.throws('SYSADMIN role cannot be soft-deleted', $$ update roles set deleted_at=now() where name='system_admin' $$, '%reserved%');
select t.throws('SYSADMIN role cannot have its description edited', $$ update roles set description='x' where name='system_admin' $$, '%reserved%');
select t.throws('SYSADMIN a second role with that name is rejected', $$ insert into roles (name) values ('system_admin') $$, '%idx_roles_name_active%');
select t.lives('SYSADMIN other roles stay editable', $$ update roles set description='Day to day' where name='staff' $$);

select t.throws('SYSADMIN a plain admin cannot grant system_admin',
  format($$ select replace_user_roles(%L, %L, (select array_agg(id) from roles where name in ('admin','staff','system_admin'))::smallint[]) $$, t.admin_id(), t.staff_id()),
  '%Only a system admin%');
select t.lives('SYSADMIN a system admin can grant it (together with admin)',
  format($$ select replace_user_roles(%L, %L, (select array_agg(id) from roles where name in ('admin','system_admin'))::smallint[]) $$, t.admin2_id(), t.staff_id()));
select t.ok('SYSADMIN the grant took effect', is_system_admin_user(t.staff_id()));
select t.throws('SYSADMIN system_admin without admin is refused',
  format($$ select replace_user_roles(%L, %L, (select array_agg(id) from roles where name = 'system_admin')::smallint[]) $$, t.admin2_id(), t.staff_id()),
  '%only be held together with admin%');
select t.lives('SYSADMIN a plain admin may edit a system admin''s OTHER roles while system_admin stays',
  format($$ select replace_user_roles(%L, %L, (select array_agg(id) from roles where name in ('admin','system_admin','staff'))::smallint[]) $$, t.admin_id(), t.staff_id()));
select t.throws('SYSADMIN a plain admin cannot remove it',
  format($$ select replace_user_roles(%L, %L, (select array_agg(id) from roles where name in ('admin','staff'))::smallint[]) $$, t.admin_id(), t.staff_id()),
  '%Only a system admin%');
select t.lives('SYSADMIN a system admin can remove it',
  format($$ select replace_user_roles(%L, %L, (select array_agg(id) from roles where name in ('admin','staff'))::smallint[]) $$, t.admin2_id(), t.staff_id()));
select update_profile_fields(t.admin_id(), t.admin2_id(), null, false);
select t.ok('SYSADMIN deactivating the admin side revokes the power', not is_system_admin_user(t.admin2_id()));
select update_profile_fields(t.admin_id(), t.admin2_id(), null, true);

-- REQ-MEM-008 purge_member ---------------------------------------------------------------------------------------------
select t.member('9800000001', null, 'Purge Me') as victim \gset
select t.member('9800000002', null, 'Bystander') as other \gset
update members set photo_url = 'm/1/photo.jpg', photo_thumbnail_url = 'm/1/thumb.jpg' where id = :victim;
select t.checkout(t.staff_id(), :victim, jsonb_build_array(
  jsonb_build_object('plan_id', t.plan('Monthly'), 'member_id', :victim, 'start_date', current_date, 'end_date', current_date+29, 'quantity', 1, 'amount_paid', 1000)));
select t.checkout(t.staff_id(), :other, jsonb_build_array(
  jsonb_build_object('plan_id', t.plan('Monthly'), 'member_id', :other, 'start_date', current_date, 'end_date', current_date+29, 'quantity', 1, 'amount_paid', 1000)));

select t.throws('PURGE a plain admin is refused', format($$ select purge_member(%L, %s) $$, t.admin_id(), :victim), '%System admin access required%');
select t.throws('PURGE staff is refused', format($$ select purge_member(%L, %s) $$, t.staff_id(), :victim), '%System admin access required%');
select t.eq('PURGE refusal leaves the member in place', (select count(*)::int from members where id=:victim), 1);
select t.throws('PURGE an unknown member is an error', format($$ select purge_member(%L, 999999) $$, t.admin2_id()), '%not found%');
select t.throws('PURGE a plain DELETE is still blocked outside the RPC', format($$ delete from members where id=%s $$, :victim), '%Hard delete is not allowed%');
select t.throws('PURGE the bypass flag is not left on after a failed call', format($$ delete from subscriptions where member_id=%s $$, :victim), '%Hard delete is not allowed%');

select id as vsub from subscriptions where member_id = :victim \gset
select id as vitem from subscription_items where member_id = :victim \gset
select t.ok('PURGE the subscription and item had audit history before the purge',
  (select count(*) > 0 from audit_log where table_name='subscriptions' and record_id=:'vsub') and (select count(*) > 0 from audit_log where table_name='subscription_items' and record_id=:'vitem'));
select purge_member(t.admin2_id(), :victim) as result \gset
select t.ok('PURGE returns the photo paths to remove', (:'result'::jsonb -> 'photo_paths') @> '["m/1/photo.jpg","m/1/thumb.jpg"]'::jsonb);
select t.eq('PURGE removes the member', (select count(*)::int from members where id=:victim), 0);
select t.eq('PURGE removes their subscriptions', (select count(*)::int from subscriptions where member_id=:victim), 0);
select t.eq('PURGE removes their items', (select count(*)::int from subscription_items where member_id=:victim), 0);
select t.eq('PURGE removes the member''s audit history entirely, leaving no trace of the purge',
  (select count(*)::int from audit_log where table_name='members' and record_id=:'victim'), 0);
select t.eq('PURGE removes the subscription''s audit history too',
  (select count(*)::int from audit_log where table_name='subscriptions' and record_id=:'vsub'), 0);
select t.eq('PURGE removes the item''s audit history too',
  (select count(*)::int from audit_log where table_name='subscription_items' and record_id=:'vitem'), 0);
select t.eq('PURGE leaves other members, subscriptions and items untouched',
  (select count(*)::int from members m join subscriptions s on s.member_id=m.id join subscription_items i on i.subscription_id=s.id where m.id=:other), 1);
select t.ok('PURGE leaves other members'' audit history', (select count(*) > 0 from audit_log where table_name='members' and record_id=:'other'));
select t.throws('PURGE hard delete is blocked again afterwards', format($$ delete from members where id=%s $$, :other), '%Hard delete is not allowed%');

-- a member who is the shared (couple) member on someone else's item cannot be purged
select t.member('9800000003', null, 'Partner') as partner \gset
select t.checkout(t.staff_id(), :other, jsonb_build_array(
  jsonb_build_object('plan_id', t.plan('Couple Monthly'), 'member_id', :other, 'shared_member_id', :partner, 'start_date', current_date+60, 'end_date', current_date+89, 'quantity', 1, 'amount_paid', 1800)));
select t.throws('PURGE refused while the member is a shared member on another subscription',
  format($$ select purge_member(%L, %s) $$, t.admin2_id(), :partner), '%shared member%');
select t.eq('PURGE that refusal rolled everything back', (select count(*)::int from members where id=:partner), 1);

-- the RPC is not callable by signed-in users
select t.as_user(t.admin2_id());
select t.throws('PURGE not executable by authenticated', format($$ select purge_member(%L, %s) $$, t.admin2_id(), :other), '%permission denied%');
select t.throws('PURGE is_system_admin_user not executable by authenticated', format($$ select is_system_admin_user(%L) $$, t.admin2_id()), '%permission denied%');
select t.as_super();

rollback;
