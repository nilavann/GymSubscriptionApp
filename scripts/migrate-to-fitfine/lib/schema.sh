# --create and --reset (MIG-1.3). Sourced by run.sh after preflight; target writes only.

target_schema_exists() {
  [ "$(psql_target -v schema="$TARGET_SCHEMA" -f - <<'SQL'
select count(*) from pg_namespace where nspname = :'schema';
SQL
)" = 1 ]
}

step_create() {
  target_schema_exists && refuse "target schema $TARGET_SCHEMA already exists; use --reset --confirm-target $MIG_TARGET_REF to rebuild"
  psql_target -v schema="$TARGET_SCHEMA" -1 -f "$MIG_DIR/sql/01-pre-data.sql" || die "--create failed; nothing was created"
  log "create  $TARGET_SCHEMA with $(mig_tables | wc -l | tr -d ' ') tables (keys and indexes are added by --load)"
}

# Removes only what came from the source: TARGET_SCHEMA, and target auth users whose ids exist
# in the source (their identities, sessions etc. cascade in auth). Photos: added in MIG-1.6a.
step_reset() {
  local confirm=$1 ids n
  [ "$confirm" = "$MIG_TARGET_REF" ] ||
    refuse "--confirm-target '$confirm' does not match the target project ref; nothing was removed"
  ids=$(psql_source -c "select coalesce('{' || string_agg(id::text, ',') || '}', '{}') from auth.users")
  n=$(psql_target -v schema="$TARGET_SCHEMA" -v ids="$ids" -1 -f - <<'SQL'
drop schema if exists :"schema" cascade;
with gone as (delete from auth.users where id = any(:'ids'::uuid[]) returning 1)
select count(*) from gone;
SQL
) || die "--reset failed; the transaction was rolled back, nothing was removed"
  log "reset   dropped schema $TARGET_SCHEMA (if present), removed $n source auth user(s) from the target"
  if [ -n "${PHOTO_BUCKET-}" ] && [ -n "${TARGET_SUPABASE_URL-}" ] && [ -n "${TARGET_SERVICE_ROLE_KEY-}" ]; then
    reset_photos
  else
    warn "reset: PHOTO_BUCKET / TARGET_SUPABASE_URL / TARGET_SERVICE_ROLE_KEY not set, so target photos were not removed"
  fi
}
