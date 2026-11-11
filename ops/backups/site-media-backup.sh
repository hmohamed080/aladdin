#!/usr/bin/env bash
# Site media step of the daily backup: runs after r2-media-backup.sh in the same job and gives EVERY object of the
# project's dynamic site-media bucket (Admin-managed banners, hero art, promo videos: aladdin-site-media /
# aladdin-acceptance-site-media) its own encrypted copy in the project's backup bucket. READ-ONLY on the source.
# Unlike user media there is no database table to ask what must exist, so the bucket listing IS the source of truth:
# whatever an admin uploads is picked up by the next run, with no list to maintain. Bundled static assets that are
# versioned in Git (lib/assets) are not in this bucket and need no copy. An empty bucket is a complete backup of nothing.
# Nothing is deleted by this kit. Retention is bounded like the R2 user media: a copy lives in its monthly generation,
# which a lifecycle rule expires after 90 days; an asset an admin removes is gone from the backup within about 90 days.
#
#   BACKUP_STATE_DIR=<the folder db-backup.sh wrote>  AGE_RECIPIENTS=...
#   BACKUP_LABEL=production BACKUP_BUCKET=... R2_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...   (backup bucket, write)
#   R2_SITE_SOURCE_ENDPOINT=... R2_SITE_SOURCE_BUCKET=... R2_SITE_SOURCE_ACCESS_KEY_ID=... R2_SITE_SOURCE_SECRET_ACCESS_KEY=...   (READ-ONLY token)
#
# Writes (each object once, never replacing anything):
#   media/<label>/site/<YYYYMM>/objects/<sha256>.age      encrypted object, named by content hash only;
#                                                         x-amz-meta-sha256 / size = the plain file
#   <each prefix of the snapshot>/<snapshot>.sitemedia.tsv.age   EVERY object of the bucket at copy time -> its copy
#   <each prefix of the snapshot>/<snapshot>.sitemedia.json      counts: complete true/false (no names)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
require_production_go
if [ "${R2_SITE_BACKUP:-0}" != 1 ]; then
  # The workflow always runs this step. Off is fine for Acceptance, never for Production: the site bucket may hold
  # assets nothing else can recreate, so a Production backup without it is not a complete backup.
  [ "$BACKUP_LABEL" != production ] || die "the Production snapshot requires the site-media backup and R2_SITE_BACKUP is off: a backup without the site bucket is not a complete backup. Switch it on and the next run takes a new snapshot"
  log "site media backup is off (R2_SITE_BACKUP is not 1): nothing to do"; exit 0
fi
require_env BACKUP_STATE_DIR AGE_RECIPIENTS R2_SITE_SOURCE_ENDPOINT R2_SITE_SOURCE_BUCKET R2_SITE_SOURCE_ACCESS_KEY_ID R2_SITE_SOURCE_SECRET_ACCESS_KEY
[ "$R2_SITE_SOURCE_BUCKET" = "$(expected_site_bucket)" ] || [ "$BACKUP_LABEL" = local-test ] \
  || die "a $BACKUP_LABEL backup reads only its own site bucket $(expected_site_bucket), not $R2_SITE_SOURCE_BUCKET"
[ "$R2_SITE_SOURCE_BUCKET" != "$BACKUP_BUCKET" ] || die "the site bucket and the backup bucket must be different buckets"
[ "$R2_SITE_SOURCE_ACCESS_KEY_ID" != "$AWS_ACCESS_KEY_ID" ] || [ "$BACKUP_LABEL" = local-test ] || die "the site source and the backup bucket must use different credentials"
case "$BACKUP_LABEL" in
  production|acceptance) case "$R2_SITE_SOURCE_ENDPOINT" in https://[0-9a-f]*.r2.cloudflarestorage.com) ;; *) die "the site source must be R2";; esac;;
  *) case "$R2_SITE_SOURCE_ENDPOINT" in http://127.0.0.1:*) ;; *) die "local-test only reads a local S3 endpoint";; esac;;
esac
[ -s "$BACKUP_STATE_DIR/db.env" ] || die "run db-backup.sh first: no snapshot in $BACKUP_STATE_DIR"
# shellcheck disable=SC1091
. "$BACKUP_STATE_DIR/db.env"
if [ "${SKIPPED:-0}" = 1 ]; then log "no new snapshot today: nothing to do"; exit 0; fi
umask 077
GEN="$(r2_generation)"; P="media/$BACKUP_LABEL/site/$GEN"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
src() { AWS_ACCESS_KEY_ID="$R2_SITE_SOURCE_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SITE_SOURCE_SECRET_ACCESS_KEY" aws --endpoint-url "$R2_SITE_SOURCE_ENDPOINT" "$@"; }
site_copy_key() { echo "$P/objects/$1.age"; }
# One "key<TAB>size" line per object. The AWS CLI pages through the whole bucket by itself.
list_keys() {  # $1 = list function (src or s3), $2 = bucket, $3 = prefix
  "$1" s3api list-objects-v2 --bucket "$2" --prefix "$3" --output json | python3 -c '
import json, sys
text = sys.stdin.read().strip()
for o in (json.loads(text).get("Contents") or []) if text and text != "null" else []:
    print(o["Key"] + "\t" + str(o["Size"]))'
}
list_keys src "$R2_SITE_SOURCE_BUCKET" "" | sort > "$WORK/source.tsv"
list_keys s3 "$BACKUP_BUCKET" "$P/objects/" | cut -f1 | sort > "$WORK/have.txt"

