#!/usr/bin/env bash
# R2 media step of the daily backup: runs after db-backup.sh and media-backup.sh in the same job and gives the
# R2-hosted originals (avatars, portfolios, products, documents) their own copy, in a DIFFERENT bucket and under a
# DIFFERENT credential than the one that serves them. READ-ONLY on the source bucket and on the project.
# Nothing is deleted by this kit. Retention is BOUNDED on purpose (user media is personal data): a copy lives in its
# monthly generation, which a lifecycle rule expires after 90 days; an original a user removes is gone from the
# backup within about 90 days. Not locked for a year, not kept forever.
# Only originals are copied. Derivatives (thumb/card/full WebP under .../v/) are regenerated from them, and
# pending/ uploads are unverified and expire on their own.
#
#   BACKUP_STATE_DIR=<the folder db-backup.sh wrote>  BACKUP_DB_URL=...  AGE_RECIPIENTS=...
#   BACKUP_LABEL=production BACKUP_BUCKET=... R2_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...   (backup bucket, write)
#   R2_SOURCE_ENDPOINT=... R2_SOURCE_BUCKET=... R2_SOURCE_ACCESS_KEY_ID=... R2_SOURCE_SECRET_ACCESS_KEY=...     (media bucket, READ-ONLY token)
#
# Writes (each object once, never replacing anything):
#   media/<label>/r2/<YYYYMM>/objects/<sha256>.age       encrypted original, named by content hash only;
#                                                        x-amz-meta-sha256 / size = the plain file
#   <each prefix of the snapshot>/<snapshot>.r2media.tsv.age   EVERY verified original of that snapshot -> its copy
#   <each prefix of the snapshot>/<snapshot>.r2media.json      counts: complete true/false (no names)
# The source bytes must hash to the sha256 the database recorded when the upload was verified, or the file is
# counted as a failure and nothing is stored for it.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
require_production_go
require_env BACKUP_STATE_DIR BACKUP_DB_URL AGE_RECIPIENTS R2_SOURCE_ENDPOINT R2_SOURCE_BUCKET R2_SOURCE_ACCESS_KEY_ID R2_SOURCE_SECRET_ACCESS_KEY
check_db_url "$BACKUP_DB_URL"
[ "$R2_SOURCE_BUCKET" != "$BACKUP_BUCKET" ] || die "the media bucket and the backup bucket must be different buckets"
[ "$R2_SOURCE_ACCESS_KEY_ID" != "$AWS_ACCESS_KEY_ID" ] || [ "$BACKUP_LABEL" = local-test ] || die "the media source and the backup bucket must use different credentials"
case "$BACKUP_LABEL" in
  production|acceptance) case "$R2_SOURCE_ENDPOINT" in https://[0-9a-f]*.r2.cloudflarestorage.com) ;; *) die "the media source must be R2";; esac;;
  *) case "$R2_SOURCE_ENDPOINT" in http://127.0.0.1:*) ;; *) die "local-test only reads a local S3 endpoint";; esac;;
esac
[ -s "$BACKUP_STATE_DIR/db.env" ] || die "run db-backup.sh first: no snapshot in $BACKUP_STATE_DIR"
# shellcheck disable=SC1091
. "$BACKUP_STATE_DIR/db.env"
if [ "${SKIPPED:-0}" = 1 ]; then log "no new snapshot today: nothing to do"; exit 0; fi
[ -f "$BACKUP_STATE_DIR/r2-objects.tsv" ] || die "the snapshot's R2 media list is missing"
umask 077
GEN="$(r2_generation)"; P="media/$BACKUP_LABEL/r2/$GEN"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
src() { AWS_ACCESS_KEY_ID="$R2_SOURCE_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SOURCE_SECRET_ACCESS_KEY" aws --endpoint-url "$R2_SOURCE_ENDPOINT" "$@"; }

# Live originals too: one verified after the dump is copied now, so tomorrow's snapshot finds it even if the
# user removes it before then. (to_jsonb: the storage_key column exists only after migration 20261029120001.)
psql "$BACKUP_DB_URL" -X -At -F $'\t' -v ON_ERROR_STOP=1 -c 'set session characteristics as transaction read only' -c "
  select sha256, size_bytes, coalesce(to_jsonb(l)->>'storage_key', namespace||'/'||object_key)
  from public.media_storage_locations l
  where provider = 'r2' and cleaned_at is null and verified_at is not null order by created_at, namespace, object_key" \
  | sed '1{/^SET$/d}' > "$WORK/live.tsv"
