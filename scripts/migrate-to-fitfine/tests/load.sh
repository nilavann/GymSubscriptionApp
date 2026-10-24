#!/usr/bin/env bash
# MIG-1.4: --load against the scratch target (S2, S3, S4, S5). Leaves the target without
# TARGET_SCHEMA and without source auth users, as it found it.
set -u
. "$(dirname "$0")/lib.sh"
envf=${MIG_ENV_FILE:-$MIG_DIR/.env}
load_env "$envf"
ref=$(db_url_ref "$TARGET_DB_URL")
schema=$TARGET_SCHEMA

fresh() { mig_run "$envf" -- --reset --confirm-target "$ref" --create >/dev/null 2>&1; }
tq() { psql_target -v schema="$schema" -f -; }
total_rows() {
  local t sql='' u=''
  for t in $(mig_tables); do sql="$sql${u}select count(*) c from \"$schema\".\"$t\""; u=' union all '; done
  psql_target -c "select sum(c) from ($sql) x"
}
src_ids() { psql_source -c "select string_agg(id::text, ',') from auth.users"; }
src_ids_in_target() { psql_target -c "select count(*) from auth.users where id = any(string_to_array('$(src_ids)', ',')::uuid[])"; }

# S5 — an extra NOT NULL column on the target stops the load before anything is written
fresh
tq <<'SQL'
alter table :"schema".members add column extra_col text not null default 'x';
SQL
expect_run "S5 extra column on members stops the load" 2 'members: column mismatch' mig_run "$envf" -- --load
assert_eq "S5 nothing written" 0 "$(total_rows)"
assert_eq "S5 no source users in target auth" 0 "$(src_ids_in_target)"

# S2 — a normal load
fresh
expect_run "S2 --load completes" 0 'load    done' mig_run "$envf" -- --load
for t in $(mig_tables); do
  assert_eq "S2 row count $t" "$(psql_source -c "select count(*) from public.\"$t\"")" "$(psql_target -c "select count(*) from \"$schema\".\"$t\"")"
done
assert_eq "S2 auth.users count" "$(psql_source -c 'select count(*) from auth.users')" "$(psql_target -c "select count(*) from auth.users where id = any(string_to_array('$(src_ids)', ',')::uuid[])")"
assert_eq "S2 auth.identities count" "$(psql_source -c 'select count(*) from auth.identities')" "$(psql_target -c "select count(*) from auth.identities where user_id = any(string_to_array('$(src_ids)', ',')::uuid[])")"
assert_eq "S2 generated confirmed_at populated like the source" \
  "$(psql_source -c 'select count(*) from auth.users where confirmed_at is not null')" \
  "$(psql_target -c "select count(*) from auth.users where confirmed_at is not null and id = any(string_to_array('$(src_ids)', ',')::uuid[])")"
assert_true "S2 source fingerprint written" test -s "$MIG_DIR/out/source-fingerprint.json"

# S3 — a second load is refused and writes nothing
before=$(total_rows)
expect_run "S3 second --load refused" 2 'target already has [0-9]+ row' mig_run "$envf" -- --load
assert_eq "S3 row total unchanged" "$before" "$(total_rows)"

# S4 — a failure just before the commit leaves nothing behind
fresh
expect_run "S4 forced failure exits 1" 1 'rolled back' mig_run "$envf" MIG_TEST_FAIL_AT=post-data -- --load
assert_eq "S4 zero rows in the 11 tables" 0 "$(total_rows)"
assert_eq "S4 no keys or FKs" 0 "$(tq <<'SQL'
select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace
where n.nspname = :'schema' and c.contype in ('p', 'f', 'u')
SQL
)"
assert_eq "S4 no source user ids in target auth.users" 0 "$(src_ids_in_target)"

mig_run "$envf" -- --reset --confirm-target "$ref" >/dev/null 2>&1
t_summary load
