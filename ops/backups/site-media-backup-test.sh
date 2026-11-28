#!/usr/bin/env bash
# Offline test of the site-media backup and its verifier. A tiny `aws` stand-in (a folder per bucket) replaces S3, so
# nothing is hosted and no S3 server is needed. Proves: Production requires the site backup; each label reads only its
# own site bucket; every object (and a later upload) is copied encrypted and verified; an empty bucket is complete;
# an unreadable object makes the snapshot incomplete without naming it; the coverage rule alarms when the site copy is
# missing; the verifier passes a good backup and fails a corrupted copy.
#   bash ops/backups/site-media-backup-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/s3"
cat > "$T/bin/aws" <<'PY'
#!/usr/bin/env python3
import hashlib, json, os, shutil, sys
root = os.environ["FAKE_S3"]
a = sys.argv[1:]
if a[:1] == ["--endpoint-url"]: a = a[2:]
assert a[0] == "s3api", a
op, opts, pos, i = a[1], {}, [], 2
while i < len(a):
    if a[i].startswith("--"): opts[a[i][2:]] = a[i + 1] if i + 1 < len(a) and not a[i + 1].startswith("--") else ""; i += 2 if opts[a[i][2:]] != "" or a[i] in ("--if-none-match",) else 1
    else: pos.append(a[i]); i += 1
b, k = opts.get("bucket"), opts.get("key")
def path(bucket, key): return os.path.join(root, bucket, key)
def meta_path(bucket, key): return os.path.join(root, ".meta", bucket, hashlib.sha256(key.encode()).hexdigest())
denied = [x for x in os.environ.get("FAKE_DENY", "").split(",") if x]
if op == "list-objects-v2":
    prefix, out = opts.get("prefix", ""), []
    base = os.path.join(root, b)
    for d, _, files in os.walk(base):
        for f in files:
            key = os.path.relpath(os.path.join(d, f), base)
            if key.startswith(prefix): out.append({"Key": key, "Size": os.path.getsize(os.path.join(d, f))})
    out.sort(key=lambda o: o["Key"])
    print(json.dumps({"Contents": out} if out else {}))
elif op == "get-object":
    if any(d in k for d in denied): sys.stderr.write("An error occurred (AccessDenied) when calling the GetObject operation: Access Denied\n"); sys.exit(1)
    if not os.path.exists(path(b, k)): sys.stderr.write("An error occurred (NoSuchKey) when calling the GetObject operation: The specified key does not exist.\n"); sys.exit(1)
    shutil.copy(path(b, k), pos[0]); print("{}")
elif op == "head-object":
    if not os.path.exists(path(b, k)): sys.stderr.write("An error occurred (404) when calling the HeadObject operation: Not Found\n"); sys.exit(1)
    m = json.load(open(meta_path(b, k))) if os.path.exists(meta_path(b, k)) else {}
    q = opts.get("query", "")
    if q == "ContentLength": print(os.path.getsize(path(b, k)))
    else: print(str(m.get("size", "None")) + "\t" + str(m.get("sha256", "None")))
elif op == "put-object":
    if os.path.exists(path(b, k)): sys.stderr.write("An error occurred (PreconditionFailed) when calling the PutObject operation\n"); sys.exit(1)
    os.makedirs(os.path.dirname(path(b, k)), exist_ok=True); shutil.copy(opts["body"], path(b, k))
    if "metadata" in opts:
        os.makedirs(os.path.dirname(meta_path(b, k)), exist_ok=True)
        json.dump(dict(p.split("=", 1) for p in opts["metadata"].split(",")), open(meta_path(b, k), "w"))
    print("{}")
else:
    sys.stderr.write("unsupported " + op + "\n"); sys.exit(2)
PY
chmod +x "$T/bin/aws"
export PATH="$T/bin:$PATH" FAKE_S3="$T/s3" LC_ALL=C AWS_DEFAULT_REGION=auto AWS_PAGER=""
pass=0; fail=0
ok() { if [ "$1" -eq 0 ]; then pass=$((pass+1)); echo "PASS  $2"; else fail=$((fail+1)); echo "FAIL  $2"; fi; }
age-keygen -o "$T/owner.key" 2>/dev/null; AGE_RECIPIENTS="$(age-keygen -y "$T/owner.key")"; export AGE_RECIPIENTS