s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$P/objects/" --query 'Contents[].Key' --output text \
  | tr '\t' '\n' | grep -v '^None$' | sort > "$WORK/have.txt" || true

COPIED=0; BYTES=0; FAILED=0
while IFS=$'\t' read -r sha size key; do
  [ -n "$sha" ] || continue
  case "$sha" in *[!0-9a-f]*) die "unexpected sha256 in the media records";; esac
  [ "${#sha}" = 64 ] || die "unexpected sha256 in the media records"
  case "$size" in ''|*[!0-9]*) die "unexpected size in the media records";; esac
  ck="$(r2_copy_key "$sha" "$GEN")"
  grep -qxF "$ck" "$WORK/have.txt" && continue
  if ! src s3api get-object --bucket "$R2_SOURCE_BUCKET" --key "$key" "$WORK/f" >/dev/null 2>&1; then
    FAILED=$((FAILED+1)); log "could not read an R2 original (sha256 ${sha:0:12})"; continue
  fi
  if [ "$(wc -c < "$WORK/f" | tr -d ' ')" != "$size" ] || [ "$(sha256 "$WORK/f")" != "$sha" ]; then
    FAILED=$((FAILED+1)); log "an R2 original differs from the size or sha256 the database recorded (${sha:0:12})"; rm -f "$WORK/f"; continue
  fi
  age_encrypt "$WORK/f" "$WORK/f.age"
  put_once "$WORK/f.age" "$ck" application/octet-stream --metadata "sha256=$sha,size=$size"
  echo "$ck" >> "$WORK/have.txt"
  COPIED=$((COPIED+1)); BYTES=$((BYTES+size)); rm -f "$WORK/f" "$WORK/f.age"
done < <(sort -u "$WORK/live.tsv" "$BACKUP_STATE_DIR/r2-objects.tsv")

# The snapshot's own inventory: every original the dump references must have a copy.
: > "$WORK/inventory.tsv"; MISSING=0
while IFS=$'\t' read -r sha size key; do
  ck="$(r2_copy_key "$sha" "$GEN")"
  if grep -qxF "$ck" "$WORK/have.txt"; then state=ok; else state=MISSING; MISSING=$((MISSING+1)); fi
  printf '%s\tr2\t%s\t%s\t%s\t%s\n' "$sha" "$key" "$size" "$ck" "$state" >> "$WORK/inventory.tsv"
done < "$BACKUP_STATE_DIR/r2-objects.tsv"
TOTAL="$(wc -l < "$WORK/inventory.tsv" | tr -d ' ')"
COMPLETE=true; [ "$MISSING" -eq 0 ] && [ "$FAILED" -eq 0 ] || COMPLETE=false
cat > "$WORK/r2media.json" <<JSON
{"snapshot":"$NAME","label":"$BACKUP_LABEL","objects":$TOTAL,"backed_up":$((TOTAL-MISSING)),"missing":$MISSING,"copy_failures":$FAILED,
 "complete":$COMPLETE,"r2_media_records_not_covered":0,"inventory_sha256":"$(sha256 "$WORK/inventory.tsv")"}
JSON
age_encrypt "$WORK/inventory.tsv" "$WORK/inventory.tsv.age"
# Inventories first, records last (see media-backup.sh): an interrupted run is superseded by the next one.
for prefix in $PREFIXES; do put_once "$WORK/inventory.tsv.age" "$prefix/$NAME.r2media.tsv.age" application/octet-stream; done
for prefix in $PREFIXES; do put_once "$WORK/r2media.json" "$prefix/$NAME.r2media.json" application/json; done
log "r2 media: snapshot $TOTAL originals, $((TOTAL-MISSING)) backed up, $MISSING missing; $COPIED new copied ($BYTES bytes), $FAILED failed"
[ "$COMPLETE" = true ] || die "the R2 media backup of $NAME is incomplete (marked so in its .r2media.json); the next scheduled run takes a new snapshot"
