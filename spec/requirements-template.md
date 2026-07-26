# Requirements Template

> Fill this in before writing the domain model or API spec. One row/entry per requirement, grouped by feature area. Delete the `<...>` instructional text as you replace it. Copy the "Feature Area" block for each new area (Members, Plans, Subscriptions, Users/Auth, Reports, etc.).

---

## 0. App Overview

- **App name:** Fit&Fine Gym Subscription Manager
- **One-sentence purpose:** Application to manage the gym members and subscription details by gym staff and admin
- **Primary users:** gym staff, admin
- **Platforms:** web

---

## 1. Actors & Roles

List every distinct type of user/system that interacts with the app, and what they're fundamentally allowed to do. This drives every permission check later.

| Role | Who they are | Can generally do |
|---|---|---|
| admin | manager/app admin | manage plans, users, view everything, configure settings |
| staff | gym coach | add/edit members, add/renew subscriptions |

---

## 2. Feature Area: Member Management

### 2.1 Requirements

| ID | Requirement | Who can do it | Priority (Must/Should/Could) |
|---|---|---|---|
| REQ-MEM-001 | Staff/admin can register a new member with: name, date of birth (mandatory), phone, date of joining, branch, gender (Male/Female/Other), weight (kg), height (cm), "under doctor's care" flag (+ explanation if yes), and emergency contact (name, mobile, relationship) — all required. Plus optional: email, photo, residential address, aadhaar number, occupation. Phone number must be unique across all (non-deleted) members. | staff, admin | Must |
| REQ-MEM-002 | Staff/admin can capture a member's photo directly via device camera at registration time, in addition to uploading an existing image file. | staff, admin | Could |
| REQ-MEM-003 | Every member record stores who created it (system-set, immutable) and a separate, independently editable "handled by" staff field for cases where one staff member enters data on behalf of another. | staff, admin | Must |
| REQ-MEM-004 | A member's photo is compressed client-side (in the browser) before upload, targeting ~400px on the longest side and under ~50KB. Both the original file and the compressed version are uploaded and stored. | staff, admin | Should |
| REQ-MEM-005 | Every member is assigned a unique, system-generated member number at creation, formatted `<branch code>-<year>-<sequence>` (e.g. `MUM-2026-0001`). The sequence increments continuously per branch and **never resets** — `<year>` reflects the member's actual registration year, not a counter-reset boundary (e.g. a branch's second-ever member might be `MUM-2025-0002`, and its next member the following year `MUM-2026-0003`, not `MUM-2026-0001`). **Revised** from an earlier "resets to 0001 each year" design — see [backend/member-management.md §3](./backend/member-management.md#3-member-number-generation-req-mem-005). | system (staff/admin never enter it) | Must |
| REQ-MEM-006 | Staff/admin can edit an existing member's details — every field is editable except `member_number` (system-generated, immutable), `created_by` (system-set, immutable, see REQ-MEM-003), and `branch_id` (set once at registration, immutable — REQ-MEM-005's branch code is baked into `member_number` at creation and never revisited). | staff, admin | Must |
| REQ-MEM-007 | Staff/admin can delete a member. There is no separate "deactivate" state — deleting a member follows the same soft-delete convention as every other entity (`deleted_at`/`deleted_by` set, see Section 11); the member is then excluded from the member list, search, and reports by default. Its `phone` becomes free for reuse by a new member (since phone uniqueness only applies among non-deleted members); `member_number` is never reused. | staff, admin | Should |

### 2.2 Acceptance Criteria

**REQ-MEM-001**
- Given all required fields are filled in, when staff submits, then the member record is created.
- Given any required field is missing, when staff submits, then registration is blocked with a validation error naming the missing field(s).
- Given "under doctor's care" = Yes, when staff leaves the explanation text blank, then submission is blocked with a validation error — the explanation is mandatory whenever the flag is Yes.
- Given staff opens the new member form, when the form loads, then `date_of_joining` is pre-filled with today's date (browser local date).
- Given the pre-filled `date_of_joining` value, when staff changes it before submitting, then the manually entered date is saved instead of today's date.
- Given staff submits a phone number already used by another (non-deleted) member, when they submit, then registration is blocked with a validation error naming the conflict.

**REQ-MEM-002**
- Given staff chooses "take photo", when they capture via camera, then the captured image is used exactly like an uploaded photo (same storage, same field).
- Given the browser/device denies camera access, then staff can still fall back to uploading a file.

**REQ-MEM-003**
- Given a member is created, when saved, then `created_by` is set automatically from the logged-in session and can never be edited afterward, by anyone.
- Given a different staff member should get credit for handling the signup, when any staff or admin (not admin-only) edits the "handled by" field, then it updates independently of `created_by`.

**REQ-MEM-004**
- Given staff selects or captures a photo, when it is ready to upload, then the browser compresses it client-side to ~400px on the longest side, targeting under ~50KB, before the upload request is made.
- Given compression completes, when the upload happens, then both the original file (`photo_url`) and the compressed file (`photo_thumbnail_url`) are stored, each with its own URL.
- Given a screen needs to display a member's photo (list, card, thumbnail), when rendering, then it uses `photo_thumbnail_url` for speed; the original `photo_url` is retained but not necessarily shown by default.
- Given compression or the photo upload fails, when staff submits the form, then the rest of the member's details still save successfully as a separate step from the photo — the member record is created regardless — and staff sees an error message stating the photo couldn't be uploaded, with the option to retry the photo upload afterward on that member's record.

**REQ-MEM-006**
- Given staff/admin opens an existing member's edit form, when they change any editable field and submit, then the record is updated and `changed_by`/`changed_at` are set from the session (system, unchanged from the existing audit pattern).
- Given staff/admin submits a phone number already used by another (non-deleted) member — whether creating (REQ-MEM-001) or editing (REQ-MEM-006) — then submission is blocked with a validation error naming the conflict.
- Given the edit form, when it is shown, then `member_number`, `created_by`, and `branch_id` are displayed read-only and are never sent as editable inputs.
- Given an update payload includes a changed `branch_id` (e.g. a forged direct API call), when it reaches the database, then `branch_id` is silently pinned back to its existing value — same enforcement as `member_number`.