# A local-test world: bucket "site-src" (the site bucket), bucket "bk" (the backup bucket).
export BACKUP_LABEL=local-test BACKUP_BUCKET=bk R2_ENDPOINT=http://127.0.0.1:8333 AWS_ACCESS_KEY_ID=write AWS_SECRET_ACCESS_KEY=w
export R2_SITE_BACKUP=1 R2_SITE_SOURCE_ENDPOINT=http://127.0.0.1:8333 R2_SITE_SOURCE_BUCKET=site-src R2_SITE_SOURCE_ACCESS_KEY_ID=read R2_SITE_SOURCE_SECRET_ACCESS_KEY=r R2_READ_RETRY_SLEEP=0
mkdir -p "$T/s3/site-src/site/shared/aaa" "$T/s3/bk" "$T/state"
snap() { # <name> : a fresh snapshot state, filed under one prefix
  printf 'SKIPPED=0\nNAME=%s\nPREFIXES="db/local-test/daily/2026/11/01"\n' "$1" > "$T/state/db.env"
  printf '{"label":"local-test","taken_utc":"%s","storage_objects":0,"r2_media_records":0,"r2_required_originals":0}' "$(date -u +%FT%TZ)" > "$T/m.json"
  cp "$T/m.json" "$T/s3/bk/.tmp-m"; mkdir -p "$T/s3/bk/db/local-test/daily/2026/11/01"; mv "$T/s3/bk/.tmp-m" "$T/s3/bk/db/local-test/daily/2026/11/01/$1.json"
}
run() { BACKUP_STATE_DIR="$T/state" bash "$HERE/site-media-backup.sh" > "$T/out.txt" 2>&1; }
head -c 4000 /dev/urandom > "$T/s3/site-src/site/shared/aaa/original.webp"
head -c 90000 /dev/urandom > "$T/s3/site-src/site/shared/aaa/promo.mp4"

# 1. Switch and target guards.
( export BACKUP_LABEL=production PRODUCTION_BACKUP_ENABLED=true BACKUP_BUCKET=aladdin-production-db-backups R2_ENDPOINT=https://a4c2b7ac45e58a81691b9165492ce6a2.r2.cloudflarestorage.com R2_SITE_BACKUP=0
  BACKUP_STATE_DIR="$T/state" bash "$HERE/site-media-backup.sh" > "$T/out.txt" 2>&1 ); rc=$?
[ "$rc" -ne 0 ] && grep -q "requires the site-media backup" "$T/out.txt"; ok $? "Production with R2_SITE_BACKUP off fails (a backup without the site bucket is not complete)"
( export BACKUP_LABEL=acceptance BACKUP_BUCKET=aladdin-acceptance-backups-weur R2_ENDPOINT=https://a4c2b7ac45e58a81691b9165492ce6a2.r2.cloudflarestorage.com R2_SITE_BACKUP=0
  BACKUP_STATE_DIR="$T/state" bash "$HERE/site-media-backup.sh" > "$T/out.txt" 2>&1 ); rc=$?
