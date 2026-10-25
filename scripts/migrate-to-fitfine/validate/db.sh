# --validate database checks (spec section 7): structure, nothing-extra, counts, content, auth,
# identity-seq, fk, anchors, source-unchanged. Each check prints "ok  <id>" or one
# "FAIL <id> <object> <detail>" line per problem and bumps V_FAILS. Read-only on both sides.
# Sourced by lib/validate.sh.

# A query that errors makes the whole validation fail (checked in step_validate), even when the
# error happens inside a $(...) where a check cannot see the exit status.
v_query_failed() { [ -z "${V_ERR_FLAG-}" ] || echo "query failed on $1" >>"$V_ERR_FLAG"; return 1; }
q_src() { psql_source "$@" || v_query_failed source; }
q_tgt() { psql_target_ro "$@" || v_query_failed target; }

V_FAILS=0
V_SOURCE_CHANGED=0
vfail() { fail_line "$@"; V_FAILS=$((V_FAILS + 1)); }

pg_array() { mig_tables | paste -sd, - | sed 's/^/{/; s/$/}/'; }

# Source auth user ids as a postgres array literal, read once. The target auth tables may hold
# users that did not come from the source, so every auth comparison is limited to these ids.
src_ids_array() {
  [ -n "${V_SRC_IDS-}" ] || V_SRC_IDS=$(q_src -c "select coalesce('{' || string_agg(id::text, ',' order by id) || '}', '{}') from auth.users")
  printf '%s' "$V_SRC_IDS"
}

# lines_diff ID OBJECT_FIELD SRC_FILE TGT_FILE: one FAIL per line present on one side only.
# OBJECT_FIELD is the 1-based '|' field used as the FAIL line's object.
lines_diff() {
  local id=$1 field=$2 line n=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    vfail "$id" "$(printf '%s' "$line" | cut -d'|' -f"$field")" "only in source: $line"; n=$((n + 1))
  done < <(comm -23 "$3" "$4")
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    vfail "$id" "$(printf '%s' "$line" | cut -d'|' -f"$field")" "only in target: $line"; n=$((n + 1))
  done < <(comm -13 "$3" "$4")
  return 0
}

# --- structure ----------------------------------------------------------------------------

structure_sql() {
  cat <<'SQL'
select 'col|' || c.table_name || '|' || c.column_name || '|' || c.data_type || '|' || c.is_nullable || '|' ||
       coalesce(c.column_default, '') || '|' || c.is_identity || '|' || c.is_generated
from information_schema.columns c
where c.table_schema = :'s' and c.table_name = any(:'tables'::text[])
union all
select 'con|' || cl.relname || '|' || con.conname || '|' || pg_get_constraintdef(con.oid)
from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_namespace n on n.oid = cl.relnamespace
where n.nspname = :'s' and cl.relname = any(:'tables'::text[])
union all
select 'idx|' || tablename || '|' || indexname || '|' || indexdef
from pg_indexes where schemaname = :'s' and tablename = any(:'tables'::text[]);
SQL
}

check_structure() {
  local tmp=$1 before=$V_FAILS t cs ct
  structure_sql | q_src -v s=public -v tables="$(pg_array)" -f - | normalize_schema_prefix | LC_ALL=C sort >"$tmp/struct.src"
  structure_sql | q_tgt -v s="$TARGET_SCHEMA" -v tables="$(pg_array)" -f - | normalize_schema_prefix | LC_ALL=C sort >"$tmp/struct.tgt"
  lines_diff structure 2 "$tmp/struct.src" "$tmp/struct.tgt"
  for t in $MIG_AUTH_TABLES; do
    cs=$(cols_of source auth "$t"); ct=$(cols_of target auth "$t")
    compare_columns 0 "$cs" "$ct" >/dev/null 2>"$tmp/auth.err" || vfail structure "auth.$t" "$(head -1 "$tmp/auth.err")"
    grep '^target-only' "$tmp/auth.err" | sed "s/^/WARN auth.$t /" >&2 || true
  done
  [ "$V_FAILS" != "$before" ] || ok_line structure "11 tables + auth columns match"
}

# --- nothing-extra ------------------------------------------------------------------------

