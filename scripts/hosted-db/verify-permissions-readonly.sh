#!/usr/bin/env bash
# READ-ONLY hosted function-permission check, to run after a migration push (and as a baseline before it).
#   bash scripts/hosted-db/verify-permissions-readonly.sh acceptance|production [contract version]
# Runs only the SELECT-only inventory scripts/function-permissions.sql through `supabase db query --linked`, then compares
# the result with supabase/permissions/<version>.json (default: latest) via verify-permissions-readonly.mjs.
# Password at a hidden prompt; unlinks on exit; writes nothing to the database.
set -euo pipefail
export LC_ALL=C
case "${1:-}" in acceptance) REF="nxossqhdfltcqdwvbewi";; production) REF="kkpkgjrweysgvhvkhzun";; *) echo "usage: $0 acceptance|production [version]"; exit 2;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE/../.."
sb() { pnpm exec supabase "$@"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" supabase/.temp' EXIT
grep -qiE '\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b' scripts/function-permissions.sql && { echo "REFUSED: inventory SQL is not SELECT-only"; exit 1; }
read -r -s -p "$1 database password (input hidden): " SUPABASE_DB_PASSWORD; echo
export SUPABASE_DB_PASSWORD
sb link --project-ref "$REF" >/dev/null
[ "$(cat supabase/.temp/project-ref)" = "$REF" ] || { echo "REFUSED: wrong project linked"; exit 1; }
sb db query --linked -o json -f scripts/function-permissions.sql > "$TMP/perms.json" 2>/dev/null
node "$HERE/verify-permissions-readonly.mjs" "$TMP/perms.json" ${2:+"$2"}
