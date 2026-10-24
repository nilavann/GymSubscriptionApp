#!/usr/bin/env bash
# MIG-1.1 check: the generated SQL files contain nothing but tables/keys/indexes, and applied in
# order to the scratch target they create exactly the 11 tables and nothing else. Applied inside
# a transaction that is rolled back, so the target is left exactly as it was.
set -u
. "$(dirname "$0")/lib.sh"
load_env "${MIG_ENV_FILE:-$MIG_DIR/.env}"

pre=$MIG_DIR/sql/01-pre-data.sql
post=$MIG_DIR/sql/02-post-data.sql

# D1 — file content
code_lines() { grep -hv '^--' "$@"; }
assert_eq "D1 no forbidden objects in the SQL files" "" \
  "$(code_lines "$pre" "$post" | grep -wiE 'trigger|policy|function|view|grant|revoke|row level security|transaction_timeout|\\restrict|\\unrestrict' || true)"
assert_eq "D1 no public. qualifier left" "" "$(code_lines "$pre" "$post" | grep 'public\.' || true)"
assert_eq "D1 11 CREATE TABLE in pre-data" 11 "$(grep -c '^CREATE TABLE' "$pre")"
assert_eq "D1 no keys or indexes in pre-data" 0 "$(code_lines "$pre" | grep -cE 'PRIMARY KEY|FOREIGN KEY|CREATE (UNIQUE )?INDEX' || true)"
assert_eq "D1 every table is in tables.txt" "$(mig_tables | sort)" \
  "$(sed -nE 's/^CREATE TABLE :"schema"\.([a-z_]+) \($/\1/p' "$pre" | sort)"

want_pk=$(grep -c 'PRIMARY KEY' "$post")
want_fk=$(grep -c 'FOREIGN KEY' "$post")
want_ix=$(grep -cE '^CREATE (UNIQUE )?INDEX' "$post")

# D2 — applied to the scratch target, then rolled back
schema=$TARGET_SCHEMA
out=$(psql_target -v schema="$schema" -f - 2>&1 <<SQL
BEGIN;
\i $pre
\i $post
SELECT 'tables=' || count(*) FROM pg_tables WHERE schemaname = :'schema';
SELECT 'relations=' || string_agg(relkind::text || ':' || n, ',' ORDER BY relkind) FROM (
  SELECT c.relkind, count(*) n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = :'schema' GROUP BY c.relkind) x;
SELECT 'pk=' || count(*) FILTER (WHERE contype = 'p') || ' fk=' || count(*) FILTER (WHERE contype = 'f')
  || ' fk_validated=' || count(*) FILTER (WHERE contype = 'f' AND convalidated)
  FROM pg_constraint c JOIN pg_namespace s ON s.oid = c.connamespace WHERE s.nspname = :'schema';
SELECT 'plain_indexes=' || count(*) FROM pg_indexes i
  WHERE i.schemaname = :'schema' AND i.indexname NOT LIKE '%\_pkey';
SELECT 'triggers=' || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = :'schema' AND NOT t.tgisinternal;
SELECT 'policies=' || count(*) FROM pg_policies WHERE schemaname = :'schema';
SELECT 'functions=' || count(*) FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = :'schema';
SELECT 'rls=' || count(*) FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = :'schema' AND c.relrowsecurity;
ROLLBACK;
SQL
)
rc=$?
assert_eq "D2 files apply without error" 0 "$rc"
[ $rc = 0 ] || printf '%s\n' "$out" | sed 's/^/       | /'
val() { printf '%s\n' "$out" | sed -nE "s/^$1=(.*)/\1/p"; }
assert_eq "D2 exactly 11 tables" 11 "$(val tables)"
# r = tables, S = their 7 identity sequences, i = indexes; nothing else (no views, types, ...)
assert_eq "D2 only tables, identity sequences, indexes" "S:7,i:$((want_pk + want_ix)),r:11" "$(val relations)"
assert_eq "D2 keys as in the file" "pk=$want_pk fk=$want_fk fk_validated=$want_fk" "$(printf '%s\n' "$out" | grep '^pk=')"
assert_eq "D2 indexes as in the file" "$want_ix" "$(val plain_indexes)"
assert_eq "D2 no triggers"  0 "$(val triggers)"
assert_eq "D2 no policies"  0 "$(val policies)"
assert_eq "D2 no functions" 0 "$(val functions)"
assert_eq "D2 RLS not enabled" 0 "$(val rls)"
assert_eq "D2 rolled back: target has no $schema schema" 0 \
  "$(psql_target -c "select count(*) from pg_namespace where nspname = '$schema'")"

t_summary ddl
