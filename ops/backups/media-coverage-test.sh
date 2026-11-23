#!/usr/bin/env bash
# Fail-closed MEDIA COVERAGE (Production protection). What a snapshot requires comes from its own manifest (the dump),
# never from a backup switch: Supabase Storage files, R2 originals, or both while files move between them. Each case
# builds a tiny bucket on the local S3 stand-in (127.0.0.1:8333, testkey/testsecret) and asks media_coverage /
# snapshot_done / require_media_not_needed / freshness.sh. Touches nothing hosted.
#   bash ops/backups/media-coverage-test.sh
# shellcheck disable=SC2319
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export LC_ALL=C AWS_ACCESS_KEY_ID=testkey AWS_SECRET_ACCESS_KEY=testsecret AWS_DEFAULT_REGION=auto AWS_PAGER=""
export R2_ENDPOINT="${R2_ENDPOINT:-http://127.0.0.1:8333}"
# shellcheck source=lib.sh
. "$HERE/lib.sh"; set +e
T="$(mktemp -d)"; B=""; RUN="$(date +%s)"; n=0; pass=0; fail=0
trap '[ -z "$B" ] || s3 s3 rb "s3://$B" --force >/dev/null 2>&1; rm -rf "$T"' EXIT
NAME="aladdin-production-20261101T013000Z"; DAY="db/production/daily/2026/11/01"; SHA=$(printf 'a%.0s' $(seq 64))
ck() { # <description> <condition: 0 = holds>
  if [ "$2" -eq 0 ]; then pass=$((pass+1)); echo "PASS  $1"; else fail=$((fail+1)); echo "FAIL  $1"; fi
}
fresh() { # new bucket; <storage_objects> <r2_required> [r2_media_records]  -> manifest
  [ -z "$B" ] || s3 s3 rb "s3://$B" --force >/dev/null 2>&1
  n=$((n+1)); B="cov-$RUN-$n"; export BACKUP_BUCKET="$B"; s3 s3api create-bucket --bucket "$B" >/dev/null
  head -c 300 /dev/urandom > "$T/blob"; s3 s3api put-object --bucket "$B" --key "$DAY/$NAME.tar.age" --body "$T/blob" >/dev/null
  printf '{"label":"production","storage_objects":%s,"r2_media_records":%s,"r2_required_originals":%s}' "$1" "${3:-$2}" "$2" > "$T/m"
  s3 s3api put-object --bucket "$B" --key "$DAY/$NAME.json" --body "$T/m" >/dev/null
  # Production also requires the site-media copy (an empty site bucket is a complete record of 0), so every Production
  # fixture carries one; the site-media rule itself is proven in site-media-backup-test.sh.
  rec sitemedia 0 0 true
}
rec() { # <kind: media|r2media> <objects> <backed_up> <complete>
  printf '{"snapshot":"%s","label":"production","objects":%s,"backed_up":%s,"missing":%s,"copy_failures":0,"complete":%s,"r2_media_records_not_covered":0,"inventory_sha256":"%s"}' \
    "$NAME" "$2" "$3" "$(($2-$3))" "$4" "$SHA" > "$T/r"
  s3 s3api put-object --bucket "$B" --key "$DAY/$NAME.$1.json" --body "$T/r" >/dev/null
  head -c 200 /dev/urandom > "$T/inv"; s3 s3api put-object --bucket "$B" --key "$DAY/$NAME.$1.tsv.age" --body "$T/inv" >/dev/null
}
cov() { env "$@" bash -c '. "$0/lib.sh"; media_coverage "$1" "$2"' "$HERE" "$DAY" "$NAME" 2>&1; }
PROD="BACKUP_LABEL=production R2_SITE_BACKUP=1"; ACC="BACKUP_LABEL=acceptance"; OFF="LEGACY_MEDIA_BACKUP=0 R2_MEDIA_BACKUP=0"
# shellcheck disable=SC2086
covp() { cov $PROD "$@"; }

