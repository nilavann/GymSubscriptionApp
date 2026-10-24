# Migration Phase 1 — Prove the Schema + Data Move with a Script

> Status: **planned, nothing implemented yet.** Phase 1 is a feasibility script, not a switch-over. The running app, `supabase/migrations/`, the Edge Functions and the old project are not touched.

> This file is the **what and why**: scope, decisions, how each step works, the validation checks, the test suite and the risks. Task IDs, order of work, review gates and the checklist live only in [phase-1-plan.md](phase-1-plan.md), so the two files cannot drift apart.

## 1. The bigger initiative and where Phase 1 fits

The overall goal is a **new Supabase project for Fit & Fine** where the backend is organised in its own schema (`fitfine`), with the Supabase side refactored along the way: stronger security (tighter grants/RLS, `anon` locked out), better functions, and other improvements found while studying the current backend. That is a multi-phase effort:

| Phase | What | Status |
|---|---|---|
| **1 (this document)** | A script that creates the `fitfine` schema with **tables only** in the new database, migrates **all the data** into it (every table row, auth users and the member photo files), and **validates** the result, including that photos are linked to the right members | planned |
| 2 | Study and design the refactor: security, functions, RLS, grants, views | later |
| 3 | Logic migration (triggers, RLS, functions, grants) and the app/Edge Function changes | later |
| 4 | Auth setup, cutover, rollback | later |

Phase 1 answers one question: **can we create the new schema with its tables and move every row and every photo across without any problem, and can we prove it?** Everything else waits for that answer.

## 2. Scope

**In scope**
- Create schema `fitfine` and the 11 tables in the **new** database (structure only: columns, types, defaults, PKs, FKs, CHECK/NOT NULL/unique constraints, identity columns, indexes).
- Copy all rows into them, including `auth.users` and `auth.identities` (needed because `profiles.id` references `auth.users`). Every table is copied **as it is**, `audit_log` included, with no special handling.
- Create the `member-photos` bucket in the new project (same settings as the source) and copy every photo file into it.
- Validate the migration, including that every member's photo paths point to an existing file in the new project, and print a pass/fail report.
- A test suite that proves every validation check and every safety rule works (section 8).

**Deliberately not copied:** every other `auth` table (`sessions`, `refresh_tokens`, `mfa_factors`, `one_time_tokens`, `audit_log_entries`, ...). After cutover every user signs in again; nobody's password changes.

**Out of scope for Phase 1** (do not build, do not "just add")
- Triggers, RLS, functions, views, **storage policies**, grants to `anon` / `authenticated` (the bucket is created, its access policies are not).
- Any change to `frontend/`, `supabase/functions/`, or `supabase/migrations/`.
- Auth-provider setup (Google, redirect URLs, email templates), Vercel env, cutover. Google users' `auth.identities` rows are copied, but they cannot sign in to the new project until Phase 4 configures Google for it; the report notes this so it is not read as a bug.

## 3. Decisions

