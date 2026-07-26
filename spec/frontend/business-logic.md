# Business Logic — Web Edition

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)

These rules are the same **product** rules as the mobile app's [spec/business-logic.md](../../spec/business-logic.md) — the gym's policies don't change because the platform changed. What changes is *where the rule is enforced*: on the web, the client cannot be trusted, so every rule that matters is enforced in a Supabase Edge Function (server-side) rather than only in a client-side service class.

---

## Member Status

A member's current status is derived from their **latest subscription's `end_date`**:

| Status        | Condition                                    | Badge color |
|---------------|------------------------------------------------|-------------|
| Active        | end_date >= today AND days_remaining > 7        | Green       |
| Expiring Soon | end_date >= today AND days_remaining <= 7        | Amber       |
| Expired       | end_date < today OR no subscription exists       | Red         |

**Formula:** `days_remaining = end_date - today` (in whole days, inclusive of end_date)

If a member has no subscription at all, their status is **Expired**.

**Where computed:** Client-side, from the raw subscription rows returned by `supabase-js` — same as the mobile app ("status is derived by the screen, never stored"). This is a pure read-side presentation rule with no security implication, so it does not need server-side enforcement. Use "today" as the **browser's local date**, consistent with the Timezone Rule in [domain-model.md](../backend/domain-model.md).

---

## Subscription End Date

**Formula:** `end_date = start_date + plan.duration_days - 1`

Example: start_date = `2026-07-01`, duration_days = `30` → end_date = `2026-07-30`

The `-1` ensures the subscription covers exactly `duration_days` calendar days inclusive of the start day.

**Where computed:** Server-side only, inside the `create-subscription` and `update-subscription` Edge Functions (see [architecture.md](../architecture.md)). The client never computes or sends `end_date` — this prevents a forged request from setting an arbitrary `end_date` that bypasses the overlap guard below.

---

## Subscription Overlap Guard

A member **cannot have two subscriptions whose date ranges overlap**. This applies to both adding a new member (their first subscription) and renewing an existing member.

### Overlap condition

Two date ranges `[A_start, A_end]` and `[B_start, B_end]` overlap when:

```
A_start <= B_end  AND  A_end >= B_start
```

### Validation rule

Before inserting any new subscription row for a member, the `create-subscription` Edge Function runs:

```sql
select count(*) from subscriptions
where member_id = $1
  and start_date <= $2   -- new_end_date
  and end_date   >= $3   -- new_start_date
```

Parameters: `(member_id, new_end_date, new_start_date)`

- If count > 0 → **block the insert**, return an error. The client shows: `"This period overlaps with an existing subscription (DD MMM YYYY – DD MMM YYYY). Choose a start date after DD MMM YYYY."`
  - The dates shown are from the conflicting subscription row (returned by the Edge Function).
  - "Choose a start date after DD MMM YYYY" refers to the conflicting subscription's `end_date`.
- If count = 0 → proceed with the insert.

### Where this applies

| Flow | Edge Function |
|--------|-----------------------|
| Add New Member's first subscription | `create-subscription` |
| Renew Subscription | `create-subscription` |

**Enforcement note:** This guard is only meaningful if it cannot be bypassed. Because `subscriptions` grants no direct client `insert`/`update` via RLS (see [database.md](../backend/database.md)), the only way to create a subscription row is through this Edge Function, which runs with the Supabase service role and always performs the check before writing. A direct `supabase.from('subscriptions').insert(...)` call from the browser will be rejected by RLS.

### Edge case — gap is zero days

A new subscription starting on the same day an existing one ends is an overlap.
Example: existing `end_date = 2026-07-30`, new `start_date = 2026-07-30` → **blocked** (same day = overlap).
The next valid start date is `end_date + 1` = `2026-07-31`.

> This is why the Renewal Start Date Default is set to `end_date + 1` (see below) — it automatically avoids an overlap for the common case.

---

## Plan Deletion Guard

The `delete-plan` Edge Function:
1. Queries: `select count(*) from subscriptions where plan_id = $1`
2. If count > 0 → block deletion, return an error the client shows as: "This plan cannot be deleted because it is used by X subscription(s)."
3. If count = 0 → delete the plan.

Editing a plan is always allowed via a direct RLS-guarded `supabase-js` update (admin only) — see [database.md](../backend/database.md). Changing `price` or `duration_days` does **not** recalculate existing subscriptions.

**Defense in depth:** even if the Edge Function's pre-check were somehow skipped, `subscriptions.plan_id` has `ON DELETE RESTRICT`, so Postgres itself refuses the delete at the database level. The Edge Function's job is purely to turn that into a friendly, specific error message instead of a raw constraint violation.

---

## Renewal Start Date Default

When renewing a member's subscription:
- If current subscription is still active: default `start_date` = day after current `end_date`
- If current subscription is expired: default `start_date` = today (browser local date)

This is a client-side UI default only (pre-filling the form) — the actual value submitted is still validated server-side by the overlap guard.

---

## Expiry Notification Threshold

Members are considered "expiring soon" if `end_date` is within **7 days** of today (inclusive). This threshold is used by:
- The "Expiring" filter tab on the Members List screen
- The "Expiring This Week" section on the Reports screen

**Out of scope for now:** scheduled/pushed expiry alerts (email, web push, etc.) are explicitly not specified yet — see [SPEC-WEB.md §Key Decisions](../../SPEC-WEB.md). Do not build a notification mechanism until the user asks and this file is updated with the chosen approach.

---

## User Invitation & Deactivation

New in the web edition (no equivalent client-side rule existed in the mobile app, since the mobile app created users with a locally-set PIN):

- Only an `admin` (`is_active_admin()`) may invite a new user or change another user's `role` / `is_active`.
- Inviting a user is **always** done via the `invite-user` Edge Function, which uses the Supabase service role to call the Admin API (`supabase.auth.admin.inviteUserByEmail` or `createUser`). This cannot be done with a plain client insert — there is no client-side path to create an `auth.users` row.
- A deactivated user (`is_active = false`) loses access immediately on their next request, not just at their next login — see RLS policies in [database.md](../backend/database.md). Their existing browser session becomes read/write-blocked on every table.
- An admin cannot deactivate their own account (prevents a gym from being left with zero active admins by accident). This must be enforced both in the `invite-user`/profile-update Edge Function logic and as a UI-level disabled state on "deactivate" for the currently logged-in admin's own row.
