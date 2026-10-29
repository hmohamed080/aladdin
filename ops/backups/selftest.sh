#!/usr/bin/env bash
# Local end-to-end test of the backup kit. Needs a running local Supabase stack (`pnpm exec supabase start`)
# and an S3 stand-in on 127.0.0.1:8333 with keys testkey/testsecret (SeaweedFS, see docs/guides/video-local-e2e.md).
# Touches nothing hosted: every script runs with BACKUP_LABEL=local-test, which refuses non-local targets.
#   bash ops/backups/selftest.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
export LC_ALL=C AWS_ACCESS_KEY_ID=testkey AWS_SECRET_ACCESS_KEY=testsecret AWS_DEFAULT_REGION=auto AWS_PAGER=""
export R2_ENDPOINT=http://127.0.0.1:8333 BACKUP_LABEL=local-test BACKUP_BUCKET="selftest-$(date +%s)"
export BACKUP_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_CLI="${SUPABASE_CLI:-pnpm --dir $ROOT exec supabase}"
SUPABASE_SERVICE_ROLE_KEY="$($SUPABASE_CLI status -o json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["SERVICE_ROLE_KEY"])')"
export SUPABASE_SERVICE_ROLE_KEY
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
age-keygen -o "$T/owner.key" 2>/dev/null; age-keygen -o "$T/restore.key" 2>/dev/null; age-keygen -o "$T/other.key" 2>/dev/null
export AGE_RECIPIENTS="$(age-keygen -y "$T/owner.key") $(age-keygen -y "$T/restore.key")"
s3() { aws --endpoint-url "$R2_ENDPOINT" "$@"; }
s3 s3api create-bucket --bucket "$BACKUP_BUCKET" >/dev/null
pass=0; fail=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); echo "PASS  $2"; else fail=$((fail+1)); echo "FAIL  $2"; fi; }
not() { if [ "$1" != 0 ]; then echo 0; else echo 1; fi; }

bash "$HERE/db-backup.sh" > "$T/b1.log" 2>&1; ok $? "database backup is taken, encrypted, stored and read back identical"
KEY="$(s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix db/local-test/daily/ --query "Contents[?ends_with(Key,'.tar.age')].Key | [0]" --output text)"
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$KEY" "$T/b.age" >/dev/null
age -d -i "$T/owner.key" -o "$T/o.tar" "$T/b.age" 2>/dev/null; ok $? "the owner's offline key decrypts it"
age -d -i "$T/other.key" -o "$T/x.tar" "$T/b.age" 2>/dev/null; ok "$(not $?)" "an unrelated key cannot decrypt it"
tar -tf "$T/o.tar" | sed 's#^[^/]*/##' | grep -v '^$' | sort | tr '\n' ' ' > "$T/parts.txt"
[ "$(cat "$T/parts.txt")" = "SHA256SUMS columns.txt data.sql fingerprint.txt history.txt roles.sql rowcounts-live.txt rowcounts.txt schema.sql security-tail.out.sql " ]
ok $? "the archive holds exactly the expected parts"

echo x > "$T/x"; aws --endpoint-url "$R2_ENDPOINT" s3api put-object --bucket "$BACKUP_BUCKET" --key "$KEY" --body "$T/x" --if-none-match '*' >/dev/null 2>&1
ok "$(not $?)" "an existing backup object is never replaced (If-None-Match)"

bash "$HERE/media-backup.sh" > "$T/m1.log" 2>&1; ok $? "media files are copied: $(tail -1 "$T/m1.log" | sed 's/^\[[^]]*\] //')"
bash "$HERE/media-backup.sh" > "$T/m2.log" 2>&1; grep -q ' 0 new copied' "$T/m2.log"; ok $? "a second media run copies nothing again"

AGE_IDENTITY_FILE="$T/restore.key" OUT="$T/rt" bash "$HERE/restore-test.sh" > "$T/rt.log" 2>&1; ok $? "restore test into a throwaway stack: $(grep -E '^(Schema|Row counts|Media)' "$T/rt/REPORT.txt" 2>/dev/null | tr '\n' ' ')"
[ -z "${SELFTEST_REPORT:-}" ] || cp "$T/rt/REPORT.txt" "$SELFTEST_REPORT" 2>/dev/null || true

# Tampering: a corrupted copy under a new name with the original manifest must be refused before any restore.
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$KEY" "$T/orig" >/dev/null; s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "${KEY%.tar.age}.json" "$T/orig.json" >/dev/null
python3 -c "import sys; b=bytearray(open(sys.argv[1],'rb').read()); b[len(b)//2]^=1; open(sys.argv[1]+'.bad','wb').write(b)" "$T/orig"
s3 s3api put-object --bucket "$BACKUP_BUCKET" --key "${KEY%.tar.age}-bad.tar.age" --body "$T/orig.bad" >/dev/null
s3 s3api put-object --bucket "$BACKUP_BUCKET" --key "${KEY%.tar.age}-bad.json" --body "$T/orig.json" >/dev/null
BACKUP_KEY="${KEY%.tar.age}-bad.tar.age" AGE_IDENTITY_FILE="$T/restore.key" OUT="$T/rt2" bash "$HERE/restore-test.sh" > "$T/rt2.log" 2>&1
ok "$(not $?)" "a corrupted backup is refused by the restore test"
BACKUP_KEY="$KEY" AGE_IDENTITY_FILE="$T/other.key" OUT="$T/rt3" bash "$HERE/restore-test.sh" > "$T/rt3.log" 2>&1
ok "$(not $?)" "the restore test fails with a wrong key"

BACKUP_LABEL=production bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "a production label refuses a local endpoint"
R2_ENDPOINT=https://example.r2.cloudflarestorage.com bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "local-test refuses a hosted endpoint"
BACKUP_DB_URL=postgresql://postgres:x@db.example.supabase.co:5432/postgres bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "local-test refuses a hosted database"
AGE_RECIPIENTS="not-a-key" bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "a malformed age recipient is refused"

CHECK_MEDIA=1 bash "$HERE/freshness.sh" > /dev/null 2>&1; ok $? "freshness check passes on fresh backups"
MAX_AGE_HOURS=0 bash "$HERE/freshness.sh" > /dev/null 2>&1; ok "$(not $?)" "freshness check fails on stale backups"
s3 s3api create-bucket --bucket "empty-$BACKUP_BUCKET" >/dev/null
BACKUP_BUCKET="empty-$BACKUP_BUCKET" bash "$HERE/freshness.sh" > /dev/null 2>&1; ok "$(not $?)" "freshness check fails when no backup exists"

echo "selftest: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
