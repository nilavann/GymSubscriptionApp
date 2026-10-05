# Data Restore (full-fidelity import) — Backend Spec

> **Status: specification only — nothing in this file is implemented yet.** Requirement: [REQ-ADMIN-009](../requirements-template.md#9-feature-area-admin-data-management). This is **import mode B**; mode A (Merge) is in [data-export-import.md](./data-export-import.md), which also defines the workbook, the export and the photo zip this file builds on. Frontend flow: [../frontend/data-export-import.md §4A](../frontend/data-export-import.md#4a-restore-mode).
> Read first: [database.md](./database.md) (the triggers this mode deliberately bypasses), [architecture.md](../architecture.md).

## 1. What Restore is

An **id-preserving, all-or-nothing load** of a workbook produced by REQ-ADMIN-007 into a project that holds no member, subscription or item data (a freshly migrated or wiped project). Everything the export carries is restored **as it was**: every id, `member_number`, `created_at`/`created_by`/`changed_at`/`changed_by`, soft-delete state (`deleted_at`/`deleted_by`), user accounts and role grants, the member-number counters, configuration, and the **audit log itself**. The only gates are **sanity checks** (§4) and the **existing validations** (database constraints are errors; app-level format rules are warnings).

It is *not*: a merge (use mode A on a live project); a schema restore (migrations come from `supabase/migrations/`); a way to recover passwords, sessions or OAuth identities (accounts are recreated without passwords — users sign in via *Forgot password* / Google); Edge Function secrets; Storage objects other than member photos.

## 2. Invariants this mode deliberately overrides — and why it is acceptable

| Normal invariant | Why it exists | What Restore does instead | Control |
|---|---|---|---|
| `set_audit_fields()` stamps `created_*`/`changed_*` from `auth.uid()` | Client can't forge authorship | Writes the file's values | Triggers are off **only inside** the service-role RPC (§7), in one transaction |
| `generate_member_number()` always generates | Numbers are never client-chosen | Writes the file's `member_number`, then raises the counter to ≥ the highest number used (R10) | Same |
| `audit_log` is written only by `audit_row_changes()` | Append-only history | Inserts the file's rows verbatim (ids, `changed_by`, `changed_at`) and suppresses the trigger so nothing is duplicated | Only into a project with no member/subscription/item data (R5); existing rows are never altered or overwritten |
| `generated always` ids | Server owns ids | `OVERRIDING SYSTEM VALUE`, then identity sequences reset to `max(id)` | Same |
| Triggers/RLS keep clients out | Untrusted client | RPC is `service_role`-only (explicit revoke from `public, anon, authenticated` — [test-traceability.md F10](../test-traceability.md#findings)); Edge Function re-checks admin; typed confirmation in the UI | §10 |

**Honest limit:** an admin who hand-edits the workbook can forge history that a restore will faithfully write. The file carries no signature in v1 (open question 1); the controls are admin-only access, the empty-target precondition, a typed confirmation, and function logs.

## 3. Prerequisites (runbook)

1. A project with the migrations applied (`supabase db push`).
2. **The first admin must already exist with the same UUID as in the backup.** `created_by`, `changed_by`, `handled_by_staff` and every audit row reference user UUIDs, so accounts are recreated *with their original ids* (`auth.admin.createUser({ id, … })` — `AdminUserAttributes.id` exists in the installed SDK). The admin who runs the restore cannot be re-created under a new id while signed in as the old one, so the project is bootstrapped from the backup's `Users` sheet: take your own `id` and `email` from that sheet and create the first admin with `scripts/bootstrap-admin.mjs --id … --email … ` (new helper, Phase 2; same idea as [database.md §Bootstrapping the First Admin](./database.md#bootstrapping-the-first-admin) but with a chosen id). If instead the target already has that email under a *different* id, Restore stops (R6) and prints exactly this instruction.
3. Signed in as that admin; the `.xlsx` and, optionally, the photo zip(s).

## 4. Sanity checks and validations

Severity **E** = blocks the restore (nothing is written); **W** = reported in the preview, does not block. Checks R1–R4, R6–R7, R11–R15 run in the Edge Function against the staged rows; R5, R8–R10 and the post-conditions run inside `restore_from_staging` (so the dry run is faithful).

| # | Check | Sev |
|---|---|---|
| R1 | `schema_version` supported; `README` present; all of `Branches, Plans, Roles, Users, UserRoles, Members, Subscriptions, SubscriptionItems, Configuration, MemberNumberSequences` present (`AuditLog` optional → W "audit history will not be restored") | E |
| R2 | Per-sheet row counts equal the `README` counts (detects a truncated/partly deleted file; `AuditLog`, `AuditLog_2…` summed) | E |
| R3 | Ids are positive integers (UUIDs valid) and **unique per sheet**; required id columns present | E |
| R4 | **Referential integrity inside the file**: `members.branch_id/handled_by_staff`, `subscriptions.member_id`, `subscription_items.subscription_id/plan_id/member_id/shared_member_id`, `user_roles.user_id/role_id/granted_by`, `audit_log.changed_by`, and every `created_by/changed_by/deleted_by` resolve to a row in the file. Reported with sheet + Excel row (the database FKs would also reject, but without a row number) | E |
| R5 | **Target state:** no `members`, `subscriptions` or `subscription_items` row (live *or* deleted) exists in the target unless the file contains the same id with identical business columns. A non-empty live project → "Restore needs a project without member data — use Merge." Re-running an interrupted restore passes this check (idempotent) | E |
| R6 | **Accounts:** emails valid and unique among live users in the file; a target account with the same email but a different id, or the same id but a different email → conflict with the runbook text (§3) | E |
| R7 | The file contains **an active, non-deleted admin**, and the **caller's own id is in `Users`** (the restoring admin must not lose access) | E |
| R8 | **Database constraints** — NOT NULL, CHECK (`category`, `gender`, `payment_mode`, `operation`, `max_members`, `quantity`, `*_not_blank`, `chk_doctor_care_details_required`, …), FKs, unique indexes (live `phone`, `member_number`, `code`, plan/role `name`). Row-numbered via the diagnostic pass (§7.5) | E |
| R9 | `deleted_at` and `deleted_by` both set or both empty | E |
| R10 | `member_number_sequences.last_sequence` ≥ highest sequence used by that branch's restored member numbers; if lower it is **raised** (never lowered) so the next registration cannot collide | W (auto-fixed) |
| R11 | `end_date ≥ start_date`; `end_date` equals `start_date + duration_days × quantity − 1` (NULL iff indefinite); an item's `member_id` equals its subscription's | W |
| R12 | `changed_at` not earlier than `created_at`; timestamps parse as ISO-8601 with offset | W (parse failure E) |
| R13 | Truncated cells flagged by the `README` (> 32,767 chars) | W |
| R14 | **App-level format rules, advisory in this mode:** name 2–80, phone / emergency phone 10 digits, pincode 6 digits, email shape, weight 1–500, height 1–300, gender set. A backup must never become un-restorable because a rule was added after the row was written | W |
| R15 | Config keys in the file that do not exist in the target are ignored; target-only catalog rows (not in the file) are left alone | W |
| Post | After loading: per-sheet counts in the database equal the file's; identity sequences ≥ `max(id)`; every disabled trigger is enabled again; at least one active admin exists | E (rolls back) |

Unlike Merge there is **no "skip invalid rows" option**: restore is all-or-nothing.

## 5. Flow and Edge Function contract

All steps are `import-data` calls with `mode: "restore"` (admin-only, same auth steps as [data-export-import.md §4.2](./data-export-import.md#42-steps)); data problems are returned inside a 200.

| # | `action` | What it does | Writes? |
|---|---|---|---|
| 1 | `stage` | `{job_id, sheet, first_row, rows[]}` — stores a chunk (≤ 5,000 rows / ≤ ~1 MB) in `restore_staging`. Idempotent per `(job_id, sheet, row_no)`. Also purges staging jobs older than 24 h. | staging only |
| 2 | `check` | Runs the Edge Function checks (R1–R4, R6, R7, R9, R11–R15) against the staged job and reports the accounts that would be created. | none |
| 3 | `accounts` | Creates the missing accounts (§8). Idempotent. | `auth.users` (+ trigger-made `profiles`) |
| 4 | `run` `dry_run: true` | Calls `restore_from_staging(…, true)`: the real code path, rolled back. Returns per-sheet counts, errors, warnings. | none (rolled back) |
| 5 | `run` `dry_run: false`, `confirm: "RESTORE"` | Same call, committed. The function refuses unless the literal `RESTORE` is sent (the UI makes the admin type it). On commit it unbans eligible accounts (§8). | yes |
| 6 | `cleanup` | Deletes the job's staged rows (also done automatically after a commit and on abort). | staging only |

Photos (§9) are client-side, after step 5. Response shape matches Merge's (`committed`, `summary` per sheet, `rows` with `{sheet,row,outcome,message?}`, `warnings`); restore outcomes are `inserted | adopted | overwritten | error`.

## 6. Staging table (new migration)

`restore_staging(job_id uuid, sheet text, row_no integer, data jsonb, created_at timestamptz default now(), primary key (job_id, sheet, row_no))`. RLS **enabled with no policies**, and `revoke all … from anon, authenticated` explicitly (default grants would otherwise expose it — F10/F11); written and read only by the service role. It is not a business table (no audit columns, no soft delete, no `prevent_hard_delete`); it holds personal data, so it is purged after commit/abort and by the 24 h sweep. Staging is what makes a 100k-row audit log restorable **atomically**: transport is chunked, the transaction is one function call over rows already in the database.

## 7. `restore_from_staging` RPC (new migration)

`restore_from_staging(p_caller_id uuid, p_job_id uuid, p_dry_run boolean) returns jsonb` — `plpgsql`, `security definer`, `set search_path = public`, `revoke all … from public, anon, authenticated; grant execute … to service_role;` (with the `has_function_privilege` test).

1. **Lock + precondition first, before any DDL:** `pg_advisory_xact_lock` so two restores cannot interleave; run R5. A blocked precondition returns `committed:false` without taking table locks.
2. **Disable the write-path triggers by name** — `alter table … disable trigger …` (transactional DDL: it is undone automatically on rollback): `trg_{profiles,roles,branches,plans,members,subscriptions,subscription_items}_audit`, `…_audit_fields`, `trg_members_generate_number`, `trg_user_roles_audit_fields`. **`*_no_hard_delete` stays enabled**, and FK constraints stay enforced (this is why `session_replication_role = replica` is not used — "existing validations" must still apply). Table locks are `ACCESS EXCLUSIVE` for the duration; acceptable because R5 guarantees there is no live member data to disturb.
3. **Load in dependency order**, each with `OVERRIDING SYSTEM VALUE` where the id is `generated always`: profiles → roles → user_roles → branches → plans → configuration → members → member_number_sequences → subscriptions → subscription_items → audit_log. Catalog tables run in **two passes** (overwrite existing same-id rows, then insert the rest) so a soft-delete of a seed row frees its unique name before a new row reuses it. Reconciliation per table is in §7.2.
4. **Fast path / diagnostic path:** each table is loaded with one set-based statement (`jsonb_populate_recordset`). If it raises, the function re-runs that table row by row inside sub-blocks only to produce **row-numbered** messages (R8), then aborts. The diagnostic path never commits.
5. **Post-conditions** (§4 "Post"): counts, `setval(pg_get_serial_sequence(…), greatest(max(id), 1))` for every identity table, triggers re-enabled and verified in `pg_trigger`, admin exists. Any failure → sentinel exception → rollback.
6. `p_dry_run` → sentinel exception after step 5 (everything, including the DDL, rolls back). The outcome list is a PL/pgSQL local variable, which survives the rollback of the block's database changes, exactly as in Merge ([data-export-import.md §6.2](./data-export-import.md#62-import_workbook-rpc-new-migration-never-edit-applied-ones)); verified by a SQL test.

### 7.2 Reconciliation (same id already in the target)

| Table | Existing same-id row | Target-only rows |
|---|---|---|
| `profiles` | Must exist (accounts step). **Overwrite all columns** from the file, audit columns included | Left alone (W) |
| `roles`, `branches`, `plans` | **Backup wins:** overwrite (these are seed rows of a fresh project and are expected to differ — e.g. an edited price) | Left alone (W); a unique-name clash with a restored live row surfaces as R8 |
| `configuration` | Update value/description/audit columns by key; unknown keys ignored (R15) | Left alone |
| `user_roles` | For each user in the file, **replace** that user's grants with the file's (a real delete+insert — `user_roles` is the documented hard-delete exception) | Other users untouched |
| `members`, `subscriptions`, `subscription_items` | Identical business columns (everything except `created_*`/`changed_*`) → **adopted**: audit columns set from the file. Different → blocked by R5 | None can exist (R5) |
| `member_number_sequences` | Upsert by `branch_id`, then R10 | Left alone |
| `audit_log` | Same id and identical content → skipped. Same id, different content → **error** (never overwritten) | **Kept, not deleted:** target rows (e.g. the bootstrap admin's own entries) are **re-numbered above the file's highest id**, preserving their order and content, so ids from the file stay exactly as exported |

## 8. Accounts

`auth.users` rows cannot be written inside the RPC's transaction (they go through GoTrue), so accounts are a separate, explicit, idempotent step *before* the dry run:

- For each `Users` row without an account: `auth.admin.createUser({ id, email, email_confirm: true, user_metadata: { full_name }, ban_duration })` — **no password**; `handle_new_auth_user()` makes the `profiles` row, which the restore then overwrites (§7.2).
- **Created banned.** Every account created here is banned until the restore commits, because `is_active_user()` only needs an active profile — a freshly made profile is `is_active = true`, so an account that was *deactivated or deleted* in the backup would otherwise be briefly usable via *Forgot password*. After a **committed** restore the function unbans exactly those created accounts whose restored profile is `is_active` and not deleted. If the restore never commits they stay banned; re-running adopts them.
- Existing account with the same id and email → reused. Same email, different id → R6 conflict. Same id, different email → R6 conflict.
- No password hashes, sessions, MFA factors or OAuth identities are restored; users set a password via the reset flow or sign in with Google (invite-only rule unchanged, [rules.md rule 29](./rules.md)).

## 9. Photos

Zip entries are the originals exactly as exported ([data-export-import.md §4.5](./data-export-import.md#45-photos-zip-client-side)). After a **committed** restore the client uploads, for each restored member with a `photo_url`, the original to **exactly the path in `members.photo_url`**, and regenerates the thumbnail with the existing `compressImage` to **exactly the path in `photo_thumbnail_url`** (`upsert: true`) — so the restored rows already point at the right objects and **no member update is made**. A photo that cannot be found, is not an image, or exceeds 5 MB is reported and its paths are left as exported (staff can upload a new photo from the member screen, which replaces them). Photo failures never affect the restore.

## 10. Security

1. Admin-only in the route guard and in `import-data`; staff get 403 for every `mode`/`action`.
2. `restore_from_staging` and `restore_staging` unreachable from `anon`/`authenticated` (explicit revokes + tests). The trigger-disabling DDL exists **only** inside that function.
3. The commit step requires the literal `confirm: "RESTORE"`; the UI makes the admin type it.
4. Workbook = untrusted input (P2): types and formats are validated in the Edge Function; the database constraints are the backstop.
5. Accounts are created without passwords and **banned until commit** (§8).
6. Staged rows contain personal data: purged on commit/abort and after 24 h; never logged. Logs hold caller id, job id, action and counts only.
7. Restore never deletes business rows; the only overwrites are seed-prone catalog rows, `profiles` and `configuration` (§7.2); `audit_log` rows are never altered or removed.

## 11. Tests

SQL: privileges (`has_function_privilege` false for `anon`/`authenticated` on the RPC and no table privileges on `restore_staging`); round-trip (export fixture → restore into a fresh migrated DB reproduces every table byte-for-byte on business + audit columns, including ids, `member_number`, `created_by`, deleted rows and audit_log); **no duplicate audit rows** (trigger suppression); pre-existing bootstrap audit rows re-numbered above the file max without changing content; identity sequences reset (next insert gets `max+1`); R5 blocks a live project and passes an identical re-run (idempotent); seed-row overwrite and two-pass unique-name case; `user_roles` replace; R10 raises a low counter; post-condition failure rolls back everything including DDL (trigger states restored); dry run leaves nothing behind; local variable survives rollback; diagnostic path gives row numbers. Deno: auth gates for every action, `confirm` literal, staging idempotency/purge, R1–R4/R6/R7/R9/R11–R15, account creation (banned, conflicts, unban only when eligible), warnings not blocking (R14). Frontend/E2E: see the frontend spec. Manual: restore a real export into a brand-new Supabase project end to end (accounts → data → photos → *Forgot password* sign-in).

## 12. Limits and spikes (measure before fixing numbers)

Initial caps: `.xlsx` ≤ 100 MB; ≤ 500,000 data rows; staging chunks ≤ 5,000 rows / ~1 MB. Spikes: (a) `read-excel-file` time and memory on a 200k-row AuditLog; (b) whether `service_role` can run `alter table … disable trigger` inside a `security definer` function owned by the migration role, and the `ACCESS EXCLUSIVE` lock time; (c) the set-based load time for 100k audit rows; (d) Edge Function body-size and wall-clock limits per staging chunk; (e) `auth.admin.createUser` with `id` + `ban_duration` end to end, including that a banned account can still complete *Forgot password* but cannot sign in until unbanned.

## 13. Open questions

1. **Tamper-evidence:** sign the export (HMAC with an Edge Function secret) and verify on restore? It would also block legitimate hand-editing in Excel, so it is not in v1.
2. **Remap instead of a same-id bootstrap admin:** would let an admin restore without scripting a pre-seeded account, at the price of rewriting ids inside restored rows/audit text — rejected for v1 because it breaks "as it was".
3. **A restore receipt** (who restored what, when) beyond function logs — needs an `admin_events` store (same question as [data-export-import.md §13.1](./data-export-import.md#13-open-questions)).
4. **Restoring into a live project** (id upsert with a conflict screen) — not offered; Merge covers live projects.

## Related docs

[data-export-import.md](./data-export-import.md) · [database.md](./database.md) · [edge-functions.md](./edge-functions.md#71-data-export--import-req-admin-007008009) · [../frontend/data-export-import.md](../frontend/data-export-import.md) · [../requirements-template.md](../requirements-template.md#9-feature-area-admin-data-management)
