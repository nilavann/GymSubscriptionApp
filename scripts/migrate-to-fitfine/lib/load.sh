# --load (MIG-1.4a/b): one repeatable-read snapshot of the source into files, then one target
# transaction that copies auth users, identities and the 11 tables, adds keys/FKs/indexes and sets
# the identity sequences. Sourced by run.sh after preflight.

MIG_OUT_DIR=${MIG_OUT_DIR:-$MIG_DIR/out}
MIG_AUTH_TABLES="users identities"

target_row_total() {
  local t sql='' union=''
  for t in $(mig_tables); do sql="$sql${union}select count(*) c from \"$TARGET_SCHEMA\".\"$t\""; union=' union all '; done
  psql_target_ro -c "select coalesce(sum(c), 0) from ($sql) x"
}

# Fingerprint tab-separated lines "table rows max_created max_changed max_deleted" for the 11 tables and
# auth.users, computed on the source. Used by the load (inside the snapshot) and by `source-unchanged`.
fingerprint_sql() {
  local t cols c m d first=1 expr
  expr() { # expr COLUMN LIST: max(column)::text when the table has it, else ''
    case "$2" in *"\"$1\""*) printf "coalesce(max(\"%s\")::text, '')" "$1" ;; *) printf "''" ;; esac
  }
  for t in $(mig_tables); do
    [ $first = 1 ] || printf ' union all '
    first=0
    cols=$(cols_of source public "$t" | cut -d'|' -f1 | sed 's/.*/"&"/' | tr '\n' ' ')
    printf "select '%s' k, count(*)::text n, %s c, %s m, %s d from public.\"%s\"" \
      "$t" "$(expr created_at "$cols")" "$(expr changed_at "$cols")" "$(expr deleted_at "$cols")" "$t"
  done
  printf " union all select 'auth.users', count(*)::text, coalesce(max(created_at)::text, ''), coalesce(max(updated_at)::text, ''), '' from auth.users"
  printf " union all select 'auth.identities', count(*)::text, coalesce(max(created_at)::text, ''), '', '' from auth.identities"
}

# fingerprint_json < lines  ->  {"table": {"rows":N,"created":..,"changed":..,"deleted":..}, ...}
fingerprint_json() {
  jq -Rn '[inputs | split("\t") | {key: .[0], value: {rows: (.[1] | tonumber), created: .[2], changed: .[3], deleted: .[4]}}] | from_entries'
}

