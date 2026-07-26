-- Multi-role users: replaces the single `profiles.role` column with an admin-managed
-- `roles` catalog (like branches/plans) plus a `user_roles` join table, so a user can hold
-- more than one role. See spec/backend/auth.md §2/§3 and edge-functions.md §5 for the
-- full write-up this migration implements. Safe to run multiple times / against an
-- existing project (idempotent create/replace).
--
-- Closes the Critical finding in spec/backend/security-review-findings.md:
-- `profiles_update_self_name` only checked row ownership, not which columns changed, so
-- any signed-in user could self-promote via `update({ role: 'admin' })` on their own row.
-- Moving `role` off `profiles` entirely removes that vector structurally (`user_roles`
-- grants zero client write access at all, see below) rather than patching it column by
-- column. The one remaining piece of that finding — `is_active`/`deleted_at` still being
-- client-writable columns on `profiles` — is closed here too, via a column-level grant.
--
-- Also closes the High finding in the same doc — `profiles` was the only audited table
-- missing set_audit_fields/prevent_hard_delete/audit_row_changes — and, as a prerequisite
-- for safely attaching prevent_hard_delete, domain-model-review.md's Critical #1
-- (`profiles.id ... on delete cascade` contradicting the no-hard-delete invariant).

---------------------------------------------------------------------------
-- roles — admin-managed catalog, same shape/conventions as branches/plans
---------------------------------------------------------------------------

create table if not exists roles (
  id           smallint generated always as identity primary key,
  name         text not null,
  description  text,
  created_at   timestamptz not null default now(),
  created_by   uuid references profiles(id),
  changed_at   timestamptz,
  changed_by   uuid references profiles(id),
  deleted_at   timestamptz,
  deleted_by   uuid references profiles(id)
);
-- Uniqueness only among live rows — a soft-deleted role's name can be reused, same
-- convention as branches.code / plans.name.
create unique index if not exists idx_roles_name_active on roles(name) where deleted_at is null;

drop trigger if exists trg_roles_audit on roles;
create trigger trg_roles_audit before insert or update on roles for each row execute function set_audit_fields();

drop trigger if exists trg_roles_no_hard_delete on roles;
create trigger trg_roles_no_hard_delete before delete on roles for each row execute function prevent_hard_delete();

drop trigger if exists trg_roles_audit_fields on roles;
create trigger trg_roles_audit_fields after insert or update on roles for each row execute function audit_row_changes();

alter table roles enable row level security;

drop policy if exists "roles_select_active_users" on roles;
create policy "roles_select_active_users" on roles
  for select using (is_active_user() and deleted_at is null);
drop policy if exists "roles_insert_admin" on roles;
create policy "roles_insert_admin" on roles
  for insert with check (is_active_admin());
drop policy if exists "roles_update_admin" on roles;
create policy "roles_update_admin" on roles
  for update using (is_active_admin());

