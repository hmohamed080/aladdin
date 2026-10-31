#!/usr/bin/env bash
# The built aladdin-backups repo must hold every script and helper of the kit and be able to run its own checks.
#   bash ops/backups/build-repo-test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT
bash "$HERE/build-repo.sh" "$D/repo" >/dev/null
fail=0
for f in "$HERE"/*.sh "$HERE"/*.py; do
  [ -f "$D/repo/backup/$(basename "$f")" ] || { echo "FAIL  the built repo lacks $(basename "$f")"; fail=1; }
done
# Every kit file a script sources or runs must exist next to it in the built repo.
for f in "$D"/repo/backup/*.sh; do
  for ref in $(grep -oE '"\$(HERE|LIB_DIR)/[A-Za-z0-9._-]+\.(sh|py)"' "$f" | sed -E 's|.*/([^"]+)"|\1|' | sort -u); do
    [ -f "$D/repo/backup/$ref" ] || { echo "FAIL  $(basename "$f") uses $ref, which the built repo lacks"; fail=1; }
  done
done
[ -f "$D/repo/.github/workflows/daily-backup.yml" ] && [ -f "$D/repo/r2/production/lifecycle.json" ] && [ -f "$D/repo/r2/production/lock.json" ] \
  && [ -f "$D/repo/r2/acceptance/lifecycle.json" ] || { echo "FAIL  workflows or r2 rules missing"; fail=1; }
# The default build is INACTIVE: no workflow carries a schedule trigger. --scheduled brings all of them back.
if grep -lE '^  schedule:' "$D"/repo/.github/workflows/*.yml >/dev/null; then echo "FAIL  the inactive build still has a schedule trigger"; fail=1; fi
grep -q '^mode --inactive' "$D/repo/SOURCE" || { echo "FAIL  SOURCE does not say inactive"; fail=1; }
bash "$HERE/build-repo.sh" "$D/sched" --scheduled >/dev/null
for w in daily-backup freshness restore-test; do
  grep -qE '^  schedule:' "$D/sched/.github/workflows/$w.yml" || { echo "FAIL  --scheduled build lacks the schedule of $w"; fail=1; }
  python3 -c 'import sys,re; [sys.exit(1) for l in open(sys.argv[1]) if l.strip() and not l.startswith(("#"," ")) and not re.match(r"^[A-Za-z_-]+:",l)]' "$D/repo/.github/workflows/$w.yml" || { echo "FAIL  malformed inactive $w"; fail=1; }
done
bash "$HERE/build-repo.sh" "$D/repo" bogus >/dev/null 2>&1 && { echo "FAIL  an unknown option was accepted"; fail=1; }
( cd "$D/repo" && sha256sum -c MANIFEST.sha256 >/dev/null ) || { echo "FAIL  MANIFEST.sha256 does not match"; fail=1; }
[ "$fail" = 0 ] && echo "build-repo-test: ok"
exit "$fail"
