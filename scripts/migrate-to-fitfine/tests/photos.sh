#!/usr/bin/env bash
# MIG-1.6: --photos (S6, S7, S8), reset with foreign objects (S9), --all end to end (S12) and the
# photo validator sabotage V19-V26. Leaves the target without TARGET_SCHEMA, source users and photos.
set -u
. "$(dirname "$0")/lib.sh"
. "$MIG_DIR/lib/storage.sh"
envf=${MIG_ENV_FILE:-$MIG_DIR/.env}
load_env "$envf"
ref=$(target_ref)
schema=$TARGET_SCHEMA
bucket=$PHOTO_BUCKET

tq() { psql_target -v schema="$schema" -f -; }
run() { mig_run "$envf" -- "$@"; }
validate() { run --validate; }
fresh() { run --reset --confirm-target "$ref" >/dev/null 2>&1; }
rebuild() { run --reset --confirm-target "$ref" --create --load --photos >/dev/null 2>&1; }
tgt_objects() { psql_target -c "select count(*) || '/' || coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = '$bucket' and name not like '%.emptyFolderPlaceholder'"; }
src_objects() { psql_source -c "select count(*) || '/' || coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = '$bucket' and name not like '%.emptyFolderPlaceholder'"; }
first_source_object() { psql_source -c "select name from storage.objects where bucket_id = '$bucket' and name not like '%.emptyFolderPlaceholder' order by name limit 1"; }
tgt_delete_object() { local out; printf '%s\n' "$1" | jq -Rn '{prefixes: [inputs]}' >"$ST_TMP/d.json"; st_req target DELETE "/object/$bucket" "$ST_TMP/d.out" -H 'Content-Type: application/json' --data "@$ST_TMP/d.json" >/dev/null; }
member_with_photo() { psql_target -v off="$1" -f - <<SQL
select id || '|' || photo_url || '|' || coalesce(photo_thumbnail_url, '') from $schema.members
where photo_url is not null order by id limit 1 offset :off
SQL
}

# --- S6 ---
fresh; st_init
run --create --load >/dev/null 2>&1
expect_run "S6 --photos copies everything" 0 'photos  copied [0-9]+, already present 0, failed 0' run --photos
assert_eq "S6 object count and bytes equal" "$(src_objects)" "$(tgt_objects)"
expect_run "S6 second --photos copies 0 and fails 0" 0 'photos  copied 0, already present [0-9]+, failed 0' run --photos
assert_true "S6 manifest written" test -s "${MIG_OUT_DIR:-$MIG_DIR/out}/photo-manifest.tsv"

# --- S7: a path already in the target with different bytes ---
fresh; run --create --load >/dev/null 2>&1
victim=$(first_source_object)
printf 'not the real photo' >"$ST_TMP/other.bin"
src_mime=$(psql_source -c "select metadata->>'mimetype' from storage.objects where bucket_id = '$bucket' and name = '$victim'")
run --photos >/dev/null 2>&1; tgt_delete_object "$victim"    # make sure the bucket exists, then free the path
st_upload "$bucket" "$victim" "$ST_TMP/other.bin" "$src_mime"
expect_run "S7 conflicting path reported failed, exit 1" 1 "^FAIL photos $victim " run --photos
assert_eq "S7 all other files copied" "$(src_objects | cut -d/ -f1)" "$(tgt_objects | cut -d/ -f1)"
st_download target "$bucket" "$victim" "$ST_TMP/after.bin"
assert_eq "S7 the pre-uploaded file is unchanged" "$(sha256_of "$ST_TMP/other.bin")" "$(sha256_of "$ST_TMP/after.bin")"

# --- S8: a bucket with different settings blocks the copy ---
fresh
code=$(st_req target POST /bucket "$ST_TMP/b.out" -H 'Content-Type: application/json' --data "{\"id\":\"$bucket\",\"name\":\"$bucket\",\"public\":true}")
assert_eq "S8 precondition: different bucket created" 200 "$code"
run --create --load >/dev/null 2>&1
expect_run "S8 --photos refused" 2 'exists with different settings' run --photos
assert_eq "S8 nothing copied" "0/0" "$(tgt_objects)"

# --- S9: reset leaves what did not come from the source ---
fresh; run --create --load --photos >/dev/null 2>&1
foreign_user=$(psql_target -c "insert into auth.users (id, email) values (gen_random_uuid(), 'not-from-the-source@example.invalid') returning id")
printf 'foreign' >"$ST_TMP/foreign.bin"
st_upload "$bucket" "zz-not-from-source/file.jpg" "$ST_TMP/foreign.bin" "image/jpeg"
expect_run "S9 --reset with foreign user and object" 0 'reset   removed [0-9]+ source photo' run --reset --confirm-target "$ref"
assert_eq "S9 schema gone" 0 "$(psql_target -c "select count(*) from pg_namespace where nspname = '$schema'")"
src_ids=$(psql_source -c "select string_agg(id::text, ',') from auth.users")
assert_eq "S9 source users gone" 0 "$(psql_target -c "select count(*) from auth.users where id = any(string_to_array('$src_ids', ',')::uuid[])")"
assert_eq "S9 the foreign user is still there" 1 "$(psql_target -c "select count(*) from auth.users where id = '$foreign_user'")"
assert_eq "S9 only the foreign object is left" "1/7" "$(tgt_objects)"
# The foreign user and object are removed before --all: the new project hosts only this app (D2), so a
# stray object in the bucket is rightly reported by photo-files / photo-orphans.
psql_target -c "delete from auth.users where id = '$foreign_user'" >/dev/null
tgt_delete_object "zz-not-from-source/file.jpg"
expect_run "S9 --all after the reset is green" 0 'validate: all checks ok' run --all