check_nothing_extra() {
  local before=$V_FAILS out line
  out=$(q_tgt -v s="$TARGET_SCHEMA" -v tables="$(pg_array)" -f - <<'SQL'
select 'table ' || c.relname || ' is not one of the 11' from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = :'s' and c.relkind in ('r', 'p', 'f') and c.relname <> all(:'tables'::text[])
union all
select 'relation ' || c.relname || ' (kind ' || c.relkind::text || ')' from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = :'s' and c.relkind in ('v', 'm', 'c', 'f')
union all
select 'sequence ' || c.relname || ' is not an identity sequence' from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = :'s' and c.relkind = 'S'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'i')
union all
select 'trigger ' || t.tgname || ' on ' || c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = :'s' and not t.tgisinternal
union all
select 'policy ' || p.polname || ' on ' || c.relname from pg_policy p join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = :'s'
union all
select 'row level security enabled on ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = :'s' and c.relkind = 'r' and c.relrowsecurity
union all
select 'function ' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = :'s'
union all
select 'type ' || t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = :'s' and t.typtype in ('e', 'd', 'r', 'm', 'b')
    and not (t.typcategory = 'A' and exists (select 1 from pg_type e where e.oid = t.typelem and e.typnamespace = t.typnamespace and e.typtype = 'c'));
SQL
)
  while IFS= read -r line; do [ -z "$line" ] || vfail nothing-extra "$TARGET_SCHEMA" "$line"; done <<<"$out"
  [ "$V_FAILS" != "$before" ] || ok_line nothing-extra "only the 11 tables, their identity sequences, keys and indexes"
}

# --- counts -------------------------------------------------------------------------------

# One line per table: "table|total|active|deleted" (active/deleted are -1 when there is no deleted_at).
counts_sql() { # counts_sql SCHEMA SIDE
  local t first=1 cols
  for t in $(mig_tables); do
    [ $first = 1 ] || printf ' union all '
    first=0
    cols=$(cols_of "$2" "$1" "$t" | cut -d'|' -f1)
    if printf '%s\n' "$cols" | grep -qx deleted_at; then
      printf "select '%s|' || count(*) || '|' || count(*) filter (where deleted_at is null) || '|' || count(*) filter (where deleted_at is not null) from \"%s\".\"%s\"" "$t" "$1" "$t"
    else
      printf "select '%s|' || count(*) || '|-1|-1' from \"%s\".\"%s\"" "$t" "$1" "$t"
    fi
  done
  printf " union all select 'auth.users|' || count(*) || '|-1|-1' from auth.users where id = any('%s'::uuid[])" "$(src_ids_array)"
  printf " union all select 'auth.identities|' || count(*) || '|-1|-1' from auth.identities where user_id = any('%s'::uuid[])" "$(src_ids_array)"
}

check_counts() {
  local tmp=$1 before=$V_FAILS
  q_src -c "$(counts_sql public source)" | LC_ALL=C sort >"$tmp/counts.src"
  q_tgt -c "$(counts_sql "$TARGET_SCHEMA" target)" | LC_ALL=C sort >"$tmp/counts.tgt"
  lines_diff counts 1 "$tmp/counts.src" "$tmp/counts.tgt"
  [ "$V_FAILS" != "$before" ] || ok_line counts "total and active/deleted rows equal for 11 tables + auth"
}

# --- content ------------------------------------------------------------------------------

# Row text: every column's text form, length-prefixed so NULL ('~') differs from '' ('0:') and
# no value can imitate a separator; the row md5s are sorted and hashed again.
row_expr() { # row_expr "col1,col2" (already double-quoted)
  local list=$1 expr='' c
  local IFS=,
  for c in $list; do expr="${expr:+$expr || chr(31) || }coalesce(length($c::text) || ':' || $c::text, '~')"; done
  printf '%s' "$expr"
}

content_sql() { # content_sql SCHEMA TABLE COLS [WHERE]
  printf 'select md5(coalesce(string_agg(h, %s order by h), %s)) from (select md5(%s) as h from "%s"."%s" %s) x' \
    "''" "''" "$(row_expr "$3")" "$1" "$2" "${4-}"
}

