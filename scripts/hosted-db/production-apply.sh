#!/usr/bin/env bash
# APPLIES the pending migrations of ONE named plan to PRODUCTION (kkpkgjrweysgvhvkhzun) ONLY, with every gate before and after.
# Plan: prod-catchup = ALL 27 pending migrations 20261114090001 .. 20261122090002 (plus PC_LATER in acceptance-gate.mjs), 210 -> 237, in ONE plain push (a push always sends every unapplied local migration).
# Plan: prod-marketplace-v2 = the COMBINED plan (owner decision 2026-11-24): the seven Marketplace migrations 20261123090001 .. 20261123160002 plus the seller public slug migration
# 20261124090001 and the stock-notify migration 20261124120001, 237 -> 246, one plain push, on top of Production at 237 (prod-catchup already applied). Recovery: the pinned forward-fixes marketplace-stock-notify-restore-previous.sql, marketplace-slug-remove.sql THEN
# marketplace-v2-remove.sql; needs a restore-verified PRODUCTION snapshot taken at >= 237 migrations; runs the read-only marketplace-v2-smoke.sql, marketplace-slug-smoke.sql and marketplace-stock-notify-smoke.sql before and after the push.
# Plan: prod-marketplace-orders = the 18 Marketplace orders migrations 20261125090001 .. 20261126120002 plus 20261128090001 and 20261128120001, 246 -> 266, one plain push, on top of Production at
# 246 (prod-marketplace-v2 already applied). Recovery: the pinned forward-fixes marketplace-clarity-restore-previous.sql (only if 20261128090001 is applied) THEN marketplace-orders-remove.sql; needs a
# restore-verified PRODUCTION snapshot taken at >= 246 migrations; runs the read-only marketplace-orders-smoke.sql before and after the push and marketplace-clarity-smoke.sql after it.
# See docs/operations/MARKETPLACE_ORDERS_PRODUCTION_PLAN_20261128.md, docs/operations/MARKETPLACE_V2_PRODUCTION_PLAN_20261124.md and docs/operations/PRODUCTION_CATCHUP_PLAN_20261123.md and acceptance-gate.mjs (the plan is marked target "production").
# NOT to be run without the owner's separate explicit GO for Production. Acceptance is refused. Never uses --include-all, repair or reset.
#   bash scripts/hosted-db/production-apply.sh --plan prod-catchup|prod-marketplace-v2|prod-marketplace-orders --sha <full 40-char origin/main sha> --backup-label <aladdin-production-YYYYMMDDTHHMMSSZ>
# Any Production step needs a restore-verified PRODUCTION snapshot taken at 210 migrations or later, pinned in
# PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS (acceptance-gate.mjs) after its restore test passed. Pinned: aladdin-production-20261123T142725Z (restore PASS); this script REFUSES to reach the
# password prompt with any other label. Recovery = three pinned forward-fixes, run in this order: media-notify-remove.sql, marketplace-remove.sql, prod-catchup-restore-previous.sql (sha256-checked; they restore functions, constraints and
# tables only: rows written after the push are recoverable ONLY from the backup).
# Order: checkout gates -> recovery gate -> password (hidden) -> link -> PRE checks (history, dry run, permissions vs the pre contract, table counts,
#        structure, catalog fingerprint) -> typed confirmation -> `supabase db push --linked` -> POST checks (history, permissions vs the post contract,
#        counts, structure, catalog diff: exactly the plan's objects changed). PASS only when every check succeeded.
# If the push fails nothing is retried: stop, read `supabase migration list --linked`, then the forward-fix is an owner decision.
set -euo pipefail
set +x
umask 077
export LC_ALL=C
ACC="nxossqhdfltcqdwvbewi"; PROD="kkpkgjrweysgvhvkhzun"
export GATE_TARGET=production
PLAN=""; SHA=""; LABEL=""
while [ $# -gt 0 ]; do case "$1" in --plan) PLAN="${2:-}"; shift 2;; --sha) SHA="${2:-}"; shift 2;; --backup-label) LABEL="${2:-}"; shift 2;; *) echo "unknown argument $1"; exit 2;; esac; done
[[ "$PLAN" =~ ^(prod-catchup|prod-marketplace-v2|prod-marketplace-orders)$ ]] || { echo "usage: --plan prod-catchup|prod-marketplace-v2|prod-marketplace-orders --sha <40-char sha> --backup-label <aladdin-production-YYYYMMDDTHHMMSSZ>"; exit 2; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: --plan prod-catchup|prod-marketplace-v2|prod-marketplace-orders --sha <40-char sha> --backup-label <label>"; exit 2; }
[[ "$LABEL" =~ ^aladdin-production-[0-9]{8}T[0-9]{6}Z$ ]] || { echo "--backup-label (required) must look like aladdin-production-YYYYMMDDTHHMMSSZ"; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
# Plan facts come from acceptance-gate.mjs (single source): PRE_CONTRACT POST_CONTRACT N_PENDING POST_APPLIED LATEST EXPECT_CHANGED PENDING_VERSIONS
eval "$(node "$HERE/acceptance-gate.mjs" describe "$PLAN")"

OUT=""; STEP="start"; PUSHED=0
cleanup() { rc=$?; [ -n "$OUT" ] && rm -rf "$OUT"; rm -rf supabase/.temp 2>/dev/null || true; unset SUPABASE_DB_PASSWORD 2>/dev/null || true
  if [ "$rc" -ne 0 ]; then
    if [ "$PUSHED" = 1 ]; then echo "FAIL at step '$STEP' (exit $rc) AFTER the push started. Do NOT retry blindly: check 'supabase migration list --linked', then forward-fix (scripts/hosted-db/forward-fix, owner decision)."
    else echo "FAIL at step '$STEP' (exit $rc). The push had NOT started; nothing was changed in any database."; fi
  fi; }
trap cleanup EXIT
sb() { pnpm exec supabase "$@"; }
redact() { node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const p=process.env.SUPABASE_DB_PASSWORD;process.stdout.write(p?b.split(p).join("[REDACTED]"):b)})'; }
run() { STEP="$1"; local o="$2"; shift 3
  if ! "$@" >"$o" 2>"$OUT/err.txt"; then echo "--- error output (redacted) ---" >&2; tail -n 20 "$OUT/err.txt" | redact >&2; case "$o" in *.out) redact <"$o" >&2;; esac; return 1; fi; }

STEP="repo checks"
[ -e .git ] && [ -f supabase/config.toml ] && [ -f scripts/hosted-db/acceptance-gate.mjs ] || { echo "Run from the aladdin repository root."; exit 1; }
git config --get remote.origin.url | grep -q 'hmohamed080/aladdin' || { echo "origin is not hmohamed080/aladdin"; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "REFUSED: HEAD is not $SHA"; exit 1; }
[ "$(git rev-parse origin/main)" = "$SHA" ] || { echo "REFUSED: $SHA is not the current origin/main"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo "REFUSED: working tree is not clean"; exit 1; }
for f in $PENDING_VERSIONS; do ls supabase/migrations/${f}_*.sql >/dev/null; done
[ -f "supabase/permissions/${POST_CONTRACT}.json" ] || { echo "REFUSED: permission contract ${POST_CONTRACT} is not in this checkout"; exit 1; }
echo "checkout OK: exact $SHA = origin/main, clean tree; plan $PLAN ($PENDING_VERSIONS)"
node "$HERE/acceptance-gate.mjs" drift "$PLAN" supabase/migrations   # every migration on this checkout newer than 210 must be in the plan (PC_LATER), else REFUSED
STEP="recovery gate"
node "$HERE/acceptance-gate.mjs" recovery "$PLAN" "${LABEL:-none}" "$HERE"
OUT="$(mktemp -d)"

STEP="password prompt"
read -r -s -p "PRODUCTION ($PROD) database password (hidden): " SUPABASE_DB_PASSWORD; echo
[ -n "$SUPABASE_DB_PASSWORD" ] || { echo "empty password"; exit 1; }
export SUPABASE_DB_PASSWORD
run "link" "$OUT/link.out" -- sb link --project-ref "$PROD"
[ "$(cat supabase/.temp/project-ref)" = "$PROD" ] || { echo "REFUSED: not linked to Production"; exit 1; }
[ "$(cat supabase/.temp/project-ref)" != "$ACC" ] || { echo "REFUSED: linked to Acceptance"; exit 1; }

echo "--- PRE checks (read-only) ---"
run "pre: migration list" "$OUT/list.json" -- sb migration list --linked --output-format json
run "pre: dry run (no --include-all)" "$OUT/dry.json" -- sb db push --linked --dry-run --output-format json
run "pre: acceptance gate" "$OUT/gate.out" -- node scripts/hosted-db/acceptance-gate.mjs "$PLAN" "$OUT/list.json" "$OUT/dry.json" supabase/migrations; cat "$OUT/gate.out"
run "pre: history guard" "$OUT/guard.out" -- node scripts/migration-history-guard.mjs "$OUT/list.json" --expect plan --dry-run "$OUT/dry.json"
run "pre: permissions inventory" "$OUT/perms-pre.json" -- sb db query --linked -o json -f scripts/function-permissions.sql
run "pre: permissions vs $PRE_CONTRACT" "$OUT/perms-pre.out" -- node scripts/hosted-db/verify-permissions-readonly.mjs "$OUT/perms-pre.json" "$PRE_CONTRACT"; cat "$OUT/perms-pre.out"
run "pre: table counts" "$OUT/counts-pre.json" -- sb db query --linked -o json -f scripts/hosted-db/table-counts.sql
run "pre: structure" "$OUT/struct-pre.json" -- sb db query --linked -o json -f scripts/hosted-db/acceptance-structure.sql
run "pre: catalog fingerprint" "$OUT/fp-pre.json" -- sb db query --linked -o json -f scripts/hosted-db/catalog-fingerprint.sql
if [ "$PLAN" = "prod-marketplace-v2" ]; then
  run "pre: marketplace-v2 facts" "$OUT/mv2-pre.json" -- sb db query --linked -o json -f scripts/hosted-db/marketplace-v2-smoke.sql
  run "pre: marketplace-v2 smoke" "$OUT/mv2-pre.out" -- node scripts/hosted-db/marketplace-v2-smoke.mjs facts pre "$OUT/mv2-pre.json"; cat "$OUT/mv2-pre.out"
  run "pre: marketplace-slug facts" "$OUT/slug-pre.json" -- sb db query --linked -o json -f scripts/hosted-db/marketplace-slug-smoke.sql
  run "pre: marketplace-slug smoke" "$OUT/slug-pre.out" -- node scripts/hosted-db/marketplace-slug-smoke.mjs facts pre "$OUT/slug-pre.json" --applied 237 --latest 20261122090002; cat "$OUT/slug-pre.out"
  run "pre: marketplace-stock-notify facts" "$OUT/stock-pre.json" -- sb db query --linked -o json -f scripts/hosted-db/marketplace-stock-notify-smoke.sql
  run "pre: marketplace-stock-notify smoke" "$OUT/stock-pre.out" -- node scripts/hosted-db/marketplace-stock-notify-smoke.mjs facts pre "$OUT/stock-pre.json" --applied 237 --latest 20261122090002 --no-templates; cat "$OUT/stock-pre.out"
fi
if [ "$PLAN" = "prod-marketplace-orders" ]; then
  run "pre: marketplace-orders facts" "$OUT/mo-pre.json" -- sb db query --linked -o json -f scripts/hosted-db/marketplace-orders-smoke.sql
  run "pre: marketplace-orders smoke" "$OUT/mo-pre.out" -- node scripts/hosted-db/marketplace-orders-smoke.mjs facts pre "$OUT/mo-pre.json" --plan "$PLAN"; cat "$OUT/mo-pre.out"
fi
echo "pre-checks passed. Recovery: $RECOVERY${LABEL:+ (restore-verified Production snapshot $LABEL)}"

STEP="confirmation"
echo "About to APPLY $N_PENDING migration(s) [$PENDING_VERSIONS] (plan $PLAN) to PRODUCTION $PROD from $SHA."
read -r -p "Type exactly  APPLY $PLAN TO PRODUCTION  to continue: " CONFIRM
[ "$CONFIRM" = "APPLY $PLAN TO PRODUCTION" ] || { echo "not confirmed: nothing pushed"; exit 1; }

STEP="push"; PUSHED=1
sb db push --linked 2>"$OUT/push.err" | redact || { echo "--- push error (redacted) ---" >&2; tail -n 20 "$OUT/push.err" | redact >&2; exit 1; }

echo "--- POST checks (read-only) ---"
run "post: migration list" "$OUT/list2.json" -- sb migration list --linked --output-format json
run "post: gate" "$OUT/gate2.out" -- node scripts/hosted-db/acceptance-gate.mjs post "$PLAN" "$OUT/list2.json"; cat "$OUT/gate2.out"
run "post: history guard (up to date)" "$OUT/guard2.out" -- node scripts/migration-history-guard.mjs "$OUT/list2.json" --expect up-to-date; cat "$OUT/guard2.out"
run "post: permissions inventory" "$OUT/perms-post.json" -- sb db query --linked -o json -f scripts/function-permissions.sql
run "post: permissions vs $POST_CONTRACT" "$OUT/perms-post.out" -- node scripts/hosted-db/verify-permissions-readonly.mjs "$OUT/perms-post.json" "$POST_CONTRACT"; cat "$OUT/perms-post.out"
run "post: table counts" "$OUT/counts-post.json" -- sb db query --linked -o json -f scripts/hosted-db/table-counts.sql
run "post: structure" "$OUT/struct-post.json" -- sb db query --linked -o json -f scripts/hosted-db/acceptance-structure.sql
run "post: catalog fingerprint" "$OUT/fp-post.json" -- sb db query --linked -o json -f scripts/hosted-db/catalog-fingerprint.sql
run "post: validation" "$OUT/post.out" -- node scripts/hosted-db/acceptance-postcheck.mjs "$PLAN" "$OUT/struct-pre.json" "$OUT/counts-pre.json" "$OUT/struct-post.json" "$OUT/counts-post.json"; cat "$OUT/post.out"
run "post: catalog diff (exactly the plan's functions changed)" "$OUT/diff.out" -- node scripts/hosted-db/catalog-diff.mjs "$OUT/fp-pre.json" "$OUT/fp-post.json" --expect-changed "$EXPECT_CHANGED"; cat "$OUT/diff.out"
if [ "$PLAN" = "prod-marketplace-v2" ]; then
  run "post: marketplace-v2 facts" "$OUT/mv2-post.json" -- sb db query --linked -o json -f scripts/hosted-db/marketplace-v2-smoke.sql
  run "post: marketplace-v2 smoke" "$OUT/mv2-post.out" -- node scripts/hosted-db/marketplace-v2-smoke.mjs facts post "$OUT/mv2-post.json" --applied "$POST_APPLIED" --latest "$LATEST"; cat "$OUT/mv2-post.out"
  run "post: marketplace-slug facts" "$OUT/slug-post.json" -- sb db query --linked -o json -f scripts/hosted-db/marketplace-slug-smoke.sql
  run "post: marketplace-slug smoke" "$OUT/slug-post.out" -- node scripts/hosted-db/marketplace-slug-smoke.mjs facts post "$OUT/slug-post.json" --applied "$POST_APPLIED" --latest "$LATEST"; cat "$OUT/slug-post.out"
  run "post: marketplace-stock-notify facts" "$OUT/stock-post.json" -- sb db query --linked -o json -f scripts/hosted-db/marketplace-stock-notify-smoke.sql
  run "post: marketplace-stock-notify smoke" "$OUT/stock-post.out" -- node scripts/hosted-db/marketplace-stock-notify-smoke.mjs facts post "$OUT/stock-post.json" --applied "$POST_APPLIED" --latest "$LATEST"; cat "$OUT/stock-post.out"
  echo "NEXT (owner): deploy the matching frontend to aladdin-frontend-production (upload-only, 10% then 100% by hand), then: SMOKE_TARGET=production node scripts/hosted-db/marketplace-v2-smoke.mjs http  (docs/operations/MARKETPLACE_V2_PRODUCTION_PLAN_20261124.md)"
fi
if [ "$PLAN" = "prod-marketplace-orders" ]; then
  run "post: marketplace-orders facts" "$OUT/mo-post.json" -- sb db query --linked -o json -f scripts/hosted-db/marketplace-orders-smoke.sql
  run "post: marketplace-orders smoke" "$OUT/mo-post.out" -- node scripts/hosted-db/marketplace-orders-smoke.mjs facts post "$OUT/mo-post.json" --plan "$PLAN"; cat "$OUT/mo-post.out"
  run "post: marketplace-clarity facts" "$OUT/mc-post.json" -- sb db query --linked -o json -f scripts/hosted-db/marketplace-clarity-smoke.sql
  run "post: marketplace-clarity smoke" "$OUT/mc-post.out" -- node scripts/hosted-db/marketplace-clarity-smoke.mjs facts post "$OUT/mc-post.json" --plan "$PLAN"; cat "$OUT/mc-post.out"
  echo "NEXT (owner): deploy the matching frontend (same commit, flags as decided) upload-only, then 10% and 100% by hand  (docs/operations/MARKETPLACE_ORDERS_PRODUCTION_PLAN_20261128.md)"
fi
STEP="done"; PUSHED=0
echo "PASS: plan $PLAN applied to Production $PROD; history $POST_APPLIED, permissions match $POST_CONTRACT, catalog diff limited to the plan's functions, media/storage counts verified."
