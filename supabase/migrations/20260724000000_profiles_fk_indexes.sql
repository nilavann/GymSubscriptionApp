-- Indexes every profiles-referencing FK column across the schema. Postgres does not
-- auto-index foreign keys, and none of these ever got one — flagged High in
-- spec/backend/domain-model-review.md on 2026-07-19 ("no indexes on any
-- profiles-referencing FK column... created_by, changed_by, deleted_by, handled_by_staff
-- appear on nearly every table with zero supporting indexes"), unchanged until now.
--
-- These are plain (non-partial, non-unique) btree indexes purely to support joins/filters
-- like "which staff handled this member" (members.handled_by_staff) or "everything a given
-- admin has touched" (any *_by column) — there is no uniqueness constraint implied by any
-- of them, unlike e.g. idx_members_phone_active.

create index if not exists idx_profiles_created_by on profiles(created_by);
create index if not exists idx_profiles_changed_by on profiles(changed_by);
create index if not exists idx_profiles_deleted_by on profiles(deleted_by);

create index if not exists idx_branches_created_by on branches(created_by);
create index if not exists idx_branches_changed_by on branches(changed_by);
create index if not exists idx_branches_deleted_by on branches(deleted_by);

create index if not exists idx_plans_created_by on plans(created_by);
create index if not exists idx_plans_changed_by on plans(changed_by);
create index if not exists idx_plans_deleted_by on plans(deleted_by);

create index if not exists idx_configuration_created_by on configuration(created_by);
create index if not exists idx_configuration_changed_by on configuration(changed_by);

create index if not exists idx_members_handled_by_staff on members(handled_by_staff);
create index if not exists idx_members_created_by on members(created_by);
create index if not exists idx_members_changed_by on members(changed_by);
create index if not exists idx_members_deleted_by on members(deleted_by);

create index if not exists idx_subscriptions_created_by on subscriptions(created_by);
create index if not exists idx_subscriptions_changed_by on subscriptions(changed_by);
create index if not exists idx_subscriptions_deleted_by on subscriptions(deleted_by);

create index if not exists idx_subscription_items_created_by on subscription_items(created_by);
create index if not exists idx_subscription_items_changed_by on subscription_items(changed_by);
create index if not exists idx_subscription_items_deleted_by on subscription_items(deleted_by);

create index if not exists idx_audit_log_changed_by on audit_log(changed_by);

create index if not exists idx_roles_created_by on roles(created_by);
create index if not exists idx_roles_changed_by on roles(changed_by);
create index if not exists idx_roles_deleted_by on roles(deleted_by);

-- user_roles.user_id is already the leading column of the (user_id, role_id) primary key,
-- and role_id already has idx_user_roles_role_id — only granted_by is unindexed.
create index if not exists idx_user_roles_granted_by on user_roles(granted_by);