check_content() {
  local tmp=$1 before=$V_FAILS t list hs ht
  for t in $(mig_tables); do
    list=$(cols_of source public "$t" | cut -d'|' -f1 | sed 's/.*/"&"/' | paste -sd, -)
    if [ "$(cols_of target "$TARGET_SCHEMA" "$t" | cut -d'|' -f1 | sed 's/.*/"&"/' | paste -sd, -)" != "$list" ]; then
      vfail content "$t" "column list differs from the source, so the rows cannot be compared (see structure)"
      continue
    fi
    hs=$(q_src -c "$(content_sql public "$t" "$list")")
    ht=$(q_tgt -c "$(content_sql "$TARGET_SCHEMA" "$t" "$list")")
    [ "$hs" = "$ht" ] || vfail content "$t" "row checksum differs (source $hs, target $ht)"
  done
  [ "$V_FAILS" != "$before" ] || ok_line content "every row of the 11 tables identical, incl. audit columns and timestamps"
}

# --- auth ---------------------------------------------------------------------------------

check_auth() {
  local tmp=$1 before=$V_FAILS t cs ct list hs ht where orphans
  for t in $MIG_AUTH_TABLES; do
    cs=$(cols_of source auth "$t"); ct=$(cols_of target auth "$t")
    list=$(compare_columns 0 "$cs" "$ct" 2>/dev/null) || { vfail auth "auth.$t" "column mismatch"; continue; }
    if [ "$t" = users ]; then where="where id = any('$(src_ids_array)'::uuid[])"; else where="where user_id = any('$(src_ids_array)'::uuid[])"; fi
    hs=$(q_src -c "$(content_sql auth "$t" "$list" "$where")")
    ht=$(q_tgt -c "$(content_sql auth "$t" "$list" "$where")")
    [ "$hs" = "$ht" ] || vfail auth "auth.$t" "content checksum differs (source $hs, target $ht)"
  done
  orphans=$(q_tgt -c "select count(*) from \"$TARGET_SCHEMA\".profiles p where not exists (select 1 from auth.users u where u.id = p.id)")
  [ "$orphans" = 0 ] || vfail auth profiles "$orphans profile(s) without an auth.users row"
  [ "$V_FAILS" != "$before" ] || ok_line auth "users and identities identical (incl. password hashes); every profile has a user"
}

# --- identity-seq -------------------------------------------------------------------------

check_identity_seq() {
  local before=$V_FAILS t c seq last mx
  while IFS='|' read -r t c; do
    [ -n "$t" ] || continue
    seq=$(q_tgt -v s="$TARGET_SCHEMA" -v t="$t" -v c="$c" -f - <<'SQL'
select split_part(pg_get_serial_sequence(format('%I.%I', :'s', :'t'), :'c'), '.', 2)
SQL
)
    last=$(q_tgt -v s="$TARGET_SCHEMA" -v q="$seq" -f - <<'SQL'
select coalesce(last_value::text, '') from pg_sequences where schemaname = :'s' and sequencename = :'q'
SQL
)
    mx=$(q_tgt -c "select coalesce(max(\"$c\")::text, '') from \"$TARGET_SCHEMA\".\"$t\"")
    [ "$last" = "$mx" ] || vfail identity-seq "$t.$c" "sequence last_value '${last:-unused}' but max($c) is '${mx:-none}'"
  done < <(q_tgt -v s="$TARGET_SCHEMA" -f - <<'SQL'
select table_name || '|' || column_name from information_schema.columns where table_schema = :'s' and is_identity = 'YES' order by 1
SQL
)
  [ "$V_FAILS" != "$before" ] || ok_line identity-seq "every identity sequence is at max(id)"
}

# --- fk -----------------------------------------------------------------------------------

