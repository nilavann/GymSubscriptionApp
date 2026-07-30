# Database — Web Edition (Supabase / Postgres)

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)
> Data model field definitions: see [domain-model.md](./domain-model.md). Validation/API layer: see [edge-functions.md](./edge-functions.md). Product rules: see [business-logic.md](./business-logic.md).
>
> This is the initial schema design — nothing has been created in Supabase yet. Two rules apply uniformly across every table below unless a table is explicitly marked exempt:
> 1. **No hard delete, ever — soft delete only.** Every business table gets `deleted_at` / `deleted_by`. "Deleting" a row is an `UPDATE`, never a `DELETE`.
> 2. **Soft-deleted rows are invisible to normal reads.** Every RLS `select` policy and every validation query (uniqueness checks, overlap checks, deletion guards, report queries) filters `deleted_at is null`.
>
> **Cancellation/refund and overlap-warning logic are deferred** — see [domain-model.md §Open items](./domain-model.md#open-items-not-blocking-but-worth-resolving-before-implementation-begins). `subscriptions` and `subscription_items` below intentionally have no `status`/`refund_amount`/`cancellation_reason`/`overlap_*` columns yet.

---

## Setup

- Engine: **Supabase Postgres** (hosted, online-only).
- Auth: **Supabase Auth** (`auth.users`), email + password and Google OAuth. Never build a parallel credentials table.
- Storage: **Supabase Storage**, bucket `member-photos`, for member profile photos.
- Serverless logic: **Supabase Edge Functions** (Deno + TypeScript) for anything that must not be trusted to the client — see [architecture.md](../architecture.md).
- Schema changes reach the project **only** via migration files in `supabase/migrations/` (`supabase db push` / the Supabase CLI). No ad-hoc changes through the dashboard SQL editor for anything that needs to persist.

```sql
create extension if not exists "pgcrypto";
```

Needed for `gen_random_uuid()` (profiles reuse `auth.users.id`, so this is mostly a safety default; `audit_log.change_id` is the actual consumer — see below).

---

## Soft-Delete Fields (common to every business table below)

In addition to the standard audit block (`created_at`/`created_by`/`changed_at`/`changed_by`), every table below except **AuditLog**, **configuration**, and **member_number_sequences** also carries:

| Field       | Type        | Nullable | Default | Constraints |
|-------------|-------------|----------|---------|-------------|
| deleted_at  | timestamptz | Yes      | NULL    | Set on soft-delete, never on insert |
| deleted_by  | uuid        | Yes      | NULL    | FK → `profiles.id`, set alongside `deleted_at` |

- `AuditLog` is exempt — it is strictly append-only (see [requirements-template.md REQ-ADMIN-005](../requirements-template.md)); even soft-deleting an audit entry would defeat its purpose, so it has no `deleted_at` column and no delete path at all, soft or hard.
- `configuration` and `member_number_sequences` are exempt — internal system tables (admin-viewable via the Member Numbering settings screen, but not general business records) with no product concept of "deleting" a row in them (see §Configuration Table and §Member Number Generation below).
- A row is considered "deleted" when `deleted_at is not null`. There is no separate boolean flag — checking `deleted_at is null` is the single source of truth everywhere (RLS, Edge Functions, reports).

---

## SQL Schema

```sql
-- 1. profiles — one row per auth.users row. Role no longer lives here — see roles/
-- user_roles below (§Role Assignment) — a user can hold more than one role. No `on delete
-- cascade` on the FK (unlike every other business table's FKs, this was the one exception,
-- now removed) — deactivation/soft-delete are the only supported ways to remove a user; a
-- Supabase Auth admin.deleteUser() call now fails outright with a foreign-key violation
-- instead of cascading into a real DELETE on this row.
create table if not exists profiles (
  id          uuid primary key references auth.users(id),
  full_name   text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id),
  changed_at  timestamptz,
  changed_by  uuid references profiles(id),
  deleted_at  timestamptz,
  deleted_by  uuid references profiles(id)
);

-- 2. branches
create table if not exists branches (
  id          bigint generated always as identity primary key,
  name        text not null,
  code        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id),
  changed_at  timestamptz,
  changed_by  uuid references profiles(id),
  deleted_at  timestamptz,
  deleted_by  uuid references profiles(id),
  constraint chk_branches_name_not_blank check (trim(name) <> ''),
  constraint chk_branches_code_not_blank check (trim(code) <> '')
);
-- Uniqueness only among live rows — a soft-deleted branch's code can be reused.
create unique index if not exists idx_branches_code_active on branches(code) where deleted_at is null;

-- 3. plans — unified catalog for both membership plans and add-ons (domain-model.md §3)
create table if not exists plans (
  id             bigint generated always as identity primary key,
  name           text not null,
  category       text not null check (category in ('membership', 'addon')),
  -- Nullable: NULL means indefinite (never expires, e.g. a one-time "Membership Fee").
  -- Required whenever category = 'membership' — see chk_plan_duration_required_when_membership.
  -- This column alone replaces the old separate `behavior_type` column.
  duration_days  integer check (duration_days > 0),
  price          numeric(10,2) not null check (price >= 0),
  -- Capped at 2 because SubscriptionItem only has one shared_member_id slot
  -- (see domain-model.md §6). Raise this cap only after subscription_items moves
  -- to a real multi-member join table. Stopgap, not a confirmed permanent decision —
  -- see requirements-template.md §13. Also only meaningful when category = 'membership'.
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
  ),
  constraint chk_plans_name_not_blank check (trim(name) <> '')
);
create unique index if not exists idx_plans_name_active on plans(name) where deleted_at is null;
create index if not exists idx_plans_category on plans(category);

-- 4. roles — admin-managed catalog of assignable role names (see §Role Assignment).
-- Same shape/conventions as branches/plans.
create table if not exists roles (
  id           smallint generated always as identity primary key,
  name         text not null,
  description  text,
  created_at   timestamptz not null default now(),
  created_by   uuid references profiles(id),
  changed_at   timestamptz,
  changed_by   uuid references profiles(id),
  deleted_at   timestamptz,
  deleted_by   uuid references profiles(id),
  constraint chk_roles_name_not_blank check (trim(name) <> '')
);
create unique index if not exists idx_roles_name_active on roles(name) where deleted_at is null;

-- 5. user_roles — many-to-many: a user can hold more than one role. Deliberately NOT
-- soft-deleted — a role grant/revoke is a real INSERT/DELETE, same class of exception to
-- the soft-delete convention as member_number_sequences (below), except this table IS
-- audited (see §Field-Level Audit Trigger) since it's admin-facing, unlike that one.
create table if not exists user_roles (
  user_id     uuid not null references profiles(id),
  role_id     smallint not null references roles(id),
  granted_at  timestamptz not null default now(),
  granted_by  uuid references profiles(id),
  primary key (user_id, role_id)
);
create index if not exists idx_user_roles_role_id on user_roles(role_id);

-- 6. configuration — generic key/value settings table
create table if not exists configuration (
  key          text primary key,
  value        text not null,
  description  text,
  created_at   timestamptz not null default now(),
  created_by   uuid references profiles(id),
  changed_at   timestamptz,
  changed_by   uuid references profiles(id)
);

-- 7. members
create table if not exists members (
  id                              bigint generated always as identity primary key,
  name                            text not null,
  phone                           text not null,
  date_of_birth                   date not null,
  date_of_joining                 date not null default current_date,
  gender                          text not null check (gender in ('Male', 'Female', 'Other')),
  weight_kg                       numeric not null check (weight_kg between 1 and 500),
  height_cm                       numeric not null check (height_cm between 1 and 300),
  under_doctor_care               boolean not null default false,
  doctor_care_details             text,
  emergency_contact_name          text not null,
  emergency_contact_phone         text not null,
  emergency_contact_relationship  text not null,
  email                           text,
  residential_address             text,
  aadhaar_number                  text,
  occupation                      text,
  photo_url                       text,
  photo_thumbnail_url             text,
  branch_id                       bigint not null references branches(id),
  member_number                   text not null,
  handled_by_staff                uuid references profiles(id),
  created_at                      timestamptz not null default now(),
  created_by                      uuid references profiles(id),
  changed_at                      timestamptz,
  changed_by                      uuid references profiles(id),
  deleted_at                      timestamptz,
  deleted_by                      uuid references profiles(id),
  constraint chk_doctor_care_details_required check (
    under_doctor_care = false or (doctor_care_details is not null and length(trim(doctor_care_details)) > 0)
  )
);
create unique index if not exists idx_members_number_active on members(member_number) where deleted_at is null;
-- Uniqueness only among live rows — a soft-deleted member's phone can be reused by a new member (REQ-MEM-001/006/007).
create unique index if not exists idx_members_phone_active on members(phone) where deleted_at is null;
create index if not exists idx_members_branch_id on members(branch_id);

-- 8. member_number_sequences — internal counter, one row per branch (not per branch/year —
-- the counter increments continuously for a branch's whole lifetime and never resets, not
-- even at a calendar-year boundary; see §Member Number Generation below). Admin-viewable
-- via the Member Numbering settings screen; not soft-deletable, not audited (it's a
-- counter, not a business record).
create table if not exists member_number_sequences (
  branch_id      bigint primary key references branches(id),
  last_sequence  integer not null
);

-- 9. subscriptions — header only, one row per checkout event (domain-model.md §5).
-- Immutable set of line items once created: adding something new later always means
-- a new subscriptions row, never a new line on an existing one.
create table if not exists subscriptions (
  id            bigint generated always as identity primary key,
  member_id     bigint not null references members(id),
  payment_mode  text not null default 'Cash' check (payment_mode in ('Cash', 'UPI', 'Card')),
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid references profiles(id),
  changed_at    timestamptz,
  changed_by    uuid references profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references profiles(id)
);
create index if not exists idx_subscriptions_member_id on subscriptions(member_id);

-- 10. subscription_items — one row per plan/add-on selected in a checkout (domain-model.md §6).
-- Replaces the old subscriptions.plan_id/dates/quantity/amount_paid columns AND the old
-- subscription_addons table with a single line-item table, any plan category.
create table if not exists subscription_items (
  id                  bigint generated always as identity primary key,
  subscription_id     bigint not null references subscriptions(id),
  plan_id             bigint not null references plans(id) on delete restrict,
  member_id           bigint not null references members(id),
  shared_member_id    bigint references members(id),
  start_date          date not null default current_date,
  end_date            date,
  quantity            integer not null default 1 check (quantity > 0),
  amount_paid         numeric(10,2) not null check (amount_paid >= 0),
  created_at          timestamptz not null default now(),
  created_by          uuid references profiles(id),
  changed_at          timestamptz,
  changed_by          uuid references profiles(id),
  deleted_at          timestamptz,
  deleted_by          uuid references profiles(id),
  constraint chk_subscription_item_shared_member_distinct check (
    shared_member_id is null or shared_member_id <> member_id
  )
);
create index if not exists idx_subscription_items_subscription_id on subscription_items(subscription_id);
create index if not exists idx_subscription_items_plan_id on subscription_items(plan_id);
-- Supports member_current_items (see §Views below): "what does member X currently have,"
-- filtered to end_date is null or in the future.
create index if not exists idx_subscription_items_member_end
  on subscription_items(member_id, end_date) where deleted_at is null;
create index if not exists idx_subscription_items_shared_member_end
  on subscription_items(shared_member_id, end_date) where deleted_at is null and shared_member_id is not null;

-- 11. audit_log — field-level change history, append-only, never soft- or hard-deleted
create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  change_id   uuid not null,
  table_name  text not null,
  record_id   text not null,
  field_name  text not null,
  old_value   text,
  new_value   text,
  operation   text not null check (operation in ('insert', 'update', 'delete')),
  changed_by  uuid references profiles(id),
  changed_at  timestamptz not null default now()
);
create index if not exists idx_audit_log_table_record on audit_log(table_name, record_id);
create index if not exists idx_audit_log_change_id on audit_log(change_id);
```

---

## Views

### `profiles_with_roles`

A plain view (no `security definer`) — inherits and enforces the querying user's own RLS
against `profiles`/`user_roles`/`roles` automatically, adding no new permission surface. Read
path for `AuthContext`'s own-profile fetch and for `list-users` (edge-functions.md §5).

```sql
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
```

### `member_current_items`

"What does this member currently have," across every `subscriptions` row they're part of — see [domain-model.md §Views](./domain-model.md#views) for the full explanation of why this always means a `UNION ALL` across two roles (`member_id` and `shared_member_id`) rather than a single-table lookup.

```sql
create or replace view member_current_items as
select
  si.id as subscription_item_id, si.subscription_id, si.plan_id,
  p.name as plan_name, p.category,
  si.member_id, si.start_date, si.end_date, si.quantity, si.amount_paid
from subscription_items si
join plans p on p.id = si.plan_id
where si.deleted_at is null
  and (si.end_date is null or si.end_date >= current_date)

union all

select
  si.id, si.subscription_id, si.plan_id,
  p.name, p.category,
  si.shared_member_id as member_id, si.start_date, si.end_date, si.quantity, si.amount_paid
from subscription_items si
join plans p on p.id = si.plan_id
where si.shared_member_id is not null
  and si.deleted_at is null
  and (si.end_date is null or si.end_date >= current_date);
```

Backed by `idx_subscription_items_member_end` and `idx_subscription_items_shared_member_end` above — a plain `current_date` comparison can't live inside a partial index predicate (not `IMMUTABLE`), so these are ordinary composite indexes that support an efficient `member_id = ? and end_date >= ?` range scan for each half of the `UNION ALL`, rather than partial indexes baking the date filter in.

Usage: `select * from member_current_items where member_id = :member_id order by end_date nulls last desc;`

---

## Role Assignment

`roles`/`user_roles` replace the old single `profiles.role` column — a user can hold more
than one role. Seed rows (`admin`, `staff`) are listed under §Seed Data below; beyond that,
`roles` is a normal admin-editable catalog (Manage Roles screen), same as branches/plans.

`is_admin_user(p_user_id)` is the single source of truth for "is this specific user an
active admin" — used both by RLS (`is_active_admin()` now just delegates to it) and by every
Edge Function's admin-check, replacing what used to be a duplicated inline
`profiles.select('role', ...)` query in five different functions:

```sql
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

create or replace function is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_admin_user(auth.uid());
$$;
```

**Last-admin lockout**: `count_other_active_admins(p_exclude_user_id)` backs a guard applied
everywhere a user's admin access could be removed — revoking the admin role
(`replace_user_roles` below), deactivating (`is_active = false`), or soft-deleting a user
(`update-user`, edge-functions.md §5) — all three are blocked with a clear error if the
target is the last active admin.

**`replace_user_roles`** is the only write path for `user_roles` — no client role has any
RLS grant on that table at all (see §Row Level Security), so this Edge-Function-only RPC is
the sole way a user's role set ever changes, closing the self-escalation gap that used to
exist on `profiles.role` (see the old `profiles_update_self_name` policy, still present below
for `full_name` only):

```sql
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
  v_had_admin   boolean;
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
  select p_target_user_id, role_id, p_caller_id from unnest(p_role_ids) as role_id;

  return (
    select jsonb_agg(r.name order by r.name)
    from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = p_target_user_id
  );
end;
$$;

revoke all on function replace_user_roles(uuid, uuid, smallint[]) from public;
grant execute on function replace_user_roles(uuid, uuid, smallint[]) to service_role;
```

**`update_profile_fields`/`soft_delete_profile`** exist for the same reason: now that
`set_audit_fields()` is attached to `profiles`, `update-user`'s `full_name`/`is_active` edits
and its soft-delete both need the `set_config` attribution trick too, so a plain service-role
`.update()` isn't enough — each is a tiny RPC (`update profiles set ... where id = ... and
deleted_at is null`) doing that `perform set_config(...)` first, `service_role`-only like
every RPC above.

---

## Configuration Table

A generic key/value settings table so operational constants don't require a schema migration to change. Currently used only for member-number generation (below); more keys can be added the same way later.

```sql
insert into configuration (key, value, description) values
  ('member_number_start_sequence', '1', 'First sequence number issued to a branch, the first time that branch is ever used.'),
  ('member_number_increment',      '1', 'Step size between consecutive member numbers within a branch. The counter never resets.'),
  ('member_number_padding_width',  '4', 'Zero-padding width for the sequence portion of member_number, e.g. 4 -> 0001.')
on conflict (key) do nothing;
```

(The `member_number_start_sequence`/`member_number_increment` descriptions above reflect the continuous, never-resets counter — the original seed migration's text said "per branch per year"; the live text was corrected via an `UPDATE` in `20260727000000_member_number_continuous_sequence.sql` rather than editing that already-applied seed migration, per this repo's own convention.)

If a branch ever approaches 9,999 members total, an admin can raise `member_number_padding_width` to `5` without a schema migration — existing already-issued numbers are unaffected since the width only applies at generation time.

---

## Member Number Generation

`member_number` is never accepted from the client and is always overwritten by this trigger, the same pattern `set_audit_fields()` uses for the audit columns — except this one also fires on `UPDATE`, purely to pin `member_number` and `branch_id` back to their original values. A member's branch is a registration-time fact, set once and never reassigned (REQ-MEM-005/006), so `branch_id` gets the same immutability treatment as `member_number` itself — otherwise the branch code baked into `member_number` at creation could silently drift out of sync with a member's current `branch_id`.

```sql
create or replace function generate_member_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_code text;
  v_year        integer := extract(year from now())::integer;
  v_start       integer;
  v_increment   integer;
  v_width       integer;
  v_sequence    integer;
begin
  if tg_op = 'UPDATE' then
    -- Frozen forever: no branch/number reassignment path exists, and this must never
    -- touch member_number_sequences — an UPDATE returns here, before that code is reached.
    new.member_number := old.member_number;
    new.branch_id      := old.branch_id;
    return new;
  end if;

  select code into v_branch_code from branches where id = new.branch_id and deleted_at is null;
  if v_branch_code is null then
    raise exception 'branch_id % does not reference an active branch', new.branch_id;
  end if;

  select value::integer into v_start     from configuration where key = 'member_number_start_sequence';
  select value::integer into v_increment from configuration where key = 'member_number_increment';
  select value::integer into v_width     from configuration where key = 'member_number_padding_width';

  -- Atomic per-branch counter, continuous for the branch's whole lifetime: first row for a
  -- branch starts at v_start; every subsequent insert adds v_increment to the existing
  -- counter, with no reset at a calendar-year boundary or anywhere else. The INSERT ... ON
  -- CONFLICT takes a row lock, so this is safe under concurrent member creation. Only ever
  -- reached on INSERT (see the tg_op = 'UPDATE' branch above) — an update can never bump this.
  insert into member_number_sequences (branch_id, last_sequence)
  values (new.branch_id, v_start)
  on conflict (branch_id)
  do update set last_sequence = member_number_sequences.last_sequence + v_increment
  returning last_sequence into v_sequence;

  new.member_number := v_branch_code || '-' || v_year || '-' || lpad(v_sequence::text, v_width, '0');
  return new;
end;
$$;

create trigger trg_members_generate_number
  before insert or update on members
  for each row execute function generate_member_number();
```

**Why a failed insert can't leak a sequence bump:** the counter increment happens inside this `BEFORE INSERT` trigger, as part of the same statement/transaction as the row insert itself. `NOT NULL`/`CHECK`/`UNIQUE` constraints (`chk_doctor_care_details_required`, `idx_members_phone_active`, etc.) are validated by Postgres *after* all `BEFORE ROW` triggers finish, using the trigger-modified row — so if any of them reject the row, the whole statement aborts and everything it did, including the nested `insert into member_number_sequences`, rolls back with it. The only residual gap risk is a benign concurrency artifact (two concurrent inserts where one later rolls back after the other already claimed the next number) — an accepted trade-off for a display identifier, not something worth serializing inserts to avoid.

**Trigger firing order doesn't matter here.** `generate_member_number()` and `set_audit_fields()` touch disjoint columns (`member_number`/`branch_id` vs. the audit block), so whichever of the two `BEFORE` triggers runs first produces an identical final row either way — there's no dependency to protect by naming/ordering them a particular way. The `after insert`/`after update` audit-log trigger always sees the fully-resolved row regardless, since Postgres only fires `AFTER ROW` triggers once every `BEFORE ROW` trigger has already applied its changes to `NEW`.

---

## Soft Delete Enforcement

Soft delete is a product convention (`UPDATE ... SET deleted_at = now(), deleted_by = auth.uid()`), but nothing stops a bug — or a service-role Edge Function bypassing RLS — from issuing a real `DELETE`. This trigger makes hard delete structurally impossible, at the database level, regardless of which role or code path attempts it:

```sql
create or replace function prevent_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is not allowed on table %. Soft-delete by setting deleted_at instead.', tg_table_name;
end;
$$;

create trigger trg_profiles_no_hard_delete            before delete on profiles            for each row execute function prevent_hard_delete();
create trigger trg_branches_no_hard_delete             before delete on branches             for each row execute function prevent_hard_delete();
create trigger trg_plans_no_hard_delete                before delete on plans                for each row execute function prevent_hard_delete();
create trigger trg_roles_no_hard_delete                before delete on roles                for each row execute function prevent_hard_delete();
create trigger trg_members_no_hard_delete              before delete on members              for each row execute function prevent_hard_delete();
create trigger trg_subscriptions_no_hard_delete        before delete on subscriptions        for each row execute function prevent_hard_delete();
create trigger trg_subscription_items_no_hard_delete   before delete on subscription_items   for each row execute function prevent_hard_delete();
create trigger trg_audit_log_no_hard_delete            before delete on audit_log            for each row execute function prevent_hard_delete();
```

No table above is ever granted an RLS `delete` policy — combined with this trigger, "delete" simply does not exist as an operation on any business table, at any privilege level, including the service role used by Edge Functions. **`user_roles` is the one deliberate exception** — see §Role Assignment: a role grant/revoke is a real `INSERT`/`DELETE`, so it is not attached to this trigger, the same class of exception `member_number_sequences` already gets below (an internal counter, not soft-deleted either).

---

## Audit Field Triggers

The client never sets `created_by` / `changed_by` / `changed_at` — a trigger reads the authenticated caller from `auth.uid()`.

```sql
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

create trigger trg_profiles_audit             before insert or update on profiles             for each row execute function set_audit_fields();
create trigger trg_branches_audit             before insert or update on branches             for each row execute function set_audit_fields();
create trigger trg_plans_audit                before insert or update on plans                for each row execute function set_audit_fields();
create trigger trg_roles_audit                before insert or update on roles                for each row execute function set_audit_fields();
create trigger trg_members_audit              before insert or update on members              for each row execute function set_audit_fields();
create trigger trg_subscriptions_audit        before insert or update on subscriptions        for each row execute function set_audit_fields();
create trigger trg_subscription_items_audit   before insert or update on subscription_items   for each row execute function set_audit_fields();
```

`profiles` is attached like every other table now (it was the one exception until the
roles-and-user-roles migration — security-review-findings.md's High finding). The one
wrinkle: a profile's `created_by` means "the admin who invited them," set via
`handle_new_auth_user()` below, not the row owner's own `auth.uid()` — see that section for
how the two are reconciled.

---

## Profile Creation Trigger

A `profiles` row is created automatically whenever a new `auth.users` row appears (via `invite-user` Edge Function or the bootstrap step). `full_name` arrives via `raw_user_meta_data`, set by the Edge Function at invite time. **Role assignment happens separately, after this trigger runs** — `invite-user` inserts into `user_roles` explicitly once it has the new user's id back from the invite call (see edge-functions.md §5); this trigger no longer touches role at all.

`created_at`/`created_by` are no longer literal `INSERT` values — `set_audit_fields()` (just attached above) stamps them the same as every other table. The wrinkle: `set_audit_fields()` reads `auth.uid()`, which would otherwise resolve to `NULL` here, since this trigger runs under whatever connection created the `auth.users` row (e.g. `invite-user`'s service-role client), not the inviting admin's own session. Faking the JWT claim for this transaction only (`LOCAL`, auto-reset at commit) lets `created_by` still correctly attribute to the inviting admin — the same trick `create_subscription_with_items` uses (§subscription RPC functions). Left unset for the one-time bootstrap admin (no inviter), so `created_by` naturally stays `NULL` there too.

```sql
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

create trigger trg_handle_new_auth_user
  after insert on auth.users
  for each row execute function handle_new_auth_user();
```

This applies identically regardless of whether the user's first sign-in ends up being password or Google OAuth — both land on the same `auth.users` row, and this trigger only cares about the row's creation, not which credential type accompanies it.

---

## Field-Level Audit Trigger (REQ-AUDIT-001)

Generic, attached to every business table (not `audit_log` itself). Compares `OLD`/`NEW` column-by-column via `to_jsonb`, skipping the audit-metadata columns (per REQ-AUDIT-001's acceptance criteria — those are metadata, not business data). `deleted_at`/`deleted_by` **are** audited like any other field, since a soft-delete is itself a meaningful business event worth a history entry.

```sql
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
    -- Reachable only for user_roles (§Soft Delete Enforcement's one deliberate exception
    -- to prevent_hard_delete) — every other table still can't reach this branch at all.
    -- user_roles has no surrogate `id` column; its natural key is (user_id, role_id).
    -- Read via v_old (jsonb), not direct OLD.field access, same as every other branch —
    -- this function is shared across tables with different columns.
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

create trigger trg_profiles_audit_fields            after insert or update on profiles            for each row execute function audit_row_changes();
create trigger trg_branches_audit_fields             after insert or update on branches             for each row execute function audit_row_changes();
create trigger trg_plans_audit_fields                after insert or update on plans                for each row execute function audit_row_changes();
create trigger trg_roles_audit_fields                after insert or update on roles                for each row execute function audit_row_changes();
create trigger trg_user_roles_audit_fields           after insert or delete on user_roles            for each row execute function audit_row_changes();
create trigger trg_members_audit_fields              after insert or update on members              for each row execute function audit_row_changes();
create trigger trg_subscriptions_audit_fields        after insert or update on subscriptions        for each row execute function audit_row_changes();
create trigger trg_subscription_items_audit_fields   after insert or update on subscription_items   for each row execute function audit_row_changes();
```

These are `after` triggers, so they read the row's *final* state — after `set_audit_fields()` and (for `members`) `generate_member_number()` have both already run as `before` triggers. `user_roles` is the one table using `after insert or delete` instead of `after insert or update` — it has no `update` path (a role change is a delete-then-insert, see `replace_user_roles` in §Role Assignment) and no `set_audit_fields`/`changed_at` columns of its own.

---

## Row Level Security (RLS)

RLS is **enabled on every table**: the web client cannot be trusted, so every access rule is enforced here, not just in the UI. This is the actual enforcement layer for access control on the web — every rule in [business-logic.md](./business-logic.md) that matters for security must also exist as an RLS policy or Edge Function check, not just a UI check.

```sql
alter table profiles               enable row level security;
alter table branches                enable row level security;
alter table plans                   enable row level security;
alter table roles                   enable row level security;
alter table user_roles              enable row level security;
alter table configuration           enable row level security;
alter table members                 enable row level security;
alter table member_number_sequences enable row level security;
alter table subscriptions           enable row level security;
alter table subscription_items      enable row level security;
alter table audit_log               enable row level security;

-- Helper: is the current user active and non-deleted at all (admin or staff)?
create or replace function is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  );
$$;

