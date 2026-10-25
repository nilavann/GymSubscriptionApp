#!/usr/bin/env bash
# MIG-1.3: --create and --reset against the scratch target (S1, P9, P10). Leaves the target
# without TARGET_SCHEMA, as it found it.
set -u
. "$(dirname "$0")/lib.sh"
envf=${MIG_ENV_FILE:-$MIG_DIR/.env}
load_env "$envf"
ref=$(target_ref)
schema=$TARGET_SCHEMA

q() { psql_target -v schema="$schema" -f -; }
public_objects() { psql_target -c "select md5(coalesce(string_agg(c.relname || ':' || c.relkind::text, ',' order by c.relname), ''))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'"; }
shape() { q <<'SQL'
select (select count(*) from pg_tables where schemaname = :'schema') || ' tables, '
    || (select count(*) from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = :'schema' and c.contype in ('p', 'f', 'u')) || ' keys, '
    || (select count(*) from pg_indexes where schemaname = :'schema') || ' indexes';
SQL
}
exists() { q <<'SQL'
select count(*) from pg_namespace where nspname = :'schema';
SQL
}

# Start clean whatever an earlier run left behind.
mig_run "$envf" -- --reset --confirm-target "$ref" >/dev/null 2>&1
assert_eq "S1 precondition: no $schema schema" 0 "$(exists)"

before=$(public_objects)
assert_true "S1 public object fingerprint readable" test -n "$before"
expect_run "S1 --create on an empty target" 0 "create  $schema with 11 tables" mig_run "$envf" -- --create
assert_eq "S1 exactly 11 tables, no keys or indexes yet" "11 tables, 0 keys, 0 indexes" "$(shape)"
assert_eq "S1 target public untouched" "$before" "$(public_objects)"

expect_run "P9 second --create refused" 2 "target schema $schema already exists" mig_run "$envf" -- --create
assert_eq "P9 schema unchanged after refusal" "11 tables, 0 keys, 0 indexes" "$(shape)"

expect_run "P10 --reset without --confirm-target" 2 'needs --confirm-target' mig_run "$envf" -- --reset
expect_run "P10 --reset with a wrong ref" 2 'does not match the target project ref; nothing was removed' \
  mig_run "$envf" -- --reset --confirm-target wrongref
expect_run "P10 --reset with the source ref" 2 'does not match the target project ref' \
  mig_run "$envf" -- --reset --confirm-target "$(db_url_ref "$SOURCE_DB_URL")"
assert_eq "P10 nothing dropped by a refused reset" 1 "$(exists)"

expect_run "S1 --reset --create rebuilds" 0 "create  $schema with 11 tables" \
  mig_run "$envf" -- --reset --confirm-target "$ref" --create
assert_eq "S1 rebuilt shape" "11 tables, 0 keys, 0 indexes" "$(shape)"

expect_run "S9 --reset removes the schema" 0 "reset   dropped schema $schema" mig_run "$envf" -- --reset --confirm-target "$ref"
assert_eq "S9 schema gone" 0 "$(exists)"
expect_run "S9 --reset on a clean target is a no-op" 0 'removed 0 source auth user' mig_run "$envf" -- --reset --confirm-target "$ref"
assert_eq "S1 target public untouched at the end" "$before" "$(public_objects)"

t_summary create
