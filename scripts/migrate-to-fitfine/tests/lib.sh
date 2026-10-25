# Test helpers, sourced by every tests/*.sh. Prints one "PASS <id>" / "FAIL <id>" line per
# assertion; ids are the spec's test ids (spec/migration/phase-1-dedicated-schema.md section 8).

MIG_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$MIG_DIR/lib/common.sh"

T_PASS=0
T_FAIL=0
T_OUT=''

t_ok()  { T_PASS=$((T_PASS + 1)); printf 'PASS %s\n' "$1"; }
t_bad() {
  T_FAIL=$((T_FAIL + 1)); printf 'FAIL %s\n' "$1"
  [ -z "${2-}" ] || printf '%s\n' "$2" | sed 's/^/       | /'
}

assert_eq() {
  if [ "$2" = "$3" ]; then t_ok "$1"; else t_bad "$1" "expected: $2"$'\n'"actual:   $3"; fi
}

# The scratch target's project ref (MIG_TEST_LOCAL_REF lets a developer point the suite at a local
# throwaway Postgres instead of a Supabase project).
target_ref() { printf '%s' "${MIG_TEST_LOCAL_REF:-$(db_url_ref "$TARGET_DB_URL")}"; }

# assert_true ID cmd...  /  assert_false ID cmd...
assert_true()  { local id=$1; shift; if "$@"; then t_ok "$id"; else t_bad "$id" "command failed: $*"; fi; }
assert_false() { local id=$1; shift; if "$@"; then t_bad "$id" "command succeeded: $*"; else t_ok "$id"; fi; }

# expect_run ID EXIT PATTERN cmd...: runs cmd (a command or function), passes when the exit code
# is EXIT ("nonzero" accepts any failure) and stdout+stderr matches the extended regex PATTERN.
# The output is kept in T_OUT.
expect_run() {
  local id=$1 want=$2 pat=$3 rc
  shift 3
  T_OUT=$("$@" 2>&1) && rc=0 || rc=$?
  if { [ "$rc" = "$want" ] || { [ "$want" = nonzero ] && [ "$rc" != 0 ]; }; } && printf '%s\n' "$T_OUT" | grep -Eq -- "$pat"; then
    t_ok "$id"
  else
    t_bad "$id" "exit $rc (want $want), want output matching /$pat/, got:"$'\n'"$T_OUT"
  fi
}

# mig_run ENVFILE [VAR=VALUE ...] -- ARGS...: runs run.sh with nothing inherited from this shell
# except PATH and HOME. VAR=VALUE pairs are set in the shell, so they win over ENVFILE.
# (A caller may define its own mig_run before sourcing this file; the repo's tests never do.)
if ! type mig_run >/dev/null 2>&1; then
mig_run() {
  local envf=$1; shift
  local -a vars=()
  while [ $# -gt 0 ] && [ "$1" != -- ]; do vars+=("$1"); shift; done
  [ $# -gt 0 ] && shift
  env -i PATH="$PATH" HOME="$HOME" PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}" MIG_ENV_FILE="$envf" \
    ${vars[@]+"${vars[@]}"} bash "$MIG_DIR/run.sh" "$@"
}
fi

t_summary() {
  printf '%s: %d passed, %d failed\n' "$1" "$T_PASS" "$T_FAIL"
  [ "$T_FAIL" = 0 ]
}
