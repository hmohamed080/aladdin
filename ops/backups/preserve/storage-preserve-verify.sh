#!/usr/bin/env bash
# Read-back check of a storage-preserve.sh output. Needs the age PRIVATE key (owner key); no Supabase or R2 credential.
# Usage: AGE_IDENTITY_FILE=key.txt EXPECT_OBJECTS=1080 bash storage-preserve-verify.sh <OUT_DIR>
# Prints RESULT: PASS only when every file decrypts to its recorded size and sha256 and the counts match.
set -euo pipefail
export LC_ALL=C
D="${1:?usage: storage-preserve-verify.sh <out dir>}"
[ -n "${AGE_IDENTITY_FILE:-}" ] || { echo "AGE_IDENTITY_FILE is not set" >&2; exit 2; }
for v in SUPABASE_SERVICE_ROLE_KEY AWS_SECRET_ACCESS_KEY BACKUP_DB_URL; do [ -z "${!v:-}" ] || { echo "$v is set: verify holds the age key only" >&2; exit 2; }; done
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; fail=0
( cd "$D" && grep -v ' \./SHA256SUMS$' SHA256SUMS | sha256sum -c --quiet - ) || { echo "FAIL: stored files differ from SHA256SUMS"; fail=1; }
age -d -i "$AGE_IDENTITY_FILE" -o "$W/m.tsv" "$D/manifest.tsv.age" || { echo "FAIL: manifest does not decrypt"; exit 1; }
files=0; empty=0; total=0
while IFS=$'\t' read -r b k size sum cls name; do
  total=$((total+1))
  if [ "$cls" = EMPTY ]; then [ "$size" = 0 ] && empty=$((empty+1)) || { echo "FAIL: bad empty entry #$total"; fail=1; }; continue; fi
  age -d -i "$AGE_IDENTITY_FILE" -o "$W/f" "$D/objects/$name.age" 2>/dev/null || { echo "FAIL: entry #$total does not decrypt"; fail=1; continue; }
  [ "$(wc -c < "$W/f" | tr -d ' ')" = "$size" ] && [ "$(sha256sum "$W/f" | cut -d' ' -f1)" = "$sum" ] || { echo "FAIL: entry #$total size/sha256 differs"; fail=1; }
  files=$((files+1)); rm -f "$W/f"
done < "$W/m.tsv"
on_disk=$(find "$D/objects" -type f | wc -l | tr -d ' ')
[ "$on_disk" = "$files" ] || { echo "FAIL: $on_disk encrypted files on disk, $files in the manifest"; fail=1; }
if [ -n "${EXPECT_OBJECTS:-}" ] && [ "$total" != "$EXPECT_OBJECTS" ]; then echo "FAIL: $total objects, expected $EXPECT_OBJECTS"; fail=1; fi
echo "objects $total (files $files, empty $empty)"
[ "$fail" = 0 ] && echo "RESULT: PASS" || { echo "RESULT: FAIL"; exit 1; }