-- is_admin_user(p_user_id) / is_active_admin() are defined in §Role Assignment above —
-- is_active_admin() is a one-line wrapper (`select is_admin_user(auth.uid())`) so every
-- policy below that already called it keeps working unchanged.

-- profiles: self-update is restricted to full_name via a column-level grant, not just this
-- row policy — RLS alone can't express "this column only," and `is_active`/`deleted_at`
-- must not be self-editable. See the grant below.
create policy "profiles_select_active_users" on profiles
  for select using (is_active_user() and deleted_at is null);
create policy "profiles_update_admin" on profiles
  for update using (is_active_admin() and deleted_at is null);
create policy "profiles_update_self_name" on profiles
  for update using (auth.uid() = id and deleted_at is null) with check (auth.uid() = id);

revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;

-- branches: all active users can read; only admins can write.
create policy "branches_select_active_users" on branches
  for select using (is_active_user() and deleted_at is null);
create policy "branches_insert_admin" on branches
  for insert with check (is_active_admin());
create policy "branches_update_admin" on branches
  for update using (is_active_admin() and deleted_at is null);

-- plans: all active users can read; only admins can write. One policy set now covers
-- both membership plans and add-ons (category is just a column, not a separate table).
create policy "plans_select_active_users" on plans
  for select using (is_active_user() and deleted_at is null);