check_fk() {
  local before=$V_FAILS name valid tbl cols rsch rtbl rcols n cond join tvalid
  # The list of foreign keys comes from the SOURCE, so a key dropped on the target is still
  # checked (it is reported, and its rows are still anti-joined).
  while IFS='|' read -r name tbl cols rsch rtbl rcols; do
    [ -n "$name" ] || continue
    [ "$rsch" != public ] || rsch=$TARGET_SCHEMA
    tvalid=$(q_tgt -v s="$TARGET_SCHEMA" -v t="$tbl" -v n="$name" -f - <<'SQL'
select coalesce((select convalidated::text from pg_constraint c join pg_class cl on cl.oid = c.conrelid
  join pg_namespace ns on ns.oid = cl.relnamespace
  where ns.nspname = :'s' and cl.relname = :'t' and c.conname = :'n' and c.contype = 'f'), 'missing')
SQL
)
    case $tvalid in
      true) ;;
      missing) vfail fk "$tbl" "foreign key $name exists in the source but not in the target" ;;
      *) vfail fk "$tbl" "constraint $name is not validated" ;;
    esac
    cond=$(printf '%s' "$cols" | awk -F, '{for (i = 1; i <= NF; i++) printf "%sx.%s is not null", (i > 1 ? " and " : ""), $i}')
    join=$(printf '%s\n%s' "$cols" "$rcols" | awk -F, 'NR==1{for(i=1;i<=NF;i++)a[i]=$i;n=NF} NR==2{for(i=1;i<=n;i++)printf "%sy.%s = x.%s",(i>1?" and ":""),$i,a[i]}')
    n=$(q_tgt -c "select count(*) from \"$TARGET_SCHEMA\".\"$tbl\" x where $cond and not exists (select 1 from \"$rsch\".\"$rtbl\" y where $join)")
    [ "$n" = 0 ] || vfail fk "$tbl.$name" "$n orphan row(s): no matching row in $rsch.$rtbl"
  done < <(q_src -v s=public -f - <<'SQL'
select c.conname || '|' || cl.relname || '|' ||
  (select string_agg(quote_ident(a.attname), ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) || '|' ||
  rn.nspname || '|' || rcl.relname || '|' ||
  (select string_agg(quote_ident(a.attname), ',' order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
     join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
from pg_constraint c
join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
join pg_class rcl on rcl.oid = c.confrelid join pg_namespace rn on rn.oid = rcl.relnamespace
where c.contype = 'f' and n.nspname = :'s' order by 1;
SQL
)
  [ "$V_FAILS" != "$before" ] || ok_line fk "all foreign keys present and validated, zero orphans (incl. profiles.created_by, members.handled_by_staff)"
}

# --- anchors ------------------------------------------------------------------------------

anchors_sql() { # anchors_sql SCHEMA
  cat <<SQL
select 'member_number|' || md5(coalesce(string_agg(id || ':' || member_number, ',' order by id), '')) from "$1".members
union all select 'member_number_sequences|' || md5(coalesce(string_agg(branch_id || ':' || last_sequence, ',' order by branch_id), '')) from "$1".member_number_sequences
union all select 'configuration|' || md5(coalesce(string_agg(length(key) || ':' || key || '=' || length(value) || ':' || value, ',' order by key), '')) from "$1".configuration
union all select 'members active/deleted|' || count(*) filter (where deleted_at is null) || '/' || count(*) filter (where deleted_at is not null) from "$1".members
union all select 'plans active/deleted|' || count(*) filter (where deleted_at is null) || '/' || count(*) filter (where deleted_at is not null) from "$1".plans
union all select 'branches active/deleted|' || count(*) filter (where deleted_at is null) || '/' || count(*) filter (where deleted_at is not null) from "$1".branches;
SQL
}

check_anchors() {
  local tmp=$1 before=$V_FAILS
  anchors_sql public | q_src -f - | LC_ALL=C sort >"$tmp/anch.src"
  anchors_sql "$TARGET_SCHEMA" | q_tgt -f - | LC_ALL=C sort >"$tmp/anch.tgt"
  lines_diff anchors 1 "$tmp/anch.src" "$tmp/anch.tgt"
  [ "$V_FAILS" != "$before" ] || ok_line anchors "member numbers, member_number_sequences, configuration and active/deleted counts identical"
}

# --- source-unchanged ---------------------------------------------------------------------

check_source_unchanged() {
  local file=$MIG_OUT_DIR/source-fingerprint.json now
  if [ ! -s "$file" ]; then
    vfail source-unchanged "$file" "no fingerprint from the load; run --load first"
    return 0
  fi
  now=$(psql_source -F $'\t' -c "$(fingerprint_sql)" | fingerprint_json | jq -S .)
  if [ "$now" = "$(jq -S . "$file")" ]; then
    ok_line source-unchanged "source rows and latest timestamps equal the snapshot taken at load"
  else
    vfail source-unchanged source "the source changed since the load; re-run with --reset"
    V_SOURCE_CHANGED=1
  fi
}