echo "-- both switches off: required media can never look covered"
fresh 3 0; o="$(covp $OFF)";   ck "Production, Supabase Storage files, switches off -> alarm (A)" "$(grep -q '^A .*3 Supabase Storage files' <<< "$o"; echo $?)"
fresh 0 2; o="$(covp $OFF)";   ck "Production, R2 originals, switches off -> alarm (A)" "$(grep -q '^A .*2 R2 originals' <<< "$o"; echo $?)"
fresh 3 2; o="$(covp $OFF)";   ck "Production, mixed providers, switches off -> two alarms" "$([ "$(grep -c '^A ' <<< "$o")" = 2 ]; echo $?)"
fresh 0 0; o="$(covp $OFF)";   ck "Production, legitimately empty inventories, switches off -> quiet" "$([ -z "$o" ]; echo $?)"
fresh 3 2; o="$(cov $ACC $OFF)"; ck "Acceptance, same gap -> warnings only, never a problem" "$([ "$(grep -c '^W ' <<< "$o")" = 2 ] && ! grep -q '^[PA] ' <<< "$o"; echo $?)"

echo "-- Supabase Storage provider (LEGACY_MEDIA_BACKUP=1)"
fresh 3 0; rec media 3 3 true;  o="$(covp LEGACY_MEDIA_BACKUP=1)"; ck "complete record covering all 3 files -> quiet" "$([ -z "$o" ]; echo $?)"
fresh 3 0;                      o="$(covp LEGACY_MEDIA_BACKUP=1)"; ck "record missing -> P" "$(grep -q '^P .*no readable media record' <<< "$o"; echo $?)"
fresh 3 0; rec media 2 2 true;  o="$(covp LEGACY_MEDIA_BACKUP=1)"; ck "partial coverage (record covers 2 of 3) -> P" "$(grep -q '^P .*covers 2 files but the snapshot requires 3' <<< "$o"; echo $?)"
fresh 3 0; rec media 3 2 false; o="$(covp LEGACY_MEDIA_BACKUP=1)"; ck "missing copy (incomplete record) -> P" "$(grep -q '^P .*incomplete' <<< "$o"; echo $?)"
fresh 3 0; rec media 3 3 true; s3 s3api delete-object --bucket "$B" --key "$DAY/$NAME.media.tsv.age" >/dev/null
o="$(covp LEGACY_MEDIA_BACKUP=1)"; ck "inventory not stored -> P" "$(grep -q '^P .*no media inventory' <<< "$o"; echo $?)"
fresh 3 0; printf '{"snapshot":"%s","label":"production","objects":3,"backed_up":3,"missing":0,"copy_failures":0,"complete":true,"inventory_sha256":"nope","r2_media_records_not_covered":0}' "$NAME" > "$T/r"
s3 s3api put-object --bucket "$B" --key "$DAY/$NAME.media.json" --body "$T/r" >/dev/null; o="$(covp LEGACY_MEDIA_BACKUP=1)"; ck "integrity mismatch (inventory hash not a sha256) -> P" "$(grep -q '^P ' <<< "$o"; echo $?)"
fresh 3 0; rec media 3 3 true; rec r2media 2 2 true; o="$(covp LEGACY_MEDIA_BACKUP=1)"; ck "an unrelated r2media record does not satisfy Supabase files -> quiet only for the right kind" "$([ -z "$o" ]; echo $?)"