create policy "plans_insert_admin" on plans
  for insert with check (is_active_admin());
create policy "plans_update_admin" on plans
  for update using (is_active_admin() and deleted_at is null);

-- roles: all active users can read (needed to render the role picker); only admins write.
create policy "roles_select_active_users" on roles
  for select using (is_active_user() and deleted_at is null);
create policy "roles_insert_admin" on roles
  for insert with check (is_active_admin());
create policy "roles_update_admin" on roles
  for update using (is_active_admin() and deleted_at is null);

-- user_roles: readable by any active user, but NO insert/update/delete policy for any
-- client role at all — every write goes through replace_user_roles() (§Role Assignment,
-- service_role only), so there is no self-service path to this table whatsoever.
create policy "user_roles_select_active_users" on user_roles
  for select using (is_active_user());

-- configuration: admin-only read/update; keys themselves are migration-managed (no insert grant).
create policy "configuration_select_admin" on configuration
  for select using (is_active_admin());
create policy "configuration_update_admin" on configuration
  for update using (is_active_admin());

-- member_number_sequences: admin-only read (Member Numbering settings screen,
-- member-management.md §3.1) — still no insert/update/delete policy for any client role.
-- generate_member_number() writes via its SECURITY DEFINER privilege regardless of RLS;
-- an admin's own override goes through update-member-number-sequence (service role), not
-- a direct client write, since it needs to check `members` for collisions first.
create policy "member_number_sequences_select_admin" on member_number_sequences
  for select using (is_active_admin());

