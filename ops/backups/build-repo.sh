#!/usr/bin/env bash
# Assembles the contents of the separate private `aladdin-backups` repo from this checkout, so the backup job
# always runs exactly the kit that was tested here. Writes into an EMPTY folder (or one built by this script
# before); it never pushes anything.
#   bash ops/backups/build-repo.sh ~/aladdin-backups              # INACTIVE (default): no `schedule:` trigger anywhere
#   bash ops/backups/build-repo.sh ~/aladdin-backups --scheduled   # only after the owner's activation GO
# Then, inside that folder: git add -A && git commit -m "Backup kit from aladdin <sha>" && git push
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
DEST="${1:?usage: build-repo.sh <folder for the aladdin-backups repo> [--scheduled]}"
MODE="${2:-}"; case "$MODE" in ""|--scheduled) ;; *) echo "unknown option $MODE"; exit 1;; esac
mkdir -p "$DEST"; DEST="$(cd "$DEST" && pwd)"
if [ -n "$(find "$DEST" -mindepth 1 -maxdepth 1 ! -name .git -print -quit)" ] && [ ! -f "$DEST/SOURCE" ]; then
  echo "$DEST is not empty and was not built by this script: stopping"; exit 1
fi
rm -rf "$DEST/backup" "$DEST/.github/workflows" "$DEST/supabase" "$DEST/r2"
mkdir -p "$DEST/backup/kit" "$DEST/.github/workflows" "$DEST/supabase" "$DEST/r2"
# Every script and helper of the kit (a fixed list once left out media-verify.sh and the validators, so the built
# repo could not run its restore test); build-repo-test.sh fails if anything is missing.
cp "$HERE"/*.sh "$HERE"/*.py "$DEST/backup/"
cp "$ROOT"/scripts/hosted-db/{security-tail,schema-fingerprint,rowcounts,auth-storage-columns,local-only-roles-cleanup,local-default-privileges-reset}.sql "$DEST/backup/kit/"
cp "$HERE"/workflows/*.yml "$DEST/.github/workflows/"
# Inactive build: drop the `schedule:` trigger (its cron lines) from every workflow; manual runs stay possible and
# are still gated by plan.sh and the environments. The repo owner re-builds with --scheduled at the activation GO.
if [ "$MODE" != --scheduled ]; then
  python3 - "$DEST/.github/workflows" <<'PY'
import pathlib, re, sys
for f in pathlib.Path(sys.argv[1]).glob("*.yml"):
    out, skipping = [], False
    for line in f.read_text().splitlines(keepends=True):
        if re.match(r"^  schedule:\s*$", line): skipping = True; continue
        if skipping and (line.startswith("    ") or not line.strip()): continue
        skipping = False; out.append(line)
    f.write_text("".join(out))
PY
fi
cp -r "$HERE"/r2/. "$DEST/r2/"
cp "$ROOT/supabase/config.toml" "$DEST/supabase/"; cp -r "$ROOT/supabase/templates" "$DEST/supabase/"
cp "$HERE/README.md" "$DEST/README.md"
printf 'aladdin commit %s\nbuilt %s\nmode %s\n' "$(git -C "$ROOT" rev-parse HEAD)" "$(date -u +%FT%TZ)" "${MODE:---inactive}" > "$DEST/SOURCE"
( cd "$DEST" && find . \( -path ./.git -o -name MANIFEST.sha256 \) -prune -o -type f -print | sort | xargs sha256sum > "$DEST/MANIFEST.sha256" )
echo "Built $DEST from $(git -C "$ROOT" rev-parse --short HEAD). Review, commit and push it to the private aladdin-backups repo."
