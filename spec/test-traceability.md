# Requirements → Implementation → Test Traceability

> Audit done 2026-10-03 against [requirements-template.md](./requirements-template.md) (functional requirements, Section 10 non-functional requirements, Section 11 constraints). Every requirement was traced to its implementation and given tests that include edge cases. This is the first automated test suite in the repo — before it, nothing was tested.
>
> **Status key:** ✅ implemented and tested · ⚠️ implemented with a gap (the gap has a test that records it — see [Findings](#findings)) · 🚫 deliberately out of scope / deferred per the spec · 🔎 cannot be verified from the repo (external config)

## How to run

| Layer | Command | Needs | What it covers |
|---|---|---|---|
| Frontend (vitest, jsdom, Testing Library) | `npm run test:frontend` | `npm install` | pure logic, services, repositories, auth context, and every page rendered against fake services |
| Edge Functions (Deno) | `npm run test:functions` | [Deno](https://deno.com) 2.x on `PATH` | all 10 functions' auth gates, validation, guards and payload shaping, with `@supabase/supabase-js` swapped for a scriptable fake |
| Database | `npm run test:db` | `psql` + a local Postgres superuser | the **real migrations** applied to a throwaway DB (Supabase `auth`/`storage`/roles stubbed), then SQL assertions on constraints, triggers, RLS, RPCs, views, audit log, concurrency and a 2,000-member load check |
| Everything | `npm test` | all of the above | |

At the time of writing: **488** frontend tests, **136** Edge Function tests, **213** database assertions (all green).

**Known-gap tests.** A requirement the code does not yet meet is *not* hidden by skipping its test. It is written as a normal assertion of the spec'd behaviour and marked so it passes while the gap exists and **fails the moment the gap is fixed** (forcing it to be promoted to a regular test): `it.fails(...)` in vitest, `knownGap(...)` in Deno, `t.known_gap(...)` / `known-gap -` lines in SQL. Search for `GAP` to list them.

---

## Member Management (§2)

| Req | Status | Implementation | Tests (edge cases covered) |
|---|---|---|---|
| MEM-001 register member | ✅ | `member.service.ts` validation, `AddMemberPage`, `members` constraints | `member.service.test.ts` (each required field, name 2–80, phone exactly 10 digits/spaces ignored, weight 1–500 & height 1–300 boundaries, email optional-but-valid, doctor-care Yes+blank/whitespace/ok, No+stale text), `AddMemberPage.test.tsx` (empty form names every missing field, today pre-filled, edited date saved, duplicate phone message, network failure keeps form, digits-only phone), `10_members.test.sql` (NOT NULL/CHECK per field, boundaries, whitespace doctor details) |
| MEM-001 phone unique among non-deleted | ✅ | partial unique index `idx_members_phone_active` | SQL: duplicate on create, on edit, own phone OK, reuse after soft-delete, blocked again once reused |
| MEM-002 camera capture | ✅ | `CameraCaptureModal` | denied camera → message pointing to Upload; no `getUserMedia`; stream released on close; captured frame is a JPEG `File` fed to the same pipeline |
| MEM-003 created_by / handled_by | ✅ | `set_audit_fields()`, `handled_by_staff` | SQL: forged `created_by` ignored on insert and update, `handled_by_staff` independent and FK-checked; page tests: default = logged-in user, changeable before submit and later from member page, `null` clears |
| MEM-004 compression + both files stored | ✅ / ⚠️ | `photo-compression.ts`, `member.service.uploadPhoto` | 400px longest side (landscape/portrait/small/exact), quality ladder to <50KB, floor instead of infinite loop, no-canvas & encode failure; both original and thumbnail uploaded, compress-before-upload order, half-failed upload cleaned up, path-save failure cleans up, member kept on any photo failure. ⚠️ **F4**: the failure message is only `console.warn`ed at registration |
| MEM-005 member number | ✅ | `generate_member_number()` | SQL: format `<code>-<year>-<seq>`, per-branch counters, never resets (no `year` key), continues from stored counter, client-supplied number overwritten, failed insert burns no number, inactive branch rejected; Deno: `update-member-number-sequence` skips numbers used in any year, honours increment, rejects bad input/misconfig |
| MEM-006 edit; number/created_by/branch immutable | ✅ / ⚠️ | trigger pins `member_number` & `branch_id`; update payload omits them | SQL: forged `branch_id`/`member_number` silently pinned while other fields in the same UPDATE apply, update never bumps sequence; service: update payload has none of the three; page: no inputs for them. ⚠️ **F5**: branch isn't *displayed* on the member page |
| MEM-007 soft delete | ✅ (documented deviation F6) | `delete-member` function | SQL: hard delete impossible, row kept with `deleted_by`, invisible via RLS & `member_list_view`, number never reissued, phone freed; Deno: guard counts primary-or-shared, ignores deleted items, update touches only `deleted_at/deleted_by` on a live row; page: confirm/cancel, guard text shown verbatim, offline message |

## Member List (§3)

| Req | Status | Implementation | Tests |
|---|---|---|---|
| LIST-001 default sort, extra sorts | ✅ | `lib/member-list-filters.ts` (extracted from `MembersListPage` unchanged) | join date DESC default (ties, month boundaries), name, expiry with indefinite/none last, input not mutated, search/filters never change default order; page test through the real DOM |
| LIST-002 search | ✅ | `matchesSearch` | name / member number / phone substring, case-insensitive, spaces ignored in phone, trimmed query, empty query, no-match empty state + Clear |
| LIST-003 status pills | ✅ | `lib/status.ts` `deriveStatus` | exactly 7 days = Expiring, 8 = Active, ends today = Expiring, yesterday = Expired, NULL end = Active, no membership = Expired, month/year/leap-day boundaries, **local-date** rule; pill counts; single-select |
| LIST-004 filter panel | ✅ | `filterBeforeStatus`, `member_list_view` | gender OR within group, add-on any-of current add-ons, plan = current membership, AND across groups + pill + search, members without a plan never match a plan filter |
| LIST-* data source | ✅ | `member_current_items`, `member_list_view` | SQL: item ending today is current, expired excluded, latest `end_date` wins, indefinite outranks dated, soft-deleted items/members excluded, add-on ids only add-ons, one row per member |

## Subscriptions (§4)

| Req | Status | Implementation | Tests |
|---|---|---|---|
| SUB-001 checkout | ✅ | `RenewSubscriptionPage`, `create-subscription`, `create_subscription_with_items` | exactly-one-membership (0, 2, +add-ons) at service, page, Deno and (indirectly) DB level; defaults (today, price×qty); one RPC call carries header+all items; **atomicity** — bad second item, unknown plan, negative amount all leave no orphan header |
| SUB-002 payment mode | ✅ | header `payment_mode` check | Cash/UPI/Card only, default Cash, one value per checkout |
| SUB-003 add-ons itemised | ✅ | one row per item | separate `amount_paid` per item in UI total and DB |
| SUB-004 shared member | ⚠️ **F1** | server + DB ✅ (couple plans only, ≠ primary, never on add-ons) | Deno/SQL tests pass; **UI never offers the picker** (`shared_member_id: null` hard-coded) |
| SUB-005 membership overlap warning | ⚠️ **F2** | `findItemOverlap` | inclusive date ranges, indefinite = open-ended, quantity extends range, "Save anyway" keeps payload unchanged, Cancel reverts date; ⚠️ only same-plan overlaps warn |
| SUB-006 duration / indefinite | ✅ | `plans.duration_days` | NULL end_date, quantity forced to 1, chips hidden, "Never expires" |
| SUB-007 indefinite hard block | ⚠️ **F3** | RPC check | blocks repeat, blocks inside one checkout (rolled back), other members unaffected, deleted item no longer blocks, 409 mapping, no separate pre-check; ⚠️ **not atomic across concurrent sessions** (two-session test attaches it twice) |
| SUB-008 add-on overlap | ✅ | same function | same add-on warns, different add-on / membership doesn't |
| SUB-009 quantity | ✅ | `previewEndDate`, server end_date | x1/x2/x3/x6/x12 + custom (clamped 1–60 in UI), 0/negative/fractional rejected, `end = start + days×qty − 1` incl. leap years and year ends, amount = price × qty, no discount |
| SUB-010/011 | 🚫 deferred | — | SQL asserts no cancellation/refund/overlap columns exist (no scope creep) |
| SUB-012 status from multiple checkouts | ✅ | `member_list_view` | SQL (multiple items/checkouts resolve to one current membership) |

## Reporting (§6) · Auth (§7) · Audit (§8) · Admin (§9)

| Req | Status | Tests |
|---|---|---|
| REPORT-001 charts / ranges | ✅ | default 1st-of-month→today, Today/This week/Custom, start>end rejected, **one bar per calendar month** incl. empty months & year boundary, bucketed by `start_date`, add-ons separate, payment-mode totals fixed order |
| REPORT-002 transaction list | ✅ | one row per item (renewal + add-ons stay separate), exact column set, type label, payment mode from the checkout, newest first, empty state, retry |
| AUTH-001 password sign-in | ✅ | disabled until filled, generic "Wrong email or password." (no enumeration), password cleared, timeout message |
| AUTH-002/004 Google, one account | ✅ in code / 🔎 provider config | OAuth start + failure, redirect to bare origin; same profile resolution for any method. Google provider/credentials must be configured in the Supabase dashboard — cannot be checked here (still open in `audit-findings.md`) |
| AUTH-003 invite-only | ✅ | `AuthProvider`: no profile → "not invited" + signed out, one retry absorbs the invite-trigger race, deactivated → distinct message, **fetch failure ≠ not invited**, re-validation on tab focus, mid-session 401, expired-link error surfaced |
| AUTH-005 password reset | ✅ | generic confirmation whether or not the request errors, recovery session confined to `/reset-password`, ≥6 chars + match, expired link message |
| AUDIT-001 field-level audit | ✅ | insert = one row per column, update = one row per *changed* field sharing a `change_id`, no-op writes nothing, metadata columns excluded, soft delete logged, trigger on all 6 required tables (+roles, user_roles), `changed_by` = acting user, append-only & admin-only |
| ADMIN-001 admin-only screens | ✅ | `RequireAdmin` (admin / multi-role / no role / no profile), staff nav hides Settings, RLS: staff can read but not write plans/branches/roles/config |
| ADMIN-002 plans | ✅ | membership needs duration, add-on may be indefinite, price ≥ 0 (0 ok), duration ≥ 1, name unique among live rows, **edit doesn't change past items**, delete guard "used by X" |
| ADMIN-003 branches | ✅ ⚠️ | blank name/code, duplicate code, code reusable after soft delete, delete guard "used by X member(s)"; ⚠️ **F7** DB blank-check ignores tabs/newlines |
| ADMIN-004 users | ✅ ⚠️ | list/status, self-protection (UI disabled + server 403), last-admin guard on deactivate/demote/delete, multi-role edit, invite via function (409 duplicate email, roles validated); ⚠️ **F8** edit form hides the "at least one role" error |
| ADMIN-005 audit overview | ✅ | filters (table, record, dates, user), inverted range rejected, 500-row cap flagged, **no edit/delete control anywhere**, local-day boundaries |
| ADMIN-006 delete user | ✅ | soft delete + restore, not own account, last admin, hidden by default, deleted user loses all access (RLS) |

## Non-functional (§10) and constraints (§11)

| Item | Status | Evidence |
|---|---|---|
| Member list < 1s for ~2,000 members | ✅ | DB: `member_list_view` over 2,000 members ≈ 10 ms; client filter+sort over 2,000 rows < 100 ms (tests assert the budgets) |
| Security: every write role-checked server-side | ⚠️ **F9/F10** | RLS write policies and Edge Function gates verified (non-admin 403 before any table access, deactivated/deleted/never-invited callers refused, no direct client insert on `subscriptions`/`subscription_items`); but see the view and RPC-exposure findings below |
| Auditability / soft delete only | ✅ | every business table has the four audit columns and a no-hard-delete trigger (checked structurally and by attempting deletes); RLS hides soft-deleted rows |
| Members have no login; single tenant; no payment gateway; branch not an access boundary | ✅ | RLS never references `branch_id`; no member auth path exists |

---

## Findings

Ranked. **F1–F8 are spec deviations**, **F9–F11 are security/deployment risks** that depend on how the live Supabase project is configured — each has a one-line check to run against the real project. Nothing in application code was changed to fix these; the only production-code change in this audit is a behaviour-preserving extraction of the list search/filter/sort helpers from `MembersListPage.tsx` into `lib/member-list-filters.ts` so they can be unit-tested.

| # | Sev | Finding | Where | Evidence |
|---|---|---|---|---|
| F1 | High | **REQ-SUB-004 (Must): checkout has no shared-member picker.** The UI hard-codes `shared_member_id: null`, so couple plans can never record their second member (the backend supports it). | `RenewSubscriptionPage.tsx:248` | `it.fails` in `RenewSubscriptionPage.test.tsx` |
| F2 | Med | **REQ-SUB-005: membership overlap only warns for the *same plan*.** Spec (requirements §4, backend/business-logic.md, frontend/subscription-management.md §5) says *any* membership item conflicts, regardless of plan. `src/renew-checkout-page.md` still describes the narrower rule, so the docs disagree. | `subscription.service.ts` `findItemOverlap` | `it.fails` at unit and page level |
| F3 | Med | **REQ-SUB-007 race is real** (already listed open in `crud-review.md`): two concurrent checkouts both attach the same indefinite plan; the in-RPC check is not atomic under READ COMMITTED. Fix as that doc suggests (`pg_advisory_xact_lock` on plan+member, or a partial unique index). | `20260801…sql` | `50_concurrency.sh` ends with 2 rows |
| F4 | Med | **REQ-MEM-004: photo failure at registration isn't shown to staff** — `AddMemberPage` only `console.warn`s it, then navigates away. | `AddMemberPage.tsx:145` | `it.fails` |
| F5 | Low | REQ-MEM-006: branch is never displayed (read-only) on the member page. | `MemberDetailPage.tsx` | `it.fails` |
| F6 | Info | REQ-MEM-007 text says deleting a member leaves its subscriptions untouched; the implementation *blocks* deleting a member that has subscription items (a user-confirmed decision recorded in `audit-findings.md`). The requirement text should be updated to match. | `delete-member` | Deno + page tests assert the implemented behaviour |
| F7 | Low | DB blank checks use bare `trim()` (spaces only) — already listed open in `crud-review.md`. | `20260731…sql` | `known-gap` |
| F8 | Low | Manage Users edit form doesn't render `errors.roles`, so unticking the only role silently blocks Save. Also: the Renew custom-quantity field re-clamps on each keystroke (clearing it snaps to 1, so typing `4` yields `14`), and malformed JSON returns 500 instead of 400. | `ManageUsersPage.tsx`, `RenewSubscriptionPage.tsx`, `create-subscription` | `it.fails` / `knownGap` |
| F9 | **High — verify** | **The list views bypass RLS.** A plain view runs with its owner's rights; the migrations say it "enforces the querying user's own RLS" but none sets `security_invoker = true`. With Supabase's legacy default grants the public anon key can read `member_list_view` (names, phones, member numbers, photo paths), `member_current_items` and `profiles_with_roles`, and deactivated/deleted users keep read access to the member list. Fix: `alter view … set (security_invoker = true)` for all three. Check: `select has_table_privilege('anon','public.member_list_view','select');` | `20260720000200…`, `20260721…`, `20260722…` | `40_view_exposure.test.sql` (7 `known-gap`s) |
| F10 | **High — verify** | **"Service-role-only" RPCs are probably callable by any signed-in user.** The migrations `revoke … from public` + `grant … to service_role`, but Supabase's default privileges also grant `EXECUTE` on new `public` functions directly to `anon`/`authenticated`, which that revoke does not remove. If so, any staff user can call `replace_user_roles` (**self-promote to admin**), `soft_delete_profile`, `update_profile_fields`, `create_subscription_with_items`, `update_subscription_header`, `restore_profile` directly via `supabase.rpc`, bypassing every Edge Function guard. Fix: `revoke execute … from anon, authenticated` explicitly. Check: `select has_function_privilege('authenticated','public.replace_user_roles(uuid,uuid,smallint[])','execute');` | `20260720000300…`, `20260722…`, `20260802…` | `known-gap`s in `20_…` and `30_…` (the harness shows a staff user calling `replace_user_roles` on themselves succeeds) |
| F11 | **High — deployment** | **No migration contains a table/view `GRANT`.** The app silently relies on the legacy "auto-expose new objects" default; `supabase/config.toml` says that default is being removed (field deleted 2026-10-30). A project created or reset after that gets no `anon`/`authenticated` privileges at all and every API call would be denied. The fix for F9/F10 should be done together with an explicit grants migration (`grant select, insert, update on … to authenticated` per table, matching the RLS policies). | all migrations | `grep -rn "grant .* on .* to authenticated" supabase/migrations` finds only function grants |

### Observations not turned into tests
- Google OAuth provider setup and the hosted project's Redirect URL allow-list (AUTH-002/005) are dashboard settings; `audit-findings.md` already tracks them.
- `invite-user` creates the auth user and *then* inserts `user_roles`; if the second step fails the invited user exists with no role. Not covered (needs a real auth backend).
- Storage-bucket policies (`member-photos` private bucket) were applied by the migrations in the test DB but the signed-URL behaviour itself needs a real Storage service.