-- Seed Data — the two roles the app has always had. Reference data, not a fixture (see
-- seed.sql's header comment on that distinction) — this is what every fresh project needs
-- to function, same as branches/plans' seed block in master_data.sql.
insert into roles (name, description)
values
  ('admin', 'Full access — user/role/catalog management plus everything staff can do.'),
  ('staff', 'Day-to-day member and subscription management.')
on conflict (name) where deleted_at is null do nothing;

---------------------------------------------------------------------------
-- user_roles — join table, deliberately NOT soft-deleted
---------------------------------------------------------------------------
-- A role grant/revoke is a real INSERT/DELETE, not an UPDATE of a status flag — same class
-- of exception to the soft-delete-only convention as member_number_sequences (an internal
-- table, not shown in any UI list). Unlike that table, user_roles IS admin-facing (Manage
-- Users), so unlike member_number_sequences it still gets audited — see the DELETE-branch
-- extension to audit_row_changes() below — it just isn't soft-deleted.

create table if not exists user_roles (
  user_id     uuid not null references profiles(id),
  role_id     smallint not null references roles(id),
  granted_at  timestamptz not null default now(),
  granted_by  uuid references profiles(id),
  primary key (user_id, role_id)
);
create index if not exists idx_user_roles_role_id on user_roles(role_id);

alter table user_roles enable row level security;

drop policy if exists "user_roles_select_active_users" on user_roles;
create policy "user_roles_select_active_users" on user_roles
  for select using (is_active_user());

-- No insert/update/delete policy for any client role at all. Every write goes through
-- replace_user_roles() below (service_role only) — this is what makes the escalation
-- vector structurally impossible here, not just restricted: there is no self-service path
-- to this table whatsoever, unlike profiles' column-grant approach.

---------------------------------------------------------------------------
-- audit_row_changes() — extend the DELETE branch for user_roles
---------------------------------------------------------------------------
-- Every other table's DELETE is unreachable (prevent_hard_delete blocks it), so this branch
-- was a documented no-op. user_roles is the one table where DELETE is a real, reachable
-- operation (a role revocation), so it needs to actually log now. Purely additive: nothing
-- changes for any other table, since they still can't reach this branch at all.

create or replace function audit_row_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change_id uuid := gen_random_uuid();
  v_old       jsonb;
  v_new       jsonb;
  v_record_id text;
  v_key       text;
  v_excluded  text[] := array['created_at', 'created_by', 'changed_at', 'changed_by'];
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_record_id := v_new ->> 'id';
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> all(v_excluded) then
        insert into audit_log (change_id, table_name, record_id, field_name, old_value, new_value, operation, changed_by, changed_at)
        values (v_change_id, tg_table_name, v_record_id, v_key, null, v_new ->> v_key, 'insert', auth.uid(), now());
      end if;
    end loop;
    return new;

  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_record_id := v_new ->> 'id';
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> all(v_excluded) and (v_old ->> v_key) is distinct from (v_new ->> v_key) then
        insert into audit_log (change_id, table_name, record_id, field_name, old_value, new_value, operation, changed_by, changed_at)
        values (v_change_id, tg_table_name, v_record_id, v_key, v_old ->> v_key, v_new ->> v_key, 'update', auth.uid(), now());
      end if;
    end loop;
    return new;

  elsif tg_op = 'DELETE' then
    -- Reachable only for user_roles (the one table exempt from prevent_hard_delete).
    -- user_roles has no surrogate `id` column — its natural key is (user_id, role_id).
    -- Read via v_old (jsonb), not direct OLD.field access, same as every other branch —
    -- this function is shared across tables with different columns, and OLD's fields
    -- vary per table, so only the generic to_jsonb(old) path is safe here.
    v_old := to_jsonb(old);
    v_record_id := coalesce(v_old ->> 'id', (v_old ->> 'user_id') || ':' || (v_old ->> 'role_id'));
    for v_key in select jsonb_object_keys(v_old) loop
      if v_key <> all(v_excluded) then
        insert into audit_log (change_id, table_name, record_id, field_name, old_value, new_value, operation, changed_by, changed_at)
        values (v_change_id, tg_table_name, v_record_id, v_key, v_old ->> v_key, null, 'delete', auth.uid(), now());
      end if;
    end loop;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_user_roles_audit_fields on user_roles;
create trigger trg_user_roles_audit_fields after insert or delete on user_roles for each row execute function audit_row_changes();

---------------------------------------------------------------------------
-- Drop profiles.role — role now lives entirely in user_roles
---------------------------------------------------------------------------
-- handle_new_auth_user() (profiles_auth.sql) inserts a `role` value into profiles —
-- that column is being dropped, so the function must be redefined first to stop
-- referencing it. Role assignment at invite time becomes invite-user's job (see
-- edge-functions.md §5): done explicitly after the profiles row exists, via
-- user_roles, rather than parsed out of JWT metadata here.
--
-- created_at/created_by are no longer set as literal INSERT values either — now that
-- set_audit_fields() is attached to profiles (below), it takes over stamping those on
-- INSERT, the same as every other table. The one wrinkle: set_audit_fields() reads
-- auth.uid(), which would otherwise resolve to NULL here (this trigger runs as part of
-- whatever connection created the auth.users row — e.g. invite-user's service-role
-- client — not the inviting admin's own session). Faking the JWT claim for this
-- transaction only (LOCAL, auto-reset at commit) lets created_by still correctly
-- attribute to the inviting admin — same trick create_subscription_with_items uses
-- (subscription_rpc_functions.sql). Left unset for the one-time bootstrap admin (no
-- inviter), so created_by naturally stays NULL there too, same as before.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invited_by uuid := nullif(new.raw_user_meta_data ->> 'invited_by', '')::uuid;
begin
  if v_invited_by is not null then
    perform set_config('request.jwt.claim.sub', v_invited_by::text, true);
  end if;

  insert into profiles (id, full_name, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

alter table profiles drop column if exists role;

---------------------------------------------------------------------------
-- profiles.id FK — drop the on-delete-cascade
---------------------------------------------------------------------------
-- domain-model-review.md Critical #1: every other FK in this schema omits ON DELETE
-- (defaults to the equivalent of RESTRICT) so hard-deletes stay structurally impossible,
-- reinforced by prevent_hard_delete() triggers — profiles was the one exception. A
-- Supabase Auth admin.deleteUser() call issues a real DELETE on auth.users, which this
-- FK would cascade into a real DELETE on profiles. Dropping the cascade means that call
-- now fails outright with a clear foreign-key-violation error instead of silently
-- succeeding (or, if prevent_hard_delete were attached first, cascading into a delete
-- that trigger then rejects, aborting the whole transaction from deep inside the cascade
-- rather than at the FK itself). Deactivation (is_active = false) / soft-delete
-- (deleted_at) remain the only supported ways to remove a user — never an Auth-level
-- delete, documented here since it's now enforced structurally, not just by convention.
alter table profiles drop constraint if exists profiles_id_fkey;
alter table profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id);

---------------------------------------------------------------------------
-- Attach the standard shared triggers to profiles
---------------------------------------------------------------------------
-- profiles previously had none of these three, unlike every other business table —
-- see security-review-findings.md's High finding. Safe to attach now that the FK above
-- no longer cascades a real auth.users delete into a real profiles delete.

drop trigger if exists trg_profiles_audit on profiles;
create trigger trg_profiles_audit before insert or update on profiles for each row execute function set_audit_fields();

drop trigger if exists trg_profiles_no_hard_delete on profiles;
create trigger trg_profiles_no_hard_delete before delete on profiles for each row execute function prevent_hard_delete();

drop trigger if exists trg_profiles_audit_fields on profiles;
create trigger trg_profiles_audit_fields after insert or update on profiles for each row execute function audit_row_changes();

---------------------------------------------------------------------------
-- Column-grant fix on profiles — closes the rest of the Critical finding
---------------------------------------------------------------------------
-- profiles_update_self_name (profiles_auth.sql) checks only auth.uid() = id, not which
-- columns changed — is_active/deleted_at are still columns a self-update could otherwise
-- touch. RLS can't express "this column only"; a column-level grant can.

revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;

---------------------------------------------------------------------------
-- Helper functions
---------------------------------------------------------------------------

-- Single source of truth for "is this specific user an active admin" — callable both by
-- RLS (via is_active_admin() below) and by Edge Functions via .rpc(), replacing the
-- duplicated inline `profiles.select('role', ...)` admin-checks in invite-user, list-users,
-- update-user, delete-branch, delete-plan.
create or replace function is_admin_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from profiles p
    join user_roles ur on ur.user_id = p.id
    join roles r on r.id = ur.role_id and r.name = 'admin' and r.deleted_at is null
    where p.id = p_user_id and p.is_active = true and p.deleted_at is null
  );
