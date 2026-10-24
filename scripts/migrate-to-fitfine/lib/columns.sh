# Copyable column lists and the cross-side comparison rules (spec section 6, "Load" step 2).
# Sourced by run.sh and the tests. A column line is "name|type|nullable|hasdefault".

# cols_of SIDE SCHEMA TABLE: non-generated columns in ordinal order. SIDE is source or target.
# is_generated = 'NEVER' excludes auth.users.confirmed_at, auth.identities.email and any future
# generated column, which COPY cannot write.
cols_of() {
  local side=$1 schema=$2 table=$3 runner=psql_source
  [ "$side" = source ] || runner=psql_target_ro
  $runner -v s="$schema" -v t="$table" -f - <<'SQL'
select column_name || '|' || data_type || '|' || lower(is_nullable) || '|' || (column_default is not null or is_identity = 'YES')::text
from information_schema.columns
where table_schema = :'s' and table_name = :'t' and is_generated = 'NEVER'
order by ordinal_position;
SQL
}

# compare_columns STRICT(1|0) SOURCE_LINES TARGET_LINES
#   STRICT=1 (the 11 tables): both lists must be identical, names, order and types.
#   STRICT=0 (auth tables): every source column must exist in the target; a target-only column is
#   allowed when it is nullable or has a default (reported on stderr as "target-only: <name>").
# Prints the comma-separated, quoted copy list on stdout and returns 0, or prints the reason on
# stderr and returns 1.
compare_columns() {
  local strict=$1 src=$2 tgt=$3 line name type nullable hasdef tline tname tnull tdef found list=''
  if [ "$strict" = 1 ]; then
    if [ "$src" != "$tgt" ]; then
      printf 'column lists differ\n--- source\n%s\n--- target\n%s\n' "$src" "$tgt" >&2
      return 1
    fi
  else
    while IFS='|' read -r name type nullable hasdef; do
      [ -n "$name" ] || continue
      found=0
      while IFS='|' read -r tname _ _ _; do
        [ "$tname" = "$name" ] && { found=1; break; }
      done <<<"$tgt"
      if [ $found = 0 ]; then printf 'column %s exists in the source but not in the target\n' "$name" >&2; return 1; fi
    done <<<"$src"
    while IFS='|' read -r tname _ tnull tdef; do
      [ -n "$tname" ] || continue
      found=0
      while IFS='|' read -r name _ _ _; do
        [ "$tname" = "$name" ] && { found=1; break; }
      done <<<"$src"
      if [ $found = 0 ]; then
        if [ "$tnull" = yes ] || [ "$tdef" = true ]; then
          printf 'target-only: %s\n' "$tname" >&2
        else
          printf 'column %s exists only in the target and is NOT NULL without a default\n' "$tname" >&2
          return 1
        fi
      fi
    done <<<"$tgt"
  fi
  while IFS='|' read -r name _; do
    [ -n "$name" ] || continue
    list="${list:+$list,}\"$name\""
  done <<<"$src"
  printf '%s' "$list"
}