| ID | Decision |
|---|---|
| D1 | Schema name is `fitfine`. |
| D2 | The new project hosts only this app. |
| D3 | Tables are created from plain SQL files run by the script (not `supabase db push`), so Phase 1 leaves `supabase/migrations/` exactly as it is. A later phase turns the refactored result into real migrations. |
| D4 | `audit_log` is copied **as it is**, like every other table: no special flag or mode. Because no triggers exist in the new schema during Phase 1, nothing rewrites audit fields or adds audit rows. It is called out in a report only if it actually causes an issue (a failed check). |
| D5 | No downtime concern: the app is idle for the next 24 hours, so the source is expected to be frozen. The script does not trust that: it reads the source in one consistent snapshot and `--validate` checks that the source has not changed since the load (section 7, "Source unchanged"). |
| D6 | The script is **bash + `psql`/`pg_dump` + `curl` + `jq` + `shasum`** (all already installed here; `psql`/`pg_dump` are also needed by `supabase/tests/run.sh`), no new dependencies. Tests are plain bash too (no `bats`). |
| D7 | Photos are copied in Phase 1 and checked against the member records. Files are copied through the Supabase Storage HTTP API (the database alone cannot move file contents), so this step needs each project's service-role key. |
| D8 | The structure is split the way `pg_dump --section` splits it: **pre-data** (tables, columns, defaults, NOT NULL, CHECK, identity) is created before the load; **post-data** (primary keys, unique and foreign keys, indexes) is added after the rows are in, inside the same transaction. No FK in the current schema is `DEFERRABLE` and almost every table references `profiles` (which references itself), so this is the only way the load works without ordering tricks. Adding the FKs afterwards also re-checks every reference. |
| D9 | Two photo files are equal when their **size and SHA-256 of the bytes** are equal. The etag is only a fast "already copied" hint: a file first uploaded as multipart/resumable has an etag like `"…-N"` that a single re-upload of the same bytes never reproduces. |

## 4. Connection details come from an env file

`scripts/migrate-to-fitfine/.env` (git-ignored by the existing `**/.env` rule; `.env.example` is committed, which the existing `!**/.env.example` rule allows):

```
SOURCE_DB_URL=postgresql://postgres:...@db.<old-ref>.supabase.co:5432/postgres   # current project, read-only use
TARGET_DB_URL=postgresql://postgres:...@db.<new-ref>.supabase.co:5432/postgres   # NEW project
TARGET_SCHEMA=fitfine

# only for the photo copy and photo checks (Storage API)
SOURCE_SUPABASE_URL=https://<old-ref>.supabase.co
SOURCE_SERVICE_ROLE_KEY=...      # used for read access only
TARGET_SUPABASE_URL=https://<new-ref>.supabase.co
TARGET_SERVICE_ROLE_KEY=...
PHOTO_BUCKET=member-photos
```

