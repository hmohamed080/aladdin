#!/usr/bin/env bash
# Proves one snapshot's SITE-MEDIA backup (the restore test runs it next to media-verify.sh). Touches no hosted project
# and writes nothing to the bucket. The site bucket has no database rows, so the inventory is compared with itself and
# with the stored copies, and fails on any difference:
#   1. the snapshot's sitemedia record is valid and complete, and the decrypted inventory is the one it hashes;
#   2. every inventory entry is "ok" and has a stored copy with at least the recorded size and its sha256 metadata;
#   3. a random sample (MEDIA_SAMPLE, default 20) plus the largest object is decrypted and its sha256 and size equal
#      what was recorded when it was copied.
# An empty bucket is a valid, complete record (0 objects). Snapshots older than the guaranteed full-restore window
# (lib.sh, 59 days for R2 media) are database-only: copies that already expired are counted, not failed.
#
#   BACKUP_LABEL=... BACKUP_BUCKET=... R2_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
#   KEY=db/<label>/.../<snapshot>.tar.age  AGE_IDENTITY_FILE=<private key file>  OUT=<report folder>
# Writes $OUT/media-summary.txt (one line) and $OUT/media-fails.txt (one finding per line); exit 1 on any finding.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
require_env KEY AGE_IDENTITY_FILE OUT
case "$KEY" in db/"$BACKUP_LABEL"/*.tar.age) ;; *) die "KEY must be a $BACKUP_LABEL .tar.age snapshot";; esac
umask 077
mkdir -p "$OUT"; W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "${KEY%.tar.age}.json" "$W/snap-manifest.json" >/dev/null 2>&1 || die "the snapshot manifest cannot be read"
TAKEN="$(sed -n 's/.*"taken_utc":"\([^"]*\)".*/\1/p' "$W/snap-manifest.json" | head -1)"
[ -n "$TAKEN" ] || die "the snapshot manifest has no taken_utc"
OUTSIDE=0; outside_media_guarantee r2 "$TAKEN" && OUTSIDE=1
prefix="${KEY%/*}"; name="$(basename "$KEY" .tar.age)"
fails=(); summary=""
finish() {
  printf '%s\n' "$summary" > "$OUT/media-summary.txt"
  if [ "${#fails[@]}" -gt 0 ]; then printf '%s\n' "${fails[@]}" > "$OUT/media-fails.txt"; else : > "$OUT/media-fails.txt"; fi
  [ "${#fails[@]}" -eq 0 ]
  exit $?
}
# 1. The record and the inventory.
found="$(media_findings "$prefix" "$name" sitemedia)"
while IFS= read -r line; do case "$line" in "P "*) fails+=("${line#P }");; esac; done <<< "$found"
if [ "${#fails[@]}" -gt 0 ]; then summary="NO VALID SITE-MEDIA RECORD for this snapshot"; finish; fi
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$prefix/$name.sitemedia.json" "$W/media.json" >/dev/null
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$prefix/$name.sitemedia.tsv.age" "$W/inv.age" >/dev/null
if ! age -d -i "$AGE_IDENTITY_FILE" "$W/inv.age" > "$W/inv.tsv" 2>/dev/null; then
  fails+=("the site-media inventory cannot be decrypted with this key"); summary="inventory cannot be decrypted"; finish
fi
want="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["inventory_sha256"])' "$W/media.json")"
[ "$(sha256 "$W/inv.tsv")" = "$want" ] || fails+=("the decrypted site-media inventory is not the one its record hashes")
records="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["objects"])' "$W/media.json")"
FILES="$(wc -l < "$W/inv.tsv" | tr -d ' ')"
[ "$FILES" = "$records" ] || fails+=("the inventory has $FILES entries but its record says $records")
[ "$(awk -F'\t' '$6 != "ok"' "$W/inv.tsv" | wc -l | tr -d ' ')" = 0 ] || fails+=("the site-media inventory holds entries that were not backed up")

# 2. Every copy exists with at least the plain file's size and its recorded sha256 and size.
s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "media/$BACKUP_LABEL/site/" --output json \
  | python3 -c '
import json, sys
t = sys.stdin.read().strip()
for o in (json.loads(t).get("Contents") or []) if t and t != "null" else []: print(o["Key"] + "\t" + str(o["Size"]))' | sort > "$W/have.tsv" || true
GONE=0; SMALL=0; BADMETA=0; EXPIRED=0
: > "$W/present.tsv"
while IFS=$'\t' read -r sha _ _ size k _; do
  [ -n "$k" ] || continue
  stored="$(awk -F'\t' -v k="$k" '$1 == k {print $2}' "$W/have.tsv")"
  if [ -z "$stored" ]; then if [ "$OUTSIDE" = 1 ]; then EXPIRED=$((EXPIRED+1)); else GONE=$((GONE+1)); fi; continue; fi
  [ "$stored" -ge "$size" ] || SMALL=$((SMALL+1))
  meta="$(s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$k" --query '[Metadata.size,Metadata.sha256]' --output text 2>/dev/null || true)"
  m_size="${meta%%$'\t'*}"; m_sha="${meta#*$'\t'}"
  if [ "$m_size" != "$size" ] || [ "$m_sha" != "$sha" ]; then BADMETA=$((BADMETA+1)); fi
  printf '%s\t%s\t%s\n' "$sha" "$size" "$k" >> "$W/present.tsv"
done < "$W/inv.tsv"
[ "$GONE" -eq 0 ] || fails+=("$GONE site-media objects have no stored copy in the backup bucket")
[ "$SMALL" -eq 0 ] || fails+=("$SMALL stored copies are smaller than the object they back up")
[ "$BADMETA" -eq 0 ] || fails+=("$BADMETA stored copies do not carry the recorded size and sha256")

# 3. Decrypt a sample and compare with what was recorded at copy time.
{ shuf -n "${MEDIA_SAMPLE:-20}" "$W/present.tsv" || true; awk -F'\t' '$2+0 > m {m=$2+0; l=$0} END {if (l != "") print l}' "$W/present.tsv"; } | sort -u > "$W/sample.tsv"
N=0; BAD=0
while IFS=$'\t' read -r sha size k; do
  [ -n "$k" ] || continue; N=$((N+1))
  if s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$k" "$W/m.age" >/dev/null 2>&1 \
     && age -d -i "$AGE_IDENTITY_FILE" -o "$W/m" "$W/m.age" 2>/dev/null \
     && [ "$(sha256 "$W/m")" = "$sha" ] && [ "$(wc -c < "$W/m" | tr -d ' ')" = "$size" ]; then :; else BAD=$((BAD+1)); fi
  rm -f "$W/m" "$W/m.age"
done < "$W/sample.tsv"
[ "$BAD" -eq 0 ] || fails+=("$BAD of $N sampled site-media objects did not restore exactly")

if [ "${#fails[@]}" -eq 0 ]; then
  if [ "$OUTSIDE" = 1 ]; then
    summary="[site] DATABASE-ONLY restore (snapshot older than the $(media_guarantee_days r2)-day window): $FILES objects listed; $EXPIRED copies already expired (expected); $((N-BAD)) of $N sampled objects restored with the recorded sha256 and size"
  else
    summary="[site] $FILES objects (an empty bucket is a complete backup of nothing); all $FILES copies exist with the recorded size and sha256; $((N-BAD)) of $N sampled objects restored with the recorded sha256 and size"
  fi
else
  summary="SITE MEDIA CHECK FAILED ($FILES objects; $((N-BAD)) of $N sampled restored exactly)"
fi
finish