**REQ-MEM-007**
- Given staff/admin deletes a member, when confirmed, then the member's `deleted_at` is set to the current time and `deleted_by` to the acting staff/admin — the row is never physically removed.
- Given a deleted member, when the member list, search, filters, or reports are queried, then that member is excluded by default, same as any other soft-deleted entity (Section 11).
- Given a deleted member's phone number, when a new member is registered or an existing member is edited with that same phone number, then it is accepted — uniqueness (REQ-MEM-001/006) only applies among non-deleted members.
- Given a deleted member, when its subscriptions/add-ons/audit history are considered, then those associated records are unaffected and still retained — deleting a member does not cascade-delete or alter its `Subscription`/`SubscriptionAddOn` rows.

### 2.3 Data touched

- **Member** (required): name, phone, date_of_joining (today's date by default — editable), date_of_birth, gender, weight, height, branch_id (FK → Branch, selected at registration — see REQ-MEM-005), under_doctor_care (yes/no), doctor_care_details (text, relevant when under_doctor_care = yes), emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
- **Member** (optional): email, photo_url (original, uncompressed), photo_thumbnail_url (**new**, compressed version — see REQ-MEM-004), residential_address, aadhaar_number, occupation
- **Member** (new, system/audit): created_by (existing, immutable, unchanged), handled_by_staff (**new** field, references a staff/admin profile, independently editable — not the same as created_by/changed_by), deleted_at (timestamptz, nullable), deleted_by (uuid FK → profile, nullable — see REQ-MEM-007, standard soft-delete columns per Section 11)

### 2.4 Business rules specific to this area

- `created_by` / `changed_by` remain system-set via the existing audit trigger and are never client-editable — unchanged from the current spec.
- `handled_by_staff` is a new, separately editable field — it does not affect or overwrite `created_by`.
- Photo capture supports both live camera capture and file upload; either path feeds the same compression step (REQ-MEM-004) before storage.
- Compression happens client-side, before upload; both the original (`photo_url`) and compressed (`photo_thumbnail_url`) files are stored — never only one.
- Display surfaces (member list, cards, thumbnails) use `photo_thumbnail_url` by default for load speed.
- "Under doctor's care" defaults to No; the explanation field is only shown/relevant when it is Yes.
- `date_of_joining` defaults to today's date (browser local date) but is editable by staff before submitting.
- `Member.phone` is unique across all non-deleted members — enforced on both create (REQ-MEM-001) and edit (REQ-MEM-006), blocking submission with a validation error on conflict.
- Deleting a member (REQ-MEM-007) always means soft delete (`deleted_at`/`deleted_by` set) — there is no separate "deactivate" state for members, and no hard delete; a deleted member's `Subscription`/`SubscriptionAddOn`/`AuditLog` history is retained unchanged.
- `Member.branch_id` is required at registration (REQ-MEM-001) and feeds the member-number generator (REQ-MEM-005); it carries no access-control or filtering meaning today (see Section 11 Constraints for the full branch-scoping note). It is set once at registration and immutable thereafter (REQ-MEM-006) — a member is never reassigned to a different branch, since `member_number`'s embedded branch code is never recomputed after creation.
- `member_number` is guaranteed unique by its generation algorithm (a continuously-incrementing per-branch sequence that never resets, REQ-MEM-005) and is never client-editable, so no separate uniqueness check is needed for it.

---

## 3. Feature Area: Member List / Home Page

### 3.1 Requirements

| ID | Requirement | Who can do it | Priority (Must/Should/Could) |
|---|---|---|---|
| REQ-LIST-001 | All signed-in users land on `/` and see the full member list by default (no search/filter applied) sorted by `date_of_joining` **descending** — most recently joined members shown first. Staff can also explicitly re-sort by member name or by their current membership item's expiry date. Detailed layout, search/filter controls, row content, and empty states are already specified in [screens.md](./frontend/screens.md); this requirement adds the default-sort decision and the extra sort options that file left open. | staff, admin | Must |
| REQ-LIST-002 | Staff/admin can search the member list by name, member number (the generated ID from REQ-MEM-005), or phone number — substring match, case-insensitive, phone match ignores spaces. | staff, admin | Must |
| REQ-LIST-003 | Pill-style quick filters — All / Active / Expiring / Expired — single-select, based on the member's current membership item (**resolved** — see [backend/member-management.md §5–6](./backend/member-management.md#5-member_list_view--resolving-the-member-status-open-question)), using the same status definitions and 7-day "expiring soon" threshold already defined in business-logic.md. | staff, admin | Must |
| REQ-LIST-004 | A detailed filter panel additionally lets staff/admin filter by gender, attached add-on, and subscription plan — combinable with each other, the pill filter, and the search box. (Age-range filtering was considered and removed from scope for now — see Section 12.) | staff, admin | Should |

### 3.2 Acceptance Criteria

**REQ-LIST-001**
- Given a signed-in user loads `/` with no search query and no filters applied, when the list renders, then members are ordered by `date_of_joining` descending (newest joiner first).
- Given the user explicitly picks a different sort (e.g. `name-asc`, `expiry-asc`, or clicking a desktop table column header per screens.md), when the list re-sorts, then that explicit choice overrides the default until the user clears it or reloads the page.
- Given the user searches or applies filters, when results are shown, then they are still ordered by `date_of_joining` descending unless the user has separately chosen another sort.
- Given the sort control, when staff open it, then the available options are: join date (default, descending), member name, and expiry date (the member's current membership item's `end_date`, via `member_list_view`) — resolving the direction ambiguity screens.md left open.

**REQ-LIST-002**
- Given staff type into the search box, when the query matches a substring of a member's name, member number, or phone number (case-insensitive, phone ignoring spaces), then that member appears in results.
- Given the query matches none of those three fields for a member, then that member is excluded from the results.

**REQ-LIST-003**
- Given the "Active" pill is selected, when filtering, then only members whose current membership item has an `end_date` today or later with more than 7 days remaining, or an indefinite (NULL `end_date`) item, are shown.
- Given the "Expiring" pill is selected, when filtering, then only members whose current membership item's `end_date` is within 7 days (inclusive) of today are shown.
- Given the "Expired" pill is selected, when filtering, then only members whose current membership item's `end_date` has passed, or who have no current membership item at all, are shown.
- Given "All" is selected (or no pill selected), then no status filtering is applied.

**REQ-LIST-004**
- Given staff select one or more genders in the filter panel, when applied, then only members matching one of the selected genders are shown.
- Given staff select one or more add-ons in the filter panel, when applied, then only members with at least one of the selected add-on plans among their **current** add-on items (`member_current_items`, `category = 'addon'`) are shown — "current" means not soft-deleted and (indefinite or `end_date >= today`), same definition `member_current_items` already uses; there is no cancellation concept to also check (deferred, see REQ-SUB-011).
- Given staff select one or more plans in the filter panel, when applied, then only members whose **current membership item** (the `category = 'membership'` item with the latest `end_date`, per `member_list_view`) uses one of the selected plans are shown.
- All filter-panel selections combine with each other (AND), and are additive with the pill filter and search box, consistent with the existing filter-panel behavior in screens.md.

### 3.3 Data touched

- No new Member fields — reuses `Member.date_of_joining` (already required, see Member Management).
- List/search/filter/sort all read from `member_list_view` (see [backend/member-management.md §5](./backend/member-management.md#5-member_list_view--resolving-the-member-status-open-question)), which joins `Member` against `member_current_items` for the current membership item and the set of current add-on plan ids — **resolved**, superseding the old "member + latest subscription" join note.
- Search additionally reuses `Member.name`, `Member.phone`, and `Member.member_number` (REQ-MEM-005) — no new fields.
- Add-on filter reads `member_list_view.current_addon_plan_ids` (an array, since a member can have multiple current add-ons across independent checkouts) — not a single Member field.
- Plan filter reads `member_list_view.current_membership_plan_id`.
- **API implication**: none beyond querying `member_list_view` directly — at this app's scale, the full view result set is fetched once per route entry and search/filter/sort happen client-side (no server-side filter parameters needed); see [backend/member-management.md §5.4](./backend/member-management.md#54-usage).

### 3.4 Business rules specific to this area

- Default list sort is `date_of_joining DESC`. This is a pure read/display rule, like Member Status derivation in business-logic.md — no security implications, so client-side sorting of already-fetched data is sufficient; it doesn't need server-side enforcement beyond the query itself defaulting to this order.
- Search matches name/member_number/phone by substring, case-insensitive; phone ignores spaces — consistent with the existing name/phone search rule in screens.md, now extended to member_number.
- The pill filter reuses the exact Active/Expiring Soon/Expired definitions and 7-day threshold already defined in business-logic.md's Member Status section — not a new rule, just exposed as a quick filter.
- **Resolved** (was an open question — see [backend/member-management.md §5](./backend/member-management.md#5-member_list_view--resolving-the-member-status-open-question)): the plan filter and status pills evaluate against the member's **current membership item** — the `category = 'membership'` item in `member_current_items` with the latest `end_date` (an indefinite item outranks any dated one) — not a single "latest subscription" row, which no longer exists under the header/line-item model. The add-on filter is evaluated against **all** of the member's current add-on items, not just one, since a member can hold several independently.

---

## 4. Feature Area: Subscription Management

### 4.1 Requirements

> **Cancellation and refunds are deferred** in this revision — see [domain-model.md §Open items](./backend/domain-model.md#open-items-not-blocking-but-worth-resolving-before-implementation-begins). The REQ IDs below that covered that ground are kept (marked *Deferred*) for traceability, not deleted, so this work can be picked back up without losing the original acceptance criteria.
>
> **Overlap-warning checks (REQ-SUB-005/008) are resolved**, but with a deliberately lighter design than the original: a **client-side-only** warn-then-allow check, run just before `create-subscription` is called — no `overlap_override`/`overlap_conflict_subscription_id` columns, no server-side enforcement, and no persisted record of which checkouts triggered or dismissed the warning. It's a UX safety net against accidental double-booking, not a security control; a forged direct call to `create-subscription` bypasses it entirely, same as any other client-side-only check in this app.

| ID | Requirement | Who can do it | Priority (Must/Should/Could) |
|---|---|---|---|
| REQ-SUB-001 | Once a member exists, staff/admin can create a subscription (one checkout) for that member: add one or more catalog items — exactly one must be a `category = 'membership'` plan — each with its own start date (defaults to today, editable) and amount paid (defaults to that item's plan price × quantity, editable), plus one payment mode covering the whole checkout. A subscription's items are fixed once created; adding something new later (e.g. a class the following month) always creates a **new** subscription, never adds to an existing one. | staff, admin | Must |
| REQ-SUB-002 | Subscription payment mode supports Cash, UPI, or Card — one value per checkout, covering every item created in it. | staff, admin | Must |
| REQ-SUB-003 | Staff/admin can add one or more add-on-category items to the same checkout as the membership item, chosen from the unified catalog (REQ-ADMIN-002). Each item's cost is shown clearly in the UI, itemized separately. | staff, admin | Should |
| REQ-SUB-004 | Plans carry a `max_members` value (default 1). For a membership-category plan with `max_members = 2` (e.g. a "Couple" plan), staff can optionally set a second, **shared** member on that item **at creation time only**. There is currently no path to add, change, or clear the shared member after the subscription is created — a narrower capability than the previous design (which allowed editing the secondary member later); see §13 Open Questions. | staff, admin | Must |
| REQ-SUB-005 | *(Resolved — client-side only)* Before saving a checkout, the client warns (does not block) when a new `category = 'membership'` item's date range overlaps **any** existing non-deleted membership item for that member (as primary `member_id` or `shared_member_id`) — regardless of `plan_id`, since a member logically has one membership at a time. Staff can dismiss the warning and save anyway. | staff, admin | Should |
| REQ-SUB-006 | A catalog item's duration is expressed by `Plan.duration_days`: NULL means indefinite (charged once, never expires, cannot be attached again to a member who already has it — REQ-SUB-007); a positive number of days means it's time-boxed and can be attached again later (e.g. a new term). This single column replaces the old separate `behavior_type` field. | admin (catalog, REQ-ADMIN-002), staff (attaching) | Must |
| REQ-SUB-007 | An indefinite item (`Plan.duration_days IS NULL`) cannot be attached to a member who already has a non-deleted `SubscriptionItem` referencing it — a hard block, not a warning. This check only needs to look for an existing row, not a status, so it stands independently of the deferred cancellation logic (REQ-SUB-011). | staff, admin | Must |
| REQ-SUB-008 | *(Resolved — client-side only)* Same warn-then-allow mechanism as REQ-SUB-005, but scoped to `category = 'addon'` items: the check only compares against existing non-deleted items referencing the **same** `plan_id` for that member — a member can hold several different add-ons concurrently (REQ-SUB-003) without triggering this, but two overlapping instances of the *same* add-on (e.g. two overlapping "Zumba Class" items) do. | staff, admin | Should |
| REQ-SUB-009 | When adding any catalog item (membership or add-on) with a duration to a checkout, staff can select a quantity/multiplier for its standard period (preset chips ×1/×2/×3/×6/×12, plus a custom number field), extending that item's duration and price by that multiple — e.g. a Monthly plan × 2 = 60 days at 2× the price. Not shown for indefinite items, which have no duration to multiply. Applies uniformly to membership and add-on items — no longer a separate control per type. | staff, admin | Should |
| REQ-SUB-010 | *(Deferred)* Reducing a `SubscriptionItem`'s quantity after creation ("partial cancellation") — no edit path exists for quantity at all after creation in this revision. | — | Deferred |
| REQ-SUB-011 | *(Deferred)* Cancel & Refund flow (status, refund amount, cancelled-by/at) for a subscription item. | — | Deferred |
| REQ-SUB-012 | *(Resolved — no longer deferred)* "Member's current status" no longer maps to a single "latest subscription" — a member's current items can now come from multiple, independent checkouts (`Subscription` rows) at once, unioned via `member_current_items` (domain-model.md §Views). REQ-LIST-001/003/004 are re-implemented against `member_list_view`, which derives status from the `category = 'membership'` item with the latest `end_date` — see [backend/member-management.md §5](./backend/member-management.md#5-member_list_view--resolving-the-member-status-open-question). | — | Resolved |

### 4.2 Acceptance Criteria

**REQ-SUB-001**
- Given staff open "add subscription", when the form loads, then they can add one or more catalog items to the checkout; submission is blocked unless exactly one added item is a `category = 'membership'` plan.
- Given each added item, when the form loads it, then `start_date` is pre-filled with today's date and `amount_paid` is pre-filled with that item's plan price × the selected quantity (REQ-SUB-009; quantity defaults to ×1) — both editable.
- Given all required items are filled in and a payment mode is chosen, when staff submit, then one `subscriptions` row and one `subscription_items` row per added item are created together, in a single transaction.
- Given a subscription already exists, when staff want to add something new for that member later, then they start a new "add subscription" checkout rather than editing the existing one.

**REQ-SUB-003**
- Given one or more add-on-category items are added to a checkout alongside the membership item, when it is saved, then each item's cost is itemized separately, both in the UI and in what's stored (one `subscription_items` row per item).

**REQ-SUB-004**
- Given a membership-category plan with `max_members = 2` is selected for an item during subscription creation, when the form is shown, then staff can optionally set a shared member for that item, in addition to its primary `member_id`, before saving.
- Given such a subscription is saved without a shared member, when staff later view it, then there is currently no UI action to add one there — flagged as a gap versus the previous design in §13 Open Questions.

**REQ-SUB-005**
- Given a new `category = 'membership'` item's `[start_date, end_date]` range overlaps an existing non-deleted membership item (any `plan_id`) for the same member (as `member_id` or `shared_member_id`), when staff attempt to save the checkout, then a warning is shown naming the conflicting plan and its dates, with the option to cancel (stay on the form) or proceed (save anyway).
- Given staff choose to proceed, when the checkout is saved, then it saves exactly as if no conflict had been detected — no flag, column, or audit-log entry records that an overlap warning was shown or dismissed.
- Given an existing conflicting item is indefinite (`end_date IS NULL`), then it is treated as open-ended (always overlapping) for this comparison — though in practice a new indefinite item can't reach this check at all, since REQ-SUB-007's hard block already prevents re-attaching an indefinite plan.
- Given this check runs entirely client-side, when a request bypasses the client and calls `create-subscription` directly, then the checkout saves with no warning and no rejection — this requirement has no server-side enforcement.

**REQ-SUB-006**
- Given admin creates a catalog item with no duration, when saved, then it's treated as indefinite — no `end_date` is ever computed for `SubscriptionItem` rows referencing it.
- Given admin creates a catalog item with a duration in days, when saved, then that item is time-boxed and its `SubscriptionItem` rows get a computed `end_date`.

**REQ-SUB-007**
- Given a member already has a non-deleted `SubscriptionItem` referencing an indefinite plan (from any past subscription), when staff try to add that same plan to a new checkout for that member, then it is not offered/selectable, or submission is blocked with a clear error — no warning-and-override path for this case.

**REQ-SUB-008**
- Given a new `category = 'addon'` item's `[start_date, end_date]` range overlaps an existing non-deleted item referencing the **same** `plan_id` for the same member, when staff attempt to save the checkout, then the same warn-then-allow flow as REQ-SUB-005 applies (naming the conflicting item and its dates, cancel-or-proceed).
- Given a new add-on item's date range overlaps an existing item of a **different** `plan_id` (e.g. Zumba Class overlapping Personal Training), then no warning is shown — different add-ons are expected to run concurrently.
- Given staff choose to proceed, then the same "no trace left behind" rule as REQ-SUB-005 applies — nothing is persisted about the warning having fired.

**REQ-SUB-009**
- Given staff add a catalog item with a duration to a checkout, when they reach its quantity control, then preset chips are shown (×1, ×2, ×3, ×6, ×12) plus a custom-number field, defaulting to ×1.
- Given staff select a quantity of N, when the form recalculates, then `end_date = start_date + (plan.duration_days × N) - 1` and `amount_paid` defaults to `plan.price × N` — straight multiplication, no bulk discount.
- Given quantity stays at the default ×1, then behavior is unchanged from a normal single-period item.

### 4.3 Data touched

- **Subscription** (header — see domain-model.md §5): `member_id`, `payment_mode` (Cash/UPI/Card, one per checkout), `notes`. No plan, dates, quantity, or amount live here.
- **SubscriptionItem** (one row per catalog item selected in a checkout — see domain-model.md §6): `subscription_id`, `plan_id`, `member_id`, `shared_member_id` (nullable, only for a `max_members = 2` membership item — REQ-SUB-004), `start_date`, `end_date` (computed, null for indefinite items), `quantity` (default 1 — REQ-SUB-009), `amount_paid`.
- **Plan** (unified catalog, replaces the old Plan + AddOn split — see domain-model.md §3 and REQ-ADMIN-002): `name`, `category` ('membership' | 'addon'), `duration_days` (nullable — replaces `behavior_type`), `price`, `max_members` (only meaningful for `category = 'membership'`).
- No `status`, `refund_amount`, `cancellation_reason`, `cancelled_by`/`cancelled_at`, `overlap_override`, or `overlap_conflict_*` field exists on either table in this revision.

### 4.4 Business rules specific to this area

- A subscription (checkout) always has exactly one membership-category item and zero or more add-on-category items, created together and never modified afterward (REQ-SUB-001).
- `end_date` computation includes `quantity`: `start_date + (plan.duration_days × quantity) - 1`, or NULL when `plan.duration_days IS NULL`. The plan-deletion guard from business-logic.md is unchanged in spirit, now checking `subscription_items.plan_id` instead of `subscriptions.plan_id`.
- Payment mode stays Cash / UPI / Card, but is now a single value per checkout, not per item — a behavior change from the previous design, where an add-on could record its own independent payment mode. Flagged in §13 if that capability turns out to be needed.
- The catalog (name, category, price, duration) is admin-configured (REQ-ADMIN-002); staff choose from it per checkout item, they don't type in ad-hoc fees.
- `quantity` is set at creation time (REQ-SUB-009), defaults to 1, and always multiplies duration and price linearly (no bulk discount logic), uniformly for membership and add-on items. There is currently no path to change it afterward at all.
- Indefinite items are hard-blocked from being attached twice to the same member (REQ-SUB-007) — independent of the deferred cancellation logic.
- Every `SubscriptionItem` belongs to exactly one primary `member_id`; a couple-plan's membership item additionally has an optional `shared_member_id`. An add-on item never sets `shared_member_id`, even on a couple's subscription.
- **Deferred, not implemented in this revision**: overlap warnings (REQ-SUB-005/008), quantity reduction (REQ-SUB-010), cancellation/refund (REQ-SUB-011), and "latest subscription" status derivation (REQ-SUB-012, redefined as an open question in §13).

---

## 5. Feature Area: Add-on Management

**Merged into Plan Management (REQ-ADMIN-002).** Add-ons are no longer a separate catalog entity — they're `Plan` rows with `category = 'addon'` (see domain-model.md §3). The old REQ-ADDON-001 (name/price/behavior-type/duration CRUD, `refundable` flag, deletion guard) is superseded: catalog CRUD for both categories now lives entirely under REQ-ADMIN-002, and the `refundable` flag is deferred along with the rest of the cancellation/refund design (domain-model.md §Open items).

---

## 6. Feature Area: Reporting

### 6.1 Requirements

| ID | Requirement | Who can do it | Priority (Must/Should/Could) |
|---|---|---|---|
| REQ-REPORT-001 | A Reports page shows two bar charts — "New Subscriptions per Month" and "New Add-ons per Month" — for a selected date range. Defaults to the current calendar month; staff/admin can pick a custom start/end date, and both charts always bucket counts by calendar month regardless of range length. | staff, admin | Should |
| REQ-REPORT-002 | Below the charts, a data list shows one row per subscription or add-on transaction created within the selected date range: member name, member number, phone number, transaction type (Subscription/Add-on), plan or add-on name, transaction date, amount, and payment mode. | staff, admin | Should |

### 6.2 Acceptance Criteria

**REQ-REPORT-001**
- Given staff/admin opens the Reports page, when it loads with no custom range selected, then the default range is the 1st of the current calendar month through today.
- Given staff/admin selects a custom start/end date, when applied, then both charts and the data list recalculate for that exact range.
- Given the selected range spans multiple months, when the charts render, then each chart still shows one bar per calendar month within that range — never daily or weekly bars.
- Given a subscription or add-on's `start_date` falls within the selected range, when counting, then it's included in that month's bar — counted by `start_date` (membership period start), not `created_at` (record entry time).

**REQ-REPORT-002**
- Given the selected date range, when the data list loads, then it shows one row per `SubscriptionItem` whose `start_date` falls in that range, labeled with its transaction type (derived from `plan.category`: Subscription for `'membership'`, Add-on for `'addon'`).
- Given a member has multiple items in the selected range (e.g. a renewal plus two add-ons), then each item appears as its own separate row — no aggregation into a single member row.
- Given each row, when displayed, then it shows: member name, member number, phone number, transaction type, plan/add-on name, transaction date, amount, and payment mode — payment mode now comes from the item's **parent `Subscription`** (one value per checkout, shared by every row in that checkout), not from the item itself. This is narrower than the previous design, where an add-on could record its own independent payment mode within the same checkout — see §13 Open Questions.

### 6.3 Data touched

- Reads `SubscriptionItem` (start_date, plan_id, amount_paid, member_id, subscription_id) within the selected date range, joined to its parent `Subscription` (payment_mode), `Member` (name, member_number, phone), and `Plan` (name, category — used to label the row Subscription vs Add-on).
- No new Member fields. Both charts in REQ-REPORT-001 now read from the same `subscription_items` table, split by `plan.category`, instead of two separate tables.
- **API implication**: needs a reporting endpoint/query that accepts a date range and returns (a) monthly counts of new membership items, (b) monthly counts of new add-on items, and (c) the itemized transaction list for that same range.

### 6.4 Business rules specific to this area

- The Reports page is available to all signed-in users (staff and admin) — same access level as the Member List, not admin-restricted.
- Chart grouping is always by calendar month, regardless of the selected range's length — no adaptive daily/weekly granularity.
- The transaction list always reflects one row per item, never aggregated per member — consistent with REQ-REPORT-002.
- "New" is counted by `start_date` falling in the selected range, not `created_at`. Cancellation-aware reporting (marking a row as refunded once REQ-SUB-011 exists) is deferred along with the rest of the cancellation design — every row here is simply "created," with no cancelled/active distinction yet.

---

## 7. Feature Area: User Authentication

### 7.1 Requirements

| ID | Requirement | Who can do it | Priority (Must/Should/Could) |
|---|---|---|---|
| REQ-AUTH-001 | Staff/admin can sign in with email + password via Supabase Auth. | staff, admin | Must |
| REQ-AUTH-002 | Staff/admin can alternatively sign in with Google (Supabase OAuth), using the same email as their invited account — no separate signup step; it auto-links to their existing account. | staff, admin | Should |
| REQ-AUTH-003 | Google sign-in is **invite-only**, same as the rest of the app: if the signed-in Google account's email has no matching `profiles` row, access is blocked with a clear "not invited" message — no `profiles` row is auto-created. | system (enforced, not user-facing config) | Must |
| REQ-AUTH-004 | A single account supports both sign-in methods at once — password and Google — interchangeably; both map to the same `auth.users` row and the same `profiles` row. | staff, admin | Should |
| REQ-AUTH-005 | A user with a password-based account can request a password reset via a "Forgot password" link, using Supabase Auth's built-in password-recovery email flow. | staff, admin | Must |

### 7.2 Acceptance Criteria

**REQ-AUTH-001**
- Given an invited user with a set password, when they enter their email + password on the login screen, then Supabase Auth verifies and signs them in.
- Given incorrect credentials, when submitted, then a generic error is shown that doesn't confirm whether the email is registered, consistent with REQ-AUTH-003's "don't leak invited emails" pattern.

**REQ-AUTH-002**
- Given an invited user, when they click "Sign in with Google" and complete Google's OAuth flow using their invited email, then they are signed in without any separate password-setup step.
- Given a user who previously only had a password, when they complete Google OAuth with the matching email for the first time, then Supabase links the Google identity to their existing `auth.users` record rather than creating a second account.

**REQ-AUTH-003**
- Given a Google account whose email has no matching `profiles` row, when they complete Google's OAuth flow, then the underlying Supabase Auth step may succeed, but the app checks for a `profiles` row immediately after and blocks entry with a message such as "This email hasn't been invited — contact your admin."
- Given this blocked state, when it's detected, then the app signs the session back out — a successful Google OAuth handshake alone never grants access to any app data.

**REQ-AUTH-004**
- Given a user with both a password and a linked Google identity, when they sign in with either method, then they land in the same session, same `profiles` row, same role and permissions.

**REQ-AUTH-005**
- Given a user clicks "Forgot password" and enters their email, when submitted, then Supabase Auth sends a password-reset email if that email has a matching account — the response message is generic either way (doesn't confirm whether the email exists), consistent with REQ-AUTH-003's non-leaking pattern.
- Given the user follows the reset link and sets a new password, when submitted, then their password is updated and they can sign in with the new password immediately.
- Given a user who has only ever signed in via Google (no password set), when they use "Forgot password" with their invited email, then the same flow lets them set a password for the first time — Supabase treats this as adding a sign-in method to their existing account, not creating a new one.

### 7.3 Data touched

- No new fields — reuses `auth.users` and `profiles` exactly as already defined in [database.md](./backend/database.md) and [domain-model.md](./backend/domain-model.md). Google sign-in is a Supabase Auth identity-linking feature (multiple providers per `auth.users` row), not a schema change. Password reset likewise uses Supabase Auth's built-in recovery-email flow — no custom token/email infrastructure needed.
- **Config, not data**: the Google OAuth provider must be enabled in the Supabase Auth dashboard/CLI config — an infrastructure/setup step, not a migration.

### 7.4 Business rules specific to this area

- Invite-only account creation applies uniformly regardless of sign-in method — this closes a gap the existing [architecture.md](./architecture.md) left open when it listed Google OAuth as "optional later" without saying how it interacts with the invite-only model. There is still no client-side path to create a `profiles` row other than the `invite-user` Edge Function (admin-only) — Google sign-in never creates one.
- Sign-in method (password vs Google) has no bearing on authorization — the existing deactivation rule (`is_active = false` blocks access immediately via RLS, see database.md), role model (admin/staff), and audit rules all apply identically regardless of how the user authenticated.
- Errors deliberately avoid confirming whether a given email is invited/registered, for both password and Google sign-in failures — consistent, non-leaking error messaging across both methods, and this extends to REQ-AUTH-005's password-reset request too.

---

## 8. Feature Area: Audit Trail / Change History

### 8.1 Requirements

| ID | Requirement | Who can do it | Priority (Must/Should/Could) |
|---|---|---|---|
| REQ-AUDIT-001 | Every table in the system (Member, Subscription, SubscriptionItem, Plan, Branch, Profile — no exceptions) records a field-level entry in a shared audit log whenever a field is inserted, updated, or deleted, capturing the old value and the new value. | system (backend-enforced, not user-facing) | Should |

### 8.2 Acceptance Criteria

**REQ-AUDIT-001**
- Given any field on any table's row changes value during an update, when the save completes, then a new audit-log row is written with the table name, record id, field name, old value, new value, operation `update`, who changed it, and when.
- Given a new row is inserted into any table, when the save completes, then one audit-log row is written per field the row was created with — `old_value = null`, `new_value` = that field's initial value, operation `insert`.
- Given a row is deleted from any table, when the delete completes, then one audit-log row is written per field the deleted row had — `old_value` = its last value, `new_value = null`, operation `delete`.
- Given a single save changes several fields at once (e.g. editing a member's phone and email together), when it completes, then that many separate audit-log rows are written, sharing the same record id/changed-by/changed-at but each with its own field name and old/new value.
- Given the audit-metadata columns themselves (`created_at`, `created_by`, `changed_at`, `changed_by`), then they are **not** separately logged — they are the metadata, not business data, so auditing them would just duplicate what the audit-log entry itself already records.

### 8.3 Data touched

- **AuditLog** (new entity, separate from every other table): id, `table_name` (text), `record_id` (text — stored as text so it can hold both the `bigint` PKs most tables use and the `uuid` PK `Profile` uses, in one shared column), `field_name` (text), `old_value` (text, nullable), `new_value` (text, nullable), `operation` ('insert' | 'update' | 'delete'), `changed_by` (FK → profiles), `changed_at` (timestamptz).
- No new fields on any existing table — this is purely an additional table fed by triggers on every other table.

### 8.4 Business rules specific to this area

- Implemented as a generic trigger (AFTER INSERT/UPDATE/DELETE) attached to every table, comparing OLD vs NEW row-by-row and field-by-field — a separate, additional mechanism from the existing lightweight `set_audit_fields()` trigger in [database.md](./backend/database.md) (which only tracks who/when on the row itself, not per-field history). Both continue to exist; this doesn't replace that.
- `old_value`/`new_value` are stored as text regardless of the source column's real type (numeric, boolean, date, etc.), since one shared audit table must accommodate every column type across every table.
- No dedicated per-record "History" view exists yet (e.g. on a member or subscription's detail page) — the only screen that reads this table is the admin-only, view-only overview added in REQ-ADMIN-005 below.
- Because this runs as a database trigger, it captures changes made through any path uniformly — RLS-guarded direct client writes and service-role Edge Function writes alike — consistent with the server-side-authority principle already established in [architecture.md](./architecture.md); it cannot be bypassed by writing through a different layer.

---

## 9. Feature Area: Admin Data Management

### 9.1 Requirements

| ID | Requirement | Who can do it | Priority (Must/Should/Could) |
|---|---|---|---|
| REQ-ADMIN-001 | Admin has a dedicated overview (list) and edit screen for **every** entity in the domain model: Member, Subscription, SubscriptionItem, Plan, Branch, Profile (Users), and AuditLog. Entities that already have a purpose-built flow elsewhere in this spec (Member, Subscription, SubscriptionItem) satisfy this requirement via that existing flow — no duplicate screen is built for them. Entities without one yet get a new dedicated screen: REQ-ADMIN-002 through 006 below. | admin | Should |
| REQ-ADMIN-002 | **Plan Management**: admin can view a list of all catalog items (both `category = 'membership'` and `category = 'addon'` rows, one unified list) and create/edit them (name, category, duration_days — required for membership, optional for add-on, price, max_members — membership only). Supersedes the old separate Add-on Management area (§5). | admin | Should |
| REQ-ADMIN-003 | **Branch Management**: admin can view a list of all branches and create/edit them (name, code). | admin | Should |
| REQ-ADMIN-004 | **User Management**: admin can view a list of all staff/admin accounts (name, email, role, active status) and edit role/active-status/full name, and invite new users. | admin | Should |
| REQ-ADMIN-005 | **Audit Log overview**: admin can view a filterable/searchable list of AuditLog entries (by table, record, date range, changed-by) — view-only, no edit or delete capability. | admin | Could |
| REQ-ADMIN-006 | Admin can delete a user account — a separate, more severe action than the existing active/inactive toggle (REQ-ADMIN-004). A deleted user is fully hidden from User Management's list, same soft-delete convention as every other entity (Section 11). An admin can never delete their own account. | admin | Should |

### 9.2 Acceptance Criteria

**REQ-ADMIN-001**
- Given admin navigates the app, when looking for any entity's data, then there is always a screen where they can see a list of all records of that type and edit one — no entity is a dead end reachable only via direct database access.
- Given staff (not admin), when they try to reach any of REQ-ADMIN-002 through 006, then access is denied — these screens are admin-only, consistent with the existing role model (see Section 1).

**REQ-ADMIN-002**
- Given admin opens Plan Management, when the list loads, then it shows every catalog item (name, category, duration_days, price, max_members), both membership plans and add-ons together, filterable by category.
- Given admin creates or edits an item with `category = 'membership'` and leaves `duration_days` blank, then submission is blocked with a validation error — duration is required for membership items, optional (indefinite) for add-on items.
- Given admin edits an item, when saved, then the change applies immediately (existing items/subscriptions are unaffected — editing a catalog item does not recalculate past `SubscriptionItem` rows, per the existing business-logic.md rule).
- Given admin tries to delete an item that's referenced by any `SubscriptionItem`, then deletion is blocked with the existing "used by X subscription(s)" error (unchanged from business-logic.md's Plan Deletion Guard).

**REQ-ADMIN-003**
- Given admin opens Branch Management, when the list loads, then it shows every branch (name, code).
- Given admin creates or edits a branch, when they submit a code already used by another (non-deleted) branch, then it's blocked with a validation error (unchanged from the existing branch `code` uniqueness rule).
- Given admin creates or edits a branch, when `name` or `code` is left blank, then submission is blocked with a validation error — both fields are mandatory.
- Given admin tries to delete a branch that has any member registered against it (`Member.branch_id`), then deletion is blocked with a "used by X member(s)" style error — same guard pattern as Plan (REQ-ADMIN-002).

**REQ-ADMIN-004**
- Given admin opens User Management, when the list loads, then it shows every profile (name, email — read from the authenticated session/`auth.users`, role, active status).
- Given admin invites a new user, when submitted, then it goes through the existing `invite-user` Edge Function flow (unchanged) — this screen is the UI entry point for that already-specified flow, not a new invite mechanism.
- Given admin tries to deactivate their own account from this screen, then it's blocked — matches the existing "an admin cannot deactivate their own account" rule.

**REQ-ADMIN-005**
- Given admin opens the Audit Log overview, when it loads, then entries can be filtered by table name, record id, date range, and who made the change.
- Given any AuditLog entry, when viewed, then there is no edit or delete action available anywhere in the UI for it — the log is strictly append-only and read-only from every screen.

**REQ-ADMIN-006**
- Given admin deletes a user account, when confirmed, then that profile's `deleted_at`/`deleted_by` are set — the row is never physically removed, and the user immediately loses all access (same enforcement as the existing `is_active = false` rule, extended to also cover `deleted_at`).
- Given admin tries to delete their own account, then it's blocked — same self-protection pattern as the existing "cannot deactivate/demote own account" rule.
- Given a deleted user, when User Management's list loads, then that user is excluded by default, same as any other soft-deleted entity (Section 11).
- Deleting a user is distinct from deactivating one (`is_active = false`): deactivation is a reversible toggle still visible in the list; deletion hides the account entirely.

### 9.3 Data touched

- No new fields on any entity. Reads: `Plan`, `Branch`, `Profile`/`auth.users`, and `AuditLog` — all already defined by earlier requirements/existing spec files. REQ-ADMIN-006 reuses `Profile`'s standard `deleted_at`/`deleted_by` soft-delete columns (Section 11) — no new field.
- **API implication**: needs list + create/update queries for Plan and Branch (straightforward CRUD, RLS-guarded, admin-only), a list/invite/update/delete flow for Profile (reusing the existing `invite-user` Edge Function, plus a delete action for REQ-ADMIN-006), and a read-only filtered query for AuditLog.

### 9.4 Business rules specific to this area

- All six screens in this area are admin-only — staff get no access, not even read-only, consistent with your explicit "admin can get..." framing (unlike Plans' existing RLS, which already grants staff *read* access at the data layer; the UI screen itself is still admin-gated here).
- REQ-ADMIN-001 doesn't introduce new business rules of its own for Member/Subscription/SubscriptionItem — it just confirms their existing screens (Member Management, Member List/Home Page, Subscription Management) are sufficient and no redundant admin-only duplicate is built for them; catalog management (Plan + the old Add-on Management) is covered by REQ-ADMIN-002 alone.
- The Audit Log is never editable or deletable from any UI, by any role — this is absolute, since an editable audit trail defeats its own purpose.
- User deletion (REQ-ADMIN-006) and user deactivation (`is_active`, REQ-ADMIN-004) are two distinct, independent actions — deleting a user does not require deactivating them first, and an inactive user can still be deleted. Both share the same self-protection rule: an admin can never apply either action to their own account.

---

## Feature Area Template (copy this block for each new area — number it sequentially, continuing after Section 9)

...

---

## 10. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Member list must load in < 1s for up to ~2,000 members. |
| Security | Only authenticated, invited users (i.e. a matching `profiles` row, see REQ-AUTH-003) may access any data; every write is authorized by role (admin/staff, Section 1) and enforced server-side via RLS/Edge Functions, not just hidden in the UI. |
| Availability | Best-effort, no formal SLA — single deployment, occasional downtime for deploys/maintenance is acceptable. |
| Scale | Single gym business (with multiple branches, see Section 11), a few hundred to low-thousands of members, under 20 concurrent staff/admin users. |
| Auditability | Every table has `created_at`, `created_by`, `changed_at`, `changed_by`; every insert/update/delete additionally produces field-level entries in the shared `AuditLog` (REQ-AUDIT-001) — no write path bypasses this. |
| Data retention / deletion | All entities support **soft delete only** — a `deleted_at` (timestamptz, nullable) and `deleted_by` (uuid, nullable) column pair, mirroring the existing `created_at`/`created_by` and `changed_at`/`changed_by` audit columns. A row is considered deleted when `deleted_at is not null`; there is no separate boolean flag. The app never performs a hard/physical delete. Soft-deleted rows are excluded from all API responses and UI reads by default. A soft delete is itself just an update, so it passes through the same audit logging as any other field change (REQ-AUDIT-001). Subscription/member history is otherwise kept indefinitely. |

---

## 11. Constraints & Assumptions

- Single-tenant: one gym business only, no multi-tenant requirement. Multiple **branches** (physical locations) are supported, but only as a simple data field on Member — used at registration and for member-number generation (REQ-MEM-005). Branches do **not** drive access control, filtering, or reporting scope today: every staff/admin account can see and manage members across all branches. Branch-scoped permissions/reporting are explicitly out of scope for now (Section 12).
- No payment gateway integration — payments (Cash/UPI/Card) are recorded manually as a label, never processed by the app.
- Every entity uses soft delete (`deleted_at`/`deleted_by`), never a hard delete — see Section 10's Data retention row. Any "delete" acceptance criteria elsewhere in this spec (Plan, Branch, Profile) means setting `deleted_at`/`deleted_by`, guarded where noted.
- Every entity carries the standard audit columns (`created_at`, `created_by`, `changed_at`, `changed_by`) plus field-level history in `AuditLog` (REQ-AUDIT-001) — this is a blanket convention, not repeated field-by-field in every feature area's Data Touched section.
- Spec-driven development: this requirements doc (and the domain-model/business-logic/API-contract docs it feeds) must be updated *before* any corresponding functional code change ships — the spec is the source of truth, not the implementation.
- Platform: web only (Section 0), built on Supabase (Auth + Postgres + RLS + Edge Functions, per [architecture.md](./architecture.md)) — new requirements should reuse that stack's existing patterns (RLS for authorization, Edge Functions for privileged operations like invites) rather than introducing new ones ad hoc.
- Members do not have their own login or account — the app is staff/admin-only (Section 1); a `Member` row is just a record staff manage, never an authenticated identity. There is no member-facing role, auth flow, or self-service portal in scope.

---

## 12. Out of Scope

Explicitly list what this round of requirements does **not** cover, so it isn't accidentally designed for. Move items here to a Feature Area section later if they become real requirements.

- Automated expiry email/SMS notifications.
- Branch-based access control — e.g. restricting a staff member to only see/manage members at their own branch (see Section 11).
- Branch-specific reporting or member-list filtering (no "filter by branch" control exists in Reports or the Member List).
- True multi-tenant support (multiple independent gym businesses sharing one deployment/database).
- Age-range member filtering — considered for REQ-LIST-004, explicitly removed from scope for now.

---

## 13. Open Questions

Anything you're unsure about — don't guess, resolve before moving to the domain model.

- There's currently no standalone "all subscriptions" overview screen — Subscriptions are only reachable via a member's detail page, or the period-scoped list in Reporting (REQ-REPORT-002). Is that sufficient, or does REQ-ADMIN-001 also need a dedicated global Subscriptions list? (REQ-ADMIN-001)
- `Plan.max_members` only supports up to 2 members in the subscription UI (REQ-SUB-004). As a **stopgap**, the backend already enforces this at the database level with a hard `CHECK (max_members between 1 and 2)` constraint (database.md), tied to `SubscriptionItem.shared_member_id`'s single-column (not join-table) data model — not a confirmed permanent product decision. Deliberately not generalized to a real multi-member join table preemptively; revisit only if/when a 3+-member plan is actually requested.
- **New, from the header/line-item redesign**: cancellation, refunds, and overlap-warning checks (the old REQ-SUB-005/008/010/011) are entirely deferred — there is no way to cancel a `SubscriptionItem`, issue a refund, or warn about overlapping dates in this revision. Needs a follow-up design pass; see [domain-model.md §Open items](./backend/domain-model.md#open-items-not-blocking-but-worth-resolving-before-implementation-begins).
- **New**: `SubscriptionItem.shared_member_id` can only be set at creation time (REQ-SUB-004) — the previous design's "add/change/clear the secondary member later" edit path has no equivalent yet. Is that an acceptable gap for now, or does it need its own edit function before this ships?
- **New**: payment mode moved from per-item (old `SubscriptionAddOn.payment_mode`, independent of the parent subscription) to per-checkout (`Subscription.payment_mode`, one value shared by every item in it — REQ-SUB-002/004.4). This is a real capability regression: a member paying for their membership by card and an add-on by cash *in the same checkout* can no longer be recorded that way — they'd need two separate checkouts. Confirm this tradeoff is acceptable.
- ~~**New**: "member's current status"...~~ **Resolved.** Status derives from the member's `category = 'membership'` item(s) via `member_current_items`, using whichever has the latest `end_date` (an indefinite/NULL-`end_date` item outranks any dated one, and is treated as always-Active) — implemented as `member_list_view`. See [backend/member-management.md §5](./backend/member-management.md#5-member_list_view--resolving-the-member-status-open-question) for the view definition and [§6](./backend/member-management.md#6-status-derivation-client-side-unchanged-authority--see-business-logicmd) for the derivation logic. REQ-LIST-001/003/004 and their acceptance criteria have been updated to match.

---

## How this feeds the next stages

1. **Each Feature Area's `.3 Data touched` subsection** (Sections 2–9) → merged into the **domain model** (entities, fields, relationships), plus the blanket audit/soft-delete conventions in Section 11.
2. **Each Feature Area's `.1 Requirements` + `.4 Business rules` subsections** (Sections 2–9) → become the **business-logic.md** rules and drive which operations need an **API contract**.
3. **Section 1 (Actors & Roles)** → becomes the **RLS policy / auth** design.
4. **Section 10 (Non-functional)** → informs indexing, caching, and infra decisions.

Do not start the domain model or API spec until every `<...>` placeholder above is either filled in or deliberately moved to Section 12 (Out of Scope) or Section 13 (Open Questions).
