# --validate photo checks (spec section 7): photo-files, bucket-settings, photo-linkage,
# photo-orphans, photo-access. Needs the Storage variables. Read-only on both sides.
# Sourced by lib/validate.sh after validate/db.sh (uses vfail, q_src, q_tgt).

# member_photos SIDE: "id|photo_url path|thumbnail path" (empty when null) for every member row.
member_photos() {
  local side=$1 schema=public line id u t
  [ "$side" = target ] && schema=$TARGET_SCHEMA
  while IFS='|' read -r id u t; do
    [ -n "$id" ] || continue
    [ -z "$u" ] || u=$(photo_path "$u")
    [ -z "$t" ] || t=$(photo_path "$t")
    printf '%s|%s|%s\n' "$id" "$u" "$t"
  done < <(if [ "$side" = source ]; then q_src -v s="$schema" -f -; else q_tgt -v s="$schema" -f -; fi <<'SQL'
select id || '|' || coalesce(photo_url, '') || '|' || coalesce(photo_thumbnail_url, '') from :"s".members order by id
SQL
)
}

# referenced SIDE_FILE: all non-empty paths referenced by members, one per line, sorted unique.
referenced() { awk -F'|' '{ if ($2 != "") print $2; if ($3 != "") print $3 }' "$1" | LC_ALL=C sort -u; }

