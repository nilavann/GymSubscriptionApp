# Domain Model / Schema Review — Open Findings

> DB-expert pass over [domain-model.md](./domain-model.md) and the generated [database.md](./database.md), done 2026-07-19. Checklist for tracking — check items off as they're addressed (in the schema, the doc, or both).

---

## Critical

- [x] **`profiles.id references auth.users(id) on delete cascade` contradicts the "no hard delete, ever" invariant.** ([database.md:48](./database.md#L48))
  Every other FK in the schema deliberately omits `ON DELETE` (defaults to `RESTRICT`) so hard-deletes are structurally impossible — reinforced by the `prevent_hard_delete()` triggers. `profiles` is the one exception: a Supabase Auth admin `deleteUser()` call issues a real `DELETE` on `auth.users`, which cascades into `profiles`. Since `created_by`/`changed_by`/`deleted_by`/`cancelled_by`/`handled_by_staff` across seven other tables reference `profiles(id)` with no `ON DELETE` clause, that cascade will hit an FK-restrict error for any profile that has ever touched a row (i.e. almost every profile), or silently succeed and blow a hole in the audit trail if it hasn't.
  **Fixed** ([20260722000000_roles_and_user_roles.sql](../../supabase/migrations/20260722000000_roles_and_user_roles.sql)):
  dropped the `on delete cascade` and re-added the FK with the default (`RESTRICT`-equivalent)
  action, exactly as recommended. A Supabase Auth `admin.deleteUser()` call now fails outright
  with a foreign-key violation instead of cascading; deactivation (`is_active = false`) /
  soft-delete (`deleted_at`) remain the only supported ways to remove a user, documented in
  auth.md §2 and database.md's schema comment. This also unblocked attaching
  `prevent_hard_delete()` to `profiles` itself (security-review-findings.md's High finding),
  which needed this fixed first — attaching it while the cascade was still in place would
  have made the cascade-triggered delete abort from inside the trigger instead of failing
  cleanly at the FK.

- [x] **Two independent "gone" states on `Subscription`/`SubscriptionAddOn` with nothing keeping them in sync.**
  **Superseded, not fixed in code** — this finding described a `status IN ('active',
  'cancelled')` column that was never built. The schema was unified instead
  (`Subscription`+`SubscriptionAddOn` → `subscriptions`/`subscription_items`,
  `Plan`+`AddOn` → `plans`) and cancellation/refund was explicitly deferred rather than
  shipped with the conflicting design this finding warned about — see
  [domain-model.md §Open items](./domain-model.md#open-items-not-blocking-but-worth-resolving-before-implementation-begins)
  and REQ-SUB-011 in
  [requirements-template.md](../requirements-template.md). `subscription_addons` no
  longer exists as a table name anywhere in the schema; do not reintroduce it. When the
  deferred cancellation/refund design is actually implemented, revisit this concern
  then — a `status` column arriving beside `deleted_at` will reopen exactly the
  two-states problem described here, so the eventual design should account for it (e.g.
  route every "is this live?" query through a view, as originally suggested) rather than
  repeating a two-condition filter everywhere.

---

## High

- [x] **No indexes on any `profiles`-referencing FK column.** Postgres does not auto-index foreign keys. `created_by`, `changed_by`, `deleted_by`, `handled_by_staff` appear on nearly every table with zero supporting indexes. `handled_by_staff` (`members`) is a plausible report filter ("which staff handled this member") and remained unindexed until now.
  (`cancelled_by`, cited in the original finding, doesn't exist — it belongs to the
  deferred cancellation design, REQ-SUB-011 in
  [requirements-template.md](../requirements-template.md); index it when that column is
  actually added, not before.)
  **Fixed** ([20260724000000_profiles_fk_indexes.sql](../../supabase/migrations/20260724000000_profiles_fk_indexes.sql)):
  plain btree index added on every `created_by`/`changed_by`/`deleted_by`/`handled_by_staff`/
  `granted_by` column across `profiles`, `branches`, `plans`, `configuration`, `members`,
  `subscriptions`, `subscription_items`, `audit_log`, `roles`, `user_roles` — 24 indexes in
  one migration. `user_roles.user_id` was already covered as the leading column of its
  `(user_id, role_id)` primary key, so only `granted_by` needed one there.

- [x] **No guard against soft-deleting a Member with active subscriptions.** Plan and AddOn both get an explicit "referenced row can't be deleted" guard ([domain-model.md:63](./domain-model.md#L63), [:137](./domain-model.md#L137)); Member — the one with live, paid-for subscriptions attached — had none.
  **Fixed** ([delete-member Edge Function](../../supabase/functions/delete-member/index.ts), [member-management.md's Member Deletion Guard](./member-management.md#member-deletion-guard-closes-domain-model-reviewmds-member-deletion-finding)):
  product decision was **block** (not warn/auto-cancel), matching the existing Plan/Branch/Role
  "used by X" pattern for consistency. `memberRepository.delete()` now calls this Edge Function
  instead of updating `members` directly; it counts non-deleted `subscription_items` referencing
  the member (`member_id` or `shared_member_id`) and returns 409 if any exist, otherwise
  soft-deletes. Not admin-only, unlike Plan/Branch — REQ-MEM-007 is staff/admin, so the guard
  only checks the caller is an active, non-deleted user.

- [x] **Bare `numeric` (no scale) on all money and body-measurement fields.**
  **Partially superseded:** the money side is fixed — `plans.price` and
  `subscription_items.amount_paid` are both `numeric(10,2)` today (the separate
  `addons`/`subscription_addons` tables this finding named no longer exist; addons are
  `plans` rows with `category = 'addon'`, priced through the same `plans.price` column).
  `refund_amount` doesn't exist yet — it's part of the deferred cancellation design
  (REQ-SUB-011); scale it `numeric(10,2)` when that column is added, not before.
  `members.weight_kg`/`height_cm` are still bare `numeric` — already tracked as a Low/polish
  item in
  [security-review-findings.md](./security-review-findings.md#low--polish) rather than
  duplicated here.

- [ ] **No `end_date >= start_date` check on `subscription_items`.** A cheap CHECK
  constraint that catches a whole class of future Edge Function bugs at the DB layer
  instead of in production data — currently nothing stops `start_date` and `end_date`
  from being inserted in either order.
  ([20260720000100_transactional_data.sql:86-87](../../supabase/migrations/20260720000100_transactional_data.sql#L86-L87))
  (`subscriptions`/`subscription_addons` as named in the original finding no longer
  match the schema — `subscriptions` has no date columns of its own, and
  `subscription_addons` doesn't exist; the equivalent table today is `subscription_items`.)
  **Pending, not applicable yet:** a `refund_amount <= amount_paid` check belongs with
  the deferred cancellation/refund design (REQ-SUB-011,
  [requirements-template.md](../requirements-template.md)) — there is no `refund_amount`
  column to constrain until that work is picked up. Add this CHECK alongside whichever
  migration introduces the column, not before.

---

## Medium

- [x] **domain-model.md understates what's already enforced at the DB level.** It said `doctor_care_details` is "Required (app-level, not DB CHECK)" — but `chk_doctor_care_details_required` already enforces exactly that
  ([20260720000100_transactional_data.sql:44-46](../../supabase/migrations/20260720000100_transactional_data.sql#L44-L46)).
  (The original finding's second example, `default_duration_days`/
  `chk_addon_duration_required_when_time_boxed`, was from the pre-unification `AddOn`
  table and no longer applies — the equivalent constraint on the unified `plans` table is
  `chk_plan_duration_required_when_membership`,
  [20260720000000_master_data.sql:85-87](../../supabase/migrations/20260720000000_master_data.sql#L85-L87),
  which domain-model.md should be checked against instead.)
  **Fixed** — this specific line was still wrong as of a later full-app audit (2026-07-26,
  [audit-findings.md](../audit-findings.md)), 7 days after this finding was first logged;
  updated to "Required (enforced by DB CHECK — `chk_doctor_care_details_required`, see
  below)".

- [x] **Missing composite index for the one query pattern called out as "app-wide."**
  **Superseded by the schema redesign** — the `status = 'active'` predicate this finding
  was written against never shipped (see the Critical item above). The equivalent
  "what does this member currently have" query today (`member_current_items`) is already
  backed by a composite partial index:
  `idx_subscription_items_member_end on subscription_items(member_id, end_date) where deleted_at is null`
  ([20260720000100_transactional_data.sql:104-105](../../supabase/migrations/20260720000100_transactional_data.sql#L104-L105)),
  plus the `shared_member_id` equivalent right below it. No further action needed unless
  the deferred cancellation design (REQ-SUB-011) adds a `status` column, at which point
  this index should be revisited to include it.

- [x] **No safeguard against locking out the last admin.** RLS lets any active admin flip another admin's (or their own) `role`/`is_active` with no "am I the last admin" check ([database.md:543](./database.md#L543)). Admin *deletion* already special-cases "never on the caller's own row" — the same lockout risk exists for role changes/deactivation and isn't covered.
  **Fixed** ([20260722000000_roles_and_user_roles.sql](../../supabase/migrations/20260722000000_roles_and_user_roles.sql)):
  `count_other_active_admins()` backs a guard applied in three places — `replace_user_roles`
  (removing the admin role), and `update-user`'s deactivate/soft-delete branches
  (edge-functions.md §5) — all blocked with a clear error if the target is the last active
  admin. Checked against the *system*, not just "is this my own row," since two different
  admins could otherwise still lock everyone out between them.

- [ ] **`audit_log` EAV growth has no stated retention/partitioning story.** Reasonable trade-off given the `change_id` grouping requirement — not asking to change the design — but worth a line in the doc so a future reader doesn't mistake unbounded per-field-per-edit growth for an oversight.

---

## Minor / decisions to make explicit

- [ ] Member-number sequence can gap on failed inserts (counter increments before the row is guaranteed to land) — fine for a display identifier, just confirm nothing downstream assumes contiguity.
- [ ] `text` + `CHECK IN (...)` used everywhere instead of native Postgres `ENUM` — reasonable modern choice (easier to alter), just flagging it was never stated as a deliberate trade-off.

---

## Already solid (no action needed)

- Soft-delete-only enforcement via `prevent_hard_delete()` triggers (DB-level, not just RLS/app convention).
- Partial unique indexes scoped to `deleted_at is null` for `phone` / `member_number` / branch `code` / plan & addon `name`.
- `member_number` generation via `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` — correct, race-safe per-branch counter. (Was per-branch-**per-year** when this line was written; the counter was later changed to increment continuously per branch and never reset at a year boundary — REQ-MEM-005 revised accordingly, see [member-management.md §3](./member-management.md#3-member-number-generation-req-mem-005) — the race-safety property itself is unaffected either way.)
- Audit trigger correctly excludes its own audit-metadata columns to avoid recursive noise.