step_load() {
  local rows t cols_src cols_tgt list tmp script fp seqs stmt err
  [ "$(psql_target_ro -v schema="$TARGET_SCHEMA" -f - <<'SQL'
select count(*) from pg_namespace where nspname = :'schema';
SQL
)" = 1 ] || refuse "target schema $TARGET_SCHEMA does not exist; run --create first"
  rows=$(target_row_total)
  [ "$rows" = 0 ] || refuse "target already has $rows row(s) in $TARGET_SCHEMA; use --reset --confirm-target $MIG_TARGET_REF to start over"
  [ "$(psql_target_ro -v schema="$TARGET_SCHEMA" -f - <<'SQL'
select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace
where n.nspname = :'schema' and c.contype in ('p', 'f', 'u')
SQL
)" = 0 ] || refuse "target $TARGET_SCHEMA already has keys, so a load already ran; use --reset --confirm-target $MIG_TARGET_REF"

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  script=$tmp/load.sql

  # Column lists (all checked before anything is read or written).
  : >"$tmp/read.sql"
  printf 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n' >>"$tmp/read.sql"
  {
    printf 'BEGIN;\n'
  } >"$script"
  for t in $MIG_AUTH_TABLES; do
    cols_src=$(cols_of source auth "$t"); cols_tgt=$(cols_of target auth "$t")
    [ -n "$cols_src" ] || die "source auth.$t has no readable columns"
    [ -n "$cols_tgt" ] || die "target auth.$t does not exist"
    list=$(compare_columns 0 "$cols_src" "$cols_tgt" 2>"$tmp/cmp.err") ||
      { cat "$tmp/cmp.err" >&2; refuse "auth.$t: column mismatch between source and target; nothing was written"; }
    grep '^target-only' "$tmp/cmp.err" | sed "s/^/WARN auth.$t /" >&2 || true
    printf '\\copy auth.%s (%s) to %s/auth.%s.copy\n' "$t" "$list" "$tmp" "$t" >>"$tmp/read.sql"
    printf '\\copy auth.%s (%s) from %s/auth.%s.copy\n' "$t" "$list" "$tmp" "$t" >>"$script"
  done
  for t in $(mig_tables); do
    cols_src=$(cols_of source public "$t"); cols_tgt=$(cols_of target "$TARGET_SCHEMA" "$t")
    [ -n "$cols_tgt" ] || die "target $TARGET_SCHEMA.$t does not exist"
    list=$(compare_columns 1 "$cols_src" "$cols_tgt" 2>"$tmp/cmp.err") ||
      { cat "$tmp/cmp.err" >&2; refuse "$t: column mismatch between source public and target $TARGET_SCHEMA; nothing was written"; }
    printf '\\copy public."%s" (%s) to %s/%s.copy\n' "$t" "$list" "$tmp" "$t" >>"$tmp/read.sql"
    printf '\\copy "%s"."%s" (%s) from %s/%s.copy\n' "$TARGET_SCHEMA" "$t" "$list" "$tmp" "$t" >>"$script"
  done
  printf '\\copy (%s) to %s/fingerprint.txt\n' "$(fingerprint_sql)" "$tmp" >>"$tmp/read.sql"
  printf 'COMMIT;\n' >>"$tmp/read.sql"

  # Identity sequences: setval to max(id); an empty table keeps its start value.
  seqs=$(psql_target_ro -v schema="$TARGET_SCHEMA" -f - <<'SQL'
select table_name || '|' || column_name from information_schema.columns
where table_schema = :'schema' and is_identity = 'YES' order by table_name
SQL
)
  printf '\\i %s/02-post-data.sql\n' "$MIG_DIR/sql" >>"$script"
  while IFS='|' read -r t stmt; do
    [ -n "$t" ] || continue
    printf "select setval(pg_get_serial_sequence(format('%%I.%%I', :'schema', '%s'), '%s'), max(\"%s\")) from :\"schema\".\"%s\" having count(*) > 0;\n" "$t" "$stmt" "$stmt" "$t" >>"$script"
  done <<<"$seqs"
  # Test hook, inert unless set: fail just before the commit so the rollback is exercised (S4).
  printf "select 1 / (case when :'failat' = 'post-data' then 0 else 1 end);\nCOMMIT;\n" >>"$script"

  log "load    reading source snapshot (repeatable read, read-only)"
  psql_source -f "$tmp/read.sql" >/dev/null || die "reading the source snapshot failed; nothing was written"

  log "load    writing target in one transaction"
  err=$tmp/write.err
  if ! psql_target -v schema="$TARGET_SCHEMA" -v failat="${MIG_TEST_FAIL_AT-}" -f "$script" >/dev/null 2>"$err"; then
    cat "$err" >&2
    if grep -qiE 'permission denied|must be owner|insufficient privilege' "$err"; then
      warn "the target role cannot write to auth.*; record this as a Phase 2 input (fallback: re-invite users)"
    fi
    die "--load failed; the transaction was rolled back, nothing was written"
  fi

  mkdir -p "$MIG_OUT_DIR"
  fingerprint_json <"$tmp/fingerprint.txt" >"$MIG_OUT_DIR/source-fingerprint.json"
  log "load    done: $(jq -r '[.[].rows] | add' "$MIG_OUT_DIR/source-fingerprint.json") rows (11 tables + auth), keys, FKs and indexes added"
  rm -rf "$tmp"; trap - EXIT
}
