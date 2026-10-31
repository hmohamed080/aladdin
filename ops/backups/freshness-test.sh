#!/usr/bin/env bash
# Regression tests of freshness.sh: it must FAIL CLOSED. Each case builds a tiny backup bucket on the local S3
# stand-in (127.0.0.1:8333, keys testkey/testsecret; see selftest.sh) holding today's snapshot with one particular
# media record, and says whether the alarm must stay quiet or fire. Touches nothing hosted (BACKUP_LABEL=local-test).
#   bash ops/backups/freshness-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export LC_ALL=C AWS_ACCESS_KEY_ID=testkey AWS_SECRET_ACCESS_KEY=testsecret AWS_DEFAULT_REGION=auto AWS_PAGER=""
export R2_ENDPOINT="${R2_ENDPOINT:-http://127.0.0.1:8333}" BACKUP_LABEL=local-test
T="$(mktemp -d)"; BUCKETS=()
s3() { aws --endpoint-url "$R2_ENDPOINT" "$@"; }
# The stand-in allocates storage per bucket: leave none behind.
trap 'for b in "${BUCKETS[@]}"; do s3 s3 rb "s3://$b" --force >/dev/null 2>&1; done; rm -rf "$T"' EXIT
RUN="$(date +%s)"; n=0; pass=0; fail=0
NAME="aladdin-local-test-20261031T013000Z"; DAY="db/local-test/daily/2026/10/31"
SHA=$(printf 'a%.0s' $(seq 64))
record() { # <complete> <missing> <objects> <backed_up> [extra json fields]
  printf '{"snapshot":"%s","label":"local-test","objects":%s,"backed_up":%s,"missing":%s,"copy_failures":0,"complete":%s,"r2_media_records_not_covered":0,"inventory_sha256":"%s"%s}' \
    "$NAME" "$3" "$4" "$2" "$1" "$SHA" "${5:-}"
}

# newbucket -> sets B to a fresh bucket holding the snapshot and its inventory (no media record yet)
newbucket() {
  n=$((n+1)); B="fresh-$RUN-$n"; local b="$B"
  s3 s3api create-bucket --bucket "$b" >/dev/null; BUCKETS+=("$b")
  head -c 300 /dev/urandom > "$T/blob"
  s3 s3api put-object --bucket "$b" --key "$DAY/$NAME.tar.age" --body "$T/blob" >/dev/null
  s3 s3api put-object --bucket "$b" --key "$DAY/$NAME.media.tsv.age" --body "$T/blob" >/dev/null
}
put_record() { printf '%s' "$2" > "$T/rec"; s3 s3api put-object --bucket "$1" --key "$DAY/$NAME.media.json" --body "$T/rec" >/dev/null; }
# expect <quiet|alarm> <description> <bucket> [alarm text to find]
expect() {
  local want="$1" what="$2" b="$3" text="${4:-}" out rc
  out="$(BACKUP_BUCKET="$b" bash "$HERE/freshness.sh" 2>&1)"; rc=$?
  if { [ "$want" = quiet ] && [ "$rc" -eq 0 ]; } || { [ "$want" = alarm ] && [ "$rc" -ne 0 ] && grep -q "BACKUP ALERT" <<< "$out" && { [ -z "$text" ] || grep -qi -- "$text" <<< "$out"; }; }; then
    pass=$((pass+1)); echo "PASS  $what"
  else
    fail=$((fail+1)); echo "FAIL  $what (wanted $want${text:+ with \"$text\"}; exit $rc)"; sed 's/^/        /' <<< "$out" | head -8
  fi
}

newbucket; b="$B"; put_record "$b" "$(record true 0 3 3)";                    expect quiet "a complete, well formed record keeps the alarm quiet" "$b"
newbucket; b="$B";                                                            expect alarm "a missing media record raises the alarm" "$b" "media record"
newbucket; b="$B"; put_record "$b" "";                                        expect alarm "an empty media record raises the alarm" "$b" "empty"
newbucket; b="$B"; put_record "$b" '{"snapshot": "x", "complete": tr';        expect alarm "a truncated (malformed) media record raises the alarm" "$b" "not valid JSON"
newbucket; b="$B"; put_record "$b" 'not json at all';                         expect alarm "a media record that is not JSON raises the alarm" "$b" "not valid JSON"
newbucket; b="$B"; put_record "$b" '[]';                                      expect alarm "a media record that is not an object raises the alarm" "$b" "not a JSON object"
newbucket; b="$B"; put_record "$b" '{"complete":true}';                       expect alarm "a record with only complete:true (fields missing) raises the alarm" "$b" "lacks the field"
for f in objects backed_up missing copy_failures r2_media_records_not_covered inventory_sha256 snapshot label; do
  newbucket; b="$B"; put_record "$b" "$(record true 0 3 3 | python3 -c "import json,sys; d=json.load(sys.stdin); del d['$f']; print(json.dumps(d))")"
  expect alarm "a record without the field $f raises the alarm" "$b" "$f"
