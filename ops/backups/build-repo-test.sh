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
[ -f "$D/repo/.github/workflows/daily-backup.yml" ] && [ -f "$D/repo/r2/backup-bucket-lifecycle.json" ] || { echo "FAIL  workflows or r2 rules missing"; fail=1; }
( cd "$D/repo" && sha256sum -c MANIFEST.sha256 >/dev/null ) || { echo "FAIL  MANIFEST.sha256 does not match"; fail=1; }
[ "$fail" = 0 ] && echo "build-repo-test: ok"
exit "$fail"