$$;

-- is_active_admin() (profiles_auth.sql) now just delegates — every existing RLS policy
-- that calls it keeps working unchanged.
create or replace function is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_admin_user(auth.uid());
$$;

-- Active, non-deleted admins other than the given user — backs the last-admin lockout
-- guard in replace_user_roles() and update-user's deactivate/delete branches.
create or replace function count_other_active_admins(p_exclude_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from profiles p
  join user_roles ur on ur.user_id = p.id
  join roles r on r.id = ur.role_id and r.name = 'admin' and r.deleted_at is null
  where p.is_active = true and p.deleted_at is null and p.id <> p_exclude_user_id;
$$;

---------------------------------------------------------------------------
-- replace_user_roles — the only write path for user_roles
---------------------------------------------------------------------------
-- Same shape/reasoning as create_subscription_with_items (subscription_rpc_functions.sql):
-- a delete-then-insert needs to be one transaction, and the set_config() trick is needed
-- for the same auth.uid()-under-service-role reason. Locked to service_role only — see
-- the revoke/grant at the end, same as every other RPC in this app.

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
  v_had_admin  boolean;
  v_keeps_admin boolean;
begin
  perform set_config('request.jwt.claim.sub', p_caller_id::text, true);

  select is_admin_user(p_target_user_id) into v_had_admin;
  select exists (
    select 1 from roles where id = any(p_role_ids) and name = 'admin' and deleted_at is null
  ) into v_keeps_admin;

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

revoke all on function replace_user_roles(uuid, uuid, smallint[]) from public;
grant execute on function replace_user_roles(uuid, uuid, smallint[]) to service_role;

---------------------------------------------------------------------------
-- update_profile_fields / soft_delete_profile — the write paths update-user uses for
-- profiles itself (full_name/is_active, and the deleted_at/deleted_by soft-delete)
---------------------------------------------------------------------------
-- Now that set_audit_fields() is attached to profiles, a plain supabase-js .update() from
-- update-user's service-role client would leave changed_at/changed_by unset — auth.uid()
-- resolves NULL under that connection with no per-request JWT context, same reasoning as
-- every other RPC in this app. Routing these two writes through RPCs (rather than direct
-- .update() calls) is what lets them use the same set_config() attribution trick.

create or replace function update_profile_fields(
  p_caller_id       uuid,
  p_target_user_id  uuid,
  p_full_name       text,
  p_is_active       boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claim.sub', p_caller_id::text, true);

  update profiles
  set full_name = coalesce(p_full_name, full_name),
      is_active = coalesce(p_is_active, is_active)
  where id = p_target_user_id and deleted_at is null;
end;
$$;

revoke all on function update_profile_fields(uuid, uuid, text, boolean) from public;
grant execute on function update_profile_fields(uuid, uuid, text, boolean) to service_role;

create or replace function soft_delete_profile(
  p_caller_id      uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claim.sub', p_caller_id::text, true);

  update profiles
  set deleted_at = now(), deleted_by = p_caller_id
  where id = p_target_user_id and deleted_at is null;
end;
$$;

revoke all on function soft_delete_profile(uuid, uuid) from public;
grant execute on function soft_delete_profile(uuid, uuid) to service_role;

---------------------------------------------------------------------------
-- profiles_with_roles view
---------------------------------------------------------------------------
-- Plain view (no security definer) — inherits and enforces the querying user's own RLS
-- against profiles/user_roles/roles automatically, adding no new permission surface, same
-- reasoning already documented for member_list_view. Read path for AuthContext's own-profile
-- fetch and for list-users.

create or replace view profiles_with_roles as
select
  p.id,
  p.full_name,
  p.is_active,
  p.deleted_at,
  coalesce(ur.role_names, '{}') as roles
from profiles p
left join lateral (
  select array_agg(r.name order by r.name) as role_names
  from user_roles ur
  join roles r on r.id = ur.role_id and r.deleted_at is null
  where ur.user_id = p.id
) ur on true;