echo "-- R2 provider (R2_MEDIA_BACKUP=1)"
fresh 0 2; rec r2media 2 2 true; o="$(covp R2_MEDIA_BACKUP=1)"; ck "complete record covering both originals -> quiet" "$([ -z "$o" ]; echo $?)"
fresh 0 2;                       o="$(covp R2_MEDIA_BACKUP=1)"; ck "record missing -> P" "$(grep -q '^P .*r2media record' <<< "$o"; echo $?)"
fresh 0 2; rec r2media 1 1 true; o="$(covp R2_MEDIA_BACKUP=1)"; ck "partial coverage (1 of 2 originals) -> P" "$(grep -q '^P .*covers 1 files but the snapshot requires 2' <<< "$o"; echo $?)"
fresh 0 2; rec r2media 2 1 false; o="$(covp R2_MEDIA_BACKUP=1)"; ck "missing copy -> P" "$(grep -q '^P .*incomplete' <<< "$o"; echo $?)"
fresh 0 2; rec r2media 2 2 true; s3 s3api put-object --bucket "$B" --key "$DAY/$NAME.r2media.json" --body "$T/blob" >/dev/null
o="$(covp R2_MEDIA_BACKUP=1)"; ck "corrupt record -> P" "$(grep -q '^P .*not valid JSON' <<< "$o"; echo $?)"
fresh 0 7 9; rec r2media 7 7 true; o="$(covp R2_MEDIA_BACKUP=1)"; ck "retired originals (9 records, 7 required) are not demanded: record of 7 -> quiet" "$([ -z "$o" ]; echo $?)"

echo "-- mixed providers during the transition"
fresh 3 2; rec media 3 3 true; rec r2media 2 2 true; o="$(covp LEGACY_MEDIA_BACKUP=1 R2_MEDIA_BACKUP=1)"; ck "both records complete -> quiet" "$([ -z "$o" ]; echo $?)"
fresh 3 2; rec media 3 3 true; o="$(covp LEGACY_MEDIA_BACKUP=1 R2_MEDIA_BACKUP=0)"; ck "Supabase copied, R2 originals not -> A for R2 only" "$([ "$(grep -c . <<< "$o")" = 1 ] && grep -q '^A .*R2 originals' <<< "$o"; echo $?)"
fresh 3 2; rec r2media 2 2 true; o="$(covp LEGACY_MEDIA_BACKUP=0 R2_MEDIA_BACKUP=1)"; ck "R2 copied, Supabase files not -> A for Supabase only" "$([ "$(grep -c . <<< "$o")" = 1 ] && grep -q '^A .*Supabase Storage files' <<< "$o"; echo $?)"
fresh 3 2; rec media 3 3 true; rec r2media 1 1 true; o="$(covp LEGACY_MEDIA_BACKUP=1 R2_MEDIA_BACKUP=1)"; ck "Supabase complete, R2 partial -> P" "$(grep -q '^P .*covers 1 files but the snapshot requires 2' <<< "$o"; echo $?)"
fresh 3 0; o="$(covp LEGACY_MEDIA_BACKUP=1 R2_MEDIA_BACKUP=1)"; ck "R2 empty but its switch is on and no record exists -> P (a switched-on step must have run)" "$(grep -q '^P .*r2media record' <<< "$o"; echo $?)"

echo "-- the manifest itself"
fresh 3 0; s3 s3api delete-object --bucket "$B" --key "$DAY/$NAME.json" >/dev/null; o="$(covp $OFF)"; ck "manifest missing -> P (coverage unknown, never 'nothing to back up')" "$(grep -q '^P .*manifest' <<< "$o"; echo $?)"
for bad in '{"label":"production","r2_media_records":0}' '{"label":"production","storage_objects":"3","r2_media_records":0}' '{"storage_objects":-1,"r2_media_records":0}' '{"storage_objects":1,"storage_objects":1,"r2_media_records":0}' '[]' 'garbage' ''; do
  fresh 0 0; printf '%s' "$bad" > "$T/m"; s3 s3api put-object --bucket "$B" --key "$DAY/$NAME.json" --body "$T/m" >/dev/null
  o="$(covp $OFF)"; ck "unusable manifest [$bad] -> P" "$(grep -q '^P .*manifest' <<< "$o"; echo $?)"
done
fresh 0 0; printf '{"label":"production","storage_objects":0,"r2_media_records":5}' > "$T/m"; s3 s3api put-object --bucket "$B" --key "$DAY/$NAME.json" --body "$T/m" >/dev/null
o="$(covp $OFF)"; ck "older manifest without r2_required_originals: r2_media_records is the (conservative) requirement" "$(grep -q '^A .*5 R2 originals' <<< "$o"; echo $?)"

