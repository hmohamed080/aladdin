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
EXTRA=("avatars/$(uid).png" "avatars/$(uid).png")   # two files no copy exists of yet, for the interrupted-run cases
storage() { curl -fsS -X "$1" "$SUPABASE_URL/storage/v1/object/$2" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" "${@:3}" >/dev/null; }
cleanup() {
  for f in "${FIXTURES[@]}" "$LATE" "${EXTRA[@]}"; do storage DELETE "${f%%/*}" -H 'content-type: application/json' -d "{\"prefixes\":[\"${f#*/}\"]}" || true; done
  for b in "$BACKUP_BUCKET" "empty-$BACKUP_BUCKET"; do aws --endpoint-url "$R2_ENDPOINT" s3 rb "s3://$b" --force >/dev/null 2>&1 || true; done
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
export BACKUP_STATE_DIR="$T/state" TMPDIR="$T/tmp"; mkdir -p "$TMPDIR"
# A shim in front of aws that kills the calling backup script, as a cancelled or crashed runner would: the Nth
# put-object whose key matches SHIM_KILL_MATCH (counted in SHIM_COUNT_FILE) never happens and the script is gone.
REAL_AWS="$(command -v aws)"; export REAL_AWS; mkdir -p "$T/shim"
cat > "$T/shim/aws" <<'SHIM'
#!/usr/bin/env bash
if [ -n "${SHIM_KILL_MATCH:-}" ]; then
  prev=""; key=""; for a in "$@"; do [ "$prev" = --key ] && key="$a"; prev="$a"; done
  case " $* " in *" put-object "*)
    if [[ "$key" =~ $SHIM_KILL_MATCH ]]; then
      n=$(( $(cat "$SHIM_COUNT_FILE" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$SHIM_COUNT_FILE"
      if [ "$n" -ge "${SHIM_KILL_AFTER:-1}" ]; then kill -9 "$PPID"; sleep 1; exit 137; fi
    fi;;
  esac
fi
exec "$REAL_AWS" "$@"
SHIM
chmod +x "$T/shim/aws"
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
[ "$N1" = "$N2" ] && grep -q "is complete" "$T/skip.log"; ok $? "a second scheduled firing on the same Cairo day does nothing"

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


# ---- media-verify: the inventory against the database, field by field (no restore stack needed) ----
newest_daily() { s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "${1:-db/local-test/daily/}" --query "sort_by(Contents[?ends_with(Key,'.tar.age')], &LastModified)[-1].Key" --output text; }
KEY2="$(newest_daily)"
verify() { # <snapshot key> <name> -> exit status; all MEDIA_SAMPLE files are checked
  MEDIA_DB_CONTAINER=supabase_db_aladdin KEY="$1" AGE_IDENTITY_FILE="${3:-$T/restore.key}" OUT="$T/mv-$2" MEDIA_SAMPLE=100 bash "$HERE/media-verify.sh" > "$T/mv-$2.log" 2>&1
}
verify "$KEY2" ok; ok $? "media-verify: the newest snapshot's inventory equals the database: $(cat "$T/mv-ok/media-summary.txt" 2>/dev/null)"
verify "$KEY" older; ok "$(not $?)" "media-verify: the older snapshot no longer equals the database (a file was deleted since): $(head -1 "$T/mv-older/media-fails.txt" 2>/dev/null | cut -c1-90)"
verify "$KEY2" wrongkey "$T/other.key"; ok "$(not $?)" "media-verify: an unrelated key cannot read the inventory"
# tamper <name> <python editing the inventory rows L>: a copy of KEY2's inventory with one change, signed with a matching record
tamper() {
  local v="$1" vkey="db/local-test/tamper/aladdin-local-test-$1"
  s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "${KEY2%.tar.age}.media.tsv.age" "$T/t.age" >/dev/null
  age -d -i "$T/restore.key" -o "$T/t.tsv" "$T/t.age"
  python3 - "$T/t.tsv" "$2" "aladdin-local-test-$v" "$T/t.json" <<'PY'
import hashlib, json, sys
path, edit, name, record = sys.argv[1:5]
L = [l.rstrip("\n").split("\t") for l in open(path) if l.strip()]
exec(edit)
data = "".join("\t".join(r) + "\n" for r in L)
open(path, "w").write(data)
missing = sum(1 for r in L if r[5] != "ok")
json.dump({"snapshot": name, "label": "local-test", "objects": len(L), "backed_up": len(L) - missing, "missing": missing,
           "copy_failures": 0, "complete": missing == 0, "r2_media_records_not_covered": 0,
           "inventory_sha256": hashlib.sha256(data.encode()).hexdigest()}, open(record, "w"))
PY
  age -r "$(age-keygen -y "$T/owner.key")" -r "$(age-keygen -y "$T/restore.key")" -o "$T/t2.age" "$T/t.tsv"
  s3 s3api put-object --bucket "$BACKUP_BUCKET" --key "$vkey.media.tsv.age" --body "$T/t2.age" >/dev/null
  s3 s3api put-object --bucket "$BACKUP_BUCKET" --key "$vkey.media.json" --body "$T/t.json" >/dev/null
  echo "$vkey.tar.age"
}
tamper_fails() { # <name> <python> <what must be reported>
  local k; k="$(tamper "$1" "$2")"; verify "$k" "$1"; local rc=$?
  [ "$rc" -ne 0 ] && grep -qi -- "$3" "$T/mv-$1/media-fails.txt"; ok $? "media-verify refuses an inventory with $4"
}
tamper_fails size 'L[0][3] = str(int(L[0][3]) + 1)' "size" "a different size"
tamper_fails path 'L[0][2] = L[0][2] + "x"' "path" "a different complete path"
tamper_fails bucket 'L[0][1] = "avatars" if L[0][1] != "avatars" else "professional-portfolio"' "bucket" "a different bucket"
tamper_fails id 'L[0][0] = "99999999-9999-9999-9999-999999999999"' "not in" "a different object id"
tamper_fails key 'L[0][4] = L[0][4].replace("supabase/objects", "supabase/other")' "copy key" "a different copy key"
tamper_fails extra 'L.append(["33333333-3333-3333-3333-333333333333", "avatars", "u/x.png", "10", "media/local-test/supabase/objects/avatars/33333333-3333-3333-3333-333333333333-noetag.age", "ok"])' "not in the restored database" "an entry the database does not have"
tamper_fails dropped 'L.pop()' "not in the inventory" "a database file left out"
tamper_fails marked 'L[0][5] = "MISSING"' "incomplete" "a file marked MISSING"
# The copy itself: gone, and corrupted at rest. (The bucket stand-in has no lock; the copy is put back afterwards.)
CK="$(age -d -i "$T/restore.key" "$T/t2.age" 2>/dev/null | head -1 | cut -f5)"
[ -n "$CK" ] || CK="$(age -d -i "$T/restore.key" "$T/t.age" | head -1 | cut -f5)"
s3 s3api copy-object --bucket "$BACKUP_BUCKET" --copy-source "$BACKUP_BUCKET/$CK" --key "$CK.bak" >/dev/null
s3 s3api delete-object --bucket "$BACKUP_BUCKET" --key "$CK" >/dev/null
verify "$KEY2" nocopy; rc=$?; [ "$rc" -ne 0 ] && grep -q "no stored copy" "$T/mv-nocopy/media-fails.txt"; ok $? "media-verify refuses a snapshot whose stored copy has vanished"
SHA_REC="$(s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$CK.bak" --query 'Metadata.sha256' --output text)"; SZ_REC="$(s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$CK.bak" --query 'Metadata.size' --output text)"
head -c "$SZ_REC" /dev/urandom > "$T/junk"; age -r "$(age-keygen -y "$T/owner.key")" -o "$T/junk.age" "$T/junk"
s3 s3api put-object --bucket "$BACKUP_BUCKET" --key "$CK" --body "$T/junk.age" --metadata "sha256=$SHA_REC,size=$SZ_REC" >/dev/null
verify "$KEY2" corrupt; rc=$?; [ "$rc" -ne 0 ] && grep -q "did not restore exactly" "$T/mv-corrupt/media-fails.txt"; ok $? "media-verify catches a copy corrupted at rest (right size on paper, wrong sha256 inside)"
s3 s3api delete-object --bucket "$BACKUP_BUCKET" --key "$CK" >/dev/null
s3 s3api copy-object --bucket "$BACKUP_BUCKET" --copy-source "$BACKUP_BUCKET/$CK.bak" --key "$CK" >/dev/null; s3 s3api delete-object --bucket "$BACKUP_BUCKET" --key "$CK.bak" >/dev/null
verify "$KEY2" ok2; ok $? "media-verify passes again once the copy is back"

BACKUP_LABEL=production bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "a production label refuses a local endpoint"
R2_ENDPOINT=https://example.r2.cloudflarestorage.com bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "local-test refuses a hosted endpoint"
BACKUP_DB_URL=postgresql://postgres:x@db.example.supabase.co:5432/postgres bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "local-test refuses a hosted database"
AGE_RECIPIENTS="not-a-key" bash "$HERE/db-backup.sh" > /dev/null 2>&1; ok "$(not $?)" "a malformed age recipient is refused"


# ---- Interrupted and failed runs are retried, never silently skipped ----
# A scheduled job is the db step then the media step, with SKIP_IF_TAKEN on. BACKUP_NOW pins the Cairo day.
snaps() { s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$1" --query "length(Contents[?ends_with(Key,'.tar.age')] || \`[]\`)" --output text; }
copies() { s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix media/local-test/supabase/objects/ --query 'length(Contents || `[]`)' --output text; }
exists() { s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$1" >/dev/null 2>&1; }
etag() { s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$1" --query ETag --output text; }
scheduled() { # <now> [VAR=value ...] -> exit status of the media step (the db step must succeed)
  local now="$1"; shift; rm -rf "$T/state-s"
  env BACKUP_NOW="$now" SKIP_IF_TAKEN=1 BACKUP_STATE_DIR="$T/state-s" bash "$HERE/db-backup.sh" > "$T/s-db.log" 2>&1 || return 99
  env BACKUP_STATE_DIR="$T/state-s" "$@" bash "$HERE/media-backup.sh" > "$T/s-media.log" 2>&1
}

# A. The job is cancelled after the database step: no media step at all.
NOWA=2027-02-03T12:00:00Z; DA=db/local-test/daily/2027/02/03/
rm -rf "$T/state-a"; env BACKUP_NOW=$NOWA SKIP_IF_TAKEN=1 BACKUP_STATE_DIR="$T/state-a" bash "$HERE/db-backup.sh" > "$T/a1.log" 2>&1
A1="$(newest_daily "$DA")"; E1="$(etag "$A1")"
exists "${A1%.tar.age}.media.json"; ok "$(not $?)" "interrupted before the media step: the snapshot has no media record"
scheduled $NOWA; ok $? "the next scheduled firing completes the night: $(tail -1 "$T/s-media.log" | sed 's/^\[[^]]*\] //')"
grep -q "have no complete media backup" "$T/s-db.log"; ok $? "it says so loudly instead of skipping silently: $(grep -m1 'no complete media' "$T/s-db.log" | cut -c1-110)"
[ "$(snaps $DA)" = 2 ] && [ "$(etag "$A1")" = "$E1" ] && ! exists "${A1%.tar.age}.media.json"; ok $? "the unfinished snapshot is left exactly as it was (immutable) and superseded by a new one"
A2="$(newest_daily "$DA")"; exists "${A2%.tar.age}.media.json" && exists "${A2%.tar.age}.media.tsv.age"; ok $? "the new snapshot has its media record and inventory"
scheduled $NOWA; ok $? "a further firing finds a complete snapshot"; grep -q "is complete" "$T/s-db.log" && [ "$(snaps $DA)" = 2 ]; ok $? "...and does nothing (still two snapshots that day)"

# B. The runner dies in the middle of the media step, after one of two new files was copied.
for f in "${EXTRA[@]}"; do png "$f"; done
NOWB=2027-02-04T12:00:00Z; DB_=db/local-test/daily/2027/02/04/; C0="$(copies)"
scheduled $NOWB PATH="$T/shim:$PATH" SHIM_KILL_MATCH='/objects/' SHIM_KILL_AFTER=2 SHIM_COUNT_FILE="$T/count-b"; rc=$?
[ "$rc" -ne 0 ] && [ "$rc" -ne 99 ] && [ "$(( $(copies) - C0 ))" = 1 ]; ok $? "killed mid-way: exactly one of the two new files was copied, the job is gone (exit $rc)"
B1="$(newest_daily "$DB_")"; exists "${B1%.tar.age}.media.json"; ok "$(not $?)" "...and its snapshot has no media record"
scheduled $NOWB; ok $? "the retry finishes: $(tail -1 "$T/s-media.log" | sed 's/^\[[^]]*\] //')"
[ "$(( $(copies) - C0 ))" = 2 ] && grep -q " 1 new copied" "$T/s-media.log"; ok $? "the retry copied only the one file still missing (the copy made before the crash was reused, nothing doubled)"
B2="$(newest_daily "$DB_")"; [ "$B1" != "$B2" ] && exists "${B2%.tar.age}.media.json" && ! exists "${B1%.tar.age}.media.json"; ok $? "the retry's snapshot is complete; the interrupted one stays unrecorded"

# C. The runner dies between the daily and the weekly record of a Sunday's snapshot.
NOWC=2027-02-07T12:00:00Z; DC=db/local-test/daily/2027/02/07/; WC=db/local-test/weekly/2027/
scheduled $NOWC PATH="$T/shim:$PATH" SHIM_KILL_MATCH='\.media\.json$' SHIM_KILL_AFTER=2 SHIM_COUNT_FILE="$T/count-c"; rc=$?
C1="$(newest_daily "$DC")"; C1N="$(basename "$C1")"; EC1="$(etag "$C1")"
[ "$rc" -ne 0 ] && [ "$rc" -ne 99 ] && exists "${C1%.tar.age}.media.json" && ! exists "$WC${C1N%.tar.age}.media.json"; ok $? "killed between prefixes: the daily record exists, the weekly one does not"
scheduled $NOWC; ok $? "the next firing does not accept a snapshot that is complete in only one prefix"
C2="$(newest_daily "$DC")"; C2N="$(basename "$C2")"
[ "$C1" != "$C2" ] && exists "${C2%.tar.age}.media.json" && exists "$WC${C2N%.tar.age}.media.json" && exists "$WC${C2N}" && [ "$(etag "$C1")" = "$EC1" ]; ok $? "the new snapshot is complete in both prefixes; the old one is untouched"
scheduled $NOWC; ok $? "and then the night is done"; grep -q "is complete" "$T/s-db.log" && [ "$(snaps $DC)" = 2 ]; ok $? "...no third snapshot"

CHECK_MEDIA=1 bash "$HERE/freshness.sh" > /dev/null 2>&1; ok $? "freshness check passes on fresh, complete backups"
MAX_AGE_HOURS=0 bash "$HERE/freshness.sh" > /dev/null 2>&1; ok "$(not $?)" "freshness check fails on stale backups"
s3 s3api create-bucket --bucket "empty-$BACKUP_BUCKET" >/dev/null
BACKUP_BUCKET="empty-$BACKUP_BUCKET" bash "$HERE/freshness.sh" > /dev/null 2>&1; ok "$(not $?)" "freshness check fails when no backup exists"

# An incomplete media run (a file cannot be read) is marked so and raises the alarm.
png "$LATE"; sleep 1
bash "$HERE/db-backup.sh" > "$T/b3.log" 2>&1 && SUPABASE_SERVICE_ROLE_KEY=not-the-key bash "$HERE/media-backup.sh" > "$T/m3.log" 2>&1
ok "$(not $?)" "a media run that cannot copy a file fails"
CHECK_MEDIA=1 bash "$HERE/freshness.sh" > "$T/f3.log" 2>&1; ok "$(not $?)" "freshness check fails on an incomplete media run: $(grep -m1 incomplete "$T/f3.log" | sed 's/^ *//')"

# The restore test restores the newest snapshot WITH a complete media record and says it skipped the newer unfinished one.
AGE_IDENTITY_FILE="$T/restore.key" OUT="$T/rt4" bash "$HERE/restore-test.sh" > "$T/rt4.log" 2>&1; rc=$?
LAST="$(newest_daily)"; grep -q "of $LAST\$" "$T/rt4/REPORT.txt"; same=$?
[ "$rc" = 0 ] && [ "$same" != 0 ] && grep -q "Newer snapshots skipped because their media backup is not complete: 1" "$T/rt4/REPORT.txt"
ok $? "the restore test skips the newest snapshot because its media backup is incomplete, and restores the newest complete one: $(grep -E '^(Restore test|Newer)' "$T/rt4/REPORT.txt" 2>/dev/null | sed 's/^Restore test [^ ]* of //' | tr '\n' ' ')"

echo "selftest: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
