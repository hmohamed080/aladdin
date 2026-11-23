#!/usr/bin/env bash
# shellcheck disable=SC2319  # the tests read `[ cond ]; ok $?` on purpose
# End to end on a local S3 stand-in (127.0.0.1:8333) and a throwaway local PostgreSQL: a removed (retired) avatar
# whose original is gone from R2 no longer breaks the media backup, while a missing ACTIVE original, a mismatch,
# a refused token and a concurrent replacement still do; the restore verification applies the same rule to the
# restored database independently. Touches nothing hosted.   bash ops/backups/r2-retired-media-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/pgtemp.sh"
export LC_ALL=C AWS_ACCESS_KEY_ID=testkey AWS_SECRET_ACCESS_KEY=testsecret AWS_DEFAULT_REGION=auto AWS_PAGER=""
export R2_ENDPOINT="${R2_ENDPOINT:-http://127.0.0.1:8333}" BACKUP_LABEL=local-test MEDIA_KIND=r2 R2_MEDIA_BACKUP=1
T="$(mktemp -d)"; SRC="ret-src-$(date +%s)"; DST="ret-dst-$(date +%s)"; export BACKUP_BUCKET="$DST"
s3() { aws --endpoint-url "$R2_ENDPOINT" "$@"; }
trap 's3 s3 rb "s3://$SRC" --force >/dev/null 2>&1; s3 s3 rb "s3://$DST" --force >/dev/null 2>&1; stop_pg; rm -rf "$T"' EXIT
start_pg || { echo "r2-retired-media-test: skipped (no local PostgreSQL)"; [ -n "${REQUIRE_PG:-}" ] && exit 1; exit 0; }
pass=0; fail=0
ok() { if [ "$1" -eq 0 ]; then pass=$((pass+1)); echo "PASS  $2"; else fail=$((fail+1)); echo "FAIL  $2"; fi; }
Q() { psql "$PGURL" -X -q -At -F $'\t' -v ON_ERROR_STOP=1 "$@"; }
age-keygen -o "$T/id.key" 2>/dev/null; AGE_RECIPIENTS="$(age-keygen -y "$T/id.key")"; export AGE_RECIPIENTS
s3 s3api create-bucket --bucket "$SRC" >/dev/null; s3 s3api create-bucket --bucket "$DST" >/dev/null

U1=11111111-1111-1111-1111-111111111111; U2=22222222-2222-2222-2222-222222222222
A_OLD=aaaaaaaa-0000-0000-0000-000000000001; A_ACT=aaaaaaaa-0000-0000-0000-000000000002; A_NEW=aaaaaaaa-0000-0000-0000-000000000003
Q <<SQL >/dev/null
create schema storage;
create table storage.objects (id uuid, bucket_id text, name text, metadata jsonb);
create table public.avatar_uploads (id uuid primary key, object_key text, owner_user_id uuid, state text);
create table public.portfolio_items (id uuid primary key, object_key text, owner_user_id uuid, state text);
create table public.professional_certificates (id uuid primary key, object_path text, owner_user_id uuid, state text);
create table public.product_images (id uuid primary key, object_key text, created_by uuid, state text);
create table public.organization_images (id uuid primary key, object_key text, created_by uuid, state text);
create table public.profiles (user_id uuid, avatar_media_id uuid, cover_media_id uuid);
create table public.organizations (id uuid, logo_media_id uuid);
create table public.media_storage_locations (namespace text, object_key text, owner_user_id uuid, provider text, sha256 text,
  size_bytes bigint, created_at timestamptz default now(), verified_at timestamptz, cleaned_at timestamptz, primary key (namespace, object_key));
insert into storage.objects values ('00000000-0000-0000-0000-000000000001','avatars','x','{"size":5}');
SQL
# objects: the retired avatar's bytes are NOT in R2 (as on Acceptance); the active avatar's are.
head -c 200 /dev/urandom > "$T/act"; ACT_SHA="$(sha256sum "$T/act" | cut -d' ' -f1)"
printf 'old-bytes' > "$T/old"; OLD_SHA="$(sha256sum "$T/old" | cut -d' ' -f1)"
printf 'new-bytes!' > "$T/new"; NEW_SHA="$(sha256sum "$T/new" | cut -d' ' -f1)"
s3 s3api put-object --bucket "$SRC" --key "avatar/user-ACTIVE.jpg" --body "$T/act" >/dev/null
loc() { Q -c "insert into public.media_storage_locations (namespace,object_key,owner_user_id,provider,sha256,size_bytes,verified_at) values ('avatar','$1','$2','r2','$3',$4,now())"; }
up() { Q -c "insert into public.avatar_uploads values ('$1','$2','$3','$4')"; }
up $A_OLD user-OLD.jpg $U2 deleted; loc user-OLD.jpg $U2 "$OLD_SHA" 9
up $A_ACT user-ACTIVE.jpg $U1 ready; loc user-ACTIVE.jpg $U1 "$ACT_SHA" 200
Q -c "insert into public.profiles values ('$U1','$A_ACT',null)"

