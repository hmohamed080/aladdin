#!/usr/bin/env bash
# Media step of the daily backup: runs right after db-backup.sh in the same job and makes that database snapshot
# restorable with its files. READ-ONLY on the project: one SELECT on storage.objects and authenticated GETs.
# LEGACY AND OPT-IN. Aladdin is moving all media to R2 and the owner has decided to delete the legacy user media
# from Supabase Storage for good, so this step is OFF unless LEGACY_MEDIA_BACKUP=1. Switch it on only for a
# documented, time-boxed recovery need, and keep its prefix on a SHORT lifecycle expiry (30 days), never a
# year-long lock. Nothing is deleted by this kit itself.
# Database backups never contain these bytes, only their storage.objects rows.
#
#   BACKUP_STATE_DIR=<the folder db-backup.sh wrote>  BACKUP_DB_URL=... SUPABASE_URL=https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=... AGE_RECIPIENTS=... BACKUP_LABEL=production BACKUP_BUCKET=... R2_ENDPOINT=...
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...  bash media-backup.sh
#
# Writes (each object once, never replacing anything; the copies are shared by every snapshot that needs them):
#   media/<label>/supabase/objects/<bucket>/<object id>-<etag>.age   each file version once, encrypted;
#                                                                    x-amz-meta-sha256 / size = the plain file
#   <each prefix of the snapshot>/<snapshot>.media.tsv.age           EVERY object of that snapshot -> its backup copy
#   <each prefix of the snapshot>/<snapshot>.media.json              counts: complete true/false (no names)
# The snapshot files sit next to the database backup, so they share its lock and expiry (14 d, 8 w, 12 months).
# Keys hold only the object's random id, never its path or any name.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
require_production_go
[ "${LEGACY_MEDIA_BACKUP:-0}" = 1 ] || { log "legacy Supabase media backup is off (LEGACY_MEDIA_BACKUP is not 1): nothing to do"; exit 0; }
require_env BACKUP_STATE_DIR BACKUP_DB_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY AGE_RECIPIENTS
check_db_url "$BACKUP_DB_URL"; check_supabase_url "$SUPABASE_URL"; check_service_key "$SUPABASE_SERVICE_ROLE_KEY"
[ -s "$BACKUP_STATE_DIR/db.env" ] || die "run db-backup.sh first: no snapshot in $BACKUP_STATE_DIR"
# shellcheck disable=SC1091
. "$BACKUP_STATE_DIR/db.env"
if [ "${SKIPPED:-0}" = 1 ]; then log "no new snapshot today: nothing to do"; exit 0; fi
[ -f "$BACKUP_STATE_DIR/objects.tsv" ] || die "the snapshot's media list is missing"
umask 077
P="media/$BACKUP_LABEL/supabase"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# Live objects too: a file uploaded after the dump is copied now, so tomorrow's snapshot finds it even if it
# is deleted before then.
psql "$BACKUP_DB_URL" -X -At -F $'\t' -v ON_ERROR_STOP=1 -c 'set session characteristics as transaction read only' -c "
  select id, bucket_id, name, (metadata->>'size')::bigint, regexp_replace(coalesce(metadata->>'eTag',''), '[^0-9A-Za-z]', '', 'g')
  from storage.objects where coalesce((metadata->>'size')::bigint, 0) > 0 order by created_at, id" | sed '1{/^SET$/d}' > "$WORK/live.tsv"
s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$P/objects/" --query 'Contents[].Key' --output text \
  | tr '\t' '\n' | grep -v '^None$' | sort > "$WORK/have.txt" || true

COPIED=0; BYTES=0; FAILED=0
while IFS=$'\t' read -r id bucket name size etag; do
  [ -n "$id" ] || continue
  case "$id" in *[!0-9a-f-]*) die "unexpected object id";; esac
  case "$bucket" in *[!0-9a-z_-]*) die "unexpected bucket id";; esac
  key="$(media_copy_key "$id" "$bucket" "$etag")"
  grep -qxF "$key" "$WORK/have.txt" && continue
  path="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe="/"))' "$name")"
  if ! curl -fsS --retry 3 --max-time 300 -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
       -o "$WORK/f" "$SUPABASE_URL/storage/v1/object/authenticated/$bucket/$path"; then
    FAILED=$((FAILED+1)); log "could not read object $id"; continue
  fi
  [ "$(wc -c < "$WORK/f" | tr -d ' ')" = "$size" ] || { FAILED=$((FAILED+1)); log "object $id: size differs from storage.objects"; continue; }
  sum="$(sha256 "$WORK/f")"
  age_encrypt "$WORK/f" "$WORK/f.age"
  put_once "$WORK/f.age" "$key" application/octet-stream --metadata "sha256=$sum,size=$size"
  echo "$key" >> "$WORK/have.txt"
  COPIED=$((COPIED+1)); BYTES=$((BYTES+size)); rm -f "$WORK/f" "$WORK/f.age"
done < <(sort -u "$WORK/live.tsv" "$BACKUP_STATE_DIR/objects.tsv")

# The snapshot's own inventory: every object the dump references must have a copy. One deleted between the
# dump and this step is found by its earlier copy; one never copied at all is MISSING and the run fails.
: > "$WORK/inventory.tsv"; MISSING=0
while IFS=$'\t' read -r id bucket name size etag; do
  key="$(media_copy_key "$id" "$bucket" "$etag")"
  if grep -qxF "$key" "$WORK/have.txt"; then state=ok; else state=MISSING; MISSING=$((MISSING+1)); fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$bucket" "$name" "$size" "$key" "$state" >> "$WORK/inventory.tsv"
done < "$BACKUP_STATE_DIR/objects.tsv"
TOTAL="$(wc -l < "$WORK/inventory.tsv" | tr -d ' ')"
# R2-hosted originals are copied by r2-media-backup.sh (its own record); uncovered only when that step is off.
UNCOVERED="${R2_ROWS:-0}"; [ "${R2_MEDIA_BACKUP:-0}" != 1 ] || UNCOVERED=0
COMPLETE=true; [ "$MISSING" -eq 0 ] && [ "$FAILED" -eq 0 ] || COMPLETE=false
cat > "$WORK/media.json" <<JSON
{"snapshot":"$NAME","label":"$BACKUP_LABEL","objects":$TOTAL,"backed_up":$((TOTAL-MISSING)),"missing":$MISSING,"copy_failures":$FAILED,
 "complete":$COMPLETE,"r2_media_records_not_covered":$UNCOVERED,"inventory_sha256":"$(sha256 "$WORK/inventory.tsv")"}
JSON
age_encrypt "$WORK/inventory.tsv" "$WORK/inventory.tsv.age"
# Inventories first, records last: a record in a prefix means its inventory is there too. Each object is written
# once and never replaced. A run interrupted anywhere in here leaves a snapshot that media-record checks reject
# (a prefix without its record), and the next scheduled run supersedes it with a new snapshot.
for prefix in $PREFIXES; do put_once "$WORK/inventory.tsv.age" "$prefix/$NAME.media.tsv.age" application/octet-stream; done
for prefix in $PREFIXES; do put_once "$WORK/media.json" "$prefix/$NAME.media.json" application/json; done
log "media: snapshot $TOTAL files, $((TOTAL-MISSING)) backed up, $MISSING missing; $COPIED new copied ($BYTES bytes), $FAILED failed"
[ "$UNCOVERED" -eq 0 ] || log "WARNING: $R2_ROWS media records live in R2, which this job does not copy (see README, R2 media)"
[ "$COMPLETE" = true ] || die "the media backup of $NAME is incomplete (marked so in its .media.json); the next scheduled run takes a new snapshot"
