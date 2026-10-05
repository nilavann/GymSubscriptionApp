# Data Export / Import (Excel + Photos) — Backend Spec

> **Status: §4 Export (REQ-ADMIN-007) is implemented (Phase 1). §5–§8 Merge (REQ-ADMIN-008) and Restore ([data-restore.md](./data-restore.md)) are specification only.** Requirements: [REQ-ADMIN-007 / REQ-ADMIN-008](../requirements-template.md#9-feature-area-admin-data-management). Frontend counterpart: [../frontend/data-export-import.md](../frontend/data-export-import.md).
> Import mode B (full-fidelity **Restore** — same ids, `created_by`, audit stamps and audit log): [data-restore.md](./data-restore.md), requirement [REQ-ADMIN-009](../requirements-template.md#9-feature-area-admin-data-management).
> Read first: [architecture.md](../architecture.md) (server-side authority), [database.md](./database.md) (triggers/RLS the import must respect), [edge-functions.md](./edge-functions.md), [rules.md](./rules.md).

## 1. Purpose and scope

The project runs on the Supabase Free plan: no managed backups, and the CLI dump needs Docker. This feature gives an **admin** an in-app way to
1. **Export** all business data to one Excel workbook (`.xlsx`) plus a separate `.zip` of member photos, and
2. **Import** an Excel workbook (and optionally a photos `.zip`) back into the live app as a **merge**.

**There are two import modes, chosen explicitly by the admin, and they have opposite guarantees:**

| | **A — Merge** (this file, §5–§8) | **B — Restore** ([data-restore.md](./data-restore.md)) |
|---|---|---|
| Use it for | Adding or updating data in a **live** project (bulk onboarding, fixing data in Excel) | Rebuilding a **fresh or wiped** project from a backup — the "complete record" |
| Ids, `member_number`, `created_by`/`created_at`/`changed_*`, deleted rows, audit log | **Regenerated / ignored.** Goes through the app's normal write rules: new ids, new member numbers, the importing admin as `created_by`, normal audit entries | **Preserved exactly as exported**, including the audit log itself |
| Users, roles, configuration, audit history | Ignored (export-only for Merge) | Restored |
| Target must be | Anything | A project with no member, subscription or item data (re-running the same restore is fine) |
| Gates | Server-side validation of every row (§5.4) | Sanity checks + existing validations: database constraints are errors, app-level format rules are warnings |
| Atomicity | One transaction, `on_error` option | One transaction, all-or-nothing |
| Mechanism | `import_workbook` RPC; triggers stay on | Staging table + `restore_from_staging` RPC; write-path triggers disabled by name inside that one function |

Merge can never reproduce original ids, member numbers, audit stamps, deleted rows or audit history — the triggers in [database.md](./database.md) overwrite or forbid all of those on purpose (`set_audit_fields`, `generate_member_number`, `audit_row_changes`, `prevent_hard_delete`). Restore is the mode that deliberately overrides them, behind controls described in data-restore.md §2.

Non-goals (v1): scheduled/automatic exports; encrypted workbooks; importing into a different schema version; restoring password hashes, sessions or OAuth identities; Merge importing users, roles, configuration or audit history; updating existing subscriptions in Merge; Merge importing photos for members that already exist.

## 2. Principles

| # | Principle | Why |
|---|---|---|
| P1 | **Admin-only at both layers** — route guard (UX) *and* `is_admin_user()` check inside both Edge Functions (authority). | Export contains Aadhaar numbers, medical notes, emergency contacts and emails; import writes in bulk. |
| P2 | **The uploaded workbook is untrusted input.** The client parses it only to build a JSON payload; the Edge Function and the RPC re-validate every value. | Anyone can call the function directly with any JSON; a workbook can be hand-edited. |
| P3 | **Values only.** Import reads cell *values*; formulas are never evaluated or stored. All user text is written to the export as string-typed cells. | See §9.2 — the chosen reader cannot detect formula cells, so the guarantee is "never evaluate", not "reject". |
| P4 | **Never destructive.** Merge only inserts and (opt-in) updates; it never deletes, never un-deletes, never edits subscription line items. Restore never deletes business rows either (data-restore.md §10.7). | `prevent_hard_delete()`; line items are immutable (CLAUDE.md). |
| P5 | **Atomic and previewable.** One import = one transaction (Restore stages rows first, then runs one transaction over them). The preview runs the *same* code path with a forced rollback. | No half-imported state; preview == real outcome. |
| P6 | **Idempotent.** Merge: re-importing the same file creates nothing new (natural keys, §5.1). Restore: re-running a restore of the same file is a no-op (same ids, identical content). | Safe retries. |
| P7 | **Two modes, never blended.** Merge keeps every trigger and regenerates ids/stamps; Restore preserves them and is allowed only where no member data exists. | The same row can't be both "new" and "exactly as it was". |

P3 (values only) and P2 (untrusted workbook) apply to both modes; P4–P6 are stated here for Merge and in data-restore.md for Restore.

## 3. Workbook contract

### 3.1 File

- Name: `fit-and-fine-data-YYYY-MM-DD.xlsx` (export date in the admin's local time). Photos: `fit-and-fine-photos-YYYY-MM-DD.zip` (or `…-part-N.zip`, §4.5).
- **Columns are matched by header name** (case-insensitive; surrounding whitespace ignored; space and underscore equivalent), never by position, so an admin may reorder or delete columns in Excel. Unknown columns are ignored with a warning. A missing *required* column is a file-level error.
- Sheet names are matched case-insensitively. An import uses whichever importable sheets are present; none present → file-level error "No importable sheets found".
- Row 1 is the header; data starts at row 2. Error messages always quote the **Excel row number**.
- `README` sheet (first sheet) holds `schema_version` (integer, currently `1`), `exported_at` (UTC ISO-8601), `exported_by` (admin's email), `source_project` (the Supabase project ref, informational), **exact per-sheet row counts** (Restore check R2 compares them to detect a truncated file), options used (e.g. audit log included, photo parts), the number of **truncated cells** and of **cleaned cells** (control characters removed, §3.2), and any export warnings (unreadable photos). Merge reads only `schema_version`: a **higher** major version than the app supports → file-level error; a lower one is accepted. Restore also reads the counts.

**README layout (a contract the importers read back):** column A/B hold `key | value` pairs from `schema_version` down to `cleaned_cells`, then one blank row, then a `Sheet | Rows` header followed by one `sheet name | row count` line per exported sheet (counts are numbers; `AuditLog` overflow sheets are summed under `AuditLog`), then a blank row and a `Warnings` section (`None` when empty), then a `Notes` section. Implemented in `frontend/src/lib/data-transfer/workbook-schema.ts` (`buildReadme`), which is the single place a column or README line is named.

**Fidelity rule for Restore:** every column of every exported table is exported, nothing is derived or reformatted. Timestamps are written **exactly as the API returns them** (ISO-8601 text with offset and microseconds — never round-tripped through a JS `Date`); ids are numbers (bigints stay below 2^53); UUIDs are text.

### 3.2 Cell and format rules

| Data | Written as | Import accepts |
|---|---|---|
| Free text, phone, emergency phone, pincode, Aadhaar, member number, notes | **String cells** (type `String`, text format) — never numbers, so leading zeros and 12-digit values survive and `=`/`+`/`-`/`@`-prefixed text can never be a formula | Strings; a *numeric* cell in a text column is converted with its raw text (read with a string `parseNumber`), then validated — a phone that lost its leading zero fails with "Enter a valid 10-digit phone number (Excel may have dropped a leading zero)" |
| Calendar dates (`date_of_birth`, `date_of_joining`, `start_date`, `end_date`) | ISO text `YYYY-MM-DD` | ISO text; a real Excel date cell (read as UTC calendar date); anything else (e.g. `05/06/2026`) is rejected as ambiguous: "Use YYYY-MM-DD" |
| Timestamps (`created_at`, `changed_at`, `deleted_at`, `changed_at` in AuditLog) | ISO-8601 text with offset, microsecond precision, verbatim from the API | **Merge:** ignored (info columns), except `deleted_at` ≠ blank → row skipped (§5.3). **Restore:** parsed and written as-is |
| Numbers (`price`, `amount_paid`, `weight_kg`, `height_cm`, `quantity`, `duration_days`, `max_members`) | Number cells | Number or numeric text; non-finite / locale strings (`1,000`) rejected |
| Booleans (`under_doctor_care`, `is_active`) | `TRUE` / `FALSE` text | `TRUE/FALSE/Yes/No/Y/N/1/0`, case-insensitive; blank = `false` |
| Empty | Blank cell | Blank cell **= "no value"** (never overwrites an existing value on update, §5.2) |
| Characters a spreadsheet cannot store — control characters other than tab / LF / CR, U+FFFE / U+FFFF, unpaired surrogates (e.g. a stray vertical tab pasted into a name) | **Removed on export**, each affected cell counted (README `cleaned_cells` + an on-screen warning). Verified: the spreadsheet library drops these silently, which would alter the data without a word; tab, newlines and emoji are kept | n/a |

Limits: input `.xlsx` ≤ **10 MB**; total importable data rows per file ≤ **2,000** (initial value — tuned by the Phase 2 timing spike, §11; larger datasets are split across several files, which is safe because import is idempotent); any single text cell ≤ 32,767 characters (Excel's own cap — longer values are truncated on export with a README warning); a sheet beyond 1,048,576 rows overflows into `AuditLog_2`, `AuditLog_3`, …

### 3.3 Sheets and columns

Every data sheet starts with the **info columns** `id, created_at, created_by, changed_at, changed_by, deleted_at, deleted_by` (UUIDs for the `*_by` columns — resolve against the `Users` sheet). **Merge ignores them** (§5.3 for `deleted_at`); **Restore imports them as-is**. Sheets for tables without some of these columns (`Configuration`, `MemberNumberSequences`, `UserRoles`, `AuditLog`) carry only the columns the table has. The tables below list the remaining columns. "Req" = required for **Merge** (Restore's requirements are data-restore.md §4: it needs the id columns, not the name-based convenience columns).

**Branches** *(importable; key `code`)* — `name` (req), `code` (req).

**Plans** *(importable; key `name`)* — `name` (req), `category` (req: `membership`|`addon`), `duration_days` (req when membership; blank = indefinite for add-ons), `price` (req, ≥ 0), `max_members` (1–2; default 1; must be 1 for add-ons).

**Members** *(importable; key `phone`)* — `name`, `phone`, `date_of_birth`, `gender` (`Male`/`Female`/`Other`), `weight_kg`, `height_cm`, `emergency_contact_name`, `emergency_contact_phone`, `emergency_contact_relationship`, `branch_code` (all req); `date_of_joining` (blank → today, with a warning), `under_doctor_care`, `doctor_care_details` (req when `under_doctor_care`), `email`, `residential_address`, `pincode`, `aadhaar_number`, `occupation`, `handled_by_email` (resolved to a live, active profile; unresolved → blank + warning), `photo_file` (name of the entry in the photos zip). Columns Merge ignores but **Restore requires**: `branch_id`, `member_number`, `handled_by_staff` (UUID), `photo_url` (bucket path), `photo_thumbnail_url`. `branch_code`, `handled_by_email` and `photo_file` are exported alongside them as human-friendly/Merge columns.

**Subscriptions** *(importable; one row per checkout)* — `subscription_ref` (req; the source `id`, or any label unique in the file — links items to their header), `member_phone` (req), `payment_mode` (`Cash`/`UPI`/`Card`; default `Cash`), `notes`.

**SubscriptionItems** *(importable)* — `subscription_ref` (req), `plan_name` (req), `member_phone` (req), `shared_member_phone`, `start_date` (req), `quantity` (default 1), `amount_paid` (blank → `plan.price × quantity`, same as `create-subscription`). `end_date` is exported for reference and **ignored by Merge** — always recomputed. **Restore keeps it as exported.** For Restore the id-based columns are also exported (Subscriptions: `id, member_id`; SubscriptionItems: `id, subscription_id, plan_id, member_id, shared_member_id, start_date, end_date, quantity, amount_paid`); `subscription_ref` equals the subscription's `id`, and `member_phone` / `plan_name` / `shared_member_phone` are the Merge-friendly equivalents.

**Roles** *(Merge: reference-only; Restore: imported)* — `name`, `description`.
**Users** *(Merge: reference-only; Restore: accounts recreated)* — `id, email, full_name, is_active` (+ info columns). The old comma-separated `roles` column is kept for readability, but Restore reads the `UserRoles` sheet. No password hashes, tokens or provider data are ever read.
**UserRoles** *(new; Merge: ignored; Restore: imported)* — `user_id, role_id, granted_at, granted_by` (the `user_roles` table has no audit columns and no `id`).
**Configuration** *(Merge: reference-only; Restore: imported)* — `key, value, description` + `created_at, created_by, changed_at, changed_by` (the table has no soft-delete columns). **MemberNumberSequences** *(same)* — `branch_id, last_sequence`.
**AuditLog** *(Merge: reference-only; Restore: imported verbatim)* — `id, change_id, table_name, record_id, field_name, old_value, new_value, operation, changed_by, changed_at`.

Why Merge treats these as reference-only: **AuditLog** is written solely by `audit_row_changes()` and is append-only — a merge that imported it would forge history. **Users** would need `invite-user` (an email side-effect). **Configuration** keys are migration-managed. **Roles** are the access-control surface. **MemberNumberSequences** is an internal counter. Restore, which has stricter preconditions and is the "complete record" mode, imports all of them (data-restore.md §2, §7.2).

## 4. Export — `export-data` Edge Function

`supabase/functions/export-data/index.ts` · POST · service role internally.

### 4.1 Contract

Request `{ "table": <ExportTable>, "after": <number|null>, "limit": <1..1000> }` (`limit` defaults to 500); response `{ "rows": [...], "next": <number|null>, "project_ref": "<ref>" }`, where `project_ref` is taken from `SUPABASE_URL` (README `source_project`). **`next` is the id of the last row returned, and is `null` only on an empty page — the last page of a table is an empty one.** The client therefore always makes one extra request per paged table. This is deliberate: deciding "last page" from `rows.length < limit` would silently truncate a backup if the server's own row cap (`max_rows`) were ever lower than the page size asked. `ExportTable` is a **whitelist**: `branches, plans, roles, members, subscriptions, subscription_items, configuration, member_number_sequences, audit_log, users, user_roles`. Any other value → 400; the function never builds a query from a free-form table name.

- Keyset pagination on `id` ascending (`id > after`), ≤ 1,000 rows/page (PostgREST `max_rows = 1000` in `supabase/config.toml` caps it regardless). `configuration` (PK `key`) and `member_number_sequences` (PK `branch_id`) are small and returned in a single page. `users` is returned in one response (tens of rows).
- `users`: `auth.admin.listUsers` paged (`perPage 200`, loop until a short page — same pattern as [`list-users`](./edge-functions.md#5-user-management-req-admin-004006)) joined with `profiles` **including soft-deleted profiles**; output `id, email, full_name, is_active` + info columns (a readable `roles` column is derived from `user_roles`, which is exported as its own table). Never a hash, token, identity or provider field.
- Response rows contain **every column of the table** as an explicit list kept in one place (never `select *`, so a column added later — especially a secret — is not exported by accident until the list and §3.3 are updated). `configuration` and `member_number_sequences` are one page; `user_roles` (composite key, tens of rows) is one page.

### 4.2 Steps

1. `Authorization` header present and resolves to a user (`auth.getUser()`), else 401.
2. `is_admin_user(callerId)` via the service-role client, else 403 `Admin access required`.
3. Validate `table` (whitelist), `limit` (integer 1–1000), `after` (null or non-negative integer), else 400.
4. Read the page with the service-role client (§4.3), return it.
5. `console.info` one JSON line `{event:"export-data", caller, table, rows, after}` — the only record of who exported what (open question 1).

### 4.3 Deliberate exception to "every service-role read filters `deleted_at is null`"

[rules.md rule 21](./rules.md) requires service-role reads to exclude soft-deleted rows. **`export-data` is the one documented exception**: a data export that silently dropped deleted rows would not be a complete record (member numbers are never reused, and history references deleted members/plans). Controls that make this safe: admin-only (P1); whitelisted tables; deleted rows are *flagged* (`deleted_at`/`deleted_by` columns exported), never presented as live; and the function's tests assert both that deleted rows are returned and that no non-whitelisted or credential-bearing column ever appears. rule 21 carries a pointer to this section.

### 4.4 Client-side assembly (not an Edge Function)

The browser loops pages per table, builds the workbook (`write-excel-file`, dynamic import, string-typed cells, bold frozen header row, sensible column widths) and offers it as a Blob download. Abort/cancel stops the loop; nothing is persisted server-side.

### 4.5 Photos zip (client-side)

Photo bytes **never pass through an Edge Function**. For every member row (live *and* deleted) with a `photo_url`, the admin's own session downloads the object from the private `member-photos` bucket (existing `member_photos_read_active_users` policy) and `fflate` zips it. Rules:

- Original only (`photo_url`); thumbnails are regenerated on import by the existing pipeline.
- Entry name `<member_number>.<ext>`; `<ext>` comes from the **blob's content type** (`image/jpeg→jpg`, `png`, `webp`) — *not* from the stored path, because `memberService.uploadPhoto` names every object `.jpg` even when the content is PNG/WebP. A name collision gets a `-<id>` suffix. The Members sheet's `photo_file` carries the entry name.
- Parts: a new `…-part-N.zip` starts once ~250 MB has been added (browser memory); normally there is exactly one zip. `photo_file` is always just the entry name, whichever part holds it; the README lists how many parts exist. Import accepts **one or more** zip files at once and looks entries up across all of them.
- A photo that cannot be read is skipped, left blank in `photo_file`, and listed in the README warnings — the export still completes.

## 5. Import — merge semantics

### 5.1 Matching (natural keys)

| Sheet | Key (among **live**, non-deleted rows) | Existing → default | Existing → with "update existing" |
|---|---|---|---|
| Branches | `code` (exact, trimmed — same as `idx_branches_code_active`) | `skipped_exists` | update `name` |
| Plans | `name` (`idx_plans_name_active`) | `skipped_exists` | update `category`-compatible fields: `duration_days`, `price`, `max_members` (never `category`) |
| Members | `phone` (`idx_members_phone_active`) | `skipped_exists` | update non-blank editable columns (never `member_number`, `branch_id`, photo) |
| Subscriptions | any item key `(member phone, plan name, start_date)` already present | `skipped_exists` (whole subscription — header + items are an atomic, immutable set) | **not applicable** — never updated |

A key that matches only a **soft-deleted** row counts as *not existing* (the partial unique indexes allow reuse, REQ-MEM-001/007), so a new row is created. Two rows with the same key **inside the file** → the second is an `error` "Duplicate of row N".

Cross-sheet references are resolved by natural key against live rows **plus rows created earlier in the same import** (all in one transaction): `members.branch_code → branches.code`, `subscriptions.member_phone → members.phone`, `items.plan_name → plans.name`, `items.shared_member_phone → members.phone`. Unresolvable reference → row `error` "Branch 'XYZ' not found" etc.

Order: Branches → Plans → Members → Subscriptions (+ items).

### 5.2 Options

- `update_existing` (default **false**): see the table above. A **blank cell never overwrites** an existing value (blank = "no change"), so Excel cannot be used to clear a field in v1. A row whose non-blank values equal the stored ones → `unchanged` (no write, no audit noise).
- `on_error`: `abort` (default — if any row is invalid nothing is committed) or `skip_invalid` (commit all valid rows, report the rest).

### 5.3 Row outcomes

`created` · `updated` · `unchanged` · `skipped_exists` · `skipped_deleted` (row has non-blank `deleted_at` — merge never resurrects or creates deleted data) · `error` (with message). Every outcome carries `{sheet, row, message?}`; `created` members also carry the new `member_id` (used for photo upload, §7).

### 5.4 Server-side validation (authoritative)

The Edge Function validates types and formats **before** the RPC; the RPC enforces schema constraints (NOT NULL / CHECK / FK / unique) as the safety net, so a bad row can never get in even if validation drifts.

- **Common:** every cell is a string, finite number, boolean or null; text trimmed; text ≤ 1,000 chars (names ≤ 80); control characters rejected; file-level caps (rows, sheets present, `schema_version`).
- **Branches:** `name`, `code` non-blank (`chk_branches_*`).
- **Plans:** `category ∈ {membership, addon}`; `duration_days` integer > 0, required when membership; `price` ≥ 0 (numeric(10,2)); `max_members ∈ {1,2}`, = 1 for add-ons; `name` non-blank.
- **Members** (mirror of `frontend/src/services/member.service.ts` today): name 2–80; phone and emergency phone exactly 10 digits after removing spaces (`/^\d{10}$/`); `date_of_birth` required; weight 1–500; height 1–300; gender ∈ {Male, Female, Other}; emergency name/relationship non-blank; email, if present, `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; pincode, if present, `/^\d{6}$/`; `doctor_care_details` required when `under_doctor_care` (`chk_doctor_care_details_required`); Aadhaar and occupation are free text (no format rule exists today). These format rules are client-only elsewhere in the app; import is the first *server-side* enforcement and therefore carries a **parity test** (§10).
- **Subscriptions:** exactly one `category = 'membership'` item (REQ-SUB-001); `quantity` positive integer, and absent/1 for indefinite plans (as `create-subscription`); `shared_member_phone` only on a `max_members = 2` membership item and ≠ the item's member; `amount_paid` ≥ 0; `start_date` valid date (**past dates allowed** — imported history is the point; `create-subscription` also has no past-date rule). `end_date = start_date + duration_days × quantity − 1` (NULL when indefinite) is **recomputed**, never read. REQ-SUB-007 (indefinite plan already attached to that member) → row error. The overlap guard is client-only by design and is not applied.

## 6. Import — `import-data` Edge Function and RPC

### 6.1 `import-data` (`supabase/functions/import-data/index.ts`, POST)

Request:
```json
{ "dry_run": true,
  "options": { "update_existing": false, "on_error": "abort" },
  "schema_version": 1,
  "sheets": { "branches": [{"_row": 2, "name": "...", "code": "..."}], "plans": [], "members": [], "subscriptions": [], "subscription_items": [] } }
```
Response: `{ "committed": bool, "dry_run": bool, "summary": { "<sheet>": { "created": n, "updated": n, "unchanged": n, "skipped_exists": n, "skipped_deleted": n, "error": n } }, "rows": [ {sheet,row,outcome,message?,member_id?} ], "warnings": [...] }`.

Steps: (1) auth + admin check exactly as §4.2 steps 1–2; (2) body caps (`schema_version` supported, ≤ 2,000 rows total, known sheet keys only); (3) per-row validation (§5.4) — invalid rows become `error` outcomes and, under `on_error = skip_invalid`, are removed from the payload sent on; (4) call `import_workbook` once; (5) merge validation errors and RPC outcomes into the response, ordered by sheet then row; (6) `console.info` `{event:"import-data", caller, dry_run, summary}`. Status codes: 401/403 as usual; 400 malformed request or over a cap; 409 not used; 500 unexpected. A *data* problem is never an HTTP error — it is an `error` outcome inside a 200.

### 6.2 `import_workbook` RPC (new migration; never edit applied ones)

```
import_workbook(p_caller_id uuid, p_payload jsonb, p_update_existing boolean,
                p_skip_invalid boolean, p_dry_run boolean) returns jsonb
language plpgsql  security definer  set search_path = public
revoke all on function import_workbook(…) from public, anon, authenticated;   -- ALL THREE, explicitly
grant execute on function import_workbook(…) to service_role;
```

**Do not copy the privilege pattern of the existing RPCs.** [test-traceability.md finding F10](../test-traceability.md#findings) records that `revoke … from public` + `grant … to service_role` does **not** remove Supabase's default `EXECUTE` grants to `anon`/`authenticated` on new `public` functions. `import_workbook` takes `p_caller_id` as a *parameter* and writes with definer rights, so if a signed-in staff user could call it directly they could create plans and branches (admin-only by RLS), bulk-insert members, and forge who did it. The migration therefore revokes from `public, anon, authenticated` by name, and a SQL test asserts `has_function_privilege('anon' | 'authenticated', 'public.import_workbook(…)', 'execute') = false`. (The same pattern is used for any other function this feature adds.)

- First statement: `perform set_config('request.jwt.claim.sub', p_caller_id::text, true)` — the existing attribution trick, so `set_audit_fields()` and `audit_row_changes()` record the importing admin.
- Processes sheets in §5.1 order. **Each row runs in its own sub-block** (`begin … exception when others then`) so a failing row is recorded as an `error` outcome and its partial writes — including the `generate_member_number()` counter bump — roll back with it ("a failed insert burns no member number" holds, as in [database.md](./database.md#member-number-generation)).
- Members are inserted with `member_number` omitted (the trigger generates it); updates never touch `member_number`/`branch_id` (the trigger pins them anyway). Subscriptions are written by **calling the existing `create_subscription_with_items`** with resolved ids, recomputed `end_date` and defaulted `amount_paid`, so the atomic header+items insert and the REQ-SUB-007 check have a single implementation.
- After all rows: if `not p_skip_invalid` and any `error` outcome exists → raise a sentinel exception (everything rolls back, `committed = false`); if `p_dry_run` → raise a second sentinel (everything rolls back, `committed = false`, outcomes are what a real run would produce).
- The outcome list is a PL/pgSQL **local variable**, which survives the rollback of the block's database changes (documented PL/pgSQL behaviour) — the function catches the sentinels in the outer handler and returns the list. This is verified by a SQL test rather than assumed.
- Dry run therefore consumes no member numbers and writes no audit rows; it may leave gaps in `identity` sequences (harmless, not rolled back by Postgres).

### 6.3 Audit effects

A real import produces normal field-level `audit_log` rows for every created/updated row, attributed to the importing admin (`changed_by`), identifying nothing as "import". Whether to add an explicit import-run record is open question 1.

## 7. Photo import (client-side, after commit)

1. Only runs after a **committed** import, only if one or more photo zips were supplied, and only for members with outcome `created` and a non-blank `photo_file`.
2. Entry looked up by name across the supplied zips (`fflate`); not found → warning. Non-image content type or > 5 MB (bucket limit) → warning. A photo failure never fails or rolls back the member (same rule as member registration, [member-management.md §7](./member-management.md#7-business-rules) "Photo handling").
3. Upload via the **existing** `memberService.uploadPhoto(memberId, file)` — compresses the thumbnail, uploads both objects under `{memberId}/…`, writes the paths with a normal RLS-guarded member update, cleans up on partial failure. No new storage policy; the admin's own session performs the writes.
4. Existing members never get photos from an import (non-goal) and an existing photo is never overwritten.

## 8. Errors and reporting

Row-level problems are data, returned inside a 200 (§6.1) with the Excel row number and a plain-language message (client-validation wording reused where the rule is the same, e.g. "Name must be 2-80 characters"). File-level problems (not an xlsx, > 10 MB, unsupported `schema_version`, no importable sheets, missing required column, over the row cap) are reported by the client before any request. Network failures surface via `isNetworkError()` and the existing offline UI, never by string-matching a message. After an import the client builds a downloadable **report workbook** (one row per outcome) from the response.

## 9. Security and privacy

1. **Authorization:** admin-only in the route guard *and* in both functions (P1). Staff get 403 even by calling the functions directly. The RPC behind `import-data` must also be **unreachable from `anon`/`authenticated`** (explicit revoke, §6.2) — the Edge Function's admin check is worthless if a staff user can call the RPC straight through `supabase.rpc`.
2. **Formulas / injection (P3).** Export writes every user-controlled text value as a string-typed cell, so Excel never evaluates it. Import reads cached *values*; `read-excel-file` exposes no way to tell a formula cell from a value cell, so the spec does **not** claim formulas are rejected — it guarantees a formula is never evaluated, stored or echoed unescaped (React escapes on render). A user who converts the workbook to CSV and opens that in a spreadsheet is outside the app's control; the README sheet warns about it.
3. **Resource limits.** 10 MB input cap and the 2,000-row cap are enforced before parsing/sending; the library documents no zip-bomb protection, so a malicious `.xlsx` can at worst exhaust the importing admin's own tab.
4. **No SQL from input.** All queries are parameterized `supabase-js` calls; the RPC receives values as `jsonb` and never builds dynamic SQL from them (rules.md rule 4).
5. **Data at rest.** The workbook and zip are **plain files containing personal and medical data**. The UI warns before export; storing and disposing of them is the admin's responsibility. Excel-level password protection is a non-goal (the JS libraries do not support it).
6. **Secrets.** No password hash, token, provider identity or service-role key is ever read, written or logged. The service-role key stays in Edge Function secrets.
7. **Logging.** Function logs record caller id, table/sheet and counts — never row contents.

## 10. Libraries and tests

**Libraries (frontend, dynamic `import()` only — nothing enters the main bundle):** `write-excel-file` (browser build, `toBlob()`), `read-excel-file` (browser build, reads `File`/`Blob`, string `parseNumber`), `fflate` (zip read/write). Chosen over `exceljs` (21 MB unpacked, Node-oriented dependencies) and the npm `xlsx` package (frozen at 0.18.5 on the registry; known unpatched advisories). All three are MIT. Known limits to verify in the Phase 1/2 spikes, not assumed: `write-excel-file` has no documented behaviour for 100k+ rows (§11 budget); `read-excel-file` has no formula detection and no zip-bomb limit (§9.2–3); date cells and time zones must be tested with a real Excel-saved fixture.

**Tests (per CLAUDE.md testing rules):** Deno — both functions' auth gates (401/403/400), whitelist, pagination, deleted-rows-included, no credential columns, every validation rule, dry-run vs real. SQL — `import_workbook`: **not executable by `anon` or `authenticated`** (the F10 check, §6.2), per-row error isolation, no member number burned by a failed row or a dry run, no audit rows after a dry run, attribution to `p_caller_id`, `update_existing` pins `member_number`/`branch_id`, idempotent re-run, REQ-SUB-007 collision, soft-deleted key reuse, local-variable-survives-rollback. **Parity:** a shared fixture file of member-validation cases is run by both the frontend vitest suite (against `member.service.ts`) and a Deno test (against the function's validator) so the two copies cannot drift; the same for the `end_date` formula against `create-subscription`'s cases. Frontend — see the frontend spec.

## 11. Performance budget (to be confirmed by spikes)

Single-tenant scale: low thousands of members ([requirements §10](../requirements-template.md#10-non-functional-requirements)). Targets: export of 2,000 members + 6,000 items + ~100k audit rows < 60 s on broadband; import of 2,000 rows (preview *or* apply) < 30 s end to end; browser peak memory < 500 MB; photo zip parts ≤ ~250 MB. **Phase 1 spike — done (2026-10-06).** The real `buildSheets` + `writeWorkbook` on a synthetic audit log (plus 2,000 members), run in Node 24 / V8 (indicative of a desktop browser tab, **not** a measurement of one):

| Audit rows | Build sheets | Write .xlsx | File | Peak heap | Peak RSS | Longest main-thread stall |
|---|---|---|---|---|---|---|
| 50,000 | 39 ms | 1.6 s | 2 MB | 145 MB | 426 MB | 1.1 s |
| 100,000 | 62 ms | 2.7 s | 5 MB | 367 MB | 724 MB | 1.8 s |
| 200,000 | 110 ms | 5.4 s | 9 MB | 360 MB | 977 MB | 3.6 s |

**Verdict:** inside the time (< 60 s) and heap (< 500 MB) budget at the 200k design point, so the audit-log toggle stays **on by default** and no workbook splitting is needed. **But the write is one uninterruptible call that blocks the main thread — about 1 s per 50,000 audit rows** — so the page cannot repaint or react to Cancel while "Building workbook…" runs; the service therefore yields to the browser so that state is painted *before* the block starts, and a Cancel pressed just before it is honoured. Moving the write into a Web Worker is the fix if this proves painful on real data (open question 6); ~1 GB RSS at 200k rows would also be tight on a phone, so a very large audit log is best exported from a desktop browser. Re-measure in a real browser tab before relying on these numbers. **Phase 2 spike:** time `import_workbook` against the existing 2,000-member load dataset (`supabase/tests/60_performance.test.sql`, `supabase/test-data/`) and check the Edge Function request-body size and wall-clock limits and the `service_role` statement timeout; adjust the 2,000-row cap from the measurements.

## 12. Requirements traceability

| Requirement | Backend implementation |
|---|---|
| REQ-ADMIN-007 (export) | `export-data` (§4), client workbook + zip assembly (§4.4–4.5), `is_admin_user`, whitelist, deleted-rows exception (§4.3) |
| REQ-ADMIN-008 (import, Merge) | `import-data` (§6.1), `import_workbook` RPC (§6.2), `create_subscription_with_items` reuse, existing `memberService.uploadPhoto` (§7) |
| REQ-ADMIN-009 (Restore) | [data-restore.md](./data-restore.md): `import-data` `mode: "restore"` actions, `restore_staging` table, `restore_from_staging` RPC, account step, photo path restore |

## 13. Open questions

1. **Export/import audit trail.** `audit_log` is trigger-written only (database.md §RLS), so there is nowhere to record "admin X exported everything". v1 records it in Edge Function logs only. Should an `admin_events` table (service-role write, admin read) be added?
2. **Limits to be measured** (§11): request-body size, function wall-clock, `service_role` statement timeout, and whether 2,000 rows/file holds.
3. **Blank = no change** means Excel cannot clear a field. Is a sentinel (e.g. `[clear]`) wanted later?
4. **Photos for existing members** (e.g. a second import adding photos): out of scope now — wanted?
5. **Users sheet import** via `invite-user` (sends invite emails) — only if bulk onboarding of staff is ever needed.
6. **Large audit logs:** the §11 budget holds at 200k rows, but the build freezes the page for ~1 s per 50k rows and uses ~1 GB at 200k. Move the write into a Web Worker (keeps Cancel and the progress bar alive), or leave as is until a real project's log is that big?
7. Restore-specific questions (tamper-evidence, receipts, bootstrap-admin id) live in [data-restore.md §13](./data-restore.md#13-open-questions).

## Related docs

[data-restore.md](./data-restore.md) · [requirements-template.md §9](../requirements-template.md#9-feature-area-admin-data-management) · [edge-functions.md](./edge-functions.md) · [database.md](./database.md) · [member-management.md](./member-management.md) · [subscription-management.md](./subscription-management.md) · [../frontend/data-export-import.md](../frontend/data-export-import.md)
