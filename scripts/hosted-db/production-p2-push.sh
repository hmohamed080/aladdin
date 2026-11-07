#!/usr/bin/env bash
# P-2: the ONLY sanctioned way to push the 8 pending migrations to Production (kkpkgjrweysgvhvkhzun). Owner-run, after
# separate written approval. It refuses to push unless every gate below passes, and re-checks the snapshot's age
# immediately before the push.
#   bash scripts/hosted-db/production-p2-push.sh <snapshot folder> --check-only    # gates only, never pushes
#   bash scripts/hosted-db/production-p2-push.sh <snapshot folder>                 # gates, typed confirmation, push
# Gates (all must pass; logic and tests in p2-gate.mjs / p2-gate.test.mjs):
#   1. this checkout is clean and equals origin/main (the approved commit);
#   2. the snapshot is of Production, history 195 / 20261107090002, its COPY-vs-SELECT row counts were validated, it is
#      at most 60 minutes old, its backup files still match their checksums;
#   3. the encrypted copy exists, is unchanged since encrypt-backup.sh's decrypt-and-compare recovery check passed, and
#      that check belongs to this snapshot;
#   4. the linked project IS Production; it has exactly 195 applied, none remote-only, and exactly the 8 expected pending
#      migrations, and `db push --dry-run --include-all` would push exactly those 8 in order;
#   5. a typed confirmation, then the snapshot age is checked again.
# After the push it lists the history again: 203 applied, none pending. The password is read at a hidden prompt.
set -euo pipefail
export LC_ALL=C
SNAP="${1:?usage: production-p2-push.sh <snapshot folder> [--check-only]}"; CHECK_ONLY=0
[ "${2:-}" != "--check-only" ] || CHECK_ONLY=1
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE/../.."
PROD="kkpkgjrweysgvhvkhzun"
sb() { pnpm exec supabase "$@"; }
SNAP="$(cd "$SNAP" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" supabase/.temp' EXIT

echo "[1/5] approved commit"
git fetch -q origin main
[ -z "$(git status --porcelain)" ] || { echo "REFUSED: the working tree is not clean"; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "REFUSED: HEAD is not origin/main"; exit 1; }
echo "      $(git rev-parse --short HEAD) = origin/main"

echo "[2/5] snapshot, encrypted copy and recovery proof"
node "$HERE/p2-gate.mjs" snapshot "$SNAP"

echo "[3/5] Production state"
read -r -s -p "Production database password (input hidden): " SUPABASE_DB_PASSWORD; echo
export SUPABASE_DB_PASSWORD
sb link --project-ref "$PROD" >/dev/null
[ "$(cat supabase/.temp/project-ref)" = "$PROD" ] || { echo "REFUSED: not linked to Production"; exit 1; }
sb migration list --linked --output-format json > "$TMP/list.json" 2>/dev/null
sb db push --linked --dry-run --include-all --output-format json > "$TMP/dry.json" 2>/dev/null
node "$HERE/p2-gate.mjs" pending "$TMP/list.json" "$TMP/dry.json" supabase/migrations

if [ "$CHECK_ONLY" = 1 ]; then echo "[check-only] all gates passed; nothing was pushed."; exit 0; fi

echo "[4/5] confirmation"
echo "About to apply 8 migrations to PRODUCTION ($PROD) with --include-all."
read -r -p "Type exactly  PUSH 8 MIGRATIONS TO PRODUCTION  to continue: " CONFIRM
[ "$CONFIRM" = "PUSH 8 MIGRATIONS TO PRODUCTION" ] || { echo "not confirmed: nothing pushed"; exit 1; }
node "$HERE/p2-gate.mjs" snapshot "$SNAP" >/dev/null     # the age limit again, after the prompts

echo "[5/5] push"
sb db push --linked --include-all
sb migration list --linked --output-format json > "$TMP/after.json" 2>/dev/null
node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const r=JSON.parse(t.slice(t.indexOf("{"))).migrations;const pend=r.filter(x=>x.local&&!x.remote).length;const rem=r.filter(x=>x.remote).length;console.log("applied:",rem,"pending:",pend);process.exit(rem===203&&pend===0?0:1)' "$TMP/after.json" \
  && echo "P-2 done: 203 applied, none pending. Continue with the P-2 checks in the checklist." \
  || { echo "UNEXPECTED history after the push: stop, do not continue to P-1"; exit 1; }