[ "$rc" -eq 0 ] && grep -q "nothing to do" "$T/out.txt"; ok $? "Acceptance with the switch off is a no-op"
( export BACKUP_LABEL=production PRODUCTION_BACKUP_ENABLED=true BACKUP_BUCKET=aladdin-production-db-backups R2_ENDPOINT=https://a4c2b7ac45e58a81691b9165492ce6a2.r2.cloudflarestorage.com
  R2_SITE_SOURCE_ENDPOINT=https://a4c2b7ac45e58a81691b9165492ce6a2.r2.cloudflarestorage.com R2_SITE_SOURCE_BUCKET=aladdin-acceptance-site-media BACKUP_STATE_DIR="$T/state" bash "$HERE/site-media-backup.sh" > "$T/out.txt" 2>&1 ); rc=$?
[ "$rc" -ne 0 ] && grep -q "reads only its own site bucket aladdin-site-media" "$T/out.txt"; ok $? "Production refuses the Acceptance site bucket"
( export BACKUP_LABEL=acceptance BACKUP_BUCKET=aladdin-acceptance-backups-weur R2_ENDPOINT=https://a4c2b7ac45e58a81691b9165492ce6a2.r2.cloudflarestorage.com
  R2_SITE_SOURCE_ENDPOINT=https://a4c2b7ac45e58a81691b9165492ce6a2.r2.cloudflarestorage.com R2_SITE_SOURCE_BUCKET=aladdin-site-media BACKUP_STATE_DIR="$T/state" bash "$HERE/site-media-backup.sh" > "$T/out.txt" 2>&1 ); rc=$?
[ "$rc" -ne 0 ] && grep -q "reads only its own site bucket aladdin-acceptance-site-media" "$T/out.txt"; ok $? "Acceptance refuses the Production site bucket"

# 2. A normal run copies every object, encrypted, named by hash; the record is complete.
N1=aladdin-local-test-20261101T010000Z; snap "$N1"; run; rc=$?
ok "$rc" "a run with two assets succeeds"
REC="$T/s3/bk/db/local-test/daily/2026/11/01/$N1.sitemedia.json"
grep -q '"objects":2' "$REC" && grep -q '"complete":true' "$REC"; ok $? "the record says 2 objects, complete"
n="$(find "$T/s3/bk/media/local-test/site" -name '*.age' | wc -l | tr -d ' ')"; [ "$n" = 2 ]; ok $? "two encrypted copies were stored"
age -d -i "$T/owner.key" "$T/s3/bk/db/local-test/daily/2026/11/01/$N1.sitemedia.tsv.age" > "$T/inv.tsv" 2>/dev/null
[ "$(awk -F'\t' '$6=="ok"' "$T/inv.tsv" | wc -l | tr -d ' ')" = 2 ] && grep -q "site/shared/aaa/promo.mp4" "$T/inv.tsv"; ok $? "the encrypted inventory lists both assets"
! grep -rq "promo.mp4" "$T/s3/bk/media"; ok $? "no asset name appears in a copy's key"

# 3. The verifier passes the good backup, then fails a corrupted copy.
KEY="db/local-test/daily/2026/11/01/$N1.tar.age"
BACKUP_LABEL=local-test KEY="$KEY" AGE_IDENTITY_FILE="$T/owner.key" OUT="$T/vo" bash "$HERE/site-media-verify.sh" > "$T/v.txt" 2>&1; ok $? "the verifier passes the good backup"
victim="$(find "$T/s3/bk/media/local-test/site" -name '*.age' | head -1)"; cp "$victim" "$T/victim.keep"
head -c "$(wc -c < "$victim")" /dev/urandom > "$victim"
MEDIA_SAMPLE=10 BACKUP_LABEL=local-test KEY="$KEY" AGE_IDENTITY_FILE="$T/owner.key" OUT="$T/vo2" bash "$HERE/site-media-verify.sh" > "$T/v2.txt" 2>&1
[ $? -ne 0 ]; ok $? "the verifier fails a corrupted copy"
cp "$T/victim.keep" "$victim"

# 4. A later upload is picked up by the next snapshot; existing copies are reused.
mkdir -p "$T/s3/site-src/site/pages"; head -c 700 /dev/urandom > "$T/s3/site-src/site/pages/late.png"
N2=aladdin-local-test-20261102T010000Z; snap "$N2"; run; rc=$?
ok "$rc" "the next run succeeds"
grep -q '"objects":3' "$T/s3/bk/db/local-test/daily/2026/11/01/$N2.sitemedia.json"; ok $? "the new asset is included automatically (3 objects)"
grep -q "1 new copied" "$T/out.txt"; ok $? "only the new asset was copied"

# 5. An unreadable object makes the snapshot incomplete, names nothing, and fails the run.
head -c 300 /dev/urandom > "$T/s3/site-src/site/pages/secret-banner.png"
N3=aladdin-local-test-20261103T010000Z; snap "$N3"; FAKE_DENY=secret-banner run; rc=$?
[ "$rc" -ne 0 ]; ok $? "an unreadable asset fails the run"
grep -q '"complete":false' "$T/s3/bk/db/local-test/daily/2026/11/01/$N3.sitemedia.json"; ok $? "the snapshot's site record is marked incomplete"
! grep -q "secret-banner" "$T/out.txt"; ok $? "the log never names the asset"
grep -q "access_denied" "$T/out.txt"; ok $? "the log says why (access_denied)"

# 6. An empty bucket is a complete backup of nothing.
rm -rf "$T/s3/site-src"; mkdir -p "$T/s3/site-src"
N4=aladdin-local-test-20261104T010000Z; snap "$N4"; run; rc=$?
ok "$rc" "an empty site bucket succeeds"
grep -q '"objects":0' "$T/s3/bk/db/local-test/daily/2026/11/01/$N4.sitemedia.json" && grep -q '"complete":true' "$T/s3/bk/db/local-test/daily/2026/11/01/$N4.sitemedia.json"; ok $? "an empty bucket records 0 objects, complete"

# 7. The coverage rule: Production without a site record is an alarm; with a complete one it is clear.
cov() { BACKUP_LABEL=production BACKUP_BUCKET=bk bash -c '. "$0/lib.sh"; media_coverage "$1" "$2"' "$HERE" "$1" "$2" 2>&1; }
P="db/production/daily/2026/11/01"; NP=aladdin-production-20261101T010000Z
mkdir -p "$T/s3/bk/$P"; printf '{"label":"production","storage_objects":0,"r2_media_records":0,"r2_required_originals":0}' > "$T/s3/bk/$P/$NP.json"
o="$(R2_SITE_BACKUP=0 cov "$P" "$NP")"; grep -q "^A .*site-media bucket" <<< "$o"; ok $? "Production, site backup off -> alarm (A)"
o="$(R2_SITE_BACKUP=1 cov "$P" "$NP")"; grep -q "^P .*sitemedia" <<< "$o"; ok $? "Production, switch on but no record -> problem (P)"
printf '{"snapshot":"%s","label":"production","objects":0,"backed_up":0,"missing":0,"copy_failures":0,"complete":true,"r2_media_records_not_covered":0,"inventory_sha256":"%s"}' "$NP" "$(printf 'a%.0s' $(seq 64))" > "$T/s3/bk/$P/$NP.sitemedia.json"
head -c 120 /dev/urandom > "$T/s3/bk/$P/$NP.sitemedia.tsv.age"
o="$(R2_SITE_BACKUP=1 cov "$P" "$NP")"; [ -z "$o" ]; ok $? "Production, switch on with a complete record -> clear"
( export BACKUP_LABEL=acceptance; . "$HERE/lib.sh"; [ -z "$(R2_SITE_BACKUP=0 media_coverage "$P" "$NP" 2>/dev/null)" ] ) ; ok $? "Acceptance with the switch off is not alarmed"

echo "site-media-backup-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