COPIED=0; BYTES=0; FAILED=0; FAIL_CLASSES=""; : > "$WORK/inventory.tsv"
while IFS=$'\t' read -r key size; do
  [ -n "$key" ] || continue
  # Failure classes are logged, never the key (it names an asset); a hash prefix identifies nothing.
  tries=0; cls=""
  while :; do
    if src s3api get-object --bucket "$R2_SITE_SOURCE_BUCKET" --key "$key" "$WORK/f" >/dev/null 2> "$WORK/err"; then cls=""; break; fi
    cls="$(classify_s3_error "$WORK/err")"; tries=$((tries+1))
    { [ "$cls" = transient ] || [ "$cls" = other ]; } && [ "$tries" -lt 3 ] && { sleep "${R2_READ_RETRY_SLEEP:-2}"; continue; }
    break
  done
  if [ -n "$cls" ]; then
    FAILED=$((FAILED+1)); FAIL_CLASSES="$FAIL_CLASSES $cls"; log "could not read a site-media object: $cls"; rm -f "$WORK/f" "$WORK/err"
    printf 'unreadable\tsite\t%s\t%s\t-\tMISSING\n' "$(printf '%s' "$key" | sha256sum | cut -d' ' -f1)" "$size" >> "$WORK/inventory.tsv"; continue
  fi
  real="$(wc -c < "$WORK/f" | tr -d ' ')"; sha="$(sha256 "$WORK/f")"; ck="$(site_copy_key "$sha")"
  if ! grep -qxF "$ck" "$WORK/have.txt"; then
    age_encrypt "$WORK/f" "$WORK/f.age"
    put_once "$WORK/f.age" "$ck" application/octet-stream --metadata "sha256=$sha,size=$real"
    echo "$ck" >> "$WORK/have.txt"; COPIED=$((COPIED+1)); BYTES=$((BYTES+real)); rm -f "$WORK/f.age"
  fi
  printf '%s\tsite\t%s\t%s\t%s\tok\n' "$sha" "$key" "$real" "$ck" >> "$WORK/inventory.tsv"
  rm -f "$WORK/f"
done < "$WORK/source.tsv"

TOTAL="$(wc -l < "$WORK/inventory.tsv" | tr -d ' ')"
MISSING="$(awk -F'\t' '$6 != "ok"' "$WORK/inventory.tsv" | wc -l | tr -d ' ')"
COMPLETE=true; [ "$MISSING" -eq 0 ] && [ "$FAILED" -eq 0 ] || COMPLETE=false
cat > "$WORK/sitemedia.json" <<JSON
{"snapshot":"$NAME","label":"$BACKUP_LABEL","objects":$TOTAL,"backed_up":$((TOTAL-MISSING)),"missing":$MISSING,"copy_failures":$FAILED,
 "complete":$COMPLETE,"r2_media_records_not_covered":0,"inventory_sha256":"$(sha256 "$WORK/inventory.tsv")"}
JSON
age_encrypt "$WORK/inventory.tsv" "$WORK/inventory.tsv.age"
# Inventories first, records last (see media-backup.sh): an interrupted run is superseded by the next one.
for prefix in $PREFIXES; do put_once "$WORK/inventory.tsv.age" "$prefix/$NAME.sitemedia.tsv.age" application/octet-stream; done
for prefix in $PREFIXES; do put_once "$WORK/sitemedia.json" "$prefix/$NAME.sitemedia.json" application/json; done
if [ "$FAILED" -gt 0 ]; then
  for c in not_found access_denied transient other; do
    n="$(printf '%s\n' $FAIL_CLASSES | grep -cx "$c" || true)"; [ "$n" = 0 ] || log "site read failures: $n $c"
  done
fi
log "site media: $TOTAL objects, $((TOTAL-MISSING)) backed up, $MISSING missing; $COPIED new copied ($BYTES bytes), $FAILED failed"
[ "$COMPLETE" = true ] || die "the site-media backup of $NAME is incomplete (marked so in its .sitemedia.json); the next scheduled run takes a new snapshot"
