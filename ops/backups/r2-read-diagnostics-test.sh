#!/usr/bin/env bash
# r2-media-backup.sh must say WHY an original could not be read (missing object, refused token, network), retry
# only transient errors, never print bucket or object names, and still mark the snapshot incomplete. Runs on the
# local S3 stand-in (127.0.0.1:8333, keys testkey/testsecret) with a stub `psql`; touches nothing hosted.
#   bash ops/backups/r2-read-diagnostics-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export LC_ALL=C AWS_ACCESS_KEY_ID=testkey AWS_SECRET_ACCESS_KEY=testsecret AWS_DEFAULT_REGION=auto AWS_PAGER=""
export R2_MEDIA_BACKUP=1
export R2_ENDPOINT="${R2_ENDPOINT:-http://127.0.0.1:8333}" BACKUP_LABEL=local-test
T="$(mktemp -d)"; SRC="diag-src-$(date +%s)"; DST="diag-dst-$(date +%s)"; export BACKUP_BUCKET="$DST"
s3() { aws --endpoint-url "$R2_ENDPOINT" "$@"; }
trap 's3 s3 rb "s3://$SRC" --force >/dev/null 2>&1; s3 s3 rb "s3://$DST" --force >/dev/null 2>&1; rm -rf "$T"' EXIT
pass=0; fail=0
ck() { local d="$1"; shift; if "$@"; then pass=$((pass+1)); echo "PASS  $d"; else fail=$((fail+1)); echo "FAIL  $d"; fi; }
ckn() { local d="$1"; shift; if "$@"; then fail=$((fail+1)); echo "FAIL  $d"; else pass=$((pass+1)); echo "PASS  $d"; fi; }
ok() { if [ "$1" -eq 0 ]; then pass=$((pass+1)); echo "PASS  $2"; else fail=$((fail+1)); echo "FAIL  $2"; fi; }

# 1. The error classifier, on the texts the AWS CLI prints.
cls() { printf '%s\n' "$1" > "$T/e"; ( . "$HERE/lib.sh"; classify_s3_error "$T/e" ); }
ck "NoSuchKey is not_found" [ "$(cls 'An error occurred (NoSuchKey) when calling the GetObject operation: The specified key does not exist.')" = not_found ]
ck "404 is not_found" [ "$(cls 'An error occurred (404) when calling the HeadObject operation: Not Found')" = not_found ]
ck "AccessDenied is access_denied" [ "$(cls 'An error occurred (AccessDenied) when calling the GetObject operation: Access Denied')" = access_denied ]
ck "403 is access_denied" [ "$(cls 'An error occurred (403) when calling the GetObject operation: Forbidden')" = access_denied ]
ck "a connection error is transient" [ "$(cls 'Could not connect to the endpoint URL')" = transient ]
ck "ServiceUnavailable is transient" [ "$(cls 'An error occurred (ServiceUnavailable) when calling the GetObject operation')" = transient ]
ck "anything else is other" [ "$(cls 'something unexpected')" = other ]

# 2. End to end: one readable original, one that does not exist in the media bucket.
age-keygen -o "$T/k" 2>/dev/null; AGE_RECIPIENTS="$(age-keygen -y "$T/k")"; export AGE_RECIPIENTS
s3 s3api create-bucket --bucket "$SRC" >/dev/null; s3 s3api create-bucket --bucket "$DST" >/dev/null
head -c 321 /dev/urandom > "$T/good"; GS="$(sha256sum "$T/good" | cut -d' ' -f1)"; GONE="$(printf 'gone' | sha256sum | cut -d' ' -f1)"
s3 s3api put-object --bucket "$SRC" --key "avatar/userSECRET1.jpg" --body "$T/good" >/dev/null
mkdir -p "$T/state" "$T/bin"
printf '%s\t321\tavatar/userSECRET1.jpg\n%s\t57\tavatar/userSECRET2.jpg\n' "$GS" "$GONE" > "$T/state/r2-objects.tsv"
printf 'SKIPPED=0\nNAME=aladdin-local-test-20261101T090000Z\nPREFIXES="db/local-test/daily/2026/11/01"\nR2_ROWS=2\n' > "$T/state/db.env"
printf '#!/usr/bin/env bash\ncat >/dev/null; sed "s/$/\\trequired/" "%s/state/r2-objects.tsv"\n' "$T" > "$T/bin/psql"; chmod +x "$T/bin/psql"
out="$(PATH="$T/bin:$PATH" BACKUP_STATE_DIR="$T/state" BACKUP_DB_URL=postgresql://stub@127.0.0.1:1/postgres \
  R2_SOURCE_ENDPOINT="$R2_ENDPOINT" R2_SOURCE_BUCKET="$SRC" R2_SOURCE_ACCESS_KEY_ID=testkey R2_SOURCE_SECRET_ACCESS_KEY=testsecret \
  R2_READ_RETRY_SLEEP=0 bash "$HERE/r2-media-backup.sh" 2>&1)"; rc=$?; printf '%s\n' "$out" > "$T/out.txt"
ck "the run fails when an original cannot be read" [ "$rc" -ne 0 ]
ck "the log names the failure class and the hash prefix" grep -q "could not read an R2 original (sha256 ${GONE:0:12}): not_found" "$T/out.txt"
ck "the log counts failures by class" grep -q "read failures: 1 not_found" "$T/out.txt"
ckn "no object name or bucket name reaches the log" grep -qiE "userSECRET|$SRC|avatar/" "$T/out.txt"
ckn "a missing object is not misreported as a permission or network error" grep -q "access_denied\|transient" "$T/out.txt"
KEY="db/local-test/daily/2026/11/01/aladdin-local-test-20261101T090000Z.r2media.json"
s3 s3api get-object --bucket "$DST" --key "$KEY" "$T/rec" >/dev/null 2>&1
ck "the snapshot is recorded incomplete (never marked complete)" grep -q '"complete":false' "$T/rec"
ck "the record counts the failed read" grep -q '"copy_failures":1' "$T/rec"
n="$(s3 s3api list-objects-v2 --bucket "$DST" --prefix media/local-test/r2/ --query 'length(Contents || `[]`)' --output text)"
ck "the readable original was still copied (1 copy)" [ "$n" = 1 ]
echo "r2-read-diagnostics-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
