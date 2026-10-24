# Shared helpers for run.sh, validate/ and tests/: env loading, URL parsing, psql wrappers,
# safety checks, logging. Sourced, never executed. Bash 3.2 compatible (macOS /bin/bash):
# no associative arrays, no mapfile, no ${x,,}, no "${empty[@]}" under set -u.

MIG_DIR=${MIG_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}

EXIT_OK=0
EXIT_FAIL=1
EXIT_REFUSED=2
EXIT_SOURCE_CHANGED=3

# Schemas TARGET_SCHEMA may never be: --reset drops TARGET_SCHEMA with CASCADE.
MIG_RESERVED_SCHEMAS="public auth storage extensions graphql graphql_public realtime vault pgbouncer net cron supabase_functions supabase_migrations information_schema"

# Applied at the start of every session so text forms (timestamps, floats) are identical
# whatever the client's PGTZ / PGDATESTYLE, which the content checksums depend on.
MIG_SESSION_SQL="SET TimeZone = 'UTC'; SET DateStyle = 'ISO, YMD'; SET IntervalStyle = 'postgres'; SET extra_float_digits = 3; SET client_min_messages = warning"

log()    { printf '%s\n' "$*" >&2; }
warn()   { printf 'WARN %s\n' "$*" >&2; }
refuse() { printf 'REFUSED %s\n' "$*" >&2; exit "$EXIT_REFUSED"; }
die()    { printf 'ERROR %s\n' "$*" >&2; exit "$EXIT_FAIL"; }

# Report lines (stdout). Tests match on "FAIL <check-id> <table-or-path>".
fail_line() { printf 'FAIL %s %s %s\n' "$1" "$2" "${3-}"; }
ok_line()   { printf 'ok   %s %s\n' "$1" "${2-}"; }

# --- env file -------------------------------------------------------------------------------

# KEY=VALUE lines; blank lines and '#' comments ignored; surrounding quotes stripped; an unquoted
# value loses a trailing " # comment". A variable already set in the shell wins over the file.
load_env() {
  local file=$1 line key value re='^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$'
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    line=${line#"${line%%[![:space:]]*}"}
    case $line in ''|'#'*) continue ;; esac
    [[ $line =~ $re ]] || continue
    key=${BASH_REMATCH[2]}
    value=${BASH_REMATCH[3]}
    case $value in
      \"*\") value=${value#\"}; value=${value%\"} ;;
      \'*\') value=${value#\'}; value=${value%\'} ;;
      *)     value=${value%%[[:space:]]#*}
             while [ "${value% }" != "$value" ] || [ "${value%$'\t'}" != "$value" ]; do
               value=${value% }; value=${value%$'\t'}
             done ;;
    esac
    if eval "[ -z \"\${$key+x}\" ]"; then
      export "$key=$value"
    fi
  done <"$file"
}

# Refuses naming every missing variable at once.
require_vars() {
  local v val missing=''
  for v in "$@"; do
    eval "val=\${$v-}"
    [ -n "$val" ] || missing="$missing $v"
  done
  [ -z "$missing" ] || refuse "missing required variable(s):$missing"
}

# --- URLs -----------------------------------------------------------------------------------

# Sets DBU_USER DBU_HOST DBU_PORT DBU_DB from a postgres URL; returns 1 if it does not parse.
# The password group is greedy so an unencoded '@' in it still leaves the host intact.
parse_db_url() {
  local re='^postgres(ql)?://([^:@/]+)(:.*)?@([^:/?@]+)(:([0-9]+))?(/([^?]*))?(\?.*)?$'
  DBU_USER='' DBU_HOST='' DBU_PORT='' DBU_DB=''
  [[ $1 =~ $re ]] || return 1
  DBU_USER=${BASH_REMATCH[2]}
  DBU_HOST=${BASH_REMATCH[4]}
  DBU_PORT=${BASH_REMATCH[6]:-5432}
  DBU_DB=${BASH_REMATCH[8]:-postgres}
}

# user@host:port/db — never the password. Used in every message that names a connection.
redact_db_url() {
  parse_db_url "$1" || { printf '<unparseable URL>'; return; }
  printf '%s@%s:%s/%s' "$DBU_USER" "$DBU_HOST" "$DBU_PORT" "$DBU_DB"
}

# Why a value is not a postgres URL, without echoing it (it contains the password).
db_url_problem() {
  local u=$1 scheme_re='^postgres(ql)?://'
  case $u in *[[:space:]]*) printf 'contains whitespace'; return ;; esac
  case $u in *\"*|*\'*) printf 'contains quote characters'; return ;; esac
  [[ $u =~ $scheme_re ]] || { printf "starts with '%s' instead of postgresql://" "${u%%//*}"; return; }
  case ${u#*://} in *@*) ;; *) printf "has no '@' between user:password and host"; return ;; esac
  printf 'host, port or database part is malformed'
}

