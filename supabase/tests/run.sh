#!/usr/bin/env bash
# Builds a throwaway Postgres database from the real migrations and runs every tests/*.test.sql.
# Usage: supabase/tests/run.sh   (needs psql + a reachable Postgres superuser; see PGHOST/PGUSER/PGPORT)
set -euo pipefail
cd "$(dirname "$0")"
DB=${TEST_DB:-gym_subscription_test}
PSQL="psql -X -q -v ON_ERROR_STOP=1"

dropdb --if-exists "$DB" >/dev/null
createdb "$DB"
PGOPTIONS='--client-min-messages=warning' $PSQL -d "$DB" -f 00_supabase_stubs.sql
for f in ../migrations/*.sql; do PGOPTIONS='--client-min-messages=warning' $PSQL -d "$DB" -f "$f"; done
$PSQL -d "$DB" -f 01_test_framework.sql

fail=0
for t in *.test.sql; do
  echo "== $t"
  raw=$(mktemp)
  if ! PGOPTIONS='--client-min-messages=notice' $PSQL -d "$DB" -At -f "$t" >"$raw" 2>&1; then
    grep -vE '^(NOTICE|psql:.*NOTICE)' "$raw" | grep -v '^$' || true
    echo "!! $t aborted with a SQL error"; fail=1
  fi
  sed -E 's/^psql:[^ ]* NOTICE:  //;s/^NOTICE:  //' "$raw" | grep -E '^(ok|not ok|known-gap)' >"$raw.res" || true
  cat "$raw.res"
  if grep -q '^not ok' "$raw.res"; then fail=1; fi
  rm -f "$raw.res"
  rm -f "$raw"
done
echo "== 50_concurrency.sh"
./50_concurrency.sh "$DB" || { echo "!! 50_concurrency.sh failed"; fail=1; }
dropdb "$DB"
[ "$fail" = 0 ] && echo "ALL DB TESTS PASSED" || { echo "DB TESTS FAILED"; exit 1; }
