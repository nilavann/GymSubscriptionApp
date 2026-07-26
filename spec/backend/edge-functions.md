# Edge Functions, Validation & Authentication

> The API/function layer for [domain-model.md](./domain-model.md) and [database.md](./database.md), extending [architecture.md §Edge Functions](../architecture.md#edge-functions) and [supabase-architecture.md §9](./supabase-architecture.md). Requirement IDs referenced below (`REQ-...`) are from [requirements-template.md](../requirements-template.md).
>
> Every Edge Function runs with the Supabase **service role** key (never exposed to the client) and re-validates the caller's identity/role from the request JWT before doing anything privileged. Nothing here replaces client-side validation for UX — it replaces it as the *authoritative* check.
>
> **Cancellation/refund and overlap-warning logic are deferred** in this revision — see [domain-model.md §Open items](./domain-model.md#open-items-not-blocking-but-worth-resolving-before-implementation-begins). The functions that used to implement that (`cancel-subscription`, `cancel-subscription-addon`, and the overlap-check steps inside `create-subscription`/`attach-addon`) don't exist in this revision; `attach-addon` itself is gone too, folded into `create-subscription`'s multi-item insert.

---

## 1. Authentication (REQ-AUTH-001–005)

No new tables — reuses `auth.users` + `profiles`. Two sign-in methods, one identity, plus password reset.

### Password sign-in (REQ-AUTH-001)
- `supabase.auth.signInWithPassword({ email, password })` — handled entirely by the Supabase Auth client SDK, no Edge Function involved.
- On failure, the client shows a generic "invalid email or password" message — never confirms whether the email exists (same non-leaking pattern as invite-only checks below).

### Google OAuth sign-in (REQ-AUTH-002/003/004)
- `supabase.auth.signInWithOAuth({ provider: 'google' })` — Supabase Auth handles the OAuth handshake and either creates a new `auth.users` row or links to an existing one by matching email (`REQ-AUTH-004`, Supabase Auth's built-in identity linking — no custom code needed for the linking itself).
- **Invite-only enforcement is app-level, not Auth-level** (`REQ-AUTH-003`): Supabase Auth alone would happily create a session for *any* Google account, invited or not. On every app load / auth-state change, `AuthContext` must:
  1. Read the session from `supabase.auth.getSession()`.
  2. Query `profiles` for `id = session.user.id` (RLS-gated by `profiles_select_active_users`, which already requires `is_active_user()` — so an uninvited account's query returns zero rows, since no matching profile exists to satisfy that check in the first place... except the *check itself* is what's missing for a brand-new Google sign-in with no `profiles` row at all. In that case the query simply returns no row, which is what step 3 checks for).
  3. If no `profiles` row is found: call `supabase.auth.signOut()` immediately, and show "This email hasn't been invited — contact your admin." The Supabase Auth session must never be allowed to persist past this check.
- No Edge Function creates a `profiles` row for Google sign-in — the **only** path that creates a `profiles` row is `invite-user` (below) via `handle_new_auth_user()`.
- `is_active_user()` / `is_active_admin()` (database.md) already gate every RLS policy on `is_active = true and deleted_at is null` — this applies identically no matter which sign-in method was used to obtain the session.

### Password reset (REQ-AUTH-005)
- `supabase.auth.resetPasswordForEmail(email, { redirectTo })` — handled entirely by the Supabase Auth client SDK, no Edge Function involved (same as password sign-in, no privileged operation needed).
- The client shows a generic confirmation ("if that email is registered, a reset link has been sent") regardless of whether the email actually has a matching account or `profiles` row — same non-leaking pattern as REQ-AUTH-001/003.
- The reset-link flow (`supabase.auth.updateUser({ password })` after following the emailed link) works identically whether the account already has a password or not — a user who has only ever signed in via Google can use this flow to set a password for the first time, since it operates on the existing `auth.users` row rather than creating one.
- No `profiles` row is created or modified by this flow — it only touches `auth.users`, same boundary as every other sign-in method.

---

## 2. Members

Create/read/edit remain a **direct client write** (RLS-guarded `members_insert_active_users` / `members_update_active_users`, database.md) — no Edge Function needed for those. Deletion is the one exception (below).

- **`member_number` is never client-supplied.** The client omits it entirely from the insert payload; `generate_member_number()` (database.md) always overwrites whatever is sent, same pattern as the audit columns.
- **Required-field / conditional validation (REQ-MEM-001)** is enforced twice: client-side for instant feedback (missing-field messages naming the field, "doctor's care details required when under_doctor_care = true"), and server-side via the `not null` column constraints plus `chk_doctor_care_details_required` in database.md (which rejects a blank/whitespace-only value, not just `NULL`) — a request that bypasses the client entirely (e.g. a forged direct API call) still gets rejected by Postgres.
- **Phone uniqueness (REQ-MEM-001/006)**: enforced by `idx_members_phone_active` (database.md), a unique index scoped to `deleted_at is null`. A duplicate insert/update is rejected by Postgres with a unique-violation, which the client surfaces as a validation error naming the conflict — same enforcement shape as `member_number`'s uniqueness, just not server-generated.
- **Photo upload/compression (REQ-MEM-002/004)** stays client-side (browser canvas compression → Supabase Storage upload → save `photo_url`/`photo_thumbnail_url` via the normal member update) — no Edge Function needed, this isn't a security-sensitive computation.
- **Deletion (REQ-MEM-007)**: staff/admin can delete a member, via the `delete-member` Edge Function — not a direct client update like create/read/edit above, and not admin-only like `delete-plan`/`delete-branch` below (any active user qualifies, matching REQ-MEM-007). It counts non-deleted `subscription_items` referencing the member (`member_id` or `shared_member_id`); if any exist, it blocks with `Cannot delete — used by ${count} subscription/add-on record(s)` (409), same "used by X" shape as Plan/Branch. Otherwise it soft-deletes (`deleted_at`/`deleted_by`) via the service-role client. See [member-management.md's Member Deletion Guard](./member-management.md#member-deletion-guard-closes-domain-model-reviewmds-member-deletion-finding) for the full design; this closes domain-model-review.md's Member-deletion High finding. The now-freed `phone` becomes available to a new member via the partial unique index above.
- **Member-number sequence configuration (admin-only, operational, not a REQ-MEM item)**: `update-member-number-sequence` lets an admin retarget a specific branch's counter — one counter per branch, continuous for that branch's whole lifetime, never reset (not even at a calendar-year boundary). Admin-only (`is_admin_user`, same bar as Plan/Branch/Role management). Given `{ branch_id, next_sequence }`, it walks `next_sequence` forward by `member_number_increment` (read from `configuration`) until it finds a value that has never been issued as a `member_number` at that branch **in any year** — checked against every `member_number` starting with that branch's code, with no `deleted_at` filter, since member numbers are never reused (REQ-MEM-007) — then stores `last_sequence = <found> - increment` so the next real registration's own arithmetic produces exactly that value. Returns the value actually applied plus whether it differs from what was requested. See [member-management.md §3.1](./member-management.md#31-admin-configuration-member-numbering-screen) for the full design, and [../frontend/screens.md WSCR-16](../frontend/screens.md#wscr-16--member-numbering) for the screen.

---

## 3. Subscriptions

### `create-subscription`

The **only** write path for `subscriptions`/`subscription_items` — RLS grants no direct client insert on either table (database.md §RLS). Creates the header and every line item together, in one transaction; there is no separate function to add an item to an existing subscription later (REQ-SUB-001 — a new checkout always means a new `subscriptions` row).

Responsibilities, in order:
1. Verify caller is an authenticated, active, non-deleted user (`is_active_user()`, from JWT).
2. Validate the payload has at least one item, and **exactly one** item references a `category = 'membership'` plan — reject otherwise.
3. For each item:
   a. Look up the plan (`duration_days`, `price`, `category`, `max_members`) — must not be soft-deleted (`deleted_at is null`); a soft-deleted plan can no longer be selected, even though existing items referencing it keep working.
   b. Validate `quantity` (REQ-SUB-009): must be a positive integer when the plan has a duration; reject a quantity on an indefinite item (`duration_days is null`). The preset chips (×1/×2/×3/×6/×12) are a client-side UX affordance only — the server accepts any positive integer from the custom field too.
   c. Compute `end_date` = `null` when `plan.duration_days is null`, else `start_date + (plan.duration_days × quantity) - 1`.
   d. Compute default `amount_paid = plan.price × quantity` if the client didn't override it; either way, persist whatever `amount_paid` the client submits.
   e. **Shared member (REQ-SUB-004):** if `shared_member_id` is supplied, validate `plan.category = 'membership'`, `plan.max_members = 2`, and `shared_member_id <> member_id` (also enforced by `chk_subscription_item_shared_member_distinct`); reject with a clear error otherwise. An add-on item must never set `shared_member_id`.
   f. **Indefinite-item hard block (REQ-SUB-007):** if `plan.duration_days is null`, query whether `member_id` (and `shared_member_id`, if set) already has *any* non-deleted `subscription_items` row for this `plan_id`, across any subscription. If yes → reject with a clear error; there is no override for this case.
4. Insert the `subscriptions` header row, then all validated `subscription_items` rows, via the service-role client, in one transaction — either all rows land or none do.
5. Return the created subscription and its items.

**Deliberately not implemented here:** the warn-then-allow overlap check (REQ-SUB-005/008) — resolved as a **client-side-only** check that runs in the checkout form before this function is ever called (see [business-logic.md §Subscription Overlap Guard](./business-logic.md#subscription-overlap-guard-req-sub-005008)), not as a server-side validation step. This function has no knowledge of it, doesn't accept an override flag, and doesn't reject or warn on an overlapping date range itself — a direct call here saves an overlapping item with no resistance at all, by design.

### `update-subscription`

Header-only edits: `payment_mode`, `notes`. Line items (`subscription_items`) have no update path at all in this revision — not `plan_id`, not dates, not `quantity`, not `shared_member_id` after creation. Adding, removing, or changing an item always means a new `create-subscription` checkout.

---

## 4. Admin Catalog Management (Plans, Branches, Roles)

All three follow the same shape: direct RLS-guarded `supabase-js` update for admins, but deletion is a soft-delete with a usage guard.

### `delete-plan` (REQ-ADMIN-002)

Covers both `category = 'membership'` and `category = 'addon'` rows — one function for the whole unified catalog (there is no separate `delete-addon` anymore).
1. Verify caller is an active admin.
2. Count `subscription_items` referencing `plan_id` where `deleted_at is null`.
3. If count > 0 → block with "used by X subscription(s)".
4. Else `UPDATE plans SET deleted_at = now(), deleted_by = auth.uid()`.

**Open item, flagged not resolved:** soft delete removes the *technical* reason for this guard — a soft-deleted plan's row still exists, so a `SubscriptionItem`'s `plan_id` FK never breaks and historical items still display the plan's name via the join. The guard above is kept purely as a *product* safeguard (avoid quietly pulling an in-use item out of the picker while people still hold it). Worth confirming with product whether that's still wanted, or whether soft-deleting an in-use plan should simply be allowed (existing items unaffected either way).

### `delete-branch` (extends REQ-ADMIN-003)
Same pattern, counting `members` rows referencing `branch_id`. Same open item applies.

### `delete-role`
Same pattern, counting `user_roles` rows referencing `role_id` (regardless of whether those users are active — mirrors `delete-plan`'s existence check, not an active-only count). No open item here in the same sense as plan/branch: unlike a soft-deleted plan, a soft-deleted role is filtered out of `roles_select_active_users` (database.md §RLS) and so can no longer be assigned, which is exactly the product intent for a role type nobody should pick anymore.

---

## 5. User Management (REQ-ADMIN-004/006)

Role is no longer a `profiles` column — it's a many-to-many via `roles`/`user_roles`
(database.md §Role Assignment), so every function below deals in `roles: string[]`, not a
single `role`. Every admin-check below also switched from a duplicated inline
`profiles.select('role', ...)` query to `.rpc('is_admin_user', { p_user_id: callerId })` —
one shared source of truth instead of five copies of the same check.

### `list-users`
**Gap filled by this revision:** `profiles` has no `email` column by design (§2.2 — login identity is owned entirely by `auth.users`), but WSCR-09's list needs every user's email, not just the caller's own (the only one readable client-side via `session.user.email`). Reading other users' emails requires the Admin API, which requires the service role — so this needs its own Edge Function; it cannot be a direct RLS-guarded `supabase-js` read the way the rest of `profiles` is.
1. Verify caller is an active admin (`is_admin_user`).
2. Call `supabase.auth.admin.listUsers()` (paginated — loop until a page returns fewer than the page size) to get every `auth.users` row's `id`/`email`.
3. Query `profiles_with_roles` (database.md §Views) for every non-deleted row (`deleted_at is null`).
4. Join the two by `id` in memory and return `{ id, email, full_name, roles, is_active }[]`, sorted by `full_name`. A `profiles` row with no matching `auth.users` entry (shouldn't happen in practice — every `profiles` row is created from an `auth.users` row) is skipped rather than erroring.

### `invite-user`
1. Verify caller is an active admin.
2. Payload takes `roles: string[]` (at least one), validated against the *live* `roles` table (not a hardcoded set) so an admin-added role is assignable immediately.
3. Call `supabase.auth.admin.inviteUserByEmail(email, { data: { full_name, invited_by: callerId } })`; `handle_new_auth_user()` (database.md) creates the `profiles` row automatically — it no longer touches role at all.
4. By the time that call resolves, the trigger has already run (same transaction as the `auth.users` insert), so the new user's `profiles` row exists. Insert one `user_roles` row per selected role directly (`granted_by: callerId`) — role assignment at invite time is this function's job now, not the trigger's.

### `update-user`
1. Verify caller is an active admin.
2. Allows editing `full_name`, `roles`, `is_active` on any `profiles` row **except** the caller's own `roles`/`is_active` — "an admin cannot deactivate their own account" generalizes here to "an admin cannot change their own roles or `is_active` from this function at all." A caller editing their own `full_name` only (no `roles`/`is_active` in the payload) is allowed.
3. When `roles` is supplied, calls `replace_user_roles` (database.md §Role Assignment) — a single-transaction delete-then-insert, not a plain `.update()`, since `user_roles` grants no direct client write at all. `full_name`/`is_active` edits and the soft-delete below similarly go through `update_profile_fields`/`soft_delete_profile` rather than a plain `.update()` — now that `profiles` has `set_audit_fields()` attached (database.md §Audit Field Triggers), those RPCs are what let `changed_by`/`deleted_by` correctly attribute to the acting admin instead of resolving `NULL` under the service-role connection.
4. **Last-admin lockout (new in this revision, closing an item previously flagged open in domain-model-review.md)**: before removing the admin role from a user, deactivating (`is_active = false`), or soft-deleting (`{ delete: true }`) a user, checks whether the target is currently the last active admin (`is_admin_user` + `count_other_active_admins`) and blocks with a 409 if so. This applies regardless of whose account it is — not just a self-protection rule — since two different admins could otherwise still lock everyone out between them.
5. **Soft-deleting a user (REQ-ADMIN-006, `deleted_at`)** is a separate, more severe action than `is_active = false`, requested via `{ delete: true }` on this same function rather than a separate one: `is_active` is a reversible toggle (REQ-ADMIN-004's existing "edit active status"), while `deleted_at` fully hides the account from `User Management`'s list. Same self-protection rule applies — an admin cannot soft-delete their own account, and deleting is independent of deactivating (neither requires the other first).
6. **Why this is an Edge Function, not a direct `supabase-js` update (correcting screens.md WSCR-09's earlier "Submit flow" note):** `profiles_update_admin` (database.md §RLS) grants `for update using (is_active_admin())` with no row-level restriction excluding the caller's own id — RLS alone cannot express "any admin row except this session's own," since `USING`/`WITH CHECK` only see the row being written, not "is this auth.uid() = id." Enforcing the self-protection rule server-side (not just as a disabled control in the UI, which a direct API call bypasses trivially) requires this Edge Function to compare `callerId` against the target `user_id` explicitly.

---

## 6. Reporting (REQ-REPORT-001/002)

### `get-report-data`
Read-only. Verify caller is an active user (reports are available to staff too, not admin-only, per REQ-REPORT-001's business rule). Accepts `start_date`/`end_date`, returns:
- Monthly membership-item counts, bucketed by `subscription_items.start_date` joined to `plans` where `category = 'membership'`, `deleted_at is null`.
- Monthly add-on-item counts, same shape, `category = 'addon'`.
- The itemized transaction list (REQ-REPORT-002): one row per `subscription_items` row in range, joined to `subscriptions` (for `payment_mode`), `members`, and `plans` (for `name`/`category`, to label the row Subscription vs Add-on).

No Edge Function strictly required for this (it's read-only and RLS already permits `select` on all relevant tables to any active user) — implementable as a plain `supabase-js` query from the client, or as a thin Edge Function purely to keep the month-bucketing SQL in one server-side place rather than duplicated/re-derived in the frontend. Either is acceptable; pick one when the API contract stage is reached.

**Not implemented here (deferred):** cancelled/refunded flagging on report rows — there is no `status` field to read yet (§Subscription Cancellation & Refund, business-logic.md, is deferred).

---

## 7. Audit Log (REQ-ADMIN-005)

Read-only, admin-only, no Edge Function needed — `audit_log_select_admin` (database.md) already grants admins direct `select` access, filterable client-side or via query params on `table_name`, `record_id`, `changed_at` range, and `changed_by`. There is no write path from any client role at all (see database.md §RLS) — every row is written exclusively by `audit_row_changes()`.

**Implemented**: `frontend/src/pages/AuditLogPage.tsx` (`/audit-log`, admin-only, reached from the Settings hub's Data Management grid — see [screens.md WSCR-14](../frontend/screens.md)), backed by `frontend/src/repositories/audit-log.repository.ts`. Filters by table name (dropdown, one of the actually-audited tables), record id (text), date range (defaults to current-month-to-date, same convention as Reports), and changed-by (dropdown of users, reusing `profileRepository.getAllUsers()` — no new query needed). Capped at 500 rows per filter set with a "narrow your filters" notice if exceeded, since this EAV table's growth is unbounded (domain-model-review.md). Strictly view-only — no edit/delete control anywhere on the screen, matching REQ-ADMIN-005's acceptance criteria.

---

## 8. Validation Summary Table

| Rule | Enforced in | REQ |
|---|---|---|
| Member required fields / doctor's-care-details conditional | DB constraints (database.md) + client UX | REQ-MEM-001 |
| Member phone uniqueness (among non-deleted members) | `idx_members_phone_active` (database.md) | REQ-MEM-001/006 |
| `member_number` generation | `generate_member_number()` trigger, never client-set | REQ-MEM-005 |
| Member deletion, no usage guard, no cascade | Plain RLS-guarded update (no Edge Function) | REQ-MEM-007 |
| Subscription requires exactly one membership item | `create-subscription` | REQ-SUB-001 |
| Shared member only for `max_members = 2` membership items, set at creation only | `create-subscription` | REQ-SUB-004 |
| Indefinite item — hard block on repeat attachment | `create-subscription` | REQ-SUB-007 |
| Quantity multiplier (duration & price) | `create-subscription` | REQ-SUB-009 |
| Plan/branch/role soft-delete usage guard | `delete-plan` / `delete-branch` / `delete-role` | REQ-ADMIN-002/003 |
| Admin cannot self-demote/deactivate | `update-user` | REQ-ADMIN-004 |
| Admin cannot self-delete; user deletion independent of deactivation | `update-user` | REQ-ADMIN-006 |
| Cannot remove/deactivate/delete the last active admin (any target, not just self) | `update-user`, `replace_user_roles` (database.md) | REQ-ADMIN-004/006 |
| A user can hold more than one role, assigned via `user_roles` — no client role has direct write access to it | `replace_user_roles` (service_role only, database.md) | REQ-ADMIN-004 |
| Other users' emails require the Admin API (service role), not a `profiles` column | `list-users` | REQ-ADMIN-004 |
| Google sign-in invite-only, no auto-created profile | `AuthContext` post-OAuth check | REQ-AUTH-003 |
| Password reset, non-leaking, works for Google-only accounts too | Supabase Auth client SDK, no Edge Function | REQ-AUTH-005 |
| No hard delete, ever | `prevent_hard_delete()` trigger, all tables | — |
| Soft-deleted rows excluded from every read | RLS `deleted_at is null` + query convention | — |
| **Deferred**: overlap warnings, quantity reduction, cancellation/refund | Not implemented — see domain-model.md §Open items | REQ-SUB-005/008/010/011 |
