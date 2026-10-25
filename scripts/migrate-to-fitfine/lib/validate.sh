# --validate: read-only checks of the target against the source (spec section 7).
# Sourced by run.sh after preflight. Exit 0 all ok, 1 a FAIL, 3 source changed since the load.

. "$MIG_DIR/validate/db.sh"
. "$MIG_DIR/validate/photos.sh"

step_validate() {
  local tmp checks c
  tmp=$(mktemp -d)
  V_ERR_FLAG=$tmp/query-errors
  trap 'rm -rf "$tmp"; st_cleanup' EXIT
  checks="structure nothing_extra counts content auth identity_seq fk anchors source_unchanged"
  for c in $checks; do "check_$c" "$tmp"; done
  if [ -n "${PHOTO_BUCKET-}" ] && [ -n "${TARGET_SUPABASE_URL-}" ]; then validate_photos "$tmp"; fi
  if [ -s "$V_ERR_FLAG" ]; then
    vfail validate-error queries "$(sort -u "$V_ERR_FLAG" | paste -sd, -): a query failed, so the report above cannot be trusted"
  fi
  rm -rf "$tmp"; st_cleanup; trap - EXIT
  if [ "$V_SOURCE_CHANGED" = 1 ]; then
    log "validate: $V_FAILS problem(s); the source changed since the load"; return "$EXIT_SOURCE_CHANGED"
  fi
  if [ "$V_FAILS" -gt 0 ]; then log "validate: $V_FAILS problem(s)"; return "$EXIT_FAIL"; fi
  log "validate: all checks ok"
}
