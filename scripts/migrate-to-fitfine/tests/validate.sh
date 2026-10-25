#!/usr/bin/env bash
# MIG-1.5: --validate against the scratch target. A green baseline, then every validator
# sabotage (V1-V18) must fail with its check id and no other (spec section 8.4), then S10 and S11.
# Leaves the target without TARGET_SCHEMA and without source auth users.
set -u
. "$(dirname "$0")/lib.sh"
envf=${MIG_ENV_FILE:-$MIG_DIR/.env}
load_env "$envf"
ref=$(target_ref)
schema=$TARGET_SCHEMA
fp=${MIG_OUT_DIR:-$MIG_DIR/out}/source-fingerprint.json

tq() { psql_target -v schema="$schema" -f -; }
validate() { mig_run "$envf" -- --validate; }
rebuild() { mig_run "$envf" -- --reset --confirm-target "$ref" --create --load --photos >/dev/null 2>&1; }

# sab ID PRIMARY "SECONDARY..." APPLY_SQL [UNDO_SQL]: APPLY_SQL must end in a select returning the
# number of rows or objects it touched (> 0), so a vacuous sabotage cannot pass. Without UNDO_SQL
# the target is rebuilt from the source.
sab() {
  local id=$1 primary=$2 secondary=$3 apply=$4 undo=${5-} touched out rc line fid bad=''
  touched=$(printf '%s\n' "$apply" | tq 2>&1 | tail -1)
  case $touched in ''|*[!0-9]*|0) t_bad "$id sabotage touched nothing" "$touched"; rebuild; return ;; esac
  out=$(validate 2>&1) && rc=0 || rc=$?
  if [ "$rc" = 0 ]; then t_bad "$id validation still green" "$out"
  else
    printf '%s\n' "$out" | grep -Eq "^FAIL $primary " || bad="no FAIL $primary line"
    while IFS= read -r line; do
      fid=$(printf '%s' "$line" | awk '{print $2}')
      case " $primary $secondary " in *" $fid "*) ;; *) bad="$bad unexpected FAIL $fid;" ;; esac
    done < <(printf '%s\n' "$out" | grep '^FAIL ')
    if [ -z "$bad" ]; then t_ok "$id fails with $primary"; else t_bad "$id fails with $primary" "$bad"$'\n'"$out"; fi
  fi
  if [ -n "$undo" ]; then printf '%s\n' "$undo" | tq >/dev/null 2>&1; else rebuild; fi
  expect_run "$id undone, green again" 0 'validate: all checks ok' validate
}

rebuild
expect_run "V0 clean load validates green" 0 'validate: all checks ok' validate

sab V1 structure content 'alter table :"schema".members drop column occupation; select 1;'
sab V2 structure '' 'alter table :"schema".plans drop constraint plans_price_check; select 1;' \
  'alter table :"schema".plans add constraint plans_price_check check (price >= 0);'
sab V3 structure '' "alter table :\"schema\".subscriptions alter column payment_mode set default 'UPI'; select 1;" \
  "alter table :\"schema\".subscriptions alter column payment_mode set default 'Cash';"
idx=$(psql_target -v schema="$schema" -f - <<'SQL'
select indexname || '|' || indexdef from pg_indexes
where schemaname = :'schema' and indexname not like '%\_pkey' order by indexname limit 1
SQL
)
sab V4 structure '' "drop index :\"schema\".\"${idx%%|*}\"; select 1;" "${idx#*|};"
sab V5a nothing-extra '' 'create view :"schema".v_extra as select 1 as x; select 1;' 'drop view :"schema".v_extra;'
sab V5b nothing-extra '' 'create function :"schema".f_extra() returns trigger language plpgsql as $$ begin return new; end $$;
  create trigger t_extra before update on :"schema".plans for each row execute function :"schema".f_extra(); select 1;' \
  'drop trigger t_extra on :"schema".plans; drop function :"schema".f_extra();'
sab V6 counts 'content fk' 'with d as (delete from :"schema".subscription_items where id = (select min(id) from :"schema".subscription_items) returning 1) select count(*) from d;'
sab V7 counts 'content anchors' 'with u as (update :"schema".plans set deleted_at = now() where id = (select min(id) from :"schema".plans where deleted_at is null) returning 1) select count(*) from u;'
sab V8 content '' "with u as (update :\"schema\".members set name = name || ' x' where id = (select min(id) from :\"schema\".members) returning 1) select count(*) from u;"
sab V9 content '' "with u as (update :\"schema\".members set changed_at = changed_at + interval '1 microsecond' where id = (select min(id) from :\"schema\".members where changed_at is not null) returning 1) select count(*) from u;"
sab V10 content '' "with u as (update :\"schema\".subscriptions set notes = '' where id = (select min(id) from :\"schema\".subscriptions where notes is null) returning 1) select count(*) from u;"
sab V11 auth '' "with u as (update auth.users set encrypted_password = coalesce(encrypted_password, '') || 'x' where id = (select id from :\"schema\".profiles order by id limit 1) returning 1) select count(*) from u;"
sab V12 auth counts 'with d as (delete from auth.identities where user_id = (select id from :"schema".profiles order by id limit 1) returning 1) select count(*) from d;'
sab V13 identity-seq '' "select count(*) from (select pg_catalog.setval(pg_get_serial_sequence(:'schema' || '.audit_log', 'id'), max(id) - 1) from :\"schema\".audit_log having max(id) > 1) x;"
sab V14 fk 'structure counts content' 'alter table :"schema".subscriptions drop constraint subscriptions_member_id_fkey;
  with i as (insert into :"schema".subscriptions (member_id) values (999999999) returning 1) select count(*) from i;'
sab V15 anchors content "with u as (update :\"schema\".members set member_number = member_number || 'x' where id = (select min(id) from :\"schema\".members) returning 1) select count(*) from u;"
sab V16 anchors content "with u as (update :\"schema\".configuration set value = value || 'x' where key = (select min(key) from :\"schema\".configuration) returning 1) select count(*) from u;"
sab V17 counts content 'with d as (delete from :"schema".audit_log where id = (select min(id) from :"schema".audit_log) returning 1) select count(*) from d;'

# V18 — an edited fingerprint stands in for a source that changed after the load
cp "$fp" "$fp.bak"
jq '.profiles.rows += 1' "$fp.bak" >"$fp"
expect_run "V18 changed source -> exit 3" 3 '^FAIL source-unchanged ' validate
mv "$fp.bak" "$fp"
expect_run "V18 restored fingerprint green" 0 'validate: all checks ok' validate

# S10 — validate writes nothing
stats() { sleep 1; psql_target -v schema="$schema" -f - <<'SQL'
select md5(coalesce(string_agg(relname || ':' || n_tup_ins || ':' || n_tup_upd || ':' || n_tup_del, ',' order by relname), ''))
from pg_stat_user_tables where schemaname = :'schema' or (schemaname = 'auth' and relname in ('users', 'identities'))
SQL
}
before=$(stats); fp_before=$(cat "$fp")
validate >/dev/null 2>&1
assert_eq "S10 target write statistics unchanged" "$before" "$(stats)"
assert_eq "S10 fingerprint file unchanged" "$fp_before" "$(cat "$fp")"

# S11 — checksums do not depend on the client's time zone or date style
expect_run "S11 PGTZ/PGDATESTYLE do not matter" 0 'validate: all checks ok' \
  mig_run "$envf" PGTZ=Asia/Kolkata PGDATESTYLE=German -- --validate

mig_run "$envf" -- --reset --confirm-target "$ref" >/dev/null 2>&1
t_summary validate
