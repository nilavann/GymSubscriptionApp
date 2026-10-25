# Supabase Storage helpers (HTTP API via curl) and bucket/object lists read from storage.* in the
# databases. Sourced by run.sh and the tests. Service-role keys are passed to curl through a 0600
# header file, never on the command line, so they do not show in `ps`.

ST_TMP=''

st_init() {
  [ -n "$ST_TMP" ] && [ -d "$ST_TMP" ] && return 0
  ST_TMP=$(mktemp -d)
  chmod 700 "$ST_TMP"
  local side key
  for side in source target; do
    if [ $side = source ]; then key=${SOURCE_SERVICE_ROLE_KEY-}; else key=${TARGET_SERVICE_ROLE_KEY-}; fi
    [ -n "$key" ] || continue
    ( umask 077; printf 'apikey: %s\nAuthorization: Bearer %s\n' "$key" "$key" >"$ST_TMP/$side.hdr" )
  done
}
st_cleanup() { [ -z "$ST_TMP" ] || rm -rf "$ST_TMP"; ST_TMP=''; }

st_base() { if [ "$1" = source ]; then printf '%s' "${SOURCE_SUPABASE_URL%/}"; else printf '%s' "${TARGET_SUPABASE_URL%/}"; fi; }

# URL-encodes each path segment, keeps the slashes.
st_enc() { printf '%s' "$1" | jq -sRr 'split("/") | map(@uri) | join("/")'; }

# st_req SIDE METHOD API_PATH OUTFILE [curl args...]: prints the HTTP status (000 on a transport failure).
st_req() {
  local side=$1 method=$2 path=$3 out=$4
  shift 4
  st_init
  curl -sS -o "$out" -w '%{http_code}' -X "$method" -H "@$ST_TMP/$side.hdr" \
    --connect-timeout 10 --max-time 120 "$(st_base "$side")/storage/v1$path" "$@" 2>>"$ST_TMP/curl.err" || printf '000'
}

# st_download SIDE BUCKET PATH OUTFILE: returns 0 on HTTP 200.
st_download() {
  local code
  code=$(st_req "$1" GET "/object/authenticated/$2/$(st_enc "$3")" "$4")
  [ "$code" = 200 ]
}

# st_upload TARGET BUCKET PATH FILE MIME: never overwrites (x-upsert false). Returns 0 on HTTP 200.
st_upload() {
  local code
  code=$(st_req target POST "/object/$1/$(st_enc "$2")" "$ST_TMP/up.out" \
    -H "Content-Type: ${4:-application/octet-stream}" -H 'x-upsert: false' --data-binary "@$3")
  [ "$code" = 200 ] || { printf '%s\n' "HTTP $code $(head -c 200 "$ST_TMP/up.out" 2>/dev/null)" >"$ST_TMP/up.err"; return 1; }
}

sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
size_of()   { wc -c <"$1" | tr -d ' '; }

# bucket_json SIDE: {"public":..,"file_size_limit":..,"allowed_mime_types":..} from storage.buckets,
# or nothing when the bucket does not exist.
bucket_json() {
  local runner=psql_source
  [ "$1" = source ] || runner=psql_target_ro
  $runner -v b="$PHOTO_BUCKET" -f - <<'SQL' | jq -S -c . 2>/dev/null
select json_build_object('public', public, 'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types)::text
from storage.buckets where id = :'b'
SQL
}

# objects_of SIDE: "name|size|mimetype|etag", sorted by name; placeholder objects excluded.
objects_of() {
  local runner=psql_source
  [ "$1" = source ] || runner=psql_target_ro
  $runner -v b="$PHOTO_BUCKET" -f - <<'SQL' | LC_ALL=C sort
select name || '|' || coalesce(metadata->>'size', '') || '|' || coalesce(metadata->>'mimetype', '') || '|' ||
       coalesce(metadata->>'eTag', metadata->>'etag', '')
from storage.objects where bucket_id = :'b' and name not like '%.emptyFolderPlaceholder'
SQL
}

# lookup_line FILE NAME: the first line of FILE whose first '|' field is NAME.
lookup_line() { awk -F'|' -v n="$2" '$1 == n { print; exit }' "$1"; }

# photo_path VALUE: members.photo_url may be a bare object path or a Storage URL
# (.../object/{public|sign|authenticated}/<bucket>/<path>[?token=...]); returns the object path.
photo_path() {
  local v=$1
  case $v in
    *"/object/"*"/$PHOTO_BUCKET/"*) v=${v#*"/$PHOTO_BUCKET/"}; v=${v%%\?*} ;;
  esac
  printf '%s' "$v"
}
