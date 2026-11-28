#!/usr/bin/env bash
# Owner-run, one-off UPLOAD of an already verified, already encrypted source-preservation folder to the Production
# backup bucket (Track D). Runs on the owner's PC. Needs: bash, aws CLI v2, sha256sum, python3.
#
# What it may send: ONLY encrypted output, i.e. the files of a storage-preserve.sh folder (objects/*.age,
# manifest.tsv.age, summary.json, SHA256SUMS) or of an encrypt-backup.sh output (*.tar.gpg, *.tar.gpg.sha256).
# Nothing else in the folder is touched, and a plaintext file is never uploaded.
#
# Rules (do not weaken):
#  - Holds ONLY an R2 write token scoped to aladdin-production-db-backups. It refuses to start if a Supabase Storage
#    S3 endpoint/key, a database URL or password, a service-role key or an age private key is in the environment, and
#    the endpoint must be a Cloudflare R2 endpoint. The token is temporary: revoke it after the verified upload.
#  - Never overwrites and never deletes: every PUT is conditional (If-None-Match: *); an existing key stops the run.
#  - Each object is read back from R2 and compared by size and sha256 before the run succeeds.
#  - No lifecycle or lock is applied here; the prefix must stay outside the 30/90-day expiry rules (owner applies that).
#  - It never prints credentials, and object names are not logged (only counts and the destination prefix).
#
# Env: R2_ENDPOINT  https://<account id>.r2.cloudflarestorage.com
#      BUCKET       aladdin-production-db-backups
#      DEST_PREFIX  source-preservation/<YYYYMMDD>/<storage|database>/
#      AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   the temporary R2 write token (this and nothing else sensitive)
#      CONFIRM      exactly: upload production preservation
# Usage: bash upload-preserved.sh <folder>
set -euo pipefail
export LC_ALL=C AWS_PAGER="" AWS_EC2_METADATA_DISABLED=true AWS_DEFAULT_REGION=auto
die() { echo "upload: $*" >&2; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] $*"; }
D="${1:?usage: upload-preserved.sh <folder>}"; [ -d "$D" ] || die "not a folder"
for v in S3_ENDPOINT S3_REGION PROJECT_REF BACKUP_DB_URL DATABASE_URL SUPABASE_DB_PASSWORD SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL \
         AGE_IDENTITY AGE_IDENTITY_FILE AGE_RESTORE_TEST_IDENTITY R2_BACKUP_READ_SECRET; do
  [ -z "${!v:-}" ] || die "$v is set: this job holds the R2 write token and nothing else sensitive"
done
for v in R2_ENDPOINT BUCKET DEST_PREFIX AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do [ -n "${!v:-}" ] || die "$v is not set"; done
[ "${CONFIRM:-}" = "upload production preservation" ] || die "type the confirmation: CONFIRM='upload production preservation'"
[ "$BUCKET" = aladdin-production-db-backups ] || die "BUCKET must be aladdin-production-db-backups"
if [ -z "${LOCAL_TEST:-}" ]; then
  printf '%s' "$R2_ENDPOINT" | grep -Eq '^https://[0-9a-f]{32}\.r2\.cloudflarestorage\.com$' || die "R2_ENDPOINT must be https://<account id>.r2.cloudflarestorage.com"
fi
printf '%s' "$DEST_PREFIX" | grep -Eq '^source-preservation/[0-9]{8}/(storage|database)/$' || die "DEST_PREFIX must look like source-preservation/20261110/storage/"
r2() { aws --endpoint-url "$R2_ENDPOINT" s3api "$@"; }

# 1. Choose the files: an exact allow-list; anything else in the folder is ignored, a plaintext dump is refused.
cd "$D"
: > "${TMPDIR:-/tmp}/up.$$"; LIST="${TMPDIR:-/tmp}/up.$$"; trap 'rm -f "$LIST"' EXIT
if [ -s manifest.tsv.age ]; then
  ( grep -v ' \./SHA256SUMS$' SHA256SUMS | sha256sum -c --quiet - ) || die "the folder does not match its SHA256SUMS: not uploading"
  find objects -type f -name '*.age' 2>/dev/null | sort > "$LIST"; echo manifest.tsv.age >> "$LIST"; echo summary.json >> "$LIST"; echo SHA256SUMS >> "$LIST"
else
  ls ./*.tar.gpg ./*.tar.gpg.sha256 2>/dev/null | sed 's|^\./||' | sort > "$LIST"
  [ -s "$LIST" ] || die "nothing to upload: not a storage-preserve folder and no *.tar.gpg files"
  for f in $(grep '\.tar\.gpg$' "$LIST"); do
    [ "$(cut -d' ' -f1 "$f.sha256")" = "$(sha256sum "$f" | cut -d' ' -f1)" ] || die "an encrypted dump does not match its .sha256: not uploading"
  done
fi
N="$(wc -l < "$LIST" | tr -d ' ')"; [ "$N" -ge 2 ] || die "too few files to be a backup ($N)"
log "uploading $N files to $BUCKET/$DEST_PREFIX (conditional puts: nothing is overwritten)"

# 2. Upload each file once, then read it back and compare size and sha256.
WORK="$(mktemp -d)"; trap 'rm -f "$LIST"; rm -rf "$WORK"' EXIT; DONE=0; BYTES=0
while IFS= read -r f; do
  key="$DEST_PREFIX$f"; size="$(wc -c < "$f" | tr -d ' ')"; sum="$(sha256sum "$f" | cut -d' ' -f1)"
  r2 put-object --bucket "$BUCKET" --key "$key" --body "$f" --content-type application/octet-stream \
     --if-none-match '*' --metadata "sha256=$sum,size=$size" >/dev/null 2>"$WORK/err" \
     || die "upload #$((DONE+1)) failed or the key already exists (nothing is overwritten): $(tr -d '\n' < "$WORK/err" | cut -c1-120)"
  r2 get-object --bucket "$BUCKET" --key "$key" "$WORK/back" >/dev/null || die "cannot read back upload #$((DONE+1))"
  [ "$(wc -c < "$WORK/back" | tr -d ' ')" = "$size" ] && [ "$(sha256sum "$WORK/back" | cut -d' ' -f1)" = "$sum" ] \
     || die "upload #$((DONE+1)): the stored copy differs from the local file"
  rm -f "$WORK/back"; DONE=$((DONE+1)); BYTES=$((BYTES+size))
done < "$LIST"
log "DONE: $DONE files, $BYTES bytes uploaded and read back identical. Now revoke the R2 token."
echo "RESULT: PASS"
