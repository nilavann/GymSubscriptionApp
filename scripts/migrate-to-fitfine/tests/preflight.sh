#!/usr/bin/env bash
# Preflight and safety tests (spec section 8.2): every case must refuse with exit 2 before
# anything is written, naming the cause. Offline cases use fake URLs and need no database;
# --online adds the cases that need the real source and the scratch target (run by run-all.sh).
set -u
. "$(dirname "$0")/lib.sh"

online=0
[ "${1-}" = --online ] && online=1

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
SECRET=s3cretPW
A=aaaaaaaaaaaaaaaaaaaa
B=bbbbbbbbbbbbbbbbbbbb
SRC="postgresql://postgres:$SECRET@db.$A.supabase.co:5432/postgres"
TGT="postgresql://postgres:$SECRET@db.$B.supabase.co:5432/postgres"
fake=$tmp/fake.env
cat >"$fake" <<EOF
SOURCE_DB_URL=$SRC
TARGET_DB_URL=$TGT
TARGET_SCHEMA=fitfine
SOURCE_SUPABASE_URL=https://$A.supabase.co
SOURCE_SERVICE_ROLE_KEY=$SECRET
TARGET_SUPABASE_URL=https://$B.supabase.co
TARGET_SERVICE_ROLE_KEY=$SECRET
PHOTO_BUCKET=member-photos
EOF

# Every message names hosts, never a password or key.
no_secret() {
  if printf '%s' "$T_OUT" | grep -q "$SECRET"; then t_bad "$1 no secret in output" "$T_OUT"; else t_ok "$1 no secret in output"; fi
}

# --- argument handling ----------------------------------------------------------------------
expect_run "P0 no step given"         2 'REFUSED no step given'      mig_run "$fake" --
expect_run "P0 unknown argument"      2 'REFUSED unknown argument: --bogus' mig_run "$fake" -- --bogus
expect_run "P0 --help"                0 'Usage: run.sh'              mig_run "$fake" -- --help

# --- offline: refused before any connection -------------------------------------------------
expect_run "P1 missing TARGET_DB_URL" 2 'missing required variable\(s\): TARGET_DB_URL$' \
  mig_run "$fake" TARGET_DB_URL= -- --preflight
expect_run "P1 missing several, all named" 2 'missing required variable\(s\): SOURCE_DB_URL TARGET_SCHEMA$' \
  mig_run "$fake" SOURCE_DB_URL= TARGET_SCHEMA= -- --preflight
expect_run "P1 storage vars needed by --validate" 2 'missing required variable\(s\): TARGET_SERVICE_ROLE_KEY$' \
  mig_run "$fake" TARGET_SERVICE_ROLE_KEY= -- --validate
expect_run "P1 storage vars not needed by --preflight" 2 'source database unreachable' \
  mig_run "$fake" TARGET_SERVICE_ROLE_KEY= SOURCE_DB_URL="postgresql://postgres:$SECRET@db.$A.supabase.co:1/postgres" -- --preflight
no_secret P1

expect_run "P2 identical URLs" 2 "same project \($A\)" mig_run "$fake" TARGET_DB_URL="$SRC" -- --preflight
expect_run "P3 same project via session pooler" 2 "same project \($A\)" \
  mig_run "$fake" TARGET_DB_URL="postgresql://postgres.$A:$SECRET@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" -- --preflight
expect_run "P4 target API ref differs from DB ref" 2 "target: Supabase URL ref c+ differs from its DB URL ref $B" \
  mig_run "$fake" TARGET_SUPABASE_URL=https://cccccccccccccccccccc.supabase.co -- --preflight
expect_run "P4 source API ref differs from DB ref" 2 "source: Supabase URL ref $B differs from its DB URL ref $A" \
  mig_run "$fake" SOURCE_SUPABASE_URL=https://$B.supabase.co -- --preflight
expect_run "P5 transaction pooler refused" 2 'target: .*transaction pooler \(port 6543\)' \
  mig_run "$fake" TARGET_DB_URL="postgresql://postgres.$B:$SECRET@aws-0-ap-south-1.pooler.supabase.com:6543/postgres" -- --preflight
no_secret P5
expect_run "P5 non-Supabase URL refused" 2 'source: postgres@localhost:5432/postgres is not a Supabase' \
  mig_run "$fake" SOURCE_DB_URL="postgresql://postgres:$SECRET@localhost:5432/postgres" -- --preflight
expect_run "P5 malformed URL named, not echoed" 2 "source: SOURCE_DB_URL is not a postgresql://.*\\(starts with 'postgresql:postgresql:'" \
  mig_run "$fake" SOURCE_DB_URL="postgresql:$SRC" -- --preflight
no_secret "P5 malformed"
expect_run "P6 unreachable source" 2 "source database unreachable \(postgres@db.$A.supabase.co:1/postgres\)" \
  mig_run "$fake" SOURCE_DB_URL="postgresql://postgres:$SECRET@db.$A.supabase.co:1/postgres" -- --preflight
no_secret P6
expect_run "P12 TARGET_SCHEMA=public refused" 2 "TARGET_SCHEMA 'public' is not allowed" \
  mig_run "$fake" TARGET_SCHEMA=public -- --preflight
expect_run "P12 TARGET_SCHEMA=auth refused" 2 "TARGET_SCHEMA 'auth' is not allowed" \
  mig_run "$fake" TARGET_SCHEMA=auth -- --preflight

if [ $online = 0 ]; then
  printf 'note: P0 clean run, P6 target side, P7, P8 need the databases: run tests/run-all.sh\n'
  t_summary "preflight (offline)"; exit
fi

# --- online: real source (read-only) and the scratch target ---------------------------------
real=${MIG_ENV_FILE:-$MIG_DIR/.env}
load_env "$real"
SECRET=${TARGET_SERVICE_ROLE_KEY:-$SECRET}

expect_run "P0 clean preflight passes" 0 'preflight ok' mig_run "$real" -- --preflight
no_secret P0

parse_db_url "$TARGET_DB_URL"
bad_tgt="postgresql://$DBU_USER:x@$DBU_HOST:1/$DBU_DB"
expect_run "P6 unreachable target" 2 'target database unreachable' mig_run "$real" TARGET_DB_URL="$bad_tgt" -- --preflight

mkdir -p "$tmp/bin"
printf '#!/bin/sh\necho "pg_dump (PostgreSQL) 14.9"\n' >"$tmp/bin/pg_dump"; chmod +x "$tmp/bin/pg_dump"
expect_run "P7 pg_dump older than source" 2 'pg_dump 14.9 is older than the source server \(PostgreSQL [0-9.]+\); install pg_dump [0-9]+ or newer' \
  env PATH="$tmp/bin:$PATH" bash -c '. "$1/tests/lib.sh"; mig_run "$2" -- --preflight' _ "$MIG_DIR" "$real"

expect_run "P8 source session refuses writes" nonzero 'read-only transaction' \
  bash -c '. "$1/lib/common.sh"; load_env "$2"; psql_source -c "create temp table _mig_ro_probe (x int)"' _ "$MIG_DIR" "$real"

t_summary "preflight (online)"
