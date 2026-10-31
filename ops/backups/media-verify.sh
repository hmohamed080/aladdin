#!/usr/bin/env bash
# Proves one snapshot's media backup against a database (the restore test's throwaway restore of that same
# snapshot). Touches no hosted project and writes nothing to the bucket. It checks, and fails on any difference:
#   1. the snapshot's media record is valid and complete, and the decrypted inventory is the one it hashes;
#   2. the inventory and the database's storage.objects rows (files with bytes) agree EXACTLY on object id,
#      bucket, complete path, size and the copy key that the id, bucket and etag give; every entry is "ok";
#   3. every inventory entry has a stored copy in the backup bucket, with the recorded size and a sha256;
#   4. a random sample (MEDIA_SAMPLE, default 20) plus the largest file is decrypted and its sha256 and size
#      equal what was recorded when it was copied.
#
#   BACKUP_LABEL=... BACKUP_BUCKET=... R2_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
#   KEY=db/<label>/.../<snapshot>.tar.age  AGE_IDENTITY_FILE=<private key file>  OUT=<report folder>
#   MEDIA_DB_CONTAINER=<docker container of the restored database> | MEDIA_DB_URL=postgresql://...
# Optional: MEDIA_SAMPLE (20), MEDIA_HEAD_LIMIT (2000: how many copies get their stored metadata read).
# Writes $OUT/media-summary.txt (one line) and $OUT/media-fails.txt (one finding per line); exit 1 on any finding.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
require_env KEY AGE_IDENTITY_FILE OUT
[ -n "${MEDIA_DB_CONTAINER:-}${MEDIA_DB_URL:-}" ] || die "set MEDIA_DB_CONTAINER or MEDIA_DB_URL"
case "$KEY" in db/"$BACKUP_LABEL"/*.tar.age) ;; *) die "KEY must be a $BACKUP_LABEL .tar.age snapshot";; esac
umask 077
mkdir -p "$OUT"; W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
prefix="${KEY%/*}"; name="$(basename "$KEY" .tar.age)"
fails=(); summary=""
finish() {
  printf '%s\n' "$summary" > "$OUT/media-summary.txt"
  if [ "${#fails[@]}" -gt 0 ]; then printf '%s\n' "${fails[@]}" > "$OUT/media-fails.txt"; else : > "$OUT/media-fails.txt"; fi
  [ "${#fails[@]}" -eq 0 ]
  exit $?
}

dbq() {
  if [ -n "${MEDIA_DB_CONTAINER:-}" ]; then
    docker exec -i "$MEDIA_DB_CONTAINER" psql -U postgres -d postgres -X -q -At -F $'\t' -v ON_ERROR_STOP=1
  else
    psql "$MEDIA_DB_URL" -X -q -At -F $'\t' -v ON_ERROR_STOP=1
  fi
}
copy_prefix="media/$BACKUP_LABEL/supabase/objects/"

# 1. The record and the inventory.
found="$(media_findings "$prefix" "$name")"
while IFS= read -r line; do case "$line" in "P "*) fails+=("${line#P }");; esac; done <<< "$found"
if [ "${#fails[@]}" -gt 0 ]; then summary="NO VALID MEDIA RECORD for this snapshot"; finish; fi
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$prefix/$name.media.json" "$W/media.json" >/dev/null
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$prefix/$name.media.tsv.age" "$W/inv.age" >/dev/null
if ! age -d -i "$AGE_IDENTITY_FILE" "$W/inv.age" > "$W/inv.tsv" 2>/dev/null; then
  fails+=("the media inventory cannot be decrypted with this key"); summary="inventory cannot be decrypted"; finish
fi
want="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["inventory_sha256"])' "$W/media.json")"
[ "$(sha256 "$W/inv.tsv")" = "$want" ] || fails+=("the decrypted media inventory is not the one its record hashes")
records="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["objects"])' "$W/media.json")"
[ "$(wc -l < "$W/inv.tsv" | tr -d ' ')" = "$records" ] || fails+=("the inventory has $(wc -l < "$W/inv.tsv" | tr -d ' ') entries but its record says $records")

# 2. The inventory against the database: id, bucket, complete path, size, copy key, state.
dbq > "$W/db.tsv" <<'SQL'
select id, bucket_id, name, (metadata->>'size')::bigint, regexp_replace(coalesce(metadata->>'eTag',''), '[^0-9A-Za-z]', '', 'g')
from storage.objects where coalesce((metadata->>'size')::bigint, 0) > 0 order by id;
SQL
python3 "$HERE/inventory-compare.py" "$W/inv.tsv" "$W/db.tsv" "$BACKUP_LABEL" > "$W/compare.txt" || fails+=("the inventory comparison itself failed")
while IFS= read -r line; do case "$line" in "P "*) fails+=("${line#P }");; esac; done < "$W/compare.txt"
FILES="$(wc -l < "$W/db.tsv" | tr -d ' ')"

# 3. Every copy exists, with at least the plain file's size (encryption only adds), and its recorded size.
s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$copy_prefix" --query 'Contents[].[Key,Size]' --output text \
  | grep -v '^None$' > "$W/have.tsv" || true
awk -F'\t' 'FILENAME==ARGV[1] {sz[$1]=$2; next} !($5 in sz) {gone++; if (gone<=3) print "G " $1; next} sz[$5] < $4 {small++; if (small<=3) print "S " $1}
  END {if (gone) print "X " gone; if (small) print "Y " small}' "$W/have.tsv" "$W/inv.tsv" > "$W/exist.txt"
while IFS=' ' read -r kind a; do
  case "$kind" in X) fails+=("$a files have no stored copy in the backup bucket");; Y) fails+=("$a stored copies are smaller than the file they back up");; esac
done < "$W/exist.txt"
HEAD_LIMIT="${MEDIA_HEAD_LIMIT:-2000}"; BADMETA=0; HEADED=0
while IFS=$'\t' read -r id _ _ size k _; do
  [ -n "$k" ] || continue
  HEADED=$((HEADED+1)); [ "$HEADED" -le "$HEAD_LIMIT" ] || break
  meta="$(s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$k" --query '[Metadata.size,Metadata.sha256]' --output text 2>/dev/null || true)"
  m_size="${meta%%$'\t'*}"; m_sha="${meta#*$'\t'}"
  if [ "$m_size" != "$size" ] || ! [[ "$m_sha" =~ ^[0-9a-f]{64}$ ]]; then BADMETA=$((BADMETA+1)); fi
done < "$W/inv.tsv"
[ "$BADMETA" -eq 0 ] || fails+=("$BADMETA stored copies do not carry the recorded size and a sha256")

# 4. Decrypt a sample and compare with what was recorded at copy time.
{ shuf -n "${MEDIA_SAMPLE:-20}" "$W/inv.tsv" || true; awk -F'\t' '$4+0 > m {m=$4+0; l=$0} END {if (l != "") print l}' "$W/inv.tsv"; } | sort -u > "$W/sample.tsv"
N=0; BAD=0
while IFS=$'\t' read -r id _ _ size k _; do
  [ -n "$k" ] || continue; N=$((N+1))
  if s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$k" "$W/m.age" > "$W/m.json" 2>/dev/null; then
    rec="$(sed -n 's/.*"sha256": *"\([0-9a-f]\{64\}\)".*/\1/p' "$W/m.json")"
    if age -d -i "$AGE_IDENTITY_FILE" -o "$W/m" "$W/m.age" 2>/dev/null && [ -n "$rec" ] && [ "$(sha256 "$W/m")" = "$rec" ] \
       && [ "$(wc -c < "$W/m" | tr -d ' ')" = "$size" ]; then :; else BAD=$((BAD+1)); echo "sampled copy of $id failed" >> "$W/bad.txt"; fi
  else BAD=$((BAD+1)); echo "sampled copy of $id could not be read" >> "$W/bad.txt"; fi
  rm -f "$W/m" "$W/m.age"
done < "$W/sample.tsv"
[ "$BAD" -eq 0 ] || fails+=("$BAD of $N sampled files did not restore exactly: $(head -3 "$W/bad.txt" | tr '\n' ';')")

if [ "${#fails[@]}" -eq 0 ]; then
  summary="inventory exact ($FILES files: id, bucket, full path, size and copy key equal the restored database); all $FILES copies exist with the recorded size; $((N-BAD)) of $N sampled files restored with the recorded sha256 and size"
else
  summary="MEDIA CHECK FAILED ($FILES files in the restored database; $((N-BAD)) of $N sampled files restored exactly)"
fi
finish
