# Subscription Management — Backend Spec

> Consolidates the backend side of [requirements-template.md §4 Subscription Management](../requirements-template.md#4-feature-area-subscription-management) (REQ-SUB-001–012) into one place, pulled from [domain-model.md](./domain-model.md) §5–6, [database.md](./database.md), [business-logic.md](./business-logic.md), and [edge-functions.md](./edge-functions.md) §3 — which remain canonical for other tables/functions. Update those first if behavior changes; re-sync this doc afterward.
>
> **Cancellation and refunds are deferred** in this revision — see [domain-model.md §Open items](./domain-model.md#open-items-not-blocking-but-worth-resolving-before-implementation-begins). `subscriptions`/`subscription_items` intentionally carry no `status`/`refund_amount`/`cancellation_reason`/`cancelled_by`/`cancelled_at` columns yet.
>
> **Overlap-warning checks (REQ-SUB-005/008) are resolved, but entirely on the frontend.** There is no server-side overlap check, no `overlap_override` column, and `create-subscription` (§4 below) has no knowledge of it at all — see [../frontend/subscription-management.md §Overlap Warning](../frontend/subscription-management.md#5-overlap-warning-req-sub-005008) for the actual rule and UI flow. This doc only notes where the boundary is.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| REQ-SUB-001 | Create a subscription (checkout): one or more catalog items, exactly one `category = 'membership'`, one payment mode |
| REQ-SUB-002 | Payment mode Cash/UPI/Card, one per checkout |
| REQ-SUB-003 | Add-on items itemized separately in the same checkout |
| REQ-SUB-004 | Shared member on a `max_members = 2` membership item, at creation time only |
| REQ-SUB-006 | `duration_days`: NULL = indefinite, positive integer = time-boxed |
| REQ-SUB-007 | Indefinite item: hard block on repeat attachment (no override) |
| REQ-SUB-009 | Quantity multiplier (×1/×2/×3/×6/×12 + custom), applies to `end_date`/`amount_paid` |
| REQ-SUB-005/008 | Overlap warning — **frontend-only**, see [frontend/subscription-management.md](../frontend/subscription-management.md) |
| REQ-SUB-010/011 | *(Deferred)* Quantity reduction; Cancel & Refund |
| REQ-SUB-012 | *(Resolved elsewhere)* Status derivation — see [backend/member-management.md §5–6](./member-management.md#5-member_list_view--resolving-the-member-status-open-question) |

---

## 2. Data Model: `subscriptions` / `subscription_items` tables

```sql
-- subscriptions — header only, one row per checkout event (domain-model.md §5).
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

-- subscription_items — one row per plan/add-on selected in a checkout (domain-model.md §6).
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
create index if not exists idx_subscription_items_member_end
  on subscription_items(member_id, end_date) where deleted_at is null;
create index if not exists idx_subscription_items_shared_member_end
  on subscription_items(shared_member_id, end_date) where deleted_at is null and shared_member_id is not null;
```

No `plan_id`/dates/quantity/amount on `subscriptions` — those live per line on `subscription_items`. No `status`/`refund_amount`/`cancellation_reason`/`cancelled_by`/`cancelled_at`/`overlap_*` columns on either table — deferred/resolved-elsewhere, per the header note above.

`member_id`/`payment_mode`/`notes` on `subscriptions` stay editable after creation (correction-only, via `update-subscription`); the line items themselves are not editable at all once created.

---

## 3. Subscription End Date & Pricing (REQ-SUB-006/009)

**Formula:** `end_date = start_date + (plan.duration_days × quantity) - 1`, or `NULL` when `plan.duration_days IS NULL` (indefinite item). One formula for every `subscription_items` row, membership or add-on alike — see [business-logic.md §Subscription End Date](./business-logic.md#subscription-end-date).

- `quantity` defaults to `1`; preset chips ×1/×2/×3/×6/×12 plus a custom field are a client-side UX affordance only — the server accepts any positive integer.
- `amount_paid` defaults to `plan.price × quantity` but the client can override it; whatever the client submits is what's persisted.
- **Computed server-side only**, inside `create-subscription` — the client never computes or sends `end_date`.
- Not applicable to indefinite items (`duration_days IS NULL`) — no duration to multiply, quantity is rejected for these (see §4 below).

---

## 4. `create-subscription` Edge Function (REQ-SUB-001–004/007/009)

The **only** write path for `subscriptions`/`subscription_items` — RLS (§6 below) grants no direct client insert on either table. Creates the header and every line item together, in one transaction; there is no separate function to add an item to an existing subscription later (a new checkout always means a new `subscriptions` row).

Responsibilities, in order (see [edge-functions.md §3](./edge-functions.md#3-subscriptions) for the full write-up):

1. Verify caller is an authenticated, active, non-deleted user (`is_active_user()`, from JWT).
2. Validate the payload has at least one item, and **exactly one** item references a `category = 'membership'` plan — reject otherwise (REQ-SUB-001).
3. For each item:
   a. Look up the plan (`duration_days`, `price`, `category`, `max_members`) — must not be soft-deleted.
   b. Validate `quantity` (REQ-SUB-009): positive integer when the plan has a duration; reject a quantity on an indefinite item.
   c. Compute `end_date` (§3 above).
   d. Compute default `amount_paid = plan.price × quantity` if the client didn't override it; persist whatever the client submits either way.
   e. **Shared member (REQ-SUB-004):** if `shared_member_id` is supplied, validate `plan.category = 'membership'`, `plan.max_members = 2`, and `shared_member_id <> member_id` (also enforced by `chk_subscription_item_shared_member_distinct`); reject otherwise. An add-on item must never set `shared_member_id`.
   f. **Indefinite-item hard block (REQ-SUB-007):** if `plan.duration_days is null`, query whether `member_id` (and `shared_member_id`, if set) already has *any* non-deleted `subscription_items` row for this `plan_id`, across any subscription. If yes → reject with a clear error; there is no override for this case.
4. Insert the `subscriptions` header row, then all validated `subscription_items` rows, via the service-role client, in one transaction — either all rows land or none do.
5. Return the created subscription and its items.

**Deliberately not implemented here:** the warn-then-allow overlap check (REQ-SUB-005/008) — this function has no knowledge of it, doesn't accept an override flag, and doesn't reject or warn on an overlapping date range itself. It's resolved as a client-side-only check that runs in the checkout form *before* this function is ever called — see [frontend/subscription-management.md §5](../frontend/subscription-management.md#5-overlap-warning-req-sub-005008). A direct call here saves an overlapping item with no resistance at all, by design.

### `update-subscription`

Header-only edits: `payment_mode`, `notes`. Line items have no update path at all in this revision — not `plan_id`, not dates, not `quantity`, not `shared_member_id` after creation. Adding, removing, or changing an item always means a new `create-subscription` checkout.

---

## 5. Row Level Security

```sql
alter table subscriptions      enable row level security;
alter table subscription_items enable row level security;

-- subscriptions / subscription_items: read-only for direct client access. All writes
-- (creating a subscription + its line items together) go through create-subscription
-- using the service role — see edge-functions.md — so a checkout can't be split into a
-- header with no items, or an item with no valid parent, by a direct insert. No
-- insert/update policy is defined for either table on purpose.
create policy "subscriptions_select_active_users" on subscriptions
  for select using (is_active_user() and deleted_at is null);
create policy "subscription_items_select_active_users" on subscription_items
  for select using (is_active_user() and deleted_at is null);
```

No admin/staff distinction on read — any active user can view every subscription/item (Section 1's role model). Writes are gated entirely by which Edge Function exists (`create-subscription`/`update-subscription`), not by RLS column/role checks, since RLS alone can't express "header and items must land together or not at all."

---

## 6. Business Rules

- **Exactly one membership item per checkout** (REQ-SUB-001): enforced in `create-subscription` step 2, not a DB constraint — `subscription_items` has no way to distinguish "the" membership item at the schema level, so this is an application-layer rule.
- **Catalog item duration** (REQ-SUB-006): `plans.duration_days IS NULL` → indefinite (charged once, never expires); a positive integer → time-boxed, can be attached again later. See [business-logic.md §Catalog Item Rules](./business-logic.md#catalog-item-rules).
- **Indefinite items — hard block, no override** (REQ-SUB-007): cannot be attached again to a member who already has a non-deleted `subscription_items` row referencing it, from any past subscription. This only needs to check for an existing row, not a status, so it stands independently of the deferred cancellation logic.
- **Quantity & multiplier** (REQ-SUB-009): straight multiplication of duration and price, no bulk discount, uniformly for membership and add-on items. No edit path for `quantity` after creation exists in this revision (REQ-SUB-010 deferred).
- **Shared members / couple plans** (REQ-SUB-004): a `max_members = 2` membership item can optionally set `shared_member_id` at creation only — no path to add, change, or clear it afterward. Add-on items never set `shared_member_id`, even on a couple's subscription. See [business-logic.md §Shared Members / Couple Plans](./business-logic.md#shared-members--couple-plans).
- **Payment mode is checkout-level, not item-level** (REQ-SUB-002): one `payment_mode` per `subscriptions` row, covering every item created in it — a narrower capability than a previous design where an add-on could carry its own independent payment mode.
- **Plan deletion guard**: a plan referenced by any non-deleted `subscription_items` row cannot be deleted — see [business-logic.md §Plan Deletion Guard](./business-logic.md#plan-deletion-guard-soft-delete-guard-kept-as-a-product-rule) and [edge-functions.md §4](./edge-functions.md#4-admin-catalog-management-plans-branches). Editing a plan's `price`/`duration_days` never recalculates existing `subscription_items` rows.
- **Overlap warning is out of scope here** (REQ-SUB-005/008): see the header note and §4 above — this is entirely a frontend concern, with zero backend footprint (no column, no check, no Edge Function logic).
- **No cancellation/refund path exists** (REQ-SUB-011, deferred): `subscription_items` carries no `status`/`refund_amount`/`cancellation_reason`/`cancelled_by`/`cancelled_at` columns.

---

## 7. Requirements Traceability

| Requirement | Backend implementation |
|---|---|
| REQ-SUB-001 | `create-subscription` steps 2–4 (§4); `subscriptions`/`subscription_items` tables (§2) |
| REQ-SUB-002 | `subscriptions.payment_mode` CHECK (§2) |
| REQ-SUB-003 | One `subscription_items` row per item, own `amount_paid` (§2) |
| REQ-SUB-004 | `subscription_items.shared_member_id` + `chk_subscription_item_shared_member_distinct` (§2); `create-subscription` step 3e (§4) |
| REQ-SUB-005 | Frontend-only — see [frontend/subscription-management.md §5](../frontend/subscription-management.md#5-overlap-warning-req-sub-005008); no backend implementation |
| REQ-SUB-006 | `plans.duration_days` nullable CHECK (master-data migration); `end_date` formula (§3) |
| REQ-SUB-007 | `create-subscription` step 3f (§4) |
| REQ-SUB-008 | Frontend-only — see [frontend/subscription-management.md §5](../frontend/subscription-management.md#5-overlap-warning-req-sub-005008); no backend implementation |
| REQ-SUB-009 | `create-subscription` step 3b/3c/3d (§4); `end_date`/`amount_paid` formulas (§3) |
| REQ-SUB-010 | Deferred — no implementation |
| REQ-SUB-011 | Deferred — no implementation |
| REQ-SUB-012 | Resolved via `member_list_view`/`member_current_items` — see [backend/member-management.md §5](./member-management.md#5-member_list_view--resolving-the-member-status-open-question) |

---

## Related docs

- [domain-model.md §5–6, §Views](./domain-model.md) — `Subscription`/`SubscriptionItem` field definitions, `member_current_items`, as part of the full domain model
- [database.md](./database.md) — schema/RLS as part of the full database spec
- [business-logic.md](./business-logic.md) — end-date formula, catalog item rules, quantity/multiplier, shared members, plan deletion guard, overlap guard, as part of the full business-logic doc
- [edge-functions.md §3](./edge-functions.md#3-subscriptions) — `create-subscription`/`update-subscription` as part of the full Edge Functions catalog
- [../frontend/subscription-management.md](../frontend/subscription-management.md) — frontend counterpart (checkout form, overlap warning UI, subscription history)
