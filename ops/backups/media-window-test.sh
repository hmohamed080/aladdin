#!/usr/bin/env bash
# Tests media-verify.sh against the guaranteed full-restore window with a tiny R2-media snapshot on the local S3
# stand-in (127.0.0.1:8333, keys testkey/testsecret) and a stub `psql` standing in for the restored database.
# Inside the window a missing copy fails; outside it the snapshot is a database-only restore: the inventory must
# still equal the database exactly and every copy that remains must be intact. Touches nothing hosted.
#   bash ops/backups/media-window-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export LC_ALL=C AWS_ACCESS_KEY_ID=testkey AWS_SECRET_ACCESS_KEY=testsecret AWS_DEFAULT_REGION=auto AWS_PAGER=""
export R2_ENDPOINT="${R2_ENDPOINT:-http://127.0.0.1:8333}" BACKUP_LABEL=local-test MEDIA_KIND=r2 R2_MEDIA_BACKUP=1
T="$(mktemp -d)"; B="window-$(date +%s)"; export BACKUP_BUCKET="$B"
s3() { aws --endpoint-url "$R2_ENDPOINT" "$@"; }
trap 's3 s3 rb "s3://$B" --force >/dev/null 2>&1; rm -rf "$T"' EXIT
pass=0; fail=0
ok() { if [ "$1" -eq 0 ]; then pass=$((pass+1)); echo "PASS  $2"; else fail=$((fail+1)); echo "FAIL  $2"; fi; }
age-keygen -o "$T/id.key" 2>/dev/null; R="$(age-keygen -y "$T/id.key")"; export AGE_RECIPIENTS="$R"
s3 s3api create-bucket --bucket "$B" >/dev/null
NAME=aladdin-local-test-20260801T013000Z; DAY=db/local-test/daily/2026/08/01
: > "$T/inv.tsv"; : > "$T/db.tsv"; CK=()
for i in 1 2 3; do
  head -c $((100 + i)) /dev/urandom > "$T/f$i"; sha="$(sha256sum "$T/f$i" | cut -d' ' -f1)"; size=$((100 + i))
  ck="media/local-test/r2/202608/objects/$sha.age"; CK+=("$ck")
  age -r "$R" -o "$T/f$i.age" "$T/f$i"
  s3 s3api put-object --bucket "$B" --key "$ck" --body "$T/f$i.age" --metadata "sha256=$sha,size=$size" >/dev/null
  printf '%s\tr2\tu/user%s/file%s.bin\t%s\t%s\tok\n' "$sha" "$i" "$i" "$size" "$ck" >> "$T/inv.tsv"
  printf '%s\t%s\tu/user%s/file%s.bin\n' "$sha" "$size" "$i" "$i" >> "$T/db.tsv"
done
age -r "$R" -o "$T/inv.age" "$T/inv.tsv"
printf '{"snapshot":"%s","label":"local-test","objects":3,"backed_up":3,"missing":0,"copy_failures":0,"complete":true,"r2_media_records_not_covered":0,"inventory_sha256":"%s"}' \
  "$NAME" "$(sha256sum "$T/inv.tsv" | cut -d' ' -f1)" > "$T/rec.json"
printf '{"label":"local-test","taken_utc":"20260801T013000Z"}' > "$T/man.json"
echo x > "$T/snap"
put() { s3 s3api put-object --bucket "$B" --key "$1" --body "$2" >/dev/null; }
put "$DAY/$NAME.tar.age" "$T/snap"; put "$DAY/$NAME.json" "$T/man.json"; put "$DAY/$NAME.r2media.tsv.age" "$T/inv.age"; put "$DAY/$NAME.r2media.json" "$T/rec.json"
mkdir -p "$T/bin"; printf '#!/usr/bin/env bash\ncat >/dev/null; cat "%s/db.tsv"\n' "$T" > "$T/bin/psql"; chmod +x "$T/bin/psql"
export MEDIA_DB_URL=postgresql://stub@127.0.0.1:1/postgres
verify() { # <name> <VERIFY_NOW>
  PATH="$T/bin:$PATH" VERIFY_NOW="$2" KEY="$DAY/$NAME.tar.age" AGE_IDENTITY_FILE="$T/id.key" OUT="$T/o-$1" MEDIA_SAMPLE=10 bash "$HERE/media-verify.sh" > "$T/o-$1.log" 2>&1
}
NEAR=2026-08-06T00:00:00Z; FAR=2026-12-01T00:00:00Z   # 5 days and 122 days after the snapshot
verify near "$NEAR"; ok $? "inside the window, every copy present: passes ($(cut -c1-60 "$T/o-near/media-summary.txt" 2>/dev/null))"
s3 s3api delete-object --bucket "$B" --key "${CK[0]}" >/dev/null
verify near2 "$NEAR"; rc=$?; [ "$rc" -ne 0 ] && grep -q "no stored copy" "$T/o-near2/media-fails.txt"; ok $? "inside the window, a missing copy fails"
verify far "$FAR"; rc=$?; [ "$rc" -eq 0 ] && grep -q "DATABASE-ONLY" "$T/o-far/media-summary.txt" && grep -q "1 copies already expired" "$T/o-far/media-summary.txt"
ok $? "outside the window, the expired copy is expected and reported: $(cut -c1-120 "$T/o-far/media-summary.txt" 2>/dev/null)"
# a remaining copy that is corrupt (wrong bytes under the recorded metadata) still fails outside the window
sha2="$(sed -n 's/^\([0-9a-f]*\)\t.*/\1/p' "$T/inv.tsv" | sed -n 2p)"; head -c 102 /dev/urandom > "$T/junk"; age -r "$R" -o "$T/junk.age" "$T/junk"
s3 s3api put-object --bucket "$B" --key "${CK[1]}" --body "$T/junk.age" --metadata "sha256=$sha2,size=102" >/dev/null
verify farbad "$FAR"; rc=$?; [ "$rc" -ne 0 ] && grep -q "did not restore exactly" "$T/o-farbad/media-fails.txt"; ok $? "outside the window, a remaining corrupt copy still fails"
s3 s3api put-object --bucket "$B" --key "${CK[1]}" --body "$T/f2.age" --metadata "sha256=$sha2,size=102" >/dev/null
# the inventory must still equal the database outside the window
printf '%064d\t5\tu/ghost/x.bin\n' 7 >> "$T/db.tsv"
verify farghost "$FAR"; rc=$?; [ "$rc" -ne 0 ] && grep -q "not in the inventory" "$T/o-farghost/media-fails.txt"; ok $? "outside the window, a database original missing from the inventory still fails"
echo "media-window-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