done
newbucket; b="$B"; put_record "$b" "$(record '"true"' 0 3 3)";                expect alarm "complete as the text \"true\" raises the alarm" "$b" "complete"
newbucket; b="$B"; put_record "$b" "$(record false 1 3 2)";                   expect alarm "a record that says incomplete raises the alarm" "$b" "incomplete"
newbucket; b="$B"; put_record "$b" "$(record true 1 3 2)";                    expect alarm "complete:true with a file missing raises the alarm" "$b" "contradicts"
newbucket; b="$B"; put_record "$b" "$(record true 0 4 3)";                    expect alarm "counts that do not add up raise the alarm" "$b" "contradicts"
newbucket; b="$B"; put_record "$b" "$(record false 0 3 3 | sed 's/"complete":false/"complete":false,"complete":true/')"
expect alarm "a repeated key (complete false, then true) raises the alarm" "$b" "twice"
newbucket; b="$B"; put_record "$b" "$(record true 0 3 3 | sed 's/"label":"local-test"/"label":"production"/')"
expect alarm "a record of another label raises the alarm" "$b" "not 'local-test'"
newbucket; b="$B"; put_record "$b" "$(record true 0 3 3 | sed "s/$NAME/aladdin-local-test-20200101T000000Z/")"
expect alarm "a record of another snapshot raises the alarm" "$b" "snapshot"
newbucket; b="$B"; put_record "$b" "$(record true 0 3 3)"; s3 s3api delete-object --bucket "$b" --key "$DAY/$NAME.media.tsv.age" >/dev/null
expect alarm "a complete record without its stored inventory raises the alarm" "$b" "inventory"
newbucket; b="$B"; put_record "$b" "$(record true 0 3 3)"; : > "$T/empty"; s3 s3api put-object --bucket "$b" --key "$DAY/$NAME.media.tsv.age" --body "$T/empty" >/dev/null
expect alarm "a complete record with an empty inventory raises the alarm" "$b" "inventory"
newbucket; b="$B"; put_record "$b" "$(record true 0 3 3 ',"r2_media_records_not_covered":2' | sed 's/"r2_media_records_not_covered":0,//')"
expect quiet "R2 media not covered is only a warning for a non-Production label" "$b"
b="not-a-bucket-$RUN";                                                       expect alarm "a bucket that cannot be read raises the alarm" "$b" "cannot be listed"
newbucket; b="$B"; put_record "$b" "$(record true 0 3 3)"; R2_ENDPOINT=http://127.0.0.1:1 BACKUP_BUCKET="$b" bash "$HERE/freshness.sh" >/dev/null 2>&1
if [ $? -ne 0 ]; then pass=$((pass+1)); echo "PASS  an unreachable bucket endpoint fails"; else fail=$((fail+1)); echo "FAIL  an unreachable bucket endpoint fails"; fi
newbucket; b="$B"; put_record "$b" "$(record true 0 3 3)"; MAX_AGE_HOURS=0 BACKUP_BUCKET="$b" bash "$HERE/freshness.sh" >/dev/null 2>&1
if [ $? -ne 0 ]; then pass=$((pass+1)); echo "PASS  a stale backup raises the alarm"; else fail=$((fail+1)); echo "FAIL  a stale backup raises the alarm"; fi
newbucket; b="$B"; MAX_AGE_HOURS=0 CHECK_MEDIA=0 BACKUP_BUCKET="$b" bash "$HERE/freshness.sh" >/dev/null 2>&1
if [ $? -ne 0 ]; then pass=$((pass+1)); echo "PASS  CHECK_MEDIA=0 does not hide a stale backup"; else fail=$((fail+1)); echo "FAIL  CHECK_MEDIA=0 does not hide a stale backup"; fi

echo "freshness-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
