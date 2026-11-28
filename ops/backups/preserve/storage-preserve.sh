#!/usr/bin/env bash
# Owner-run, one-off SOURCE PRESERVATION of every file in a project's Supabase Storage (Track D, Gate S).
# Runs on the owner's PC (Git Bash / WSL / Linux). Needs: bash, aws CLI v2, age, sha256sum, python3.
#
# Credential rules (do not weaken):
#  - The Supabase Storage S3 key is a FULL Storage-access credential (not read-only). This script holds ONLY that key.
#  - It must never be set together with a database URL, a service-role key, an R2 token or an age PRIVATE key.
#    The script refuses to start if any of those variables is present.
#  - It only LISTS and GETS (read). It never writes, replaces or deletes anything in Supabase.
# Output is local only: encrypted objects + encrypted manifest in OUT_DIR. Uploading to R2 is a separate step
# with a different credential.
#
# Env:  PROJECT_REF   kkpkgjrweysgvhvkhzun (production) or nxossqhdfltcqdwvbewi (acceptance)
#       S3_ENDPOINT   https://<ref>.storage.supabase.co/storage/v1/s3   (must contain PROJECT_REF)
#       S3_REGION     the project's region (Supabase dashboard > Storage > S3 connection)
#       AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   the Storage S3 key
#       AGE_RECIPIENTS  space separated age PUBLIC keys
#       OUT_DIR       empty or new local folder
#       CONFIRM       exactly: preserve production media   (production only)
set -euo pipefail
export LC_ALL=C AWS_PAGER="" AWS_EC2_METADATA_DISABLED=true
die() { echo "preserve: $*" >&2; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

for v in BACKUP_DB_URL DATABASE_URL SUPABASE_SERVICE_ROLE_KEY R2_BACKUP_WRITE_SECRET R2_BACKUP_READ_SECRET AGE_RESTORE_TEST_IDENTITY AGE_IDENTITY; do
  [ -z "${!v:-}" ] || die "$v is set: this job must hold the Storage key and nothing else sensitive"
done
for v in PROJECT_REF S3_ENDPOINT S3_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AGE_RECIPIENTS OUT_DIR; do
  [ -n "${!v:-}" ] || die "$v is not set"
done
case "$PROJECT_REF" in
  kkpkgjrweysgvhvkhzun) LABEL=production;;
  nxossqhdfltcqdwvbewi) LABEL=acceptance;;
  *) die "PROJECT_REF is not a known Aladdin project";;
esac
[ "$S3_ENDPOINT" = "https://$PROJECT_REF.storage.supabase.co/storage/v1/s3" ] || [ -n "${LOCAL_TEST:-}" ] \
  || die "S3_ENDPOINT must be exactly https://$PROJECT_REF.storage.supabase.co/storage/v1/s3"
if [ "$LABEL" = production ]; then [ "${CONFIRM:-}" = "preserve production media" ] || die "type the confirmation: CONFIRM='preserve production media'"; fi
for r in $AGE_RECIPIENTS; do case "$r" in age1*) ;; *) die "AGE_RECIPIENTS holds something that is not an age public key";; esac; done
args=(); for r in $AGE_RECIPIENTS; do args+=(-r "$r"); done
[ ! -e "$OUT_DIR" ] || [ -z "$(ls -A "$OUT_DIR")" ] || die "OUT_DIR must be empty or new"
umask 077; mkdir -p "$OUT_DIR/objects"; WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
s3() { aws --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" s3api "$@"; }
KNOWN="avatars organization-images product-images professional-certificates professional-portfolio purchase-request-images business-verification-documents"
START="$(date -u +%FT%TZ)"

: > "$WORK/manifest.tsv"
BUCKETS="$(s3 list-buckets --query 'Buckets[].Name' --output text | tr '\t' '\n')"
[ -n "$BUCKETS" ] || die "no buckets listed: wrong key or endpoint"
for b in $BUCKETS; do case " $KNOWN " in *" $b "*) ;; *) die "unknown bucket '$b': review it before preserving (add it to KNOWN on purpose)";; esac; done
N=0; EMPTY=0; BYTES=0
for b in $BUCKETS; do
  s3 list-objects-v2 --bucket "$b" --query 'Contents[].[Key,Size,ETag]' --output text > "$WORK/list.tsv" || die "cannot list $b"
  while IFS=$'\t' read -r key size etag; do
    [ -n "$key" ] && [ "$key" != None ] || continue
    N=$((N+1)); name="$(printf '%s/%s' "$b" "$key" | sha256sum | cut -d' ' -f1)"
    s3 get-object --bucket "$b" --key "$key" "$WORK/f" >/dev/null || die "cannot read object #$N in $b"
    got="$(wc -c < "$WORK/f" | tr -d ' ')"; [ "$got" = "$size" ] || die "object #$N in $b: $got bytes read, $size listed"
    sum="$(sha256sum "$WORK/f" | cut -d' ' -f1)"
    if [ "$size" = 0 ]; then
      # read, not assumed: an object listed as empty must really read back as zero bytes
      EMPTY=$((EMPTY+1)); printf '%s\t%s\t0\t%s\tEMPTY\t\n' "$b" "$key" "$sum" >> "$WORK/manifest.tsv"; continue
    fi
    age "${args[@]}" -o "$OUT_DIR/objects/$name.age" "$WORK/f"; rm -f "$WORK/f"
    BYTES=$((BYTES+size))
    printf '%s\t%s\t%s\t%s\tFILE\t%s\n' "$b" "$key" "$size" "$sum" "$name" >> "$WORK/manifest.tsv"
  done < "$WORK/list.tsv"
  log "bucket $b done ($N objects so far)"
done
END="$(date -u +%FT%TZ)"
age "${args[@]}" -o "$OUT_DIR/manifest.tsv.age" "$WORK/manifest.tsv"
python3 - "$OUT_DIR/summary.json" "$LABEL" "$PROJECT_REF" "$START" "$END" "$N" "$EMPTY" "$BYTES" <<'PY'
import json,sys
p,label,ref,s,e,n,em,by=sys.argv[1:]
json.dump({"kind":"storage-source-preservation","label":label,"project_ref":ref,"started":s,"finished":e,
           "objects":int(n),"empty_objects":int(em),"copied_files":int(n)-int(em),"bytes":int(by)},open(p,"w"),indent=1)
PY
( cd "$OUT_DIR" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )
log "DONE: $N objects ($EMPTY empty), $BYTES bytes, encrypted in $OUT_DIR. Next: storage-preserve-verify.sh with the owner key."
