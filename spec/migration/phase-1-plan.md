# Phase 1 — Execution Plan

For review. The **what and why** are in [phase-1-dedicated-schema.md](phase-1-dedicated-schema.md): scope, decisions, how each step works (§6), the validation checks (§7), the test suite (§8) and the risks. This file is the **only** place task IDs live: small tasks, what each one produces, which tests close it, and where you review before the next step.

## 1. In one paragraph

Build a bash script, `scripts/migrate-to-fitfine/`, that (1) creates schema `fitfine` with the 11 tables and nothing else in the new database, (2) copies every row, every auth user and every member photo from the current project, and (3) validates the result. It reads all connection details from an env file. A test suite proves every check catches what it is meant to catch and every safety rule refuses what it must refuse. The script is proven on a scratch project, then run on the real new project. The app, `supabase/migrations/` and the old project are never changed.

## 2. Ground rules

- Work on a branch, `schema-migration`. Nothing merges to `master` until you have reviewed the report from the real run.
- One commit per task, so each can be reviewed or reverted alone.
- The source project is read-only for the whole phase.
- **Each task ships its tests in the same commit** (spec §8 ids listed per task). A validation check without its red test is not done.
- Nothing is called done without the task's tests passing. Failures are reported with the actual output, never summarised as passing.
- Phase 1 adds no app code, so no Vitest or Playwright tests; the script's own suite (spec §8) replaces them.

## 3. Environment as found

| Item | State | Effect on the plan |
|---|---|---|
| `psql` / `pg_dump` 17.11, `curl`, `jq`, `shasum` | installed | enough for the whole script and its tests |
| Docker, local Supabase stack | **not installed** | no local Supabase; a real scratch project is the test target |
| Local Postgres server | **not running** | `supabase/tests/run.sh` cannot run here, so MIG-1.1 dumps the structure **directly from the source database** (a read-only `pg_dump`) instead of rebuilding it from the 21 migrations |
| Direct DB host is IPv6-only | depends on the network here | the session pooler URL (port 5432) is accepted; only the transaction pooler (6543) is refused |

## 4. Inputs needed, and when

| When | What |
|---|---|
| Before MIG-1.1 | In `scripts/migrate-to-fitfine/.env`: the source DB URL (read-only use), and a **scratch Supabase project** (free tier is fine) as the target DB URL. The scratch project is created by you, never by the script or by me; MIG-1.1 applies the DDL to it and every later task tests against it |
| Before MIG-1.6a | Source and scratch Supabase URLs and service-role keys in the same file |
| Before MIG-1.8 | The real new project's values replace the scratch ones in that file |

Claude never reads or prints the contents of `.env`; the script loads it.

## 5. Tasks

Size: **S** under an hour, **M** a few hours, **L** most of a day. Test ids refer to spec §8.

### Stage A — Structure (no data touched)

**MIG-1.1 — Table DDL from the real schema** · S
- Read-only `pg_dump --schema-only --no-owner --no-privileges --table=public.<each of the 11>` from the source, once with `--section=pre-data` and once with `--section=post-data`.
- Convert them to `sql/01-pre-data.sql` and `sql/02-post-data.sql`:
  - qualify everything with `fitfine`;
  - keep tables, defaults, NOT NULL, CHECK and identity columns in pre-data, and keys and indexes in post-data;
  - remove triggers, policies, functions, views, RLS statements, grants and the bucket row;
  - strip `SET transaction_timeout` and the `\restrict` / `\unrestrict` lines.
- Write `sql/tables.txt`.
- *Check:* both files apply in order to the scratch target with no errors and create exactly the 11 tables; a case-insensitive grep for `trigger`, `policy`, `function`, `view`, `grant`, `\restrict`, `transaction_timeout` returns nothing; then the scratch schema is dropped again.

**MIG-1.2 — Script skeleton, safety, unit tests** · M
- `run.sh`, `lib/common.sh`, `.env.example`, `README.md` (stub), `tests/unit.sh`, `tests/run-all.sh` (with the `MIG_TEST_TARGET_REF` guard).
- Flags parsed: `--create --load --photos --validate --all --reset --confirm-target`. Exit codes and the `FAIL` line format per spec §5.
- Preflight per spec §6.
- Add `scripts/migrate-to-fitfine/out/` to `.gitignore`.
- Add the one-line service-role note to CLAUDE.md.
- *Tests:* U1–U4, U6, P1–P8.

**MIG-1.3 — Create and reset (`--create`, `--reset`)** · S
- `--create` applies `01-pre-data.sql` in one transaction.
- `--reset --confirm-target` per spec §6. Its auth and photo parts have nothing to delete yet; they are exercised again in MIG-1.7.
- *Tests:* S1, P9, P10.

> **Review gate A:** you read `sql/01-pre-data.sql`, `sql/02-post-data.sql` and the preflight/unit test output before any data moves.

### Stage B — Data

**MIG-1.4a — Source snapshot, column lists, the 11 tables** · M
- `lib/columns.sh` (generated columns excluded, cross-side comparison rules).
- One-snapshot source read to a temp dir, plus `out/source-fingerprint.json`.
- One target transaction: `COPY` the 11 tables, apply `02-post-data.sql`, `setval` the identity sequences, commit. Load refused if rows exist.
- The `MIG_TEST_FAIL_AT=post-data` hook.
- *Tests:* U5, S3, S4, S5.

