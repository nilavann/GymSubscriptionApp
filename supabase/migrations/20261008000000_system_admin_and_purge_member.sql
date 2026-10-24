-- Permanent member delete (REQ-MEM-008) and the reserved `system_admin` role (REQ-ADMIN-010).
--
-- Everything else in this app is soft-delete only; purge_member() is the single, deliberate
-- exception. Three things live here:
--   1. the reserved `system_admin` role + is_system_admin_user()
--   2. guards so only a system admin can grant/remove that role, and nobody can edit/delete it
--   3. purge_member() — a service-role-only RPC that erases one member and everything hanging
--      off them in one transaction, bypassing prevent_hard_delete() through a transaction-local
--      flag that only this function sets.

---------------------------------------------------------------------------
-- 1. Reserved role + helper
---------------------------------------------------------------------------

insert into roles (name, description)
values ('system_admin', 'Reserved — an admin who can also permanently delete a member and grant or remove this role.')
on conflict (name) where deleted_at is null do nothing;

-- A system admin is an active admin that also holds system_admin. Requiring both means
-- losing `admin` (deactivation, role removal) immediately revokes the purge power too.
create or replace function is_system_admin_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_admin_user(p_user_id) and exists (
    select 1
    from user_roles ur
    join roles r on r.id = ur.role_id and r.name = 'system_admin' and r.deleted_at is null
    where ur.user_id = p_user_id
  );
$$;

revoke all on function is_system_admin_user(uuid) from public, anon, authenticated;
grant execute on function is_system_admin_user(uuid) to service_role;

---------------------------------------------------------------------------
-- 2. The reserved role cannot be edited, renamed or deleted
---------------------------------------------------------------------------
-- BEFORE UPDATE is enough: INSERT of a second 'system_admin' is already rejected by
-- idx_roles_name_active, and renaming another role to that name hits the same index.

create or replace function protect_system_admin_role()
returns trigger
language plpgsql
as $$
begin
  if old.name = 'system_admin' then
    raise exception 'The system_admin role is reserved and cannot be edited or deleted';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_roles_protect_system_admin on roles;
create trigger trg_roles_protect_system_admin before update on roles
  for each row execute function protect_system_admin_role();

---------------------------------------------------------------------------
-- replace_user_roles — now refuses a system_admin change by anyone but a system admin
---------------------------------------------------------------------------
-- Re-sending a list that keeps system_admin as it was is NOT a change, so an ordinary admin
-- can still edit a system admin's other roles. Granting system_admin also requires the
-- target to hold admin in the same list, since the power only exists on top of admin.

