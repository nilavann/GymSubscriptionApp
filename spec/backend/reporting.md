# Reporting — Backend Spec

> Consolidates the backend side of [requirements-template.md §6 Reporting](../requirements-template.md#6-feature-area-reporting) (REQ-REPORT-001/002) plus the pre-existing summary-tile/expiring-list content from [../frontend/screens.md WSCR-07](../frontend/screens.md#wscr-07--reports), into one place. Pulls from [database.md](./database.md), [business-logic.md §Member Status](./business-logic.md#member-status) / [§Expiry Notification Threshold](./business-logic.md#expiry-notification-threshold), and [edge-functions.md §6](./edge-functions.md#6-reporting-req-report-001002) — those remain canonical for the underlying tables/rule; update them first if behavior changes, then re-sync this doc.
>
> **No new tables, columns, migrations, or Edge Functions.** Every number on the Reports screen is read directly off existing tables (`members`, `subscriptions`, `subscription_items`, `plans`) and the existing `member_list_view`, via RLS-gated `supabase-js` reads any active user already has (§3 below). This is a read-only reporting surface, not a new feature area with its own write path.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| REQ-REPORT-001 | Two bar charts — "New Subscriptions per Month" / "New Add-ons per Month" — for a selected date range, bucketed by calendar month |
| REQ-REPORT-002 | Itemized transaction list for the same range: one row per `subscription_items` row, member/plan/amount/payment-mode detail |
| *(pre-existing, WSCR-07)* | Summary tiles (Total / Active / Expiring Soon / Expired member counts) + "Expiring This Week" list — unchanged, just folded into this consolidated doc |

---

## 2. Data Sources (no new schema)

All four source tables already exist — see [database.md](./database.md) for full definitions:

| Table / View | Columns used here |
|---|---|
| `member_list_view` | `id`, `current_membership_plan_id`, `current_membership_end_date` — feeds the summary tiles and Expiring This Week list, via the same client-side `deriveStatus()` the Members List already uses (no server-side status column, per [member-management.md §5](./member-management.md#5-member_list_view--resolving-the-member-status-open-question)) |
| `subscription_items` | `id`, `subscription_id`, `plan_id`, `member_id`, `start_date`, `amount_paid`, `deleted_at` — one row per line item; `start_date` is the field both the charts and the transaction list bucket/filter on (REQ-REPORT-001's acceptance criteria: counted by `start_date`, not `created_at`) |
| `subscriptions` | `id`, `payment_mode` — joined in for the transaction list; payment mode is checkout-level (§Subscription Management), not per-item. Also the sole source for [frontend/reporting.md §5](../frontend/reporting.md#5-revenue-by-payment-mode-new--donut-chart)'s Revenue by Payment Mode donut — a client-side `sum(amount_paid)` grouped by this column over the same rows, no separate query |
| `plans` | `id`, `name`, `category` — joined in to label each row "Subscription" (`category = 'membership'`) vs. "Add-on" (`category = 'addon'`), and to drive which of the two charts a row's month-count falls into |
| `members` | `id`, `name`, `phone`, `member_number` — joined in for the transaction list's member columns |

No row here can reference a soft-deleted plan: the plan-deletion usage guard ([business-logic.md §Plan Deletion Guard](./business-logic.md#plan-deletion-guard-soft-delete-guard-kept-as-a-product-rule)) already blocks deleting any plan with non-deleted `subscription_items` referencing it, so every `plan_id` a report query encounters resolves to an active plan. Every query still adds `deleted_at is null` on `subscription_items`/`subscriptions`/`members` explicitly (rules.md rule 21) rather than relying on that guarantee alone.

---

## 3. Read Path — Plain `supabase-js`, No Edge Function

Per [edge-functions.md §6](./edge-functions.md#6-reporting-req-report-001002): RLS already grants `select` on all four tables/views to any active, non-deleted user (`is_active_user()`), so this is implementable entirely as direct client reads — no Edge Function, no server-side month-bucketing logic. The queries needed:

1. **Summary tiles + Expiring This Week:** one query against `member_list_view` (already used by the Members List page) — `deriveStatus()` runs client-side over the result exactly as it does there, so the counts are always consistent with what the Members List shows for the same data.
2. **Transaction list + charts, for a given `[start_date, end_date]` range:**
   a. `subscription_items` filtered `start_date >= range.start and start_date <= range.end and deleted_at is null`.
   b. The distinct `subscription_id`s from (a) → `subscriptions` filtered `.in('id', ids) and deleted_at is null`, for `payment_mode`.
   c. The distinct `plan_id`s from (a) → `plans` filtered `.in('id', ids)`, for `name`/`category`.
   d. The distinct `member_id`s from (a) → `members` filtered `.in('id', ids) and deleted_at is null`, for `name`/`phone`/`member_number`.
   e. Join (a)–(d) client-side into one row per item — same "fetch flat, join in TypeScript" pattern already used by `subscriptionRepository` (`getHistoryForMember`/`getItemsForSubscriptions`), not a Postgres-side join, consistent with how every other read in this codebase avoids supabase-js's nested-select type-inference bug (see `member.repository.ts`'s comment on this).
3. **Chart buckets** are then derived from the same joined row set in (2): group by `(plan.category, calendar month of start_date)`, count. No separate query — the transaction list and the charts read the exact same result set, just aggregated two different ways, guaranteeing they can never disagree.

If this data volume ever grows large enough that "fetch every row in range, join client-side" becomes a real cost, revisit with a dedicated `get-report-data` Edge Function or a Postgres view — not needed at current scale, and not built preemptively.

---

## 4. Business Rules

- **"New" is counted by `start_date`, not `created_at`** (REQ-REPORT-001/002): a subscription item counts toward the month it takes effect, not the month it was recorded. This matches the Renewal Start Date Default rule elsewhere in the app, where `start_date` can be backdated or future-dated relative to `created_at`.
- **Chart grouping is always by calendar month**, regardless of the selected range's length — no adaptive daily/weekly granularity, even for a single-day range (that range simply produces at most one non-zero bar).
- **The transaction list is never aggregated per member** — one row per `subscription_items` row, exactly REQ-REPORT-002's requirement, even when a member has multiple items (e.g. a renewal plus two add-ons) in the same checkout or same range.
- **Payment mode comes from the parent `subscriptions` row**, not the item — one value per checkout, shared by every item row from that checkout in the list.
- **Expiring-soon threshold reuses the existing 7-day rule** ([business-logic.md §Expiry Notification Threshold](./business-logic.md#expiry-notification-threshold)) — this doc does not define a second, reports-specific threshold.
- **No admin/staff distinction** — Reports is available to all active users, same access level as the Members List, per REQ-REPORT-001's stated business rule and the existing `reports_select` access row in [../frontend/navigation.md](../frontend/navigation.md).
- **Deferred:** cancelled/refunded flagging on report rows — there is no `status` column to read yet (§Subscription Cancellation & Refund is deferred across the whole app, per [subscription-management.md](./subscription-management.md)'s header note). Every row here is simply "created," with no cancelled/active distinction.

---

## 5. Requirements Traceability

| Requirement | Backend implementation |
|---|---|
| REQ-REPORT-001 | Client-side month-bucketing over the joined `subscription_items`/`plans` read (§3.2–3.3); no server aggregation |
| REQ-REPORT-002 | Joined `subscription_items`/`subscriptions`/`plans`/`members` read (§3.2); one row per item |
| *(pre-existing)* Summary tiles / Expiring This Week | `member_list_view` read + client-side `deriveStatus()` (§3.1), unchanged from the Members List's own logic |

---

## Related docs

- [database.md](./database.md) — schema/RLS for `members`, `subscriptions`, `subscription_items`, `plans`, `member_list_view`, as part of the full database spec
- [business-logic.md §Member Status](./business-logic.md#member-status) — 7-day expiring-soon threshold, shared with the Members List
- [subscription-management.md](./subscription-management.md) — `subscriptions`/`subscription_items` schema and business rules in full
- [edge-functions.md §6](./edge-functions.md#6-reporting-req-report-001002) — the original "no Edge Function strictly required" note this doc resolves
- [../frontend/reporting.md](../frontend/reporting.md) — frontend counterpart: screen layout, date-range control, chart/list UI, loading/error/empty states