n=0
snapshot() { # takes a snapshot of the CURRENT database like db-backup.sh does; sets NAME/DAY
  n=$((n+1)); NAME="aladdin-local-test-2026110${n}T090000Z"; DAY="db/local-test/daily/2026/11/0$n"; S="$T/state$n"; mkdir -p "$S"
  "$PGBIN/pg_dump" --data-only -d "$PGURL" > "$T/d$n.sql" 2>/dev/null || $PG_AS "$PGBIN/pg_dump" --data-only -d "$PGURL" > "$T/d$n.sql"
  python3 "$HERE/snapshot-objects.py" "$T/d$n.sql" "$T/o$n.tsv" "$S/r2-objects.tsv" "$S/r2-excluded.json" > /dev/null
  printf 'SKIPPED=0\nNAME=%s\nPREFIXES="%s"\n' "$NAME" "$DAY" > "$S/db.env"
  printf '{"label":"local-test","taken_utc":"2026110%sT090000Z"}' "$n" > "$T/man$n.json"
  s3 s3api put-object --bucket "$DST" --key "$DAY/$NAME.tar.age" --body "$T/d$n.sql" >/dev/null
  s3 s3api put-object --bucket "$DST" --key "$DAY/$NAME.json" --body "$T/man$n.json" >/dev/null
}
backup() { # -> $T/out.txt, rc
  BACKUP_STATE_DIR="$S" BACKUP_DB_URL="$PGURL" R2_SOURCE_ENDPOINT="$R2_ENDPOINT" R2_SOURCE_BUCKET="$SRC" \
    R2_SOURCE_ACCESS_KEY_ID=testkey R2_SOURCE_SECRET_ACCESS_KEY=testsecret R2_READ_RETRY_SLEEP=0 bash "$HERE/r2-media-backup.sh" > "$T/out.txt" 2>&1
}
record() { s3 s3api get-object --bucket "$DST" --key "$DAY/$NAME.r2media.json" "$T/rec.json" >/dev/null 2>&1 && cat "$T/rec.json"; }
verify() { PATH="$PATH" VERIFY_NOW=2026-11-05T00:00:00Z MEDIA_DB_URL="$PGURL" KEY="$DAY/$NAME.tar.age" AGE_IDENTITY_FILE="$T/id.key" OUT="$T/v-$1" MEDIA_SAMPLE=10 bash "$HERE/media-verify.sh" > "$T/v-$1.log" 2>&1; }

# A. A retired avatar whose original is gone does not break the backup; the active one is copied.
snapshot; backup; rc=$?
ok $rc "a retired original that no longer exists does not fail the backup"
record | grep -q '"complete":true' ; ok $? "the snapshot is recorded complete"
record | grep -q '"excluded_retired":{"retired:avatar":1}'; ok $? "the exclusion is reported separately, by reason and count"
record | grep -q '"objects":1,'; ok $? "the inventory holds only the required original"
grep -q "1 retired originals" "$T/out.txt"; ok $? "the log reports the retired count"
! grep -qE "user-OLD|user-ACTIVE|avatar/|$SRC|$U1|$U2" "$T/out.txt" && ! record | grep -qE "user-|avatar/|$U1|$U2"; ok $? "neither the log nor the record holds a key, bucket or user id"
# D. Restore verification applies the same rule to the restored database.
verify ok; ok $? "restore verification passes ($(cut -c1-110 "$T/v-ok/media-summary.txt" 2>/dev/null))"
grep -q "retired:avatar" "$T/v-ok/media-summary.txt"; ok $? "the verification summary names the excluded retired count"
# D2. In the restored database the 'retired' avatar is actually active again: the record's exclusion is wrong.
Q -c "update public.avatar_uploads set state='ready' where id='$A_OLD'" >/dev/null
verify bad; rc=$?; [ "$rc" -ne 0 ] && grep -q "retired originals the record excluded" "$T/v-bad/media-fails.txt" && grep -q "not in the inventory" "$T/v-bad/media-fails.txt"
ok $? "verification FAILS when the restored database says an excluded original is not retired"
Q -c "update public.avatar_uploads set state='deleted' where id='$A_OLD'" >/dev/null
# D3. A restored database where a pointer still references the deleted avatar is not retired either.
Q -c "update public.profiles set cover_media_id='$A_OLD'" >/dev/null
verify ptr; [ $? -ne 0 ]; ok $? "verification FAILS when something active still points at an excluded avatar"
Q -c "update public.profiles set cover_media_id=null" >/dev/null
# D4. A record that does not report its exclusions is refused.
python3 - "$T/rec.json" <<'PY'
import json,sys; p=sys.argv[1]; d=json.load(open(p)); d.pop("excluded_retired"); json.dump(d, open(p,"w"))
PY
s3 s3api put-object --bucket "$DST" --key "$DAY/$NAME.r2media.json" --body "$T/rec.json" >/dev/null
verify noex; [ $? -ne 0 ]; ok $? "verification FAILS on a record without excluded_retired"

