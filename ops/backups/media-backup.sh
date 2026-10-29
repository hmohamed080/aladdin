#!/usr/bin/env bash
# Daily copy of media files that live in Supabase Storage (Production today) into the backup bucket.
# READ-ONLY on the project: one SELECT on storage.objects and authenticated GETs of the files. Nothing is deleted
# anywhere: a file removed from Storage stays in the backup (the bucket lock keeps it at least 35 days).
# Database backups never contain these bytes, only their storage.objects rows.
#
#   BACKUP_DB_URL=... SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... AGE_RECIPIENTS=...
#   BACKUP_LABEL=production BACKUP_BUCKET=... R2_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
#   bash media-backup.sh
#
# Writes (never replacing anything):
#   media/<label>/supabase/objects/<bucket>/<object id>-<etag>.age   each file once, encrypted, x-amz-meta-sha256 = plain sha256
#   media/<label>/supabase/inventory/YYYY/MM/DD/<stamp>.tsv.age     every live object -> its backup key (for restores)
# Keys hold only the object's random id, never its path or any name.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
require_env BACKUP_DB_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY AGE_RECIPIENTS
check_db_url "$BACKUP_DB_URL"
case "$BACKUP_LABEL:$SUPABASE_URL" in
  local-test:http://127.0.0.1:*|production:https://*.supabase.co|acceptance:https://*.supabase.co) ;;
  *) die "SUPABASE_URL does not fit BACKUP_LABEL=$BACKUP_LABEL";;
esac
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; read -r Y M D <<< "$(TZ=Africa/Cairo date +'%Y %m %d')"
P="media/$BACKUP_LABEL/supabase"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

psql "$BACKUP_DB_URL" -X -At -F $'\t' -v ON_ERROR_STOP=1 -c 'set session characteristics as transaction read only' -c "
  select id, bucket_id, name, (metadata->>'size')::bigint, regexp_replace(coalesce(metadata->>'eTag',''), '[^0-9A-Za-z]', '', 'g')
  from storage.objects where coalesce((metadata->>'size')::bigint, 0) > 0 order by created_at, id" | sed '1{/^SET$/d}' > "$WORK/live.tsv"
s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$P/objects/" --query 'Contents[].Key' --output text \
  | tr '\t' '\n' | grep -v '^None$' | sort > "$WORK/have.txt" || true

COPIED=0; BYTES=0; FAILED=0
: > "$WORK/inventory.tsv"
while IFS=$'\t' read -r id bucket name size etag; do
  [ -n "$id" ] || continue
  case "$id" in *[!0-9a-f-]*) die "unexpected object id";; esac
  case "$bucket" in *[!0-9a-z_-]*) die "unexpected bucket id";; esac
  key="$P/objects/$bucket/$id-${etag:-noetag}.age"
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$bucket" "$name" "$size" "$key" >> "$WORK/inventory.tsv"
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
  COPIED=$((COPIED+1)); BYTES=$((BYTES+size)); rm -f "$WORK/f" "$WORK/f.age"
done < "$WORK/live.tsv"

age_encrypt "$WORK/inventory.tsv" "$WORK/inventory.tsv.age"
put_once "$WORK/inventory.tsv.age" "$P/inventory/$Y/$M/$D/$STAMP.tsv.age" application/octet-stream
log "media: $(wc -l < "$WORK/live.tsv" | tr -d ' ') live files, $COPIED new copied ($BYTES bytes), $FAILED failed"
[ "$FAILED" -eq 0 ] || die "$FAILED files were not backed up; the next run retries them"
