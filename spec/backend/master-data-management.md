# Master Data Management — Backend Spec

> Consolidates the backend side of [requirements-template.md §9 Admin Data Management](../requirements-template.md#9-feature-area-admin-data-management) — specifically **REQ-ADMIN-002 (Plan Management)** and **REQ-ADMIN-003 (Branch Management)**, the two pure catalog/reference-data entities. REQ-ADMIN-004 (User Management), REQ-ADMIN-005 (Audit Log overview), and REQ-ADMIN-006 (user deletion) are a different shape (an invite-driven flow and a read-only filtered view, not generic create/edit) and are **out of scope for this doc**.
>
> **Delete is implemented** — this doc previously scoped Delete out as deferred; it has since shipped (`delete-plan`/`delete-branch` Edge Functions) and is documented in §5 below, not as a future plan.
>
> No new tables, columns, or migrations — `branches` and `plans` already exist in full (`database.md`'s master-data migration), created before either admin screen did. This doc is about exposing what's already there, not building new schema.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| REQ-ADMIN-002 | Plan Management: list + create/edit catalog items (both categories, one unified list) |
| REQ-ADMIN-003 | Branch Management: list + create/edit branches |

---

## 2. Data Model (already exists — no changes)

```sql
-- branches (database.md §Master Data)
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
create unique index if not exists idx_branches_code_active on branches(code) where deleted_at is null;

-- plans (database.md §Master Data)
create table if not exists plans (
  id             bigint generated always as identity primary key,
  name           text not null,
  category       text not null check (category in ('membership', 'addon')),
  duration_days  integer check (duration_days > 0),
  price          numeric(10,2) not null check (price >= 0),
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
```

Both already carry the standard audit block (`created_at`/`created_by`/`changed_at`/`changed_by`) and soft-delete columns (`deleted_at`/`deleted_by`), and both already have `trg_*_audit`/`trg_*_no_hard_delete`/`trg_*_audit_fields` triggers wired up from the master-data and views-and-audit migrations. Nothing new needed there either.

---

## 3. Row Level Security (already exists — no changes)

```sql
-- branches: all active users can read; only admins can write.
create policy "branches_select_active_users" on branches
  for select using (is_active_user() and deleted_at is null);
create policy "branches_insert_admin" on branches
  for insert with check (is_active_admin());
create policy "branches_update_admin" on branches
  for update using (is_active_admin());

-- plans: all active users can read; only admins can write.
create policy "plans_select_active_users" on plans
  for select using (is_active_user() and deleted_at is null);
create policy "plans_insert_admin" on plans
  for insert with check (is_active_admin());
create policy "plans_update_admin" on plans
  for update using (is_active_admin());
```

**No Edge Function needed for create/edit** — direct RLS-guarded `supabase-js` insert/update, admin-only by policy. This is a deliberate contrast with `members`/`subscriptions`: there's no cross-table atomicity requirement here (one row, one table, no line items), so RLS alone is sufficient authority, the same reasoning `members` CRUD already uses.

---

## 4. Validation Rules

### Branch (REQ-ADMIN-003)

| Field | Required | Rule |
|---|---|---|
| name | Yes | Non-empty |
| code | Yes | Non-empty; unique among non-deleted branches (`idx_branches_code_active`) |

A duplicate `code` on create or edit is rejected by Postgres with a unique-violation, surfaced as a validation error naming the conflict — same shape as `members.phone`'s uniqueness handling.

### Plan (REQ-ADMIN-002)

| Field | Required | Rule |
|---|---|---|
| name | Yes | Non-empty; unique among non-deleted plans (`idx_plans_name_active`) |
| category | Yes | `membership` or `addon` |
| duration_days | Conditional | **Required** when `category = 'membership'` (`chk_plan_duration_required_when_membership`); optional (null = indefinite) when `category = 'addon'` |
| price | Yes | Number ≥ 0 |
| max_members | Conditional | Only meaningful when `category = 'membership'` (`chk_plan_max_members_only_for_membership` forces it to `1` for add-ons); `1` or `2` for membership plans |

Both conditional rules are enforced twice, same pattern as `chk_doctor_care_details_required` on `members`: client-side for instant feedback, and server-side via the CHECK constraints above, so a forged direct API call is still rejected.

---

## 5. Delete + Usage Guard

Implemented via the exact pattern documented in [edge-functions.md §4](./edge-functions.md#4-admin-catalog-management-plans-branches-roles) — soft-delete with a pre-write usage guard, via an Edge Function (not a direct client delete, since the count-then-write isn't wrapped in a single transaction — an accepted, documented race-window trade-off for an admin-only, low-frequency action, same reasoning edge-functions.md gives):

- **Plan** (`delete-plan`): blocks if any non-deleted `subscription_items` row references it (`business-logic.md`'s Plan Deletion Guard).
- **Branch** (`delete-branch`): blocks if any non-deleted `members` row has that `branch_id`.
- **Role** (`delete-role`, added by the later profiles→roles redesign, not originally scoped to this doc but the same shape): blocks if any `user_roles` row references it.
- **Member** (`delete-member`, closing a separate gap flagged in domain-model-review.md — not admin-only like the three above, since REQ-MEM-007 is staff/admin): blocks if any non-deleted `subscription_items` row references it as `member_id` or `shared_member_id`. See [member-management.md's Member Deletion Guard](./member-management.md#member-deletion-guard-closes-domain-model-reviewmds-member-deletion-finding).

All four are a `select count(*) ... where deleted_at is null` check, then a soft-delete update, same shape, different guard table/column.

---

## 6. Requirements Traceability

| Requirement | Backend implementation |
|---|---|
| REQ-ADMIN-002 | `plans` table + CHECK constraints (§2/§4); RLS (§3) |
| REQ-ADMIN-003 | `branches` table + unique `code` index (§2/§4); RLS (§3) |
| REQ-ADMIN-002/003 delete guard | Implemented — §5 |

---

## Related docs

- [database.md](./database.md) — full schema, as part of the complete database spec
- [edge-functions.md §4](./edge-functions.md#4-admin-catalog-management-plans-branches) — the existing `delete-plan` pattern §5 above will mirror for both entities when Delete is built
- [business-logic.md §Plan Deletion Guard](./business-logic.md#plan-deletion-guard-soft-delete-guard-kept-as-a-product-rule) — the guard rule reused for Branch's own delete guard
- [../frontend/master-data-management.md](../frontend/master-data-management.md) — frontend counterpart (screens, fields, layout)