-- members: all active users can read and write directly;
-- server-side CHECK constraints (see Schema above) enforce the required-field and
-- doctor's-care-details rules regardless of what the client sends.
create policy "members_select_active_users" on members
  for select using (is_active_user() and deleted_at is null);
create policy "members_insert_active_users" on members
  for insert with check (is_active_user());
create policy "members_update_active_users" on members
  for update using (is_active_user() and deleted_at is null);

-- subscriptions / subscription_items: read-only for direct client access.
-- All writes (creating a subscription + its line items together) go through Edge
-- Functions using the service role — see edge-functions.md — so a checkout can't be
-- split into a header with no items, or an item with no valid parent, by a direct insert.
create policy "subscriptions_select_active_users" on subscriptions
  for select using (is_active_user() and deleted_at is null);
create policy "subscription_items_select_active_users" on subscription_items
  for select using (is_active_user() and deleted_at is null);

-- audit_log: admin-only, read-only. No insert/update/delete policy for any role —
-- every row is written exclusively by the audit_row_changes() trigger (security definer).
create policy "audit_log_select_admin" on audit_log
  for select using (is_active_admin());
```

**Deactivated or soft-deleted users are blocked everywhere immediately**, not just at login: every policy above gates on `is_active_user()` / `is_active_admin()`, so a deactivated or deleted account's existing session immediately loses read/write access on its next request even if the client-side session token is still technically valid.

---

## Storage

Bucket `member-photos` — **private**, not public (revised by `20260723000000_member_photos_private_bucket.sql`; this section previously said `public = true` with a public-read policy, which was true only until that migration):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "member_photos_read_active_users" on storage.objects
  for select using (bucket_id = 'member-photos' and is_active_user());

create policy "member_photos_write_active_users" on storage.objects
  for insert with check (bucket_id = 'member-photos' and is_active_user());

create policy "member_photos_update_active_users" on storage.objects
  for update using (bucket_id = 'member-photos' and is_active_user());
```

