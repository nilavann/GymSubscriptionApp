# Subscription Management — Frontend Spec

> Consolidates the frontend side of [requirements-template.md §4 Subscription Management](../requirements-template.md#4-feature-area-subscription-management) (REQ-SUB-001–012) into one place.
>
> **This is the current source of truth for the checkout form and overlap-warning UI — [screens.md](./screens.md)'s WSCR-05 section and [data-models.md](./data-models.md)'s `Subscription`/`NewSubscription`/`UpdateSubscription` types predate the Subscription/SubscriptionItem header/line-item split.** Those files still describe a single-plan-per-checkout form (`subscriptionService.create({ member_id, plan_id, start_date, amount_paid, payment_mode, notes })`) and a server-side 409 overlap error — neither exists anymore. Treat this doc as authoritative for Subscription Management until they're updated to match; the route (`/members/:id/renew`), general screen conventions, and the Member Detail layout those files describe are still valid and referenced below, not repeated.
>
> Backend counterpart: [../backend/subscription-management.md](../backend/subscription-management.md) — `create-subscription`/`update-subscription`, schema, RLS. The overlap warning in §5 below has **no backend equivalent at all** — it's implemented entirely here.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| REQ-SUB-001 | Create a checkout: one or more catalog items, exactly one membership, one payment mode |
| REQ-SUB-002 | Payment mode Cash/UPI/Card, one per checkout |
| REQ-SUB-003 | Add-on items itemized separately in the same checkout |
| REQ-SUB-004 | Shared member on a `max_members = 2` membership item, at creation time only |
| REQ-SUB-005/008 | Client-side overlap warning before saving (§5) |
| REQ-SUB-006 | Indefinite vs. time-boxed items — quantity control hidden for the former |
| REQ-SUB-009 | Quantity multiplier chips, recomputes `end_date`/`amount_paid` preview |

---

## 2. Checkout Fields (current shape)

### Header (one per checkout)

| Field | Required | Type / Rule |
|---|---|---|
| payment_mode | Yes | `Cash` / `UPI` / `Card`, default `Cash` |
| notes | No | ≤ 200 chars |

`member_id` is not a form field — it comes from the route (`/members/:id/renew`).

### Per item (one or more, added/removed dynamically)

| Field | Required | Type / Rule |
|---|---|---|
| plan_id | Yes | Select from active plans; catalog grouped by category (Membership / Add-on) |
| start_date | Yes | Date picker; defaults per Renewal Start Date Default (§4) |
| quantity | Conditional | Chips ×1/×2/×3/×6/×12 + custom field, default ×1 — **hidden entirely** when the selected plan is indefinite (`duration_days IS NULL`), since there's no duration to multiply |
| amount_paid | Yes | Number ≥ 0; defaults to `plan.price × quantity`, recalculated live as plan/quantity change, always editable after that |
| shared_member_id | Conditional | Member picker — shown only when the selected plan is `category = 'membership'` and `max_members = 2`; optional even then; never shown for add-on items |
| end_date | — | **Not an input.** Read-only preview computed client-side with the same formula as §3 of the backend doc, purely for UX — the authoritative value comes back from the `create-subscription` response |

**Constraint enforced client-side before submit is even attempted:** exactly one item in the list must be `category = 'membership'` — the Save button stays disabled (or submit is blocked with an inline error) until that's true. This mirrors `create-subscription`'s own server-side check (backend spec §4 step 2) — client-side purely for instant feedback, not a replacement for it.

---

## 3. Screen — Add / Renew Subscription

**Route:** `/members/:id/renew` (unchanged from [navigation.md](./navigation.md)'s route map) · All signed-in users.

### 3.1 Page load

Before the form is usable, this screen fetches two things in parallel: the active plans catalog (for the plan picker) and the member's current items (for the Renewal Start Date Default, §4, and the Overlap Warning, §5). Per [rules.md rules 29–30](./rules.md#data-loading-errors--empty-states):

| State | Condition | UI |
|---|---|---|
| Loading | Fetch in flight | Skeleton in place of the whole form — not a form staff can start filling in before its defaults/overlap data have actually arrived |
| Error | Fetch failed | "Couldn't load this screen — check your connection and try again." (network/timeout) or "Something went wrong. Please try again." (generic), bounded by `with-timeout.ts`, plus a **Retry** button re-running the same fetch |
| Loaded, zero plans | Plans catalog is empty (nothing seeded yet) | "No plans available — ask an admin to add one first." in place of the plan picker; the rest of the form (payment mode, notes) still renders but Save stays disabled, since REQ-SUB-001 requires at least one item |

### 3.2 Submit flow

```
Staff adds one or more items (plan + start_date + quantity + amount_paid, shared_member_id
where applicable), sets payment_mode + notes once for the whole checkout.

Save tapped
  → client-side validation (§2's per-field rules, plus "exactly one membership item")
      → errors: show inline, stop
      → valid: run the overlap check (§5) against every item in the list
          → conflict found and staff hasn't confirmed yet: show the warning, stop here
          → no conflict, or staff already clicked "Save anyway": proceed
  → subscriptionService.create({ member_id, payment_mode, notes, items: [...] })
      → calls create-subscription Edge Function
      → success: navigate back to /members/:id
      → indefinite-item hard block (REQ-SUB-007): inline error naming the plan, no override offered
      → shared-member validation error (REQ-SUB-004): inline error on that item's picker
      → other failure: per rules.md rule 30 — a specific message where the cause is known
        (e.g. a network/timeout error via the same categorization as §3.1), otherwise a generic
        "Something went wrong saving this checkout. Please try again." Form stays open with every
        entered item intact — that's this screen's retry path, no separate button needed.
```

This screen doubles as both "first subscription" (empty-state CTA from Member Detail, screens.md WSCR-03) and "renew" (existing member with a lapsed/expiring membership) — same route, same form, no different mode. It never edits an existing subscription's items — see §6 below for what actually is editable.

### 3.3 Responsive layout (mobile-first)

Per [rules.md rule 16](./rules.md#ui--styling):

| Breakpoint | Layout |
|---|---|
| `< 768px` (mobile) | Items stack as individual cards, one per item, each with its own plan/date/quantity/amount fields in a single column; header fields (payment mode, notes) below the item list; a full-width "+ Add Item" button below that |
| `>= 768px` (desktop) | Items can render as a denser row-per-item layout (plan · dates · quantity · amount inline) since there's more horizontal room, but must not require horizontal scrolling — wrap to a second line within the row rather than clipping |

Every control — plan picker, quantity chips, shared-member picker, remove-item button, Save/Cancel — meets the 44×44px touch-target minimum. The overlap warning dialog (§5) is full-width on mobile, not a narrow centered modal that squeezes its Cancel/Save-anyway buttons.

---

## 4. Renewal Start Date Default (per item)

Reused from [business-logic.md §Renewal Start Date Default](../backend/business-logic.md#renewal-start-date-default), applied **per item** rather than once for the whole checkout, using the same scope the overlap check (§5) uses for "does this member already have one of these":

- **Membership item:** if the member has a current `category = 'membership'` item (any plan, via `member_current_items`), default `start_date` = day after that item's `end_date`. Otherwise, default to today.
- **Add-on item:** if the member has a current item of the **same** `plan_id`, default `start_date` = day after that item's `end_date`. Otherwise, default to today.

This is a UI convenience only — it doesn't prevent a conflict, it just makes one less likely to need the §5 warning at all. Staff can always change the date; the overlap check in §5 runs against whatever value ends up in the field, defaulted or edited.

---

## 5. Overlap Warning (REQ-SUB-005/008)

**Entirely client-side — no backend equivalent exists.** See [business-logic.md §Subscription Overlap Guard](../backend/business-logic.md#subscription-overlap-guard-req-sub-005008) for the canonical rule; this section covers only the UI mechanics.

### What triggers it

Checked once per item, immediately before the `create-subscription` call (§3's submit flow), against two sources: (a) `member_current_items` for the member (and the shared member, if the item sets one — the view already unions both roles into one `member_id` column, so one query per member covers both), and (b) any other item already added earlier in the same in-progress checkout.

| Item's plan category | Conflicts with |
|---|---|
| `membership` | Any existing current membership item, **regardless of `plan_id`** |
| `addon` | An existing current item of the **same** `plan_id` only |

Two ranges overlap when `existing.start_date <= new.end_date and new.start_date <= existing.end_date`, treating a `NULL` `end_date` (indefinite existing item) as `+infinity`.

### What the user sees

```
Save tapped, overlap detected on one or more items
  → a warning banner/dialog appears, naming each conflicting item:
     "{plan name} already runs {existing.start_date}–{existing.end_date} for this member."
  → two actions: "Cancel" (dismiss, stay on the form, no request sent) or
                 "Save anyway" (proceed exactly as if no conflict were detected)
  → staff picks "Save anyway": the submit flow (§3) continues from where it stopped,
    calling create-subscription with the payload completely unchanged — no override
    flag is added to it, because create-subscription doesn't accept one
```

### What is explicitly NOT built

- No `overlap_override` field, no `overlap_conflict_subscription_id`, no column anywhere recording that a warning fired or was dismissed.
- No audit-log entry for the override decision — `audit_row_changes()` only logs the `subscription_items` row that ends up saved, which is indistinguishable from one that never had a conflict.
- No server-side enforcement — a request that bypasses this screen and calls `create-subscription` directly (or a bug that skips this check) saves with no warning and no rejection.

This is a UX safety net against accidental double-booking (e.g. staff not noticing a membership hasn't expired yet), not a data-integrity or security control.

---

## 6. Member Detail — Current Subscription / Subscription History

Unchanged layout from [screens.md](./screens.md) WSCR-03 (`/members/:id`) — only the underlying data shape changed, from one row to a member's current/past items:

- **Current Subscription** section: now shows the member's current membership item (from `member_current_items`) plus their current add-on items, not a single "latest subscription" row. "Renew" button → `/members/:id/renew` (§3). Empty state (no current membership item) shows the same "Add Subscription" CTA, opening the identical form.
- **Subscription History**: lists past checkouts (`subscriptions` rows with their `subscription_items`), newest first. **Line items have no edit path at all** (backend spec §4) — only a checkout's header (`payment_mode`, `notes`) is editable via `update-subscription`; screens.md's older "opens an edit panel to change plan/dates/amount" description is stale and superseded by this.
- Member field saves and subscription saves remain **completely independent** (own loading/error state each) — unchanged rule from screens.md.

---

## 7. Requirements Traceability

| Requirement | Frontend implementation |
|---|---|
| REQ-SUB-001 | Checkout form (§2–3); "exactly one membership item" client-side gate |
| REQ-SUB-002 | `payment_mode` header field (§2) |
| REQ-SUB-003 | Multi-item list, each with its own `amount_paid` (§2) |
| REQ-SUB-004 | `shared_member_id` picker, shown conditionally (§2) |
| REQ-SUB-005 | Overlap warning, membership scope (§5) |
| REQ-SUB-006 | Quantity control hidden for indefinite plans (§2) |
| REQ-SUB-008 | Overlap warning, add-on scope (§5) |
| REQ-SUB-009 | Quantity chips + custom field, live `end_date`/`amount_paid` preview (§2) |
| (non-functional) loading/error/retry, empty states, mobile-responsive | §3.1, §3.3 — enforced app-wide by [rules.md](./rules.md) rules 16, 29–31 |

---

## Related docs

- [screens.md](./screens.md) — general screen/layout conventions (route map, breakpoints) still apply; its WSCR-05 field-level content and submit flow are superseded by this doc
- [rules.md](./rules.md) — app-wide non-functional rules this screen satisfies: responsive/mobile-first (rule 16), loading/error/retry (rules 29–30), empty states (rule 31)
- [data-models.md](./data-models.md) — its `Subscription`/`NewSubscription`/`UpdateSubscription` types are stale (single-plan model); §2 above is current
- [business-logic.md](./business-logic.md) — end-date formula, renewal start-date default, overlap guard rule, as part of the full business-logic doc
- [../backend/subscription-management.md](../backend/subscription-management.md) — backend counterpart: schema, RLS, `create-subscription`/`update-subscription`