# Project ref from a direct URL (host db.<ref>.supabase.co) or a pooler URL
# (user postgres.<ref>, host *.pooler.supabase.com). Returns 1 for any other shape.
db_url_ref() {
  local direct='^db\.([a-z0-9]+)\.supabase\.co$' pooler_host='\.pooler\.supabase\.com$' pooler_user='^postgres\.([a-z0-9]+)$'
  parse_db_url "$1" || return 1
  if [[ $DBU_HOST =~ $direct ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  elif [[ $DBU_HOST =~ $pooler_host ]] && [[ $DBU_USER =~ $pooler_user ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  else
    return 1
  fi
}

# Project ref from https://<ref>.supabase.co
api_url_ref() {
  local re='^https://([a-z0-9]+)\.supabase\.co/?$'
  [[ $1 =~ $re ]] || return 1
  printf '%s' "${BASH_REMATCH[1]}"
}

# direct | session-pooler | transaction-pooler | unknown
db_url_kind() {
  local pooler_host='\.pooler\.supabase\.com$' direct='^db\.[a-z0-9]+\.supabase\.co$'
  parse_db_url "$1" || { printf 'unknown'; return; }
  if [ "$DBU_PORT" = 6543 ]; then printf 'transaction-pooler'
  elif [[ $DBU_HOST =~ $pooler_host ]]; then printf 'session-pooler'
  elif [[ $DBU_HOST =~ $direct ]]; then printf 'direct'
  else printf 'unknown'
  fi
}

# --- versions -------------------------------------------------------------------------------

# First "major[.minor]" in a string, e.g. "pg_dump (PostgreSQL) 17.11 (Homebrew)" -> 17.11
version_of() {
  local re='([0-9]+)(\.([0-9]+))?'
  [[ $1 =~ $re ]] || return 1
  printf '%s.%s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[3]:-0}"
}

# version_ge A B: true when A >= B, comparing major then minor numerically.
version_ge() {
  local a b a1 a2 b1 b2
  a=$(version_of "$1") || return 1
  b=$(version_of "$2") || return 1
  a1=${a%%.*} a2=${a#*.} b1=${b%%.*} b2=${b#*.}
  [ "$a1" -gt "$b1" ] && return 0
  [ "$a1" -lt "$b1" ] && return 1
  [ "$a2" -ge "$b2" ]
}

# --- schema names ---------------------------------------------------------------------------

valid_target_schema() {
  local s=$1 r re='^[a-z_][a-z0-9_]*$'
  [[ $s =~ $re ]] || return 1
  case $s in pg_*) return 1 ;; esac
  for r in $MIG_RESERVED_SCHEMAS; do [ "$s" = "$r" ] && return 1; done
  return 0
}

# Removes the "public." / "<target>." qualifier (optionally quoted) from definitions read from
# either side, so `structure` compares shapes, not schema names. Other schemas (auth.uid()) stay.
normalize_schema_prefix() {
  sed -E "s/(^|[^[:alnum:]_\"])\"?(public|${TARGET_SCHEMA:-fitfine})\"?\./\1/g"
}

# --- psql -----------------------------------------------------------------------------------

# Each -c is its own transaction, so the session SETs (incl. read-only) apply to everything after.
psql_base()      { PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-10} PGAPPNAME=migrate-to-fitfine psql -X -q -v ON_ERROR_STOP=1 -At "$@"; }
psql_source()    { psql_base -d "$SOURCE_DB_URL" -c "$MIG_SESSION_SQL; SET default_transaction_read_only = on" "$@"; }
psql_target()    { psql_base -d "$TARGET_DB_URL" -c "$MIG_SESSION_SQL" "$@"; }
psql_target_ro() { psql_base -d "$TARGET_DB_URL" -c "$MIG_SESSION_SQL; SET default_transaction_read_only = on" "$@"; }

# Table names (one per line) from sql/tables.txt.
mig_tables() { grep -vE '^[[:space:]]*(#|$)' "$MIG_DIR/sql/tables.txt"; }

# --- preflight ------------------------------------------------------------------------------

# preflight NEED_STORAGE(0|1). Every check here stops with exit 2 before anything is written.
preflight() {
  local need_storage=${1:-0} side url v ref kind src_ref tgt_ref api out err
  local src_id tgt_id src_ver tgt_ver dump_ver ro

  if [ "$need_storage" = 1 ]; then
    require_vars SOURCE_DB_URL TARGET_DB_URL TARGET_SCHEMA \
      SOURCE_SUPABASE_URL SOURCE_SERVICE_ROLE_KEY TARGET_SUPABASE_URL TARGET_SERVICE_ROLE_KEY PHOTO_BUCKET
  else
    require_vars SOURCE_DB_URL TARGET_DB_URL TARGET_SCHEMA
  fi
  valid_target_schema "$TARGET_SCHEMA" ||
    refuse "TARGET_SCHEMA '$TARGET_SCHEMA' is not allowed (must be a plain lowercase name, not a Supabase or system schema)"

  for side in source target; do
    if [ $side = source ]; then url=$SOURCE_DB_URL; else url=$TARGET_DB_URL; fi
    if [ $side = source ]; then v=SOURCE_DB_URL; else v=TARGET_DB_URL; fi
    parse_db_url "$url" || refuse "$side: $v is not a postgresql://user:password@host:port/db URL ($(db_url_problem "$url"))"
    kind=$(db_url_kind "$url")
    [ "$kind" != transaction-pooler ] ||
      refuse "$side: $(redact_db_url "$url") is the transaction pooler (port 6543); use the direct URL or the session pooler (port 5432)"
    ref=$(db_url_ref "$url") ||
      refuse "$side: $(redact_db_url "$url") is not a Supabase direct or session-pooler URL"
    if [ $side = source ]; then src_ref=$ref; else tgt_ref=$ref; fi
  done
  [ "$src_ref" != "$tgt_ref" ] || refuse "source and target are the same project ($src_ref)"

  for side in source target; do
    if [ $side = source ]; then url=${SOURCE_SUPABASE_URL-}; ref=$src_ref; else url=${TARGET_SUPABASE_URL-}; ref=$tgt_ref; fi
    [ -n "$url" ] || continue
    api=$(api_url_ref "$url") || refuse "$side: Supabase URL '$url' is not https://<ref>.supabase.co"
    [ "$api" = "$ref" ] || refuse "$side: Supabase URL ref $api differs from its DB URL ref $ref"
  done

  err=$(mktemp)
  out=$(psql_source -c "select coalesce(inet_server_addr()::text, 'local') || '|' || inet_server_port() || '|' || current_database() || '|' || pg_postmaster_start_time() || '|' || current_setting('server_version_num') || '|' || current_setting('transaction_read_only')" 2>"$err") ||
    { local e; e=$(head -1 "$err"); rm -f "$err"; refuse "source database unreachable ($(redact_db_url "$SOURCE_DB_URL")): $e"; }
  src_id=${out%|*}; src_id=${src_id%|*}; src_ver=${out%|*}; src_ver=${src_ver##*|}; ro=${out##*|}
  out=$(psql_target -c "select coalesce(inet_server_addr()::text, 'local') || '|' || inet_server_port() || '|' || current_database() || '|' || pg_postmaster_start_time() || '|' || current_setting('server_version_num')" 2>"$err") ||
    { local e; e=$(head -1 "$err"); rm -f "$err"; refuse "target database unreachable ($(redact_db_url "$TARGET_DB_URL")): $e"; }
  rm -f "$err"
  tgt_id=${out%|*}; tgt_ver=${out##*|}

  [ "$src_id" != "$tgt_id" ] || refuse "source and target connections reach the same server and database"
  [ "$ro" = on ] || refuse "source session is not read-only (transaction_read_only=$ro)"

  src_ver="$((src_ver / 10000)).$((src_ver % 10000))"
  tgt_ver="$((tgt_ver / 10000)).$((tgt_ver % 10000))"
  dump_ver=$(version_of "$(pg_dump --version 2>/dev/null)") || refuse "pg_dump not found on PATH"
  version_ge "$dump_ver" "${src_ver%%.*}" ||
    refuse "pg_dump $dump_ver is older than the source server (PostgreSQL $src_ver); install pg_dump ${src_ver%%.*} or newer"
  version_ge "${tgt_ver%%.*}" "${src_ver%%.*}" ||
    refuse "target server PostgreSQL $tgt_ver is an older major version than the source ($src_ver)"

  log "source  $src_ref  $(db_url_kind "$SOURCE_DB_URL")  PostgreSQL $src_ver  read-only"
  log "target  $tgt_ref  $(db_url_kind "$TARGET_DB_URL")  PostgreSQL $tgt_ver  schema $TARGET_SCHEMA"
  log "pg_dump $dump_ver"
  MIG_SOURCE_REF=$src_ref
  MIG_TARGET_REF=$tgt_ref
  preflight_sizes
  log "preflight ok"
}

# Logs what will be copied, against the free-tier limits, before anything is written.
preflight_sizes() {
  local tables list db_bytes photo
  tables=$(mig_tables | sed "s/.*/'&'/" | paste -sd, -)
  db_bytes=$(psql_source -c "select coalesce(sum(pg_total_relation_size(c.oid)), 0)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where (n.nspname = 'public' and c.relname in ($tables) and c.relkind = 'r')
         or (n.nspname = 'auth' and c.relname in ('users', 'identities') and c.relkind = 'r')")
  log "data    $((db_bytes / 1048576)) MB (11 tables + auth.users/identities, incl. indexes)"
  [ "$db_bytes" -lt 524288000 ] || warn "data is over the 500 MB free-tier database limit"
  if [ -n "${PHOTO_BUCKET-}" ]; then
    photo=$(psql_source -v bucket="$PHOTO_BUCKET" -f - <<'SQL'
select count(*) || '|' || coalesce(sum((metadata->>'size')::bigint), 0)
from storage.objects where bucket_id = :'bucket';
SQL
)
    log "photos  ${photo%|*} objects, $((${photo#*|} / 1048576)) MB in bucket $PHOTO_BUCKET"
    [ "${photo#*|}" -lt 1073741824 ] || warn "photos are over the 1 GB free-tier storage limit"
  fi
}
