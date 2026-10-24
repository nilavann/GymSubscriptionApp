# migrate-to-fitfine

Phase 1 migration script: creates schema `fitfine` with the 11 tables in the new Supabase project, copies every row, auth user and member photo into it, and validates the result. What it does and why: [spec/migration/phase-1-dedicated-schema.md](../../spec/migration/phase-1-dedicated-schema.md). Task order: [spec/migration/phase-1-plan.md](../../spec/migration/phase-1-plan.md).

Status: MIG-1.2 (skeleton, preflight, unit tests). The steps are filled in by later tasks.

## Setup

```bash
cp .env.example .env     # git-ignored; fill in the values
./run.sh --preflight     # checks only, writes nothing
./run.sh --help
```

Requires bash (3.2 is enough), `psql` / `pg_dump` at least the source's major version, `curl`, `jq`, `shasum`.

## Tests

```bash
tests/unit.sh            # no database needed
tests/preflight.sh       # offline refusal tests; --online adds the ones that need the databases
tests/run-all.sh         # whole suite against the scratch target (MIG_TEST_TARGET_REF must equal the target ref)
```

## Last verified

Not run yet (filled in by MIG-1.7).
