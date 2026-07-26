-- Master/catalog data: branches, plans, configuration — plus the two shared trigger
-- functions (set_audit_fields, prevent_hard_delete) every business table from here on
-- reuses. See spec/backend/database.md for the full write-up this migration implements.
-- Safe to run multiple times / against an existing project (idempotent create/replace).
--
-- Ordering note: this is the second migration (after profiles/auth) precisely because
-- `members.branch_id` and `subscription_items.plan_id` (next migration) both depend on
-- these two catalog tables existing first.

---------------------------------------------------------------------------
-- Shared trigger functions (reused by every business table going forward)
---------------------------------------------------------------------------

-- Audit columns: never client-settable, same shape for every table that uses it.
create or replace function set_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    new.changed_at := null;
    new.changed_by := null;
  elsif tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.changed_at := now();
    new.changed_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Makes hard delete structurally impossible, regardless of role or code path.
-- "Deleting" a row is always an UPDATE setting deleted_at/deleted_by, never a real DELETE.
create or replace function prevent_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is not allowed on table %. Soft-delete by setting deleted_at instead.', tg_table_name;
end;
$$;

---------------------------------------------------------------------------
-- Tables
---------------------------------------------------------------------------

-- branches — a member's branch determines their member_number prefix (REQ-MEM-001/005).
create table if not exists branches (
  id          bigint generated always as identity primary key,
  name        text not null,
  code        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id),
  changed_at  timestamptz,
  changed_by  uuid references profiles(id),
  deleted_at  timestamptz,
  deleted_by  uuid references profiles(id)
);
-- Uniqueness only among live rows — a soft-deleted branch's code can be reused.
create unique index if not exists idx_branches_code_active on branches(code) where deleted_at is null;

-- plans — unified catalog for both gym membership plans and add-ons (domain-model.md §3).
create table if not exists plans (
  id             bigint generated always as identity primary key,
  name           text not null,
  category       text not null check (category in ('membership', 'addon')),
  -- Nullable: NULL means indefinite (never expires, e.g. a one-time "Membership Fee").
  -- Required whenever category = 'membership' — see chk_plan_duration_required_when_membership.
  duration_days  integer check (duration_days > 0),
  price          numeric(10,2) not null check (price >= 0),
  -- Capped at 2 because subscription_items only has one shared_member_id slot (stopgap,
  -- not a confirmed permanent decision — see requirements-template.md §13 Open Questions).
  max_members    integer not null default 1 check (max_members between 1 and 2),
  created_at     timestamptz not null default now(),
  created_by     uuid references profiles(id),
  changed_at     timestamptz,
  changed_by     uuid references profiles(id),
  deleted_at     timestamptz,
  deleted_by     uuid references profiles(id),
  constraint chk_plan_duration_required_when_membership check (
    category <> 'membership' or duration_days is not null
  ),
  constraint chk_plan_max_members_only_for_membership check (
    category = 'membership' or max_members = 1
  )
);
create unique index if not exists idx_plans_name_active on plans(name) where deleted_at is null;
create index if not exists idx_plans_category on plans(category);

-- configuration — generic key/value settings table; currently used only for member-number
-- generation (next migration). Exempt from soft-delete/audit-log: internal system table,
-- never shown in any UI list.
create table if not exists configuration (
  key          text primary key,
  value        text not null,
  description  text,
  created_at   timestamptz not null default now(),
  created_by   uuid references profiles(id),
  changed_at   timestamptz,
  changed_by   uuid references profiles(id)
);

insert into configuration (key, value, description) values
  ('member_number_start_sequence', '1', 'First sequence number issued per branch per year.'),
  ('member_number_increment',      '1', 'Step size between consecutive member numbers within a branch/year.'),
  ('member_number_padding_width',  '4', 'Zero-padding width for the sequence portion of member_number, e.g. 4 -> 0001.')
on conflict (key) do nothing;

---------------------------------------------------------------------------
-- Seed Data (branches, plans) — see database.md §Seed Data
---------------------------------------------------------------------------
-- created_by is left unset here: seed inserts run via the migration/service role, not
-- an authenticated session, so set_audit_fields()'s auth.uid() resolves to NULL — the
-- same as database.md's own seed block, and harmless since created_by is nullable.

-- ON CONFLICT must repeat idx_branches_code_active's WHERE predicate — Postgres only
-- infers a partial unique index for conflict resolution when the clause matches exactly.
insert into branches (name, code)
values ('Main Branch', 'MUM')
on conflict (code) where deleted_at is null do nothing;

-- Same reasoning as above, against idx_plans_name_active.
insert into plans (name, category, duration_days, price, max_members)
values
  ('Day',             'membership', 1,    100,  1),
  ('Monthly',         'membership', 30,   1000, 1),
  ('Quarterly',       'membership', 90,   2500, 1),
  ('Annual',          'membership', 365,  8000, 1),
  ('Couple Monthly',  'membership', 30,   1800, 2),
  ('Membership Fee',  'addon',      null, 500,  1),
  ('Zumba Class',     'addon',      30,   800,  1)
on conflict (name) where deleted_at is null do nothing;

---------------------------------------------------------------------------
-- Trigger attachments
---------------------------------------------------------------------------
-- Note: the audit-log (after-insert/update) trigger for these tables is NOT attached
-- here — audit_log/audit_row_changes() don't exist until the views-and-audit migration.
-- It's attached there instead, retroactively, to every audited table at once.

drop trigger if exists trg_branches_audit on branches;
create trigger trg_branches_audit before insert or update on branches for each row execute function set_audit_fields();

drop trigger if exists trg_branches_no_hard_delete on branches;
create trigger trg_branches_no_hard_delete before delete on branches for each row execute function prevent_hard_delete();

drop trigger if exists trg_plans_audit on plans;
create trigger trg_plans_audit before insert or update on plans for each row execute function set_audit_fields();

drop trigger if exists trg_plans_no_hard_delete on plans;
create trigger trg_plans_no_hard_delete before delete on plans for each row execute function prevent_hard_delete();

---------------------------------------------------------------------------
-- Row Level Security
---------------------------------------------------------------------------
-- is_active_user() / is_active_admin() already exist from the profiles/auth migration.

alter table branches      enable row level security;
alter table plans         enable row level security;
alter table configuration enable row level security;

-- branches: all active users can read; only admins can write.
drop policy if exists "branches_select_active_users" on branches;
create policy "branches_select_active_users" on branches
  for select using (is_active_user() and deleted_at is null);
drop policy if exists "branches_insert_admin" on branches;
create policy "branches_insert_admin" on branches
  for insert with check (is_active_admin());
drop policy if exists "branches_update_admin" on branches;
create policy "branches_update_admin" on branches
  for update using (is_active_admin());

-- plans: all active users can read; only admins can write. One policy set covers both
-- membership plans and add-ons (category is just a column, not a separate table).
drop policy if exists "plans_select_active_users" on plans;
create policy "plans_select_active_users" on plans
  for select using (is_active_user() and deleted_at is null);
drop policy if exists "plans_insert_admin" on plans;
create policy "plans_insert_admin" on plans
  for insert with check (is_active_admin());
drop policy if exists "plans_update_admin" on plans;
create policy "plans_update_admin" on plans
  for update using (is_active_admin());

-- configuration: admin-only read/update; keys themselves are migration-managed (no insert grant).
drop policy if exists "configuration_select_admin" on configuration;
create policy "configuration_select_admin" on configuration
  for select using (is_active_admin());
drop policy if exists "configuration_update_admin" on configuration;
create policy "configuration_update_admin" on configuration
  for update using (is_active_admin());