**MIG-1.4b — Auth users and identities** · M
- `auth.users` then `auth.identities`, at the start of the same transaction and from the same snapshot. Uses the auth column rules from spec §6, and the preflight conflict check P11.
- If the hosted `postgres` role cannot write `auth`, the run stops with the database's own error and that finding goes into the report as a Phase 2 input. Stage B stops there until you decide.
- *Tests:* S2, P11; S4 re-run to confirm no source user ids remain after the forced failure.

**MIG-1.5 — Validate the data (`--validate`, database checks)** · L
- `validate/` files for `structure`, `nothing-extra`, `counts`, `content`, `auth`, `identity-seq`, `fk`, `anchors`, `source-unchanged`, with the pinned session settings.
- *Tests:* green clean run, V1–V18, S10 (database part), S11.

> **Review gate B:** you read the data validation report and the test output for V1–V18. Photos have not been touched yet.

### Stage C — Photos

**MIG-1.6a — Bucket and file copy (`--photos`)** · M
- `lib/storage.sh`.
- Copy per spec §6: bucket settings from the source, refusal when an existing bucket differs, skip/compare/never overwrite, `out/photo-manifest.tsv`, failures listed with exit 1.
- *Tests:* S6, S7, S8.

**MIG-1.6b — Validate photos** · M
- `validate/photos.sh`: `photo-files` (SHA-256 of both sides, every file), `bucket-settings`, `photo-linkage`, `photo-orphans`, `photo-access` (every referenced photo).
- *Tests:* green clean run, V19–V26, S10 (photo part).

> **Review gate C:** you read the photo section of the report, including every warning, and the V19–V26 output.

### Stage D — Prove it, then run it for real

**MIG-1.7 — Full suite on a fresh scratch target** · M
- Start from an empty scratch target and run `tests/run-all.sh`: every U, P, S and V test in spec §8 in one go, including S9 (reset with a non-source user and object present) and S12 (`--all` end to end).
- End with `--reset --confirm-target` + `--all` + `--validate` green.
- Write the suite's verbatim output into `README.md` under "Last verified".
- *Check:* every test id `PASS`; nothing skipped. A V26 "blocked by the bucket" result counts as a pass and is listed as such.

**MIG-1.8 — Real run** · S
- Switch the target values in `.env` to the real new project and run `--all` once, then `--validate` again on its own as the final proof.
- The test suite does **not** run here (its ref guard refuses it).
- *Check:* fully green report. Any `FAIL` is either fixed in the script (with a new test that reproduces it on scratch first) and rerun, or recorded as a Phase 2 input; nothing is waved through.

> **Review gate D (end of Phase 1):** you read the final report. That is the sign-off before any Phase 2 work starts.

## 6. Order and dependencies

```
MIG-1.1 ─┐
MIG-1.2 ─┴─> MIG-1.3 ─> [A] ─> MIG-1.4a ─> MIG-1.4b ─> MIG-1.5 ─> [B] ─┐
                         │                                            ├─> MIG-1.7 ─> MIG-1.8 ─> [D]
                         └──> MIG-1.6a ─> MIG-1.6b ─> [C] ────────────┘
```

MIG-1.1 and MIG-1.2 are independent of each other. MIG-1.6a only needs the preflight and storage keys, so it can be built in parallel with Stage B; MIG-1.6b's linkage checks need loaded members, so it runs after MIG-1.4a/b.

## 7. Decisions applied

1. **Service-role keys** live in the git-ignored `scripts/migrate-to-fitfine/.env`, used only by this script. A variable already set in the shell takes precedence over the file, so a key can be kept out of the file by exporting it instead. The CLAUDE.md "no service-role key in env files" rule is about the app and its tests; MIG-1.2 adds a one-line note to CLAUDE.md saying the migration script's own env file is the only exception.
2. **Scratch target** is a real scratch Supabase project, needed from MIG-1.1. Sabotage tests never run against the real new project: `tests/run-all.sh` refuses unless `MIG_TEST_TARGET_REF` matches the target.
3. **Versions** are preflight checks: `pg_dump` major ≥ source major, and target server major ≥ source major. Otherwise the script stops with the versions it found and the ones needed.
4. **Connections:** direct or session pooler, never the transaction pooler (6543).
5. **Keys after data:** FKs, PKs and indexes are added after the rows are loaded, in the same transaction (spec D8).

## 8. Checklist

- [ ] MIG-1.1 Pre-data / post-data DDL from the real schema
- [ ] MIG-1.2 Skeleton, preflight, unit tests (U1–U4, U6, P1–P8)
- [ ] MIG-1.3 `--create` / `--reset` (S1, P9, P10)
- [ ] MIG-1.4a Snapshot, column lists, 11 tables in one transaction (U5, S3–S5)
- [ ] MIG-1.4b Auth users and identities (S2, P11)
- [ ] MIG-1.5 Database validation (V1–V18, S10, S11)
- [ ] MIG-1.6a Photo copy (S6–S8)
- [ ] MIG-1.6b Photo validation (V19–V26, S10)
- [ ] MIG-1.7 Full suite green on a fresh scratch target, README "Last verified"
- [ ] MIG-1.8 Real run, report fully green
