#!/usr/bin/env bash
# Offline test with a stub `aws` that models an R2 bucket in a folder (conditional put, get).
set -uo pipefail
H="$(cd "$(dirname "$0")" && pwd)"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; pass=0; failn=0
ok(){ if [ "$2" = 0 ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failn=$((failn+1)); fi; }
mkdir -p "$T/bin" "$T/bucket" "$T/src/objects"
printf 'enc1' > "$T/src/objects/aaa.age"; printf 'enc22' > "$T/src/objects/bbb.age"; printf 'mani' > "$T/src/manifest.tsv.age"; printf '{}' > "$T/src/summary.json"; printf 'plain secret' > "$T/src/notes.txt"
( cd "$T/src" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )
cat > "$T/bin/aws" <<STUB
#!/usr/bin/env bash
a=("\$@"); cmd=""; for x in "\${a[@]}"; do case "\$x" in put-object|get-object) cmd=\$x;; esac; done
get(){ for i in "\${!a[@]}"; do [ "\${a[\$i]}" = "\$1" ] && echo "\${a[\$((i+1))]}"; done; }
k="\$(get --key | tr '/' '_')"
case \$cmd in
 put-object) echo "\$(get --key)" >> "$T/puts.log"; [ -e "$T/bucket/\$k" ] && { echo PreconditionFailed >&2; exit 1; }
   [ -n "\${CORRUPT:-}" ] && printf bad > "$T/bucket/\$k" || cp "\$(get --body)" "$T/bucket/\$k";;
 get-object) cp "$T/bucket/\$k" "\${a[\$((\${#a[@]}-1))]}";;
esac
STUB
chmod +x "$T/bin/aws"; export PATH="$T/bin:$PATH"
base=(env -u AWS_SECRET_ACCESS_KEY -u AWS_ACCESS_KEY_ID R2_ENDPOINT=http://x LOCAL_TEST=1 BUCKET=aladdin-production-db-backups DEST_PREFIX=source-preservation/20261110/storage/ AWS_ACCESS_KEY_ID=a AWS_SECRET_ACCESS_KEY=b CONFIRM="upload production preservation")
"${base[@]}" CONFIRM=no bash "$H/upload-preserved.sh" "$T/src" >/dev/null 2>&1; ok "needs the typed confirmation" $([ $? = 1 ] && echo 0 || echo 1)
for v in S3_ENDPOINT BACKUP_DB_URL SUPABASE_SERVICE_ROLE_KEY AGE_IDENTITY_FILE PROJECT_REF; do
  "${base[@]}" "$v=x" bash "$H/upload-preserved.sh" "$T/src" >/dev/null 2>&1; ok "refuses to run beside $v" $([ $? = 1 ] && echo 0 || echo 1); done
"${base[@]}" BUCKET=other bash "$H/upload-preserved.sh" "$T/src" >/dev/null 2>&1; ok "refuses another bucket" $([ $? = 1 ] && echo 0 || echo 1)
"${base[@]}" DEST_PREFIX=db/production/ bash "$H/upload-preserved.sh" "$T/src" >/dev/null 2>&1; ok "refuses a prefix outside source-preservation/" $([ $? = 1 ] && echo 0 || echo 1)
env -u LOCAL_TEST "${base[@]}" LOCAL_TEST= R2_ENDPOINT=https://abc.storage.supabase.co/storage/v1/s3 bash "$H/upload-preserved.sh" "$T/src" >/dev/null 2>&1; ok "refuses a non-R2 endpoint" $([ $? = 1 ] && echo 0 || echo 1)
"${base[@]}" bash "$H/upload-preserved.sh" "$T/src" | tail -1 | grep -q 'RESULT: PASS'; ok "uploads and reads back" $?
[ "$(wc -l < "$T/puts.log")" = 5 ]; ok "uploaded exactly the 5 allowed files" $?
grep -q notes "$T/puts.log"; [ $? = 1 ]; ok "the plaintext file is never uploaded" $?
"${base[@]}" bash "$H/upload-preserved.sh" "$T/src" >/dev/null 2>&1; ok "a second run never overwrites" $([ $? = 1 ] && echo 0 || echo 1)
rm -rf "$T/bucket"/*; "${base[@]}" CORRUPT=1 bash "$H/upload-preserved.sh" "$T/src" >/dev/null 2>&1; ok "a corrupted stored copy fails the run" $([ $? = 1 ] && echo 0 || echo 1)
printf x >> "$T/src/objects/aaa.age"; rm -rf "$T/bucket"/*; "${base[@]}" bash "$H/upload-preserved.sh" "$T/src" >/dev/null 2>&1; ok "a folder that fails its SHA256SUMS is not uploaded" $([ $? = 1 ] && echo 0 || echo 1)
echo "upload-preserved-test: $pass passed, $failn failed"; [ "$failn" = 0 ]
