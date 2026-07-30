-- crud-review.md Low/polish finding: several admin-only UPDATE RLS policies only gated on
-- the caller's role, not on whether the TARGET row was already soft-deleted. That let an
-- admin/active user "update" a row that had already been soft-deleted (deleted_at is not
-- null) — a no-op in practice since nothing in the UI surfaces deleted rows, but the policy
-- itself should still enforce the same "soft-deleted rows are inert" invariant applied
-- everywhere else (see the *_select_* policies' `and deleted_at is null`).

drop policy if exists "branches_update_admin" on branches;
create policy "branches_update_admin" on branches
  for update using (is_active_admin() and deleted_at is null);

drop policy if exists "plans_update_admin" on plans;
create policy "plans_update_admin" on plans
  for update using (is_active_admin() and deleted_at is null);

drop policy if exists "roles_update_admin" on roles;
create policy "roles_update_admin" on roles
  for update using (is_active_admin() and deleted_at is null);

drop policy if exists "members_update_active_users" on members;
create policy "members_update_active_users" on members
  for update using (is_active_user() and deleted_at is null);

drop policy if exists "profiles_update_admin" on profiles;
create policy "profiles_update_admin" on profiles
  for update using (is_active_admin() and deleted_at is null);

drop policy if exists "profiles_update_self_name" on profiles;
create policy "profiles_update_self_name" on profiles
  for update using (auth.uid() = id and deleted_at is null) with check (auth.uid() = id);