# --- S12: --all from an empty target ---
fresh
expect_run "S12 --all end to end" 0 'validate: all checks ok' run --all

# --- V19-V26 ---
# psab ID PRIMARY "SECONDARY..." APPLY_FN UNDO_FN: APPLY_FN returns 0 when it sabotaged, 9 when the
# bucket refused (passes as "blocked by the bucket"), anything else is a broken test.
psab() {
  local id=$1 primary=$2 secondary=$3 apply=$4 undo=$5 rc out line fid bad=''
  "$apply"; rc=$?
  if [ $rc = 9 ]; then t_ok "$id blocked by the bucket (rejection recorded: $PSAB_NOTE)"; "$undo"; return; fi
  [ $rc = 0 ] || { t_bad "$id sabotage could not be applied" "$PSAB_NOTE"; "$undo"; return; }
  out=$(validate 2>&1) && rc=0 || rc=$?
  if [ $rc = 0 ]; then t_bad "$id validation still green" "$out"
  else
    printf '%s\n' "$out" | grep -Eq "^FAIL $primary " || bad="no FAIL $primary line"
    while IFS= read -r line; do
      fid=$(printf '%s' "$line" | awk '{print $2}')
      case " $primary $secondary " in *" $fid "*) ;; *) bad="$bad unexpected FAIL $fid;" ;; esac
    done < <(printf '%s\n' "$out" | grep '^FAIL ')
    if [ -z "$bad" ]; then t_ok "$id fails with $primary"; else t_bad "$id fails with $primary" "$bad"$'\n'"$out"; fi
  fi
  "$undo"
  expect_run "$id undone, green again" 0 'validate: all checks ok' validate
}
PSAB_NOTE=''
repair() { run --photos >/dev/null 2>&1; }

m1=$(member_with_photo 0); m1_id=${m1%%|*}; m1_orig=$(echo "$m1" | cut -d'|' -f2); m1_thumb=$(echo "$m1" | cut -d'|' -f3)
m2=$(member_with_photo 1); m2_id=${m2%%|*}; m2_orig=$(echo "$m2" | cut -d'|' -f2)
orig_mime=$(psql_target -c "select metadata->>'mimetype' from storage.objects where bucket_id = '$bucket' and name = '$m1_orig'")
orig_size=$(psql_target -c "select metadata->>'size' from storage.objects where bucket_id = '$bucket' and name = '$m1_orig'")

a19() { tgt_delete_object "$m1_orig"; }
psab V19 photo-files 'photo-access photo-linkage photo-orphans' a19 repair

a20() { tgt_delete_object "$m1_orig"; head -c "$orig_size" /dev/urandom >"$ST_TMP/same-size.bin"; st_upload "$bucket" "$m1_orig" "$ST_TMP/same-size.bin" "$orig_mime"; }
a20u() { tgt_delete_object "$m1_orig"; repair; }
psab V20 photo-files '' a20 a20u

a21() { psql_target -c "update storage.buckets set public = not public where id = '$bucket'" >/dev/null; }
a21u() { psql_target -c "update storage.buckets set public = not public where id = '$bucket'" >/dev/null; }
psab V21 bucket-settings '' a21 a21u

a22() { tq <<SQL >/dev/null
update :"schema".members set photo_url = '$m1_id/missing.jpg' where id = $m1_id
SQL
}
a22u() { tq <<SQL >/dev/null
update :"schema".members set photo_url = '$m1_orig' where id = $m1_id
SQL
}
psab V22 photo-linkage 'content photo-access photo-orphans' a22 a22u

a23() { tq <<SQL >/dev/null
update :"schema".members set photo_url = '$m2_orig' where id = $m1_id
SQL
}
psab V23 photo-linkage 'content photo-orphans' a23 a22u

if [ -n "$m1_thumb" ]; then
  a24() { tq <<SQL >/dev/null
update :"schema".members set photo_thumbnail_url = null where id = $m1_id
SQL
  }
  a24u() { tq <<SQL >/dev/null
update :"schema".members set photo_thumbnail_url = '$m1_thumb' where id = $m1_id
SQL
  }
  psab V24 photo-linkage 'content photo-orphans' a24 a24u
else
  t_bad "V24 needs a member with a thumbnail in the source data"
fi

a25() { printf 'stray' >"$ST_TMP/stray.bin"; st_upload "$bucket" "zz-stray/file.jpg" "$ST_TMP/stray.bin" "$orig_mime"; }
a25u() { tgt_delete_object "zz-stray/file.jpg"; }
psab V25 photo-orphans 'photo-files' a25 a25u

a26() {
  printf 'plain text, not an image' >"$ST_TMP/text.bin"
  if ! st_upload "$bucket" "$m1_id/original-test.jpg" "$ST_TMP/text.bin" "text/plain"; then PSAB_NOTE=$(cat "$ST_TMP/up.err"); return 9; fi
  tq <<SQL >/dev/null
update :"schema".members set photo_url = '$m1_id/original-test.jpg' where id = $m1_id
SQL
}
a26u() { a22u; tgt_delete_object "$m1_id/original-test.jpg"; }
psab V26 photo-access 'content photo-files photo-orphans' a26 a26u

fresh
t_summary photos
