#!/usr/bin/env bash
# Unit tests for lib/common.sh. No database, no network.
set -u
. "$(dirname "$0")/lib.sh"
. "$MIG_DIR/lib/columns.sh"

# U1 — version comparison
assert_eq    "U1 version_of pg_dump banner" 17.11 "$(version_of 'pg_dump (PostgreSQL) 17.11 (Homebrew)')"
assert_eq    "U1 version_of bare major"     17.0  "$(version_of 17)"
assert_true  "U1 17.11 >= 17"     version_ge 17.11 17
assert_true  "U1 17 >= 17"        version_ge 17 17
assert_false "U1 15 >= 17"        version_ge 15 17
assert_true  "U1 17.11 >= 17.4"   version_ge 17.11 17.4
assert_false "U1 17.4 >= 17.11"   version_ge 17.4 17.11
assert_true  "U1 18.0 >= 17.11"   version_ge 18.0 17.11
assert_false "U1 not a version"   version_ge abc 17

# U2 — project refs from every URL shape
REF=abcdefghijklmnopqrst
assert_eq   "U2 direct URL ref" $REF "$(db_url_ref "postgresql://postgres:pw@db.$REF.supabase.co:5432/postgres")"
assert_eq   "U2 session pooler ref" $REF \
  "$(db_url_ref "postgresql://postgres.$REF:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres")"
assert_eq   "U2 postgres:// scheme" $REF "$(db_url_ref "postgres://postgres:pw@db.$REF.supabase.co/postgres")"
assert_eq   "U2 '@' in password keeps host" $REF "$(db_url_ref "postgresql://postgres:p@ss@db.$REF.supabase.co:5432/postgres")"
assert_false "U2 pooler host with plain user" db_url_ref "postgresql://postgres:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
assert_false "U2 non-Supabase host" db_url_ref "postgresql://postgres:pw@localhost:5432/postgres"
assert_false "U2 not a URL" db_url_ref "host=db.$REF.supabase.co"
assert_eq   "U2 Supabase API URL ref" $REF "$(api_url_ref "https://$REF.supabase.co")"
assert_eq   "U2 API URL trailing slash" $REF "$(api_url_ref "https://$REF.supabase.co/")"
assert_false "U2 API URL over http" api_url_ref "http://$REF.supabase.co"
assert_eq   "U2 redact hides password" "postgres@db.$REF.supabase.co:5432/postgres" \
  "$(redact_db_url "postgresql://postgres:s3cret@db.$REF.supabase.co:5432/postgres")"
assert_eq   "U2 redact default port and db" "postgres@db.$REF.supabase.co:5432/postgres" \
  "$(redact_db_url "postgresql://postgres:s3cret@db.$REF.supabase.co")"

assert_eq "U2 problem: doubled prefix" "starts with 'postgresql:postgresql:' instead of postgresql://" \
  "$(db_url_problem "postgresql:postgresql://postgres:pw@db.$REF.supabase.co:5432/postgres")"
assert_eq "U2 problem: whitespace" "contains whitespace" "$(db_url_problem "postgresql://postgres:pw @db.$REF.supabase.co")"
assert_eq "U2 problem: quotes" "contains quote characters" "$(db_url_problem "\"postgresql://postgres:pw@db.$REF.supabase.co\"")"
assert_eq "U2 problem: no @" "has no '@' between user:password and host" "$(db_url_problem "postgresql://db.$REF.supabase.co")"

# U3 — connection kinds
assert_eq "U3 direct"              direct             "$(db_url_kind "postgresql://postgres:pw@db.$REF.supabase.co:5432/postgres")"
assert_eq "U3 session pooler"      session-pooler     "$(db_url_kind "postgresql://postgres.$REF:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres")"
assert_eq "U3 transaction pooler"  transaction-pooler "$(db_url_kind "postgresql://postgres.$REF:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres")"
assert_eq "U3 6543 on direct host" transaction-pooler "$(db_url_kind "postgresql://postgres:pw@db.$REF.supabase.co:6543/postgres")"
assert_eq "U3 unknown"             unknown            "$(db_url_kind "postgresql://postgres:pw@localhost/postgres")"

