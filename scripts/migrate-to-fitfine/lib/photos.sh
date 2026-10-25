# --photos: creates the bucket in the target (same settings as the source, no policies) and copies
# every file to the same path. Equality is size + SHA-256 of the bytes; the etag is only a hint.
# Sourced by run.sh after preflight (storage variables required).

step_photos() {
  local tmp src_json tgt_json name size mime etag t_line t_size t_etag copied=0 skipped=0 failed=0 sha tsha code
  src_json=$(bucket_json source)
  [ -n "$src_json" ] || refuse "source bucket $PHOTO_BUCKET does not exist"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"; st_cleanup' EXIT
  tgt_json=$(bucket_json target)
  if [ -z "$tgt_json" ]; then
    code=$(st_req target POST /bucket "$tmp/bucket.out" -H 'Content-Type: application/json' \
      --data "$(printf '%s' "$src_json" | jq -c --arg b "$PHOTO_BUCKET" '{id: $b, name: $b} + .')")
    [ "$code" = 200 ] || die "creating bucket $PHOTO_BUCKET failed (HTTP $code): $(head -c 300 "$tmp/bucket.out")"
    log "photos  created bucket $PHOTO_BUCKET: $src_json"
  elif [ "$tgt_json" != "$src_json" ]; then
    refuse "target bucket $PHOTO_BUCKET exists with different settings (source $src_json, target $tgt_json); nothing was copied"
  fi

  objects_of source >"$tmp/src.list"
  objects_of target >"$tmp/tgt.list"
  mkdir -p "$MIG_OUT_DIR"
  : >"$tmp/manifest"
  while IFS='|' read -r name size mime etag; do
    [ -n "$name" ] || continue
    t_line=$(lookup_line "$tmp/tgt.list" "$name")
    if [ -z "$t_line" ]; then
      if ! st_download source "$PHOTO_BUCKET" "$name" "$tmp/obj"; then
        fail_line photos "$name" "download from the source failed"; failed=$((failed + 1)); continue
      fi
      sha=$(sha256_of "$tmp/obj")
      if [ -n "$size" ] && [ "$(size_of "$tmp/obj")" != "$size" ]; then
        fail_line photos "$name" "downloaded size $(size_of "$tmp/obj") differs from the recorded size $size"; failed=$((failed + 1)); continue
      fi
      if st_upload "$PHOTO_BUCKET" "$name" "$tmp/obj" "$mime"; then
        copied=$((copied + 1)); printf '%s\t%s\t%s\n' "$name" "$(size_of "$tmp/obj")" "$sha" >>"$tmp/manifest"
      else
        fail_line photos "$name" "upload failed: $(cat "$ST_TMP/up.err")"; failed=$((failed + 1))
      fi
    else
      IFS='|' read -r _ t_size _ t_etag <<<"$t_line"
      if [ "$t_size" = "$size" ] && [ -n "$etag" ] && [ "$t_etag" = "$etag" ]; then
        skipped=$((skipped + 1)); printf '%s\t%s\t-\n' "$name" "$size" >>"$tmp/manifest"; continue
      fi
      if st_download source "$PHOTO_BUCKET" "$name" "$tmp/obj" && st_download target "$PHOTO_BUCKET" "$name" "$tmp/obj2"; then
        sha=$(sha256_of "$tmp/obj"); tsha=$(sha256_of "$tmp/obj2")
        if [ "$sha" = "$tsha" ]; then
          skipped=$((skipped + 1)); printf '%s\t%s\t%s\n' "$name" "$(size_of "$tmp/obj")" "$sha" >>"$tmp/manifest"
        else
          fail_line photos "$name" "exists in the target with different bytes; not overwritten"; failed=$((failed + 1))
        fi
      else
        fail_line photos "$name" "could not download to compare"; failed=$((failed + 1))
      fi
    fi
  done <"$tmp/src.list"
  cp "$tmp/manifest" "$MIG_OUT_DIR/photo-manifest.tsv"
  rm -rf "$tmp"; st_cleanup; trap - EXIT
  log "photos  copied $copied, already present $skipped, failed $failed"
  [ "$failed" = 0 ] || return "$EXIT_FAIL"
}

# Reset part: removes target objects whose paths exist in the source, then the bucket if nothing
# else is in it. Called by step_reset when the storage variables are present.
reset_photos() {
  local tmp names n left code
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"; st_cleanup' EXIT
  objects_of source | cut -d'|' -f1 >"$tmp/src.names"
  objects_of target | cut -d'|' -f1 >"$tmp/tgt.names"
  names=$(LC_ALL=C comm -12 <(LC_ALL=C sort "$tmp/src.names") <(LC_ALL=C sort "$tmp/tgt.names"))
  n=0
  if [ -n "$names" ]; then
    n=$(printf '%s\n' "$names" | wc -l | tr -d ' ')
    printf '%s\n' "$names" | jq -Rn '{prefixes: [inputs]}' >"$tmp/del.json"
    code=$(st_req target DELETE "/object/$PHOTO_BUCKET" "$tmp/del.out" -H 'Content-Type: application/json' --data "@$tmp/del.json")
    [ "$code" = 200 ] || die "removing photos from the target failed (HTTP $code): $(head -c 300 "$tmp/del.out")"
  fi
  left=$(psql_target -v b="$PHOTO_BUCKET" -f - <<'SQL'
select count(*) from storage.objects where bucket_id = :'b'
SQL
)
  if [ -n "$(bucket_json target)" ] && [ "$left" = 0 ]; then
    code=$(st_req target DELETE "/bucket/$PHOTO_BUCKET" "$tmp/b.out")
    [ "$code" = 200 ] || warn "could not delete the empty bucket $PHOTO_BUCKET (HTTP $code)"
  fi
  rm -rf "$tmp"; st_cleanup; trap - EXIT
  log "reset   removed $n source photo(s) from the target bucket ($left other object(s) left)"
}