create or replace function replace_user_roles(
  p_caller_id       uuid,
  p_target_user_id  uuid,
  p_role_ids        smallint[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_had_admin         boolean;
  v_keeps_admin       boolean;
  v_had_system_admin  boolean;
  v_keeps_system_admin boolean;
begin
  perform set_config('request.jwt.claim.sub', p_caller_id::text, true);

  select is_admin_user(p_target_user_id) into v_had_admin;
  select exists (
    select 1 from roles where id = any(p_role_ids) and name = 'admin' and deleted_at is null
  ) into v_keeps_admin;

  select exists (
    select 1 from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = p_target_user_id and r.name = 'system_admin' and r.deleted_at is null
  ) into v_had_system_admin;
  select exists (
    select 1 from roles where id = any(p_role_ids) and name = 'system_admin' and deleted_at is null
  ) into v_keeps_system_admin;

  if v_had_system_admin is distinct from v_keeps_system_admin and not is_system_admin_user(p_caller_id) then
    raise exception 'Only a system admin can grant or remove the system_admin role';
  end if;
  if v_keeps_system_admin and not v_keeps_admin then
    raise exception 'The system_admin role can only be held together with admin';
  end if;

  if v_had_admin and not v_keeps_admin and count_other_active_admins(p_target_user_id) = 0 then
    raise exception 'Cannot remove the admin role — % is the last active admin', p_target_user_id;
  end if;

  delete from user_roles where user_id = p_target_user_id;

  insert into user_roles (user_id, role_id, granted_by)
  select p_target_user_id, role_id, p_caller_id
  from unnest(p_role_ids) as role_id;

  return (
    select jsonb_agg(r.name order by r.name)
    from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = p_target_user_id
  );
end;
$$;

revoke all on function replace_user_roles(uuid, uuid, smallint[]) from public, anon, authenticated;
grant execute on function replace_user_roles(uuid, uuid, smallint[]) to service_role;

---------------------------------------------------------------------------
-- 3. prevent_hard_delete() — the one narrow, transaction-local bypass
---------------------------------------------------------------------------
-- purge_member() sets app.purge_member = 'on' with set_config(..., true) (transaction-local,
-- so it cannot leak to another request) and only the four tables it erases honour it.
-- PostgREST has no way to set a custom GUC, and purge_member() is service-role only.

create or replace function prevent_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.purge_member', true), '') = 'on'
     and tg_table_name in ('members', 'subscriptions', 'subscription_items', 'audit_log') then
    return old;
  end if;
  raise exception 'Hard delete is not allowed on table %. Soft-delete by setting deleted_at instead.', tg_table_name;
end;
$$;

---------------------------------------------------------------------------
-- purge_member — erase one member, their subscriptions, items and audit history
---------------------------------------------------------------------------
-- Returns the member's storage paths so the Edge Function can remove the photo files after
-- the transaction commits (storage objects are not part of the database transaction).
-- Nothing is written to audit_log for the purge itself: the member's, their subscriptions'
-- and their items' audit rows are erased along with them and no trace is left behind.
--
-- Refused when another member's subscription item still names this member as its shared
-- (couple) member: items are immutable, so removing the member would silently break that
-- other member's subscription. Soft-delete or purge that subscription's owner first.

create or replace function purge_member(
  p_caller_id uuid,
  p_member_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member         members%rowtype;
  v_sub_ids        bigint[];
  v_item_ids       bigint[];
  v_shared_owners  integer;
begin
  perform set_config('request.jwt.claim.sub', p_caller_id::text, true);

  if not is_system_admin_user(p_caller_id) then
    raise exception 'System admin access required';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member % not found', p_member_id;
  end if;

  select count(distinct si.member_id) into v_shared_owners
  from subscription_items si
  where si.shared_member_id = p_member_id and si.member_id <> p_member_id;
  if v_shared_owners > 0 then
    raise exception 'Cannot purge — this member is the shared member on % other member(s) subscriptions', v_shared_owners;
  end if;

  select coalesce(array_agg(id), '{}') into v_sub_ids from subscriptions where member_id = p_member_id;
  select coalesce(array_agg(id), '{}') into v_item_ids
  from subscription_items where member_id = p_member_id or subscription_id = any(v_sub_ids);

  perform set_config('app.purge_member', 'on', true);

  delete from audit_log
  where (table_name = 'members' and record_id = p_member_id::text)
     or (table_name = 'subscriptions' and record_id in (select x::text from unnest(v_sub_ids) x))
     or (table_name = 'subscription_items' and record_id in (select x::text from unnest(v_item_ids) x));

  delete from subscription_items where id = any(v_item_ids);
  delete from subscriptions where id = any(v_sub_ids);
  delete from members where id = p_member_id;

  perform set_config('app.purge_member', 'off', true);

  return jsonb_build_object(
    'photo_paths', to_jsonb(array_remove(array[v_member.photo_url, v_member.photo_thumbnail_url], null)),
    'subscriptions', coalesce(array_length(v_sub_ids, 1), 0),
    'items', coalesce(array_length(v_item_ids, 1), 0)
  );
end;
$$;

revoke all on function purge_member(uuid, bigint) from public, anon, authenticated;
grant execute on function purge_member(uuid, bigint) to service_role;
