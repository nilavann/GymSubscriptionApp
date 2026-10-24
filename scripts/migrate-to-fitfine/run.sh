#!/usr/bin/env bash
# Phase 1 migration: creates TARGET_SCHEMA with the 11 tables in the new Supabase project, copies
# every row, auth user and member photo into it, and validates the result.
# Spec: spec/migration/phase-1-dedicated-schema.md. Usage: ./run.sh --help
set -euo pipefail
MIG_DIR=$(cd "$(dirname "$0")" && pwd)
. "$MIG_DIR/lib/common.sh"

usage() {
  cat <<'EOF'
Usage: run.sh [steps] [options]

Steps (any combination, always run in this order):
  --preflight              checks only, writes nothing (also runs before every other step)
  --reset --confirm-target <target-ref>
                           remove everything a previous run put in the target
  --create                 create TARGET_SCHEMA and the 11 tables (no keys yet)
  --load                   copy auth users + the 11 tables, then add keys, FKs and indexes
  --photos                 create the bucket and copy every photo
  --validate               read-only checks of target against source
  --all                    = --create --load --photos --validate

Exit codes: 0 ok, 1 a check or step failed, 2 refused (nothing done), 3 source changed since load.
Connection details come from .env next to this script (MIG_ENV_FILE overrides the path);
a variable already set in the shell wins over the file.
EOF
}

do_preflight=0 do_reset=0 do_create=0 do_load=0 do_photos=0 do_validate=0 confirm_target=''
while [ $# -gt 0 ]; do
  case $1 in
    --preflight) do_preflight=1 ;;
    --reset)     do_reset=1 ;;
    --confirm-target)
      [ $# -ge 2 ] || refuse "--confirm-target needs the target project ref"
      confirm_target=$2; shift ;;
    --create)    do_create=1 ;;
    --load)      do_load=1 ;;
    --photos)    do_photos=1 ;;
    --validate)  do_validate=1 ;;
    --all)       do_create=1 do_load=1 do_photos=1 do_validate=1 ;;
    -h|--help)   usage; exit "$EXIT_OK" ;;
    *)           usage >&2; refuse "unknown argument: $1" ;;
  esac
  shift
done
[ $((do_preflight + do_reset + do_create + do_load + do_photos + do_validate)) -gt 0 ] ||
  { usage >&2; refuse "no step given"; }
if [ $do_reset = 1 ] && [ -z "$confirm_target" ]; then
  refuse "--reset needs --confirm-target <target-ref>"
fi

load_env "${MIG_ENV_FILE:-$MIG_DIR/.env}"
need_storage=0
if [ $do_photos = 1 ] || [ $do_validate = 1 ]; then need_storage=1; fi
preflight "$need_storage"

not_yet() { refuse "step $1 is not implemented yet ($2)"; }
[ $do_reset = 0 ]    || not_yet --reset MIG-1.3
[ $do_create = 0 ]   || not_yet --create MIG-1.3
[ $do_load = 0 ]     || not_yet --load MIG-1.4
[ $do_photos = 0 ]   || not_yet --photos MIG-1.6a
[ $do_validate = 0 ] || not_yet --validate MIG-1.5
exit "$EXIT_OK"
