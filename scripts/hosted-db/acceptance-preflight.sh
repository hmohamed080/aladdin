#!/usr/bin/env bash
# READ-ONLY on Acceptance (nxossqhdfltcqdwvbewi): the real Supabase CLI history list and `db push --dry-run`, checked by
# acceptance-gate.mjs. It never pushes. Run on the owner machine, from a clean checkout equal to origin/main.
#   bash scripts/hosted-db/acceptance-preflight.sh <plan>     (plan: media | m1 | m3a | media+m1, see acceptance-gate.mjs)
# The database password is read at a hidden prompt. `supabase/.temp` is removed on exit (unlinks again).
set -euo pipefail
export LC_ALL=C
ACC="nxossqhdfltcqdwvbewi"; PROD="kkpkgjrweysgvhvkhzun"
PLAN="${1:-}"; [[ "$PLAN" =~ ^(media|m1|m3a|media\+m1)$ ]] || { echo "usage: $0 media|m1|m3a|media+m1"; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE/../.."
sb() { pnpm exec supabase "$@"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" supabase/.temp' EXIT
git fetch -q origin main
[ -z "$(git status --porcelain)" ] || { echo "REFUSED: working tree not clean"; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "REFUSED: HEAD is not origin/main"; exit 1; }
echo "checkout $(git rev-parse --short HEAD) = origin/main"
read -r -s -p "Acceptance database password (input hidden): " SUPABASE_DB_PASSWORD; echo
export SUPABASE_DB_PASSWORD
sb link --project-ref "$ACC" >/dev/null
[ "$(cat supabase/.temp/project-ref)" = "$ACC" ] || { echo "REFUSED: not linked to Acceptance"; exit 1; }
[ "$(cat supabase/.temp/project-ref)" != "$PROD" ] || { echo "REFUSED: linked to Production"; exit 1; }
sb migration list --linked --output-format json > "$TMP/list.json" 2>/dev/null
sb db push --linked --dry-run --output-format json > "$TMP/dry.json" 2>/dev/null     # NO --include-all: a plain push must be enough
node "$HERE/acceptance-gate.mjs" "$PLAN" "$TMP/list.json" "$TMP/dry.json" supabase/migrations
node scripts/migration-history-guard.mjs "$TMP/list.json" --expect plan --dry-run "$TMP/dry.json"
echo "Acceptance preflight passed. Nothing was pushed. The push needs its own owner GO."
