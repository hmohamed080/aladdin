#!/usr/bin/env bash
# Local end-to-end test of the backup kit. Needs a running local Supabase stack (`pnpm exec supabase start`)
# and an S3 stand-in on 127.0.0.1:8333 with keys testkey/testsecret (SeaweedFS, see docs/guides/video-local-e2e.md).
# Touches nothing hosted: every script runs with BACKUP_LABEL=local-test, which refuses non-local targets.
#   bash ops/backups/selftest.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
export LC_ALL=C AWS_ACCESS_KEY_ID=testkey AWS_SECRET_ACCESS_KEY=testsecret AWS_DEFAULT_REGION=auto AWS_PAGER=""
BACKUP_BUCKET="selftest-$(date +%s)"
export R2_ENDPOINT=http://127.0.0.1:8333 BACKUP_LABEL=local-test BACKUP_BUCKET
export BACKUP_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_CLI="${SUPABASE_CLI:-pnpm --dir $ROOT exec supabase}"
SUPABASE_SERVICE_ROLE_KEY="$($SUPABASE_CLI status -o json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["SERVICE_ROLE_KEY"])')"
export SUPABASE_SERVICE_ROLE_KEY
T="$(mktemp -d)"
# Two throwaway media files in local Storage, removed again on exit, so the media copy and restore have real bytes.
uid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
FIXTURES=("avatars/$(uid).png" "professional-portfolio/$(uid).png")
LATE="avatars/$(uid).png"   # uploaded later, for the incomplete-run case
storage() { curl -fsS -X "$1" "$SUPABASE_URL/storage/v1/object/$2" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" "${@:3}" >/dev/null; }
cleanup() {
  for f in "${FIXTURES[@]}" "$LATE"; do storage DELETE "${f%%/*}" -H 'content-type: application/json' -d "{\"prefixes\":[\"${f#*/}\"]}" || true; done
  rm -rf "$T"
}
trap cleanup EXIT
png() {
  python3 -c 'import os,sys,zlib,struct
def chunk(t,d): return struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d))
raw=b"".join(b"\0"+os.urandom(48) for _ in range(16))
open(sys.argv[1],"wb").write(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",16,16,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b""))' "$T/fixture.png"
  storage POST "$1" -H 'content-type: image/png' --data-binary "@$T/fixture.png" || { echo "could not seed local Storage"; exit 1; }
}
for f in "${FIXTURES[@]}"; do png "$f"; done
age-keygen -o "$T/owner.key" 2>/dev/null; age-keygen -o "$T/restore.key" 2>/dev/null; age-keygen -o "$T/other.key" 2>/dev/null
AGE_RECIPIENTS="$(age-keygen -y "$T/owner.key") $(age-keygen -y "$T/restore.key")"; export AGE_RECIPIENTS
s3() { aws --endpoint-url "$R2_ENDPOINT" "$@"; }
s3 s3api create-bucket --bucket "$BACKUP_BUCKET" >/dev/null
export BACKUP_STATE_DIR="$T/state"
pass=0; fail=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); echo "PASS  $2"; else fail=$((fail+1)); echo "FAIL  $2"; fi; }
not() { if [ "$1" != 0 ]; then echo 0; else echo 1; fi; }

bash "$HERE/plan-test.sh" > "$T/plan.log" 2>&1; ok $? "schedule, Production gate and target checks: $(tail -1 "$T/plan.log")"

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

bash "$HERE/media-backup.sh" > "$T/m1.log" 2>&1; ok $? "the snapshot's media files are copied: $(tail -1 "$T/m1.log" | sed 's/^\[[^]]*\] //')"
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "${KEY%.tar.age}.media.json" "$T/m1.json" >/dev/null 2>&1
grep -q '"complete":true' "$T/m1.json" && grep -q '"objects":2,' "$T/m1.json"; ok $? "the snapshot's media inventory is complete (2 of 2 files) and sits next to the database backup"
N1="$(s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix db/local-test/daily/ --query "length(Contents[?ends_with(Key,'.tar.age')])" --output text)"
SKIP_IF_TAKEN=1 bash "$HERE/db-backup.sh" > "$T/skip.log" 2>&1 && bash "$HERE/media-backup.sh" >> "$T/skip.log" 2>&1
N2="$(s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix db/local-test/daily/ --query "length(Contents[?ends_with(Key,'.tar.age')])" --output text)"
[ "$N1" = "$N2" ] && grep -q "already exists" "$T/skip.log"; ok $? "a second scheduled firing on the same Cairo day does nothing"