validate_photos() {
  local tmp=$1 before=$V_FAILS name size mime etag t_line t_size sha tsha src_n tgt_n src_b tgt_b
  local id u t first code url ctype
  # --- bucket-settings ---
  if [ "$(bucket_json source)" = "$(bucket_json target)" ] && [ -n "$(bucket_json target)" ]; then
    ok_line bucket-settings "public flag, size limit and allowed mime types equal the source"
  else
    vfail bucket-settings "$PHOTO_BUCKET" "source $(bucket_json source), target $(bucket_json target)"
  fi

  # --- photo-files ---
  objects_of source >"$tmp/p.src"; objects_of target >"$tmp/p.tgt"
  before=$V_FAILS
  src_n=$(wc -l <"$tmp/p.src" | tr -d ' '); tgt_n=$(wc -l <"$tmp/p.tgt" | tr -d ' ')
  src_b=$(awk -F'|' '{s += $2} END {print s + 0}' "$tmp/p.src"); tgt_b=$(awk -F'|' '{s += $2} END {print s + 0}' "$tmp/p.tgt")
  [ "$src_n" = "$tgt_n" ] || vfail photo-files "$PHOTO_BUCKET" "object count: source $src_n, target $tgt_n"
  [ "$src_b" = "$tgt_b" ] || vfail photo-files "$PHOTO_BUCKET" "total bytes: source $src_b, target $tgt_b"
  while IFS='|' read -r name size mime etag; do
    [ -n "$name" ] || continue
    t_line=$(lookup_line "$tmp/p.tgt" "$name")
    if [ -z "$t_line" ]; then vfail photo-files "$name" "missing in the target"; continue; fi
    if ! st_download source "$PHOTO_BUCKET" "$name" "$tmp/f.src"; then vfail photo-files "$name" "cannot download from the source"; continue; fi
    if ! st_download target "$PHOTO_BUCKET" "$name" "$tmp/f.tgt"; then vfail photo-files "$name" "cannot download from the target"; continue; fi
    sha=$(sha256_of "$tmp/f.src"); tsha=$(sha256_of "$tmp/f.tgt")
    if [ "$(size_of "$tmp/f.src")" != "$(size_of "$tmp/f.tgt")" ]; then
      vfail photo-files "$name" "size differs: source $(size_of "$tmp/f.src"), target $(size_of "$tmp/f.tgt")"
    elif [ "$sha" != "$tsha" ]; then
      vfail photo-files "$name" "SHA-256 differs: source $sha, target $tsha"
    fi
  done <"$tmp/p.src"
  [ "$V_FAILS" != "$before" ] || ok_line photo-files "$src_n files: size and SHA-256 equal on both sides"

  # --- photo-linkage ---
  before=$V_FAILS
  member_photos source >"$tmp/m.src"; member_photos target >"$tmp/m.tgt"
  cut -d'|' -f1 "$tmp/p.tgt" | LC_ALL=C sort >"$tmp/p.tgt.names"
  while IFS='|' read -r id u t; do
    for first in "$u" "$t"; do
      [ -n "$first" ] || continue
      grep -qxF -- "$first" "$tmp/p.tgt.names" || vfail photo-linkage "member $id" "points at $first, which does not exist in the target bucket"
      [ "${first%%/*}" = "$id" ] || vfail photo-linkage "member $id" "points at $first, which belongs to member ${first%%/*}"
    done
    if [ -n "$u" ] && [ -z "$t" ] && [ -n "$(awk -F'|' -v i="$id" '$1 == i && $3 != "" {print 1}' "$tmp/m.src")" ]; then
      vfail photo-linkage "member $id" "has a photo but lost its thumbnail (the source has both)"
    fi
    if [ -z "$u" ] && [ -n "$t" ] && [ -n "$(awk -F'|' -v i="$id" '$1 == i && $2 != "" {print 1}' "$tmp/m.src")" ]; then
      vfail photo-linkage "member $id" "has a thumbnail but lost its photo (the source has both)"
    fi
  done <"$tmp/m.tgt"
  [ "$V_FAILS" != "$before" ] || ok_line photo-linkage "every photo path resolves to the member's own file in the target"

  # --- photo-orphans: unreferenced files and dangling paths, target vs the same lists on the source ---
  before=$V_FAILS
  referenced "$tmp/m.src" >"$tmp/ref.src"; referenced "$tmp/m.tgt" >"$tmp/ref.tgt"
  cut -d'|' -f1 "$tmp/p.src" | LC_ALL=C sort >"$tmp/p.src.names"
  LC_ALL=C comm -23 "$tmp/p.src.names" "$tmp/ref.src" >"$tmp/orph.src"       # files nobody references
  LC_ALL=C comm -23 "$tmp/p.tgt.names" "$tmp/ref.tgt" >"$tmp/orph.tgt"
  LC_ALL=C comm -13 "$tmp/p.src.names" "$tmp/ref.src" >"$tmp/dang.src"        # paths without a file
  LC_ALL=C comm -13 "$tmp/p.tgt.names" "$tmp/ref.tgt" >"$tmp/dang.tgt"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if grep -qxF -- "$name" "$tmp/orph.src"; then warn "photo-orphans $name is unreferenced in the source too (pre-existing)"
    else vfail photo-orphans "$name" "file in the target bucket that no member references (new, not in the source's orphans)"; fi
  done <"$tmp/orph.tgt"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if grep -qxF -- "$name" "$tmp/dang.src"; then warn "photo-orphans $name is referenced but missing in the source too (pre-existing)"
    else vfail photo-orphans "$name" "member path without a file in the target (new, not in the source's dangling paths)"; fi
  done <"$tmp/dang.tgt"
  [ "$V_FAILS" != "$before" ] || ok_line photo-orphans "unreferenced files and dangling paths equal the source's (see WARN lines)"

  # --- photo-access: a signed URL for every referenced photo returns 200 and an image ---
  before=$V_FAILS
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    grep -qxF -- "$name" "$tmp/p.tgt.names" || continue   # already reported by photo-linkage
    code=$(st_req target POST "/object/sign/$PHOTO_BUCKET/$(st_enc "$name")" "$tmp/sign.out" \
      -H 'Content-Type: application/json' --data '{"expiresIn": 120}')
    if [ "$code" != 200 ]; then vfail photo-access "$name" "signing failed (HTTP $code)"; continue; fi
    url=$(jq -r '.signedURL // .signedUrl // empty' "$tmp/sign.out")
    case $url in /*) url="$(st_base target)/storage/v1$url" ;; esac
    [ -n "$url" ] || { vfail photo-access "$name" "no signed URL in the response"; continue; }
    ctype=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' --connect-timeout 10 --max-time 60 "$url" 2>/dev/null || printf '000 ')
    case $ctype in
      "200 image/"*) ;;
      *) vfail photo-access "$name" "signed URL returned '$ctype' (want 200 image/*)" ;;
    esac
  done <"$tmp/ref.tgt"
  [ "$V_FAILS" != "$before" ] || ok_line photo-access "$(wc -l <"$tmp/ref.tgt" | tr -d ' ') referenced photos open through signed URLs as images"
}
