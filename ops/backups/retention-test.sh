#!/usr/bin/env bash
# Offline test of the retention contract: the R2 bucket rules, the constants in lib.sh and the documented
# full-restore window must agree, and the two projects must not share a bucket or a rule.
#   bash ops/backups/retention-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL  $1 (got '$2', wanted '$3')"; fi; }
inlib() { ( export BACKUP_LABEL="$1"; shift; . "$HERE/lib.sh"; "$@" ) 2>&1; }

# 1. One bucket per project.
check "production bucket" "$(inlib production expected_bucket)" aladdin-production-db-backups
check "acceptance bucket" "$(inlib acceptance expected_bucket)" aladdin-acceptance-backups
check "local-test has no hosted bucket" "$(inlib local-test expected_bucket)" ""
chk() { ( export BACKUP_LABEL="$1" BACKUP_BUCKET="$2" R2_ENDPOINT=https://0123abcd.r2.cloudflarestorage.com AWS_ACCESS_KEY_ID=x AWS_SECRET_ACCESS_KEY=x; . "$HERE/lib.sh"; check_target ) >/dev/null 2>&1 && echo ok || echo refused; }
check "acceptance cannot use the production bucket" "$(chk acceptance aladdin-production-db-backups)" refused
check "production cannot use the acceptance bucket" "$(chk production aladdin-acceptance-backups)" refused
check "acceptance uses its own bucket" "$(chk acceptance aladdin-acceptance-backups)" ok
check "production uses its own bucket" "$(chk production aladdin-production-db-backups)" ok
check "the shared-bucket constant is gone" "$(grep -c HOSTED_BUCKET "$HERE/lib.sh")" 0

# 2. Rule files agree with the constants, and each only touches its own project's prefixes.
RES="$(python3 - "$HERE" <<'PY'
import json, re, subprocess, sys
here = sys.argv[1]
def const(name):
    out = subprocess.check_output(["bash", "-c", f'. "{here}/lib.sh"; echo ${name}'], env={"BACKUP_LABEL": "local-test", "PATH": "/usr/bin:/bin:/usr/local/bin"}, text=True)
    return int(out.strip())
D = 86400
want = {"daily": 15, "weekly": 57, "monthly": const("DB_MONTHLY_RETENTION_DAYS")}
lock = {"daily": 14, "weekly": 56, "monthly": const("DB_MONTHLY_RETENTION_DAYS") - 1}
r2, legacy = const("R2_MEDIA_RETENTION_DAYS"), const("LEGACY_MEDIA_RETENTION_DAYS")
bad = []
for label in ("production", "acceptance"):
    rules = json.load(open(f"{here}/r2/{label}/lifecycle.json"))["rules"]
    other = "acceptance" if label == "production" else "production"
    seen = {}
    for r in rules:
        prefix = r["conditions"]["prefix"]
        if other in prefix: bad.append(f"{label} lifecycle touches {prefix}")
        if "abortMultipartUploadsTransition" in r: continue
        seen[prefix] = r["deleteObjectsTransition"]["condition"]["maxAge"]
    for k, days in want.items():
        if seen.get(f"db/{label}/{k}/") != days * D: bad.append(f"{label} {k} lifecycle is {seen.get(f'db/{label}/{k}/')}, wanted {days} days")
    if seen.get(f"media/{label}/r2/") != r2 * D: bad.append(f"{label} r2 media lifecycle is not {r2} days")
    if seen.get(f"media/{label}/supabase/") != legacy * D: bad.append(f"{label} legacy media lifecycle is not {legacy} days")
    if not any("abortMultipartUploadsTransition" in r for r in rules): bad.append(f"{label} lacks the multipart abort rule")
    if len(seen) != 5: bad.append(f"{label} has {len(seen)} expiry rules, wanted 5")
lock_rules = json.load(open(f"{here}/r2/production/lock.json"))["rules"]
if {r["prefix"] for r in lock_rules} != {f"db/production/{k}/" for k in want}: bad.append("production lock covers the wrong prefixes")
for r in lock_rules:
    k = r["prefix"].split("/")[2]
    if r["condition"]["maxAgeSeconds"] != lock[k] * D: bad.append(f"lock {k} is not {lock[k]} days")
import os
if os.path.exists(f"{here}/r2/acceptance/lock.json"): bad.append("acceptance must not be locked (disposable trial bucket)")
if any(r["prefix"].startswith("media/") for r in lock_rules): bad.append("media copies must never be locked")
print("\n".join(bad))
PY
)"
check "rule files match lib.sh constants and stay in their own project" "$RES" ""

# 3. The guaranteed full-restore window (copies age from when they were written, up to a month before the snapshot).
check "R2 guarantee is retention minus one generation (59)" "$(inlib local-test media_guarantee_days r2)" 59
check "legacy guarantee is one day" "$(inlib local-test media_guarantee_days supabase)" 1
chk_out() { ( export BACKUP_LABEL=local-test VERIFY_NOW="$3"; . "$HERE/lib.sh"; outside_media_guarantee "$1" "$2" ) >/dev/null 2>&1 && echo outside || echo inside; }
check "58 days old: still guaranteed" "$(chk_out r2 20260901T013000Z 2026-10-29T01:30:00Z)" inside
check "59 days old: no longer guaranteed" "$(chk_out r2 20260901T013000Z 2026-10-30T01:30:00Z)" outside
check "200 days old (monthly DB snapshot): database-only" "$(chk_out r2 20260401T013000Z 2026-10-18T01:30:00Z)" outside
check "yesterday: guaranteed" "$(chk_out r2 20261030T013000Z 2026-10-31T00:00:00Z)" inside
check "legacy one day later: not guaranteed" "$(chk_out supabase 20261029T013000Z 2026-10-30T02:00:00Z)" outside
check "a hosted label refuses VERIFY_NOW" "$( ( export BACKUP_LABEL=production VERIFY_NOW=2026-10-30T00:00:00Z; . "$HERE/lib.sh"; snapshot_age_days 20261029T013000Z ) >/dev/null 2>&1 && echo ran || echo refused)" refused
check "a garbage date fails closed" "$( ( export BACKUP_LABEL=local-test; . "$HERE/lib.sh"; outside_media_guarantee r2 notadate ) >/dev/null 2>&1 && echo ran || echo refused)" refused

# 4. The README states the window.
check "README states the 59-day guaranteed window" "$(grep -c '59 days' "$HERE/README.md" | awk '{print ($1>0)?"yes":"no"}')" yes

echo "retention-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