Made private because object keys are predictable (`{memberId}/original-{timestamp}.jpg`, sequential bigint ids) — a fully public bucket meant anyone with a guessed URL could view any member's photo with no session at all. Reads now require `is_active_user()`, same bar as every other member field, via short-lived signed URLs generated client-side (`frontend/src/lib/photo-urls.ts`) rather than a permanent public URL — `members.photo_url`/`photo_thumbnail_url` accordingly store a bucket-relative **path**, not a URL (a signed URL itself can't be persisted, it expires). See [member-management.md §8](./member-management.md#8-storage-member-photos-bucket) for the full write-up.

---

## Seed Data

```sql
insert into roles (name, description)
values
  ('admin', 'Full access — user/role/catalog management plus everything staff can do.'),
  ('staff', 'Day-to-day member and subscription management.')
on conflict (name) do nothing;

insert into branches (name, code)
values ('Main Branch', 'MUM')
on conflict (code) do nothing;

insert into plans (name, category, duration_days, price, max_members)
values
  ('Day',             'membership', 1,    100,  1),
  ('Monthly',          'membership', 30,   1000, 1),
  ('Quarterly',         'membership', 90,   2500, 1),
  ('Annual',            'membership', 365,  8000, 1),
  ('Couple Monthly',    'membership', 30,   1800, 2),
  ('Membership Fee',    'addon',      null, 500,  1),
  ('Zumba Class',       'addon',      30,   800,  1)
on conflict (name) do nothing;
```

Configuration seed rows are listed under §Configuration Table above. `profiles` has **no automatic seed** — see below.

---

## Bootstrapping the First Admin

A hosted Supabase project has no "first launch" moment, and auto-seeding a well-known admin credential into a public-facing database would be a security hole. The first admin account is created **once, manually**, by whoever sets up the Supabase project:

1. In the Supabase dashboard (or via the Admin API), create the first `auth.users` row with the real admin's email, using **Auth → Invite User** or `supabase.auth.admin.createUser()` from a trusted, non-deployed script.
2. Set `raw_user_meta_data = { "full_name": "..." }` on that call so the `handle_new_auth_user` trigger creates the matching `profiles` row.
3. Grant the admin role directly, since there is no admin yet to call `invite-user`:
   ```sql
   insert into user_roles (user_id, role_id)
   select '<the new auth.users.id>', id from roles where name = 'admin';
   ```
4. From then on, every other user is created through the in-app **Invite User** flow (`invite-user` Edge Function, admin-only), which assigns roles via `user_roles` directly and sets `raw_user_meta_data.invited_by` to the inviting admin's id.

This one-time step must be documented in the project's deployment runbook — it is not something the app's own UI does, since there is no logged-in admin yet the first time it runs.

---

## Query Conventions

- All client queries go through `supabase-js`, which parameterizes automatically — never build raw SQL strings from user input, on the client or in an Edge Function.
- Dates compared as Postgres `date` — native comparison, no string hacks.
- `end_date` is always computed server-side (Edge Function), never sent by the client — see [architecture.md](../architecture.md).
- `changed_at` / `changed_by` are never set by the client — see §Audit Field Triggers above.
- Every hand-written query — reports, uniqueness checks, deletion/usage guards, `member_current_items`-style aggregation — must add `and deleted_at is null` (or join through a table where it's already filtered). There is no view or default that does this automatically beyond `member_current_items` itself; it is the responsibility of each Edge Function and each `supabase-js` query.

---

## Migrations

Initial schema creation, via the Supabase CLI migration workflow. Each file is idempotent (`if not exists` / `on conflict do nothing`), and — because this is the first time this schema is created — running all of them in order against a fresh Supabase project produces the complete database in one pass:

```
supabase/
  migrations/
    20260719000000_initial_schema.sql     ← all tables (profiles, branches, plans, configuration,
                                             members, member_number_sequences, subscriptions,
                                             subscription_items, audit_log), indexes, soft-delete columns
    20260719000100_functions_triggers.sql ← set_audit_fields, handle_new_auth_user, generate_member_number,
                                             prevent_hard_delete, audit_row_changes — and every trigger
                                             attaching them to their tables
    20260719000200_views.sql              ← member_current_items
    20260719000300_rls_policies.sql       ← RLS enable + is_active_user/is_active_admin + every policy
    20260719000400_storage.sql            ← member-photos bucket + policies
    20260719000500_seed.sql               ← branches, plans (both categories), configuration seed rows
```

New schema changes always get a new migration file — never edit an already-applied migration.