# A file deleted after snapshot 1 must still restore from snapshot 1.
storage DELETE "${FIXTURES[0]%%/*}" -H 'content-type: application/json' -d "{\"prefixes\":[\"${FIXTURES[0]#*/}\"]}"
sleep 1; bash "$HERE/db-backup.sh" > "$T/b2.log" 2>&1 && bash "$HERE/media-backup.sh" > "$T/m2.log" 2>&1
grep -q ' 0 new copied' "$T/m2.log" && grep -q 'snapshot 1 files' "$T/m2.log"; ok $? "the next day copies nothing again, and its snapshot no longer lists the deleted file"

AGE_IDENTITY_FILE="$T/restore.key" OUT="$T/rt" bash "$HERE/restore-test.sh" > "$T/rt.log" 2>&1; ok $? "restore test of the newest snapshot: $(grep -E '^(Schema|Row counts|Media)' "$T/rt/REPORT.txt" 2>/dev/null | tr '\n' ' ')"
BACKUP_KEY="$KEY" MEDIA_SAMPLE=100 AGE_IDENTITY_FILE="$T/restore.key" OUT="$T/rt1" bash "$HERE/restore-test.sh" > "$T/rt1.log" 2>&1
ok $? "restore test of the OLDER snapshot brings back the file deleted since: $(grep -E '^Media' "$T/rt1/REPORT.txt" 2>/dev/null)"
[ -z "${SELFTEST_REPORT:-}" ] || cat "$T/rt/REPORT.txt" "$T/rt1/REPORT.txt" > "$SELFTEST_REPORT" 2>/dev/null || true

# Tampering: a corrupted copy under a new name with the original manifest must be refused before any restore.
# (Kept outside daily/, so the freshness checks below still see the real newest backup.)
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$KEY" "$T/orig" >/dev/null; s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "${KEY%.tar.age}.json" "$T/orig.json" >/dev/null
python3 -c "import sys; b=bytearray(open(sys.argv[1],'rb').read()); b[len(b)//2]^=1; open(sys.argv[1]+'.bad','wb').write(b)" "$T/orig"
BAD="db/local-test/tamper/$(basename "${KEY%.tar.age}")-bad"
s3 s3api put-object --bucket "$BACKUP_BUCKET" --key "$BAD.tar.age" --body "$T/orig.bad" >/dev/null
s3 s3api put-object --bucket "$BACKUP_BUCKET" --key "$BAD.json" --body "$T/orig.json" >/dev/null
BACKUP_KEY="$BAD.tar.age" AGE_IDENTITY_FILE="$T/restore.key" OUT="$T/rt2" bash "$HERE/restore-test.sh" > "$T/rt2.log" 2>&1
ok "$(not $?)" "a corrupted backup is refused by the restore test"
BACKUP_KEY="$KEY" AGE_IDENTITY_FILE="$T/other.key" OUT="$T/rt3" bash "$HERE/restore-test.sh" > "$T/rt3.log" 2>&1
ok "$(not $?)" "the restore test fails with a wrong key"

BACKUP_LABEL=production bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "a production label refuses a local endpoint"
R2_ENDPOINT=https://example.r2.cloudflarestorage.com bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "local-test refuses a hosted endpoint"
BACKUP_DB_URL=postgresql://postgres:x@db.example.supabase.co:5432/postgres bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "local-test refuses a hosted database"
AGE_RECIPIENTS="not-a-key" bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "a malformed age recipient is refused"

CHECK_MEDIA=1 bash "$HERE/freshness.sh" > /dev/null 2>&1; ok $? "freshness check passes on fresh, complete backups"
MAX_AGE_HOURS=0 bash "$HERE/freshness.sh" > /dev/null 2>&1; ok "$(not $?)" "freshness check fails on stale backups"
s3 s3api create-bucket --bucket "empty-$BACKUP_BUCKET" >/dev/null
BACKUP_BUCKET="empty-$BACKUP_BUCKET" bash "$HERE/freshness.sh" > /dev/null 2>&1; ok "$(not $?)" "freshness check fails when no backup exists"

# An incomplete media run (a file cannot be read) is marked so and raises the alarm.
png "$LATE"; sleep 1
bash "$HERE/db-backup.sh" > "$T/b3.log" 2>&1 && SUPABASE_SERVICE_ROLE_KEY=not-the-key bash "$HERE/media-backup.sh" > "$T/m3.log" 2>&1
ok "$(not $?)" "a media run that cannot copy a file fails"
CHECK_MEDIA=1 bash "$HERE/freshness.sh" > "$T/f3.log" 2>&1; ok "$(not $?)" "freshness check fails on an incomplete media run: $(grep -m1 incomplete "$T/f3.log" | sed 's/^ *//')"

echo "selftest: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
