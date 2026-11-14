#!/usr/bin/env bash
# READ-ONLY preflight for applying the Admin View-As migrations (20261114090002..04; 090001 is #192's) to the ACCEPTANCE project.
#
# It never applies anything: it lists the remote history, runs the repository's history guard, checks that exactly the
# expected migrations are pending, checks their content hashes, and shows the `db push --dry-run` plan.
# The apply itself (`supabase db push --linked`) is a separate step the OWNER runs after a separate approval.
#
# Run from a checkout of the COMBINED integration branch (Registration + View-As), with the CLI logged in
# (`supabase login`) and linked to Acceptance. It uses the CLI's temporary login role: no password is read or printed.
#
#   scripts/view-as-acceptance-preflight.sh
set -euo pipefail

ACCEPTANCE_REF="nxossqhdfltcqdwvbewi"        # aladdin-r2-acceptance-20261011
PRODUCTION_REF="kkpkgjrweysgvhvkhzun"         # never a target
# 090001 belongs to #192 (verification reviewer gate) and must be applied first; if it is already on Acceptance, set
# EXPECTED_FROM=090002 and only the three View-As migrations are required to be pending.
EXPECTED_ALL=(20261114090001 20261114090002 20261114090003 20261114090004)
if [ "${EXPECTED_FROM:-090001}" = "090002" ]; then EXPECTED=("${EXPECTED_ALL[@]:1}"); else EXPECTED=("${EXPECTED_ALL[@]}"); fi
# md5 of each file with CR removed (the same normalisation the owner's earlier guarded scripts used).
declare -A MD5=(
  [20261114090001]=9a6e939f6dfd340344f6e61ae41fbba6
  [20261114090002]=7f54a270b3d3efe2f440d9a748daac38
  [20261114090003]=392bfca9c9874655d17836ca7b129164
  [20261114090004]=9bd6fdcd8b0a8e13cd4b7d15fe5f9906
)

fail() { echo "PREFLIGHT FAIL: $*" >&2; exit 1; }

linked="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
[ "$linked" = "$ACCEPTANCE_REF" ] || fail "linked project is '${linked:-none}', expected the Acceptance project $ACCEPTANCE_REF"
[ "$linked" != "$PRODUCTION_REF" ] || fail "linked to PRODUCTION"

for v in "${EXPECTED[@]}"; do
  f=$(ls supabase/migrations/${v}_*.sql 2>/dev/null) || fail "missing local migration $v"
  [ "$(tr -d '\r' < "$f" | md5sum | cut -d' ' -f1)" = "${MD5[$v]}" ] || fail "$f differs from the reviewed content"
done
echo "ok  local files match the reviewed hashes"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
supabase migration list --linked --output-format json > "$tmp/list.json"
node scripts/migration-history-guard.mjs "$tmp/list.json" --expect plan | tee "$tmp/guard.txt"

pending="$(node -e '
  const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).migrations;
  console.log(rows.filter(r => r.local && !r.remote).map(r => r.local).join(" "));' "$tmp/list.json")"
[ "$pending" = "${EXPECTED[*]}" ] || fail "pending set is '$pending', expected '${EXPECTED[*]}' (other workstreams may have changed Acceptance)"
echo "ok  exactly the expected migrations are pending, all newer than the newest remote version"

echo "--- db push --dry-run (nothing is applied) ---"
supabase db push --linked --dry-run
echo "PREFLIGHT PASS: safe to ask the owner for the apply approval."