# U4 — schema-prefix normalisation used by the structure check
TARGET_SCHEMA=fitfine
norm() { printf '%s\n' "$1" | normalize_schema_prefix; }
assert_eq "U4 public function"  "is_active_admin()"  "$(norm 'public.is_active_admin()')"
assert_eq "U4 target sequence"  "nextval('members_id_seq'::regclass)" "$(norm "nextval('fitfine.members_id_seq'::regclass)")"
assert_eq "U4 quoted schema"    'members(id)'        "$(norm '"public".members(id)')"
assert_eq "U4 both sides equal" "$(norm 'REFERENCES public.profiles(id)')" "$(norm 'REFERENCES fitfine.profiles(id)')"
assert_eq "U4 auth untouched"   "auth.uid()"         "$(norm 'auth.uid()')"
assert_eq "U4 longer name untouched" "mypublic.x"    "$(norm 'mypublic.x')"
assert_eq "U4 several in a line" "a(x) b(y)"         "$(norm 'public.a(x) fitfine.b(y)')"

# U6 — report line format and exit codes
assert_eq "U6 FAIL line" "FAIL content members row hash differs" "$(fail_line content members 'row hash differs')"
assert_eq "U6 ok line"   "ok   counts members"  "$(ok_line counts members)"
assert_eq "U6 exit codes" "0 1 2 3" "$EXIT_OK $EXIT_FAIL $EXIT_REFUSED $EXIT_SOURCE_CHANGED"
assert_eq "U6 refuse exits 2" 2 "$( (refuse x) 2>/dev/null; echo $?)"

# U7 — env file parsing
envf=$(mktemp); trap 'rm -f "$envf"' EXIT
cat >"$envf" <<'EOF'
# comment
   # indented comment

U7_PLAIN=plain
U7_COMMENT=value   # trailing comment
U7_DQ="has # hash and spaces"
U7_SQ='single quoted'
export U7_EXPORTED=yes
U7_URL=postgresql://postgres:pa%23ss@db.x.supabase.co:5432/postgres
U7_SHELL=from-file
U7_EMPTY=
EOF
U7_SHELL=from-shell
load_env "$envf"
assert_eq "U7 plain value"           plain                  "${U7_PLAIN-}"
assert_eq "U7 inline comment dropped" value                 "${U7_COMMENT-}"
assert_eq "U7 double quotes kept #"  "has # hash and spaces" "${U7_DQ-}"
assert_eq "U7 single quotes"         "single quoted"         "${U7_SQ-}"
assert_eq "U7 export prefix"         yes                     "${U7_EXPORTED-}"
assert_eq "U7 URL intact"            "postgresql://postgres:pa%23ss@db.x.supabase.co:5432/postgres" "${U7_URL-}"
assert_eq "U7 shell value wins"      from-shell              "$U7_SHELL"
assert_eq "U7 empty value set"       "set:"                  "${U7_EMPTY+set:}${U7_EMPTY-}"
assert_true "U7 missing file is fine" load_env /nonexistent/.env

# U8 — TARGET_SCHEMA allow-list (it is dropped with CASCADE by --reset)
assert_true  "U8 fitfine allowed"       valid_target_schema fitfine
assert_true  "U8 fitfine_scratch allowed" valid_target_schema fitfine_scratch
for s in public auth storage extensions realtime vault pg_catalog pg_temp information_schema Fitfine fit-fine '' '1abc'; do
  assert_false "U8 '$s' refused" valid_target_schema "$s"
done

# U5 — column-list comparison rules
A=$'id|uuid|no|false\nname|text|no|false'
cmp() { compare_columns "$@" 2>/dev/null; }
assert_eq   "U5 strict identical -> quoted copy list" '"id","name"' "$(cmp 1 "$A" "$A")"
assert_false "U5 strict source-only column stops"  cmp 1 "$A" 'id|uuid|no|false'
assert_false "U5 strict target-only column stops"  cmp 1 'id|uuid|no|false' "$A"
assert_false "U5 strict type difference stops"     cmp 1 "$A" $'id|uuid|no|false\nname|integer|no|false'
assert_eq   "U5 auth identical"                    '"id","name"' "$(cmp 0 "$A" "$A")"
assert_false "U5 auth source-only column stops"    cmp 0 "$A" 'id|uuid|no|false'
assert_eq   "U5 auth target-only nullable allowed" '"id","name"' "$(cmp 0 "$A" "$A"$'\nextra|text|yes|false')"
assert_eq   "U5 auth target-only default allowed"  '"id","name"' "$(cmp 0 "$A" "$A"$'\nextra|text|no|true')"
assert_false "U5 auth target-only NOT NULL stops"  cmp 0 "$A" "$A"$'\nextra|text|no|false'

t_summary unit