# B. A missing ACTIVE original stays a hard failure.
s3 s3api delete-object --bucket "$SRC" --key "avatar/user-ACTIVE.jpg" >/dev/null
Q -c "delete from public.media_storage_locations where object_key='user-ACTIVE.jpg'" >/dev/null   # (re-added below with a new hash so no copy exists yet)
printf 'second-active' > "$T/act2"; ACT2_SHA="$(sha256sum "$T/act2" | cut -d' ' -f1)"
loc user-ACTIVE.jpg $U1 "$ACT2_SHA" 13
snapshot; backup; rc=$?
[ "$rc" -ne 0 ]; ok $? "a missing active original fails the backup"
grep -q "could not read an R2 original (sha256 ${ACT2_SHA:0:12}): not_found" "$T/out.txt"; ok $? "it is reported as a missing original, by hash prefix only"
record | grep -q '"complete":false'; ok $? "the snapshot is recorded incomplete"
! grep -q "removed after this snapshot" "$T/out.txt"; ok $? "an active original is never explained away as retired"

# C. Concurrent replacement: the snapshot saw the avatar as active, then the user replaced it and the old bytes were removed.
s3 s3api put-object --bucket "$SRC" --key "avatar/user-ACTIVE.jpg" --body "$T/act2" >/dev/null
snapshot                                    # the dump holds user-ACTIVE as the live avatar
s3 s3api delete-object --bucket "$SRC" --key "avatar/user-ACTIVE.jpg" >/dev/null
up $A_NEW user-NEW.jpg $U1 ready; loc user-NEW.jpg $U1 "$NEW_SHA" 10
s3 s3api put-object --bucket "$SRC" --key "avatar/user-NEW.jpg" --body "$T/new" >/dev/null
Q -c "update public.avatar_uploads set state='deleted' where id='$A_ACT'; update public.profiles set avatar_media_id='$A_NEW'" >/dev/null
backup; rc=$?
[ "$rc" -ne 0 ]; ok $? "a replacement between snapshot and copy fails that snapshot (it still refers to the removed original)"
grep -q "removed after this snapshot was taken" "$T/out.txt"; ok $? "the log explains it as removed after the snapshot, without naming it"
record | grep -q '"complete":false'; ok $? "that snapshot is recorded incomplete"
snapshot; backup; rc=$?
ok $rc "the NEXT snapshot excludes the replaced avatar and passes"
record | grep -q '"excluded_retired":{"retired:avatar":2}'; ok $? "both retired avatars are reported"
verify next; ok $? "its restore verification passes"

# E. Still hard failures: an integrity mismatch of a required original.
printf 'tampered!!' > "$T/tamper"; s3 s3api put-object --bucket "$SRC" --key "avatar/user-NEW.jpg" --body "$T/tamper" >/dev/null
s3 s3 rm "s3://$DST/media/local-test/r2/$(date +%Y%m)/objects/" --recursive >/dev/null
snapshot; backup; rc=$?
[ "$rc" -ne 0 ] && grep -q "differs from the size or sha256" "$T/out.txt"; ok $? "an integrity mismatch of a required original still fails"
record | grep -q '"complete":false'; ok $? "and the snapshot is recorded incomplete"
# (a refused token, 403, is classified access_denied and never retired: r2-read-diagnostics-test.sh; the local S3 stand-in does not check credentials)
echo "r2-retired-media-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
