#!/usr/bin/env bash
# The whole Phase 1 test suite (spec section 8) against the scratch target, real source read-only.
# Refuses unless MIG_TEST_TARGET_REF equals the target ref, so sabotage can never reach the real
# new project.
set -u
. "$(dirname "$0")/lib.sh"

load_env "${MIG_ENV_FILE:-$MIG_DIR/.env}"
require_vars TARGET_DB_URL MIG_TEST_TARGET_REF
ref=$(db_url_ref "$TARGET_DB_URL") || refuse "TARGET_DB_URL is not a Supabase URL"
[ "$ref" = "$MIG_TEST_TARGET_REF" ] ||
  refuse "target $ref is not the scratch project named by MIG_TEST_TARGET_REF; the suite only runs against the scratch target"

rc=0
suite() {
  printf '== %s\n' "$*"
  "$MIG_DIR/tests/$@" || rc=1
}
suite unit.sh
suite preflight.sh --online
suite ddl.sh
suite create.sh
suite load.sh

[ $rc = 0 ] && echo "ALL MIGRATION TESTS PASSED" || echo "MIGRATION TESTS FAILED"
exit $rc