echo "-- a Production snapshot is never 'done' with uncovered media"
done_q() { env "$@" bash -c '. "$0/lib.sh"; snapshot_done "$1" "$2"' "$HERE" "$NAME" "$DAY" >/dev/null 2>&1; }
# shellcheck disable=SC2086
fresh 3 0; done_q $PROD $OFF; ck "required files, switch off -> not done (a retry must not skip it)" "$([ $? -ne 0 ]; echo $?)"
# shellcheck disable=SC2086
fresh 0 0; done_q $PROD $OFF; ck "empty inventories -> done" "$?"
fresh 3 0; rec media 3 3 true; done_q $PROD LEGACY_MEDIA_BACKUP=1; ck "complete Supabase record -> done" "$?"
fresh 3 0; rec media 2 2 true; done_q $PROD LEGACY_MEDIA_BACKUP=1; ck "partial record -> not done" "$([ $? -ne 0 ]; echo $?)"

echo "-- the backup job itself fails (Production only) when a switched-off step is required"
ST="$T/st"; mkdir -p "$ST"; printf 'SKIPPED=0\nNAME=x\n' > "$ST/db.env"
need() { env "$@" bash -c '. "$0/lib.sh"; require_media_not_needed "$1" "$2"' "$HERE" legacy LEGACY_MEDIA_BACKUP >/dev/null 2>&1; }
: > "$ST/objects.tsv"; BACKUP_STATE_DIR="$ST" need $PROD; ck "no files required -> the step may be off" "$?"
printf 'a\tb\tc\t1\te\n' > "$ST/objects.tsv"; BACKUP_STATE_DIR="$ST" need $PROD; ck "files required, step off, Production -> the job fails" "$([ $? -ne 0 ]; echo $?)"
BACKUP_STATE_DIR="$ST" need $ACC; ck "files required, step off, Acceptance -> the job does not fail (legacy is being retired there)" "$?"
printf 'SKIPPED=1\n' > "$ST/db.env"; BACKUP_STATE_DIR="$ST" need $PROD; ck "no new snapshot today -> nothing to check" "$?"
rm -f "$ST/objects.tsv"; printf 'SKIPPED=0\n' > "$ST/db.env"; BACKUP_STATE_DIR="$ST" need $PROD; ck "media list missing -> the job fails (coverage unknown)" "$([ $? -ne 0 ]; echo $?)"

echo "-- freshness.sh end to end (label local-test): the alarm follows the manifest, not the switches"
FR() { BACKUP_LABEL=local-test BACKUP_BUCKET="$B" env "$@" bash "$HERE/freshness.sh" >"$T/fr.out" 2>&1; }
LD="db/local-test/daily/2026/11/01"; LN="aladdin-local-test-$(date -u +%Y%m%dT%H%M%SZ)"
lbucket() { [ -z "$B" ] || s3 s3 rb "s3://$B" --force >/dev/null 2>&1; n=$((n+1)); B="cov-$RUN-$n"; s3 s3api create-bucket --bucket "$B" >/dev/null
  head -c 300 /dev/urandom > "$T/blob"; s3 s3api put-object --bucket "$B" --key "$LD/$LN.tar.age" --body "$T/blob" >/dev/null
  printf '{"label":"local-test","storage_objects":%s,"r2_media_records":%s,"r2_required_originals":%s}' "$1" "$2" "$2" > "$T/m"; s3 s3api put-object --bucket "$B" --key "$LD/$LN.json" --body "$T/m" >/dev/null; }
lbucket 0 0; FR LEGACY_MEDIA_BACKUP=0 R2_MEDIA_BACKUP=0; ck "empty inventories verified by the manifest -> freshness passes" "$?"
lbucket 3 0; FR LEGACY_MEDIA_BACKUP=0 R2_MEDIA_BACKUP=0; ck "files exist, no backup (non-production) -> still passes, with a warning" "$(grep -q '^warning' "$T/fr.out"; echo $?)"
lbucket 3 0; FR LEGACY_MEDIA_BACKUP=1; ck "switch on but no record -> alarm" "$([ $? -ne 0 ]; echo $?)"

echo "media-coverage-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