Either DB URL may be the **direct** connection (`db.<ref>.supabase.co:5432`, IPv6-only without the IPv4 add-on) or the **session pooler** (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`, works over IPv4). The **transaction pooler (port 6543) is refused**: it does not keep a session, so the snapshot, `COPY` and session settings would break.

> **Service-role keys and CLAUDE.md.** CLAUDE.md says the anon key only is used in the frontend env and that no service-role key appears in any test, fixture or env file. That rule is about the app and its tests. The keys here live **only** in `scripts/migrate-to-fitfine/.env`, which is git-ignored, never read by `frontend/`, and never committed. The keys can also be supplied from the shell instead of the file; a variable already set in the shell wins over the file. Phase 1 adds a one-line note to CLAUDE.md naming this env file as the only place a service-role key may be kept.

Rules for the script:
- Reads these eight variables, nothing is hard-coded; exits with a clear message naming the variable if one is missing. The four Storage variables are required only when `--photos` or `--validate` runs.
- **Never writes to the source.** Every source session runs with `default_transaction_read_only = on` (set through `PGOPTIONS`) and the preflight confirms it with `show transaction_read_only`.
- **Refuses to run** if source and target are the same project (section 6, preflight).
- Writes to the target only: `TARGET_SCHEMA`, `auth.users` / `auth.identities` rows **whose ids come from the source**, and objects in the target bucket at paths that come from the source. Never touches `public` of either database, nor any target row or object that did not come from the source.
- The keys are used only by the photo step and the photo checks. The source key is only ever used for reads (download, signed URL).

## 5. Files

```
scripts/migrate-to-fitfine/
  README.md             how to run, what each step does, how to read the report, "Last verified" results
  .env.example          the eight variables above, placeholders only
  run.sh                entry point: preflight → create → load → photos → validate; flags below
  sql/01-pre-data.sql   CREATE SCHEMA + the 11 tables: columns, types, defaults, NOT NULL, CHECK, identity
  sql/02-post-data.sql  primary keys, unique and foreign keys, indexes (applied after the rows are loaded)
  sql/tables.txt        the 11 table names (one per line), used by load and validate
  lib/common.sh         env loading, psql wrappers (session settings), safety checks, logging, FAIL-line format
  lib/columns.sh        copyable column lists from information_schema, and the cross-side comparison
  lib/storage.sh        Storage API helpers (bucket get/create, download, upload, signed URL) via curl
  validate/             the checks in section 7, one file per check family (incl. photos.sh)
  tests/                the suite in section 8: run-all.sh, unit.sh, and one file per group
  out/                  git-ignored: source fingerprint and photo manifest of the last load
```

Flags on `run.sh`: `--preflight` (checks only), `--create`, `--load`, `--photos`, `--validate` (each can run alone), `--all` (= create, load, photos, validate), and `--reset --confirm-target <target-ref>` (section 6). There is no "sample" mode: every check always covers every row and every file.

Exit codes: `0` all checks ok (warnings allowed), `1` at least one `FAIL`, `2` preflight refused (nothing done), `3` the source changed since the load. Every failure prints one line `FAIL <check-id> <table-or-path> <detail>` so the tests can assert exactly which check fired.

## 6. How each step works

### Preflight (every run, before anything else)
- Required variables present.
- Each DB URL is a direct or session-pooler URL; port `6543` refused.
- Project refs: the ref is parsed from each DB URL (host `db.<ref>…` or user `postgres.<ref>`) and from each Supabase URL. Refused if the source and target refs are equal, or if a side's DB ref differs from its own Supabase-URL ref (catches an old/new mix-up). As a second guard, refused if `inet_server_addr()`, port and `current_database()` are the same on both connections.
- Both databases reachable (short connect timeout, error names the side).
- Versions: `pg_dump` major ≥ source server major; target server major ≥ source server major. All three are logged.
- Source session confirmed read-only.
- Target state: `TARGET_SCHEMA` absent (for `--create`); no target `auth.users` row shares an email with a source user under a different id (refused, both ids printed); source ids already present in the target need `--reset`.
- Sizes logged: the 11 tables + auth rows, and the bucket's total bytes, against the target plan's limits.

### Create (`--create`)
Applies `sql/01-pre-data.sql` in one transaction. Refused if `TARGET_SCHEMA` exists.

### Load (`--load`)
1. **Source read, one snapshot.** One `psql` session on the source runs `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` and, inside it, `\copy` of `auth.users`, `auth.identities` and the 11 tables to files in a `mktemp -d` directory outside the repo (removed on exit by a `trap`). In the same snapshot it writes `out/source-fingerprint.json`: per table the row count and the latest `created_at` / `changed_at` / `deleted_at`, plus `auth.users` count and latest `updated_at`.
2. **Column lists.** Built from `information_schema.columns` on both sides, `is_generated = 'NEVER'` only (this excludes `auth.users.confirmed_at`, `auth.identities.email` and any future generated column, which `COPY` cannot write), in ordinal order. For the 11 tables the lists must be identical or the load stops. For the two `auth` tables, a column present in the source but not the target stops the load; a target-only column is allowed when it is nullable or has a default, and is logged.
3. **Target write, one transaction.** `COPY` into `auth.users`, then `auth.identities`, then the 11 tables (any order: no FKs exist yet); apply `sql/02-post-data.sql`; `setval` each identity sequence to `max(id)` (left at its start value if the table is empty); commit. `COPY FROM` writes identity values as given, so no `OVERRIDING SYSTEM VALUE` is involved. Any error rolls back everything.
4. Refused if any of the 11 tables already has rows.

### Photos (`--photos`)
- Object list read from the source database (`storage.objects` where `bucket_id = PHOTO_BUCKET`: name, `metadata->>'size'`, `metadata->>'mimetype'`, etag), placeholder objects (`.emptyFolderPlaceholder`) excluded.
- Bucket settings read from the source `storage.buckets` (public flag, `file_size_limit`, `allowed_mime_types`; the repo history shows it started public and was made private, so the live value is read, not assumed). The target bucket is created with the same settings through the Storage API, no policies. If it already exists with different settings the step is refused.
- Per object:
  - not in target → download from source, compute SHA-256, upload to the **same path** with the same content type, `upsert` off;
  - in target with the same size and etag → skipped;
  - in target otherwise → target downloaded and SHA-256 compared: equal → skipped, different → reported as failed (**never overwritten**).
- A failure on one object is logged and the step continues, then exits `1` with the list of failed paths.
- `out/photo-manifest.tsv` records path, size and source SHA-256.
- Paths follow the app's convention `{memberId}/original-{timestamp}.jpg` and `{memberId}/thumbnail-{timestamp}.jpg`; the same path is kept so `members.photo_url` / `photo_thumbnail_url` stay valid unchanged.

### Reset (`--reset --confirm-target <target-ref>`)
Refused unless `<target-ref>` equals the target project ref, so a mistyped flag cannot wipe the real new project. Then, in the target only:
1. `DROP SCHEMA TARGET_SCHEMA CASCADE`.
2. Delete `auth.users` rows whose ids are in the source; their identities cascade.
3. Delete bucket objects whose paths are in the source list, then the bucket if it is empty.

Users, objects and schemas that did not come from the source are left alone.

### Validate (`--validate`)
Read-only against both databases (target sessions are read-only too) and, for photos, both Storage APIs. Every session pins `TimeZone = 'UTC'`, `DateStyle = 'ISO, YMD'`, `IntervalStyle = 'postgres'` and `extra_float_digits = 3`, so text forms are identical whatever the client's `PGTZ` / `PGDATESTYLE`. Prints one line per check, a summary, and exits per section 5.

## 7. What "migrated successfully" means (the validation checks)

| Check id | Check | How |
|---|---|---|
| `structure` | Structure | `information_schema` / `pg_catalog` comparison of source `public` vs target `fitfine` for the 11 tables: columns, types, nullability, defaults, identity flags, generated flags; PK / FK / CHECK / unique constraints and indexes by name and definition. Definitions are compared after removing the `public.` / `fitfine.` prefix on both sides. Anything present on only one side, or different, fails. `auth.users` / `auth.identities` columns are compared too; a target-only column is a warning. |
| `nothing-extra` | Nothing extra | `fitfine` contains exactly the 11 tables (and their identity sequences): no triggers, policies, functions, views, other tables or types. |
| `counts` | Row counts | `count(*)` per table equal, and the split active (`deleted_at is null`) vs soft-deleted equal for every table that has `deleted_at`; `auth.users` and `auth.identities` counts equal. |
| `content` | Content | Per table: the md5 of each row is computed from the **explicit, identical column list** (each value's text form, with NULL encoded distinctly from an empty string), the row hashes are sorted and hashed again. Equal on both sides. Covers audit columns and every timestamp to the microsecond. |
| `auth` | Auth | Same content checksum for `auth.users` and `auth.identities` over the copied columns (ids, emails, `encrypted_password`, confirmation times, metadata, `provider_id`s); every `profiles.id` present in `auth.users`. |
| `identity-seq` | Identity sequences | For each identity column, the sequence's `last_value` = `max(id)` with `is_called` true; for an empty table it is still at the start value. |
| `fk` | Referential integrity | Every FK of the source exists on the target and is `convalidated`; zero orphans by explicit anti-join per FK column (including `profiles.created_by` and `members.handled_by_staff`). |
| `anchors` | Business anchors | `member_number` values identical; `member_number_sequences` rows identical; `configuration` keys and values identical; active vs deleted counts of members, plans and branches equal. |
| `source-unchanged` | Source unchanged | The fingerprint recomputed on the source equals `out/source-fingerprint.json`. A difference means the app was used after the load: exit `3`, re-run with `--reset`. |
| `photo-files` | Photo files | Object count and total bytes equal; per path, size and SHA-256 of the bytes downloaded from **both** sides equal (every file, every run). |
| `bucket-settings` | Bucket settings | Target bucket public flag, size limit and allowed mime types equal the source's. |
| `photo-linkage` | Photo linkage | Every non-null `members.photo_url` and `photo_thumbnail_url` in the target resolves to an existing object in the target bucket; the path's first segment equals the owning member's `id`; each member with an original also has a thumbnail (or both were absent in the source). |
| `photo-orphans` | Photo orphans | Objects in the target bucket that no member references, and member paths with no object, must be **identical to the same lists computed on the source**. One that already existed in the source is a warning ("pre-existing"); a new one fails. |
| `photo-access` | Photo access | A signed URL from the target Storage API for **every** referenced photo returns HTTP 200 with an `image/*` content type. |

`audit_log` has no check of its own: it is verified by `counts` and `content` like every other table, and called out only if those fail.

## 8. Test suite (proves the script, not the data)

Rule: **every check in section 7 has a clean pass and at least one sabotage that must fail with that check id; every safety rule has a refusal test; every step's re-run behaviour is tested.** A check without a red test does not count as built.

How it runs:
- `tests/unit.sh` has no database. `tests/run-all.sh` runs the whole suite against the **scratch** target, with the real source read-only.
- `run-all.sh` refuses to start unless `MIG_TEST_TARGET_REF` is set and equals the target ref, so sabotage can never run against the real new project.
- Each sabotage test:
  1. confirms a green baseline;
  2. applies the sabotage directly on the target;
  3. runs `--validate` and asserts exit `1`, a `FAIL` line with the expected check id and path or table, and no `FAIL` outside that test's listed check ids;
  4. undoes the sabotage (or, where there is no exact undo, runs `--reset --confirm-target` + `--all`) and asserts green again.
- One test hook exists, `MIG_TEST_FAIL_AT=post-data`. It raises an error just before the load commits and is inert unless set.
- The suite prints one `PASS`/`FAIL` line per test id. Its full output is pasted verbatim into the README's "Last verified" section.

### 8.1 Unit (`tests/unit.sh`, no database)

| Id | Asserts |
|---|---|
| U1 | Version comparison: 15 < 17, 17 = 17, 17.11 vs 17.4, 18 > 17 |
| U2 | Ref parsing from direct URL, session-pooler URL (`postgres.<ref>` user), Supabase URL; unknown shape → error |
| U3 | Port 6543 detected as transaction pooler; 5432 on both host shapes accepted |
| U4 | Schema-prefix normalisation used by `structure` (`public.x` and `fitfine.x` compare equal; `auth.uid()` untouched) |
| U5 | Column-list comparison rules: identical → ok; source-only → stop; target-only nullable or with default → allowed (auth only); target-only NOT NULL without default → stop; any difference on the 11 tables → stop |
| U6 | `FAIL` line format and exit-code mapping |
| U7 | Env file parsing: comments, quotes, inline comments, `export` prefix, URL values intact, a shell value wins over the file |
| U8 | `TARGET_SCHEMA` allow-list: plain lowercase names only; `public`, `auth`, `storage`, other Supabase/system schemas and `pg_*` refused (it is dropped with `CASCADE` by `--reset`) |

### 8.2 Preflight and safety (each must stop before changing anything; target object list compared before/after)

| Id | Setup | Expected |
|---|---|---|
| P0 | No step, an unknown argument, `--help`; and a clean `--preflight` against the real source + scratch target | exit 2 / 2 / 0; clean run exit 0, "preflight ok" |
| P1 | One required variable unset | exit 2, names the variable |
| P2 | `TARGET_DB_URL` = `SOURCE_DB_URL` | exit 2, "same project" |
| P3 | Target = source's session-pooler URL (same project, different spelling) | exit 2, "same project" |
| P4 | `TARGET_SUPABASE_URL` ref ≠ `TARGET_DB_URL` ref | exit 2, names the side |
| P5 | Port 6543 | exit 2, "transaction pooler" |
| P6 | Unreachable host | exit 2, names the side |
| P7 | `pg_dump` stub on `PATH` reporting an older major than the source (14) | exit 2, found and needed versions |
| P8 | Source session write probe (`create temp table`) through the source wrapper | the database refuses it (read-only) |
| P9 | `--create` with `fitfine` present | exit 2 |
| P10 | `--reset` without `--confirm-target`, and with a wrong ref | exit 2, nothing dropped |
| P11 | Target has a user (made with the admin API) with a source user's email and a different id | exit 2, both ids printed |
| P12 | `TARGET_SCHEMA` set to `public` / `auth` | exit 2 before connecting |

Every P test that prints a message also asserts that no password or key appears in the output.

### 8.3 Step behaviour

| Id | Asserts |
|---|---|
| S1 | `--create` on an empty target: exactly the 11 tables, no keys yet, target `public` object list unchanged |
| S2 | `--load`: completes, `counts` ok; `auth.users.confirmed_at` was not in the copy list yet is populated (generated) |
| S3 | `--load` a second time: refused, nothing written |
| S4 | `MIG_TEST_FAIL_AT=post-data --load`: exit 1, and afterwards zero rows in all 11 tables, no FKs, no source user ids in target `auth.users` |
| S5 | An extra NOT NULL column added to `fitfine.members` before `--load`: stops with a column mismatch naming the table, nothing written |
| S6 | `--photos`: count and bytes equal; second run copies 0 files, 0 failures |
| S7 | One source path pre-uploaded to the target with different bytes: that path reported failed, all others copied, exit 1, the pre-uploaded file unchanged |
| S8 | Target bucket pre-created with different settings: `--photos` refused |
| S9 | `--reset --confirm-target <ref>` with a non-source user and a non-source object in the target: schema, source users and source objects gone; the non-source user and object still there; then `--all` green |
| S10 | `--validate` changes nothing: target and source fingerprints (and target object list) identical before and after |
| S11 | `PGTZ=Asia/Kolkata PGDATESTYLE=German --validate`: green (checksums independent of client settings) |
| S12 | `--all` from an empty target: green end to end |

### 8.4 Validator sabotage (each must fail with the check id shown; secondary ids that may also fire are in brackets)

| Id | Sabotage on the target | Must fail |
|---|---|---|
| V1 | Drop column `members.occupation` | `structure` [`content`] |
| V2 | Drop a CHECK constraint (`plans.price >= 0`) | `structure` |
| V3 | Change a default (`payment_mode` default) | `structure` |
| V4 | Drop one index | `structure` |
| V5 | Create a view, then (separately) a trigger function + trigger in `fitfine` | `nothing-extra` |
| V6 | Delete one `subscription_items` row | `counts` [`content`, `fk`] |
| V7 | Set `deleted_at` on one active plan | `counts` [`content`, `anchors`] |
| V8 | Change one member's `name` | `content` |
| V9 | Add 1 microsecond to one `changed_at` | `content` |
| V10 | Set a NULL `notes` to `''` | `content` |
| V11 | Change one `auth.users.encrypted_password` | `auth` |
| V12 | Delete one `auth.identities` row | `auth` [`counts`] |
| V13 | `setval` an identity sequence below `max(id)` | `identity-seq` |
| V14 | Drop the FK `subscriptions.member_id`, insert an orphan subscription | `fk` [`structure`, `counts`, `content`] |
| V15 | Change one `member_number` | `anchors` [`content`] |
| V16 | Change one `configuration` value | `anchors` [`content`] |
| V17 | Delete one `audit_log` row | `counts` [`content`] on `audit_log` |
| V18 | Edit one count in `out/source-fingerprint.json` (simulates a changed source; the source itself is never written) | `source-unchanged`, exit 3 |
| V19 | Delete one photo file in the target | `photo-files`, `photo-access` [`photo-linkage`, `photo-orphans`] |
| V20 | Replace one target photo with different bytes of the **same size** | `photo-files` (proves SHA-256, not size/etag) |
| V21 | Make the target bucket public | `bucket-settings` |
| V22 | Point one `photo_url` at a missing path | `photo-linkage` [`content`, `photo-access`, `photo-orphans`] |
| V23 | Point one member's `photo_url` at **another member's** existing file | `photo-linkage` [`content`, `photo-orphans`] |
| V24 | Null one `photo_thumbnail_url` (original kept) | `photo-linkage` [`content`, `photo-orphans`] |
| V25 | Upload one unreferenced file to the target bucket | `photo-orphans` (as new, FAIL — not a warning) [`photo-files`] |
| V26 | Upload a `text/plain` file at `{memberId}/original-test.jpg` and point that member's `photo_url` at it | `photo-access` (wrong content type) [`content`, `photo-files`, `photo-orphans`]. If the bucket's allowed mime types reject the upload, V26 passes as "blocked by the bucket" and the rejection is recorded |

## 9. Risks specific to Phase 1

| Risk | Effect | Mitigation |
|---|---|---|
| Hosted `postgres` role cannot write `auth.users` / `auth.identities` | The load stops at the first table | This is exactly what Phase 1 must find out; the failure message is surfaced, and the fallback (re-invite users) is recorded as a Phase 2 decision |
| `auth` columns differ between the two GoTrue versions | Silent loss or hard failure | Column lists from both sides with the rules in section 6; generated columns excluded; `structure` compares the `auth` tables too |
| Generated columns (`auth.users.confirmed_at`, `auth.identities.email`) | `COPY` fails | `is_generated = 'NEVER'` column lists; S2 |
| Source and target mistaken for each other | Real data overwritten | Ref and server-identity refusal, read-only source sessions, writes limited to source-derived rows; P2–P4, P8 |
| `--reset` run against the real new project by mistake | Migrated project wiped | `--confirm-target <ref>` required; only source-derived rows/objects removed; P10, S9 |
| Non-deferrable FKs, `profiles` self-references | Load fails on order | Keys and FKs added after the load (D8) |
| Partial load left behind | Misleading "migrated" state | Single transaction; S4 |
| Source used during or after the load | Inconsistent copy, or a false FAIL | One repeatable-read snapshot; `source-unchanged` check; V18 |
| Client time zone / date style differ | False checksum failures | Session settings pinned in every validate session; S11 |
| Direct connection IPv6-only | Cannot connect from here | Session pooler accepted; only 6543 refused |
| `pg_dump` 17.x output (`SET transaction_timeout`, `\restrict` lines) | DDL fails on an older target, noisy committed file | Stripped when the SQL files are produced; target ≥ source version checked |
| Photo upload fails midway (network, size limit, mime restriction on the new bucket) | Members whose paths dangle | Bucket created with the source's exact settings; per-object failures listed; `photo-linkage` fails on any new dangling path; S7 |
| Multipart etags differ after re-upload | False FAIL or false skip | SHA-256 is the equality test (D9); V20 |
| Orphan photo files already exist in the source (half-failed uploads, deleted members) | Noise in the report | Compared against the source's own orphan list: pre-existing ones are warnings, new ones fail; V25 |
| Free-tier limits on the scratch project (500 MB DB, 1 GB storage) | Load or copy fails for size, not for a bug | Sizes logged in preflight before anything is written |
| Service-role keys in the env file | Secret exposure | File is git-ignored and used only by this script; keys can instead be supplied from the shell (section 4) |
