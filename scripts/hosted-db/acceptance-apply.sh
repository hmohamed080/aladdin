#!/usr/bin/env bash
# APPLIES the pending migrations of ONE named plan to ACCEPTANCE (nxossqhdfltcqdwvbewi) ONLY, with every gate before and after.
# Re-pinned 2026-11-11 to the actual Acceptance history (207 applied, latest 20261107090006). Plans: see acceptance-gate.mjs.
#   media      apply 20261110090001 only (Track C media ids-only keys)          207 -> 208
#   m1         apply 20261110090002 only (P1 M1); media must already be applied 208 -> 209
#   media+m1   apply both, in order, one plain push                             207 -> 209
# NOT to be run without the owner's separate explicit GO. Production is refused. Never uses --include-all, repair or reset.
#   bash scripts/hosted-db/acceptance-apply.sh --plan <plan> --sha <full 40-char origin/main sha> --backup-label <snapshot label>
# Order: checkout gates -> password (hidden) -> link -> PRE checks (history, dry run, permissions vs the plan's pre contract,
#        table counts, structure, catalog fingerprint) -> typed confirmation -> `supabase db push --linked` -> POST checks
#        (history, permissions vs the plan's post contract, structure, counts, catalog fingerprint: exactly the plan's
#        functions changed and nothing else). PASS is printed only when every check succeeded.
# If the push itself fails: nothing is retried. Each migration file is its own transaction, so history stops at the first
# failing file; the script prints the state it can read and stops. Recovery = forward-fix or restore the named snapshot.
set -euo pipefail
set +x
umask 077
export LC_ALL=C
ACC="nxossqhdfltcqdwvbewi"; PROD="kkpkgjrweysgvhvkhzun"
PLAN=""; SHA=""; LABEL=""
while [ $# -gt 0 ]; do case "$1" in --plan) PLAN="${2:-}"; shift 2;; --sha) SHA="${2:-}"; shift 2;; --backup-label) LABEL="${2:-}"; shift 2;; *) echo "unknown argument $1"; exit 2;; esac; done
[[ "$PLAN" =~ ^(media|m1|media\+m1)$ ]] || { echo "usage: --plan media|m1|media+m1 --sha <40-char sha> --backup-label <label>"; exit 2; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: --plan <plan> --sha <40-char sha> --backup-label <label>"; exit 2; }
[[ "$LABEL" =~ ^aladdin-acceptance-[0-9]{8}T[0-9]{6}Z$ ]] || { echo "--backup-label must look like aladdin-acceptance-YYYYMMDDTHHMMSSZ"; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
# Plan facts come from acceptance-gate.mjs (single source): PRE_CONTRACT POST_CONTRACT N_PENDING POST_APPLIED LATEST EXPECT_CHANGED PENDING_VERSIONS
eval "$(node "$HERE/acceptance-gate.mjs" describe "$PLAN")"

OUT=""; STEP="start"; PUSHED=0
cleanup() { rc=$?; [ -n "$OUT" ] && rm -rf "$OUT"; rm -rf supabase/.temp 2>/dev/null || true; unset SUPABASE_DB_PASSWORD 2>/dev/null || true
  if [ "$rc" -ne 0 ]; then
    if [ "$PUSHED" = 1 ]; then echo "FAIL at step '$STEP' (exit $rc) AFTER the push started. Do NOT retry blindly: check 'supabase migration list --linked', then forward-fix or restore snapshot $LABEL (owner decision)."
    else echo "FAIL at step '$STEP' (exit $rc). The push had NOT started; nothing was changed in any database."; fi
  fi; }
trap cleanup EXIT
sb() { pnpm exec supabase "$@"; }
redact() { node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const p=process.env.SUPABASE_DB_PASSWORD;process.stdout.write(p?b.split(p).join("[REDACTED]"):b)})'; }
run() { STEP="$1"; local o="$2"; shift 3
  if ! "$@" >"$o" 2>"$OUT/err.txt"; then echo "--- error output (redacted) ---" >&2; tail -n 20 "$OUT/err.txt" | redact >&2; case "$o" in *.out) redact <"$o" >&2;; esac; return 1; fi; }

STEP="repo checks"
[ -d .git ] && [ -f supabase/config.toml ] && [ -f scripts/hosted-db/acceptance-gate.mjs ] || { echo "Run from the aladdin repository root."; exit 1; }
git config --get remote.origin.url | grep -q 'hmohamed080/aladdin' || { echo "origin is not hmohamed080/aladdin"; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "REFUSED: HEAD is not $SHA"; exit 1; }
[ "$(git rev-parse origin/main)" = "$SHA" ] || { echo "REFUSED: $SHA is not the current origin/main"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo "REFUSED: working tree is not clean"; exit 1; }
for f in $PENDING_VERSIONS; do ls supabase/migrations/${f}_*.sql >/dev/null; done
[ -f "supabase/permissions/${POST_CONTRACT}.json" ] || { echo "REFUSED: permission contract ${POST_CONTRACT} is not in this checkout"; exit 1; }
echo "checkout OK: exact $SHA = origin/main, clean tree; plan $PLAN ($PENDING_VERSIONS)"
OUT="$(mktemp -d)"

STEP="password prompt"
read -r -s -p "Acceptance ($ACC) database password (hidden): " SUPABASE_DB_PASSWORD; echo
[ -n "$SUPABASE_DB_PASSWORD" ] || { echo "empty password"; exit 1; }
export SUPABASE_DB_PASSWORD
run "link" "$OUT/link.out" -- sb link --project-ref "$ACC"
[ "$(cat supabase/.temp/project-ref)" = "$ACC" ] || { echo "REFUSED: not linked to Acceptance"; exit 1; }
[ "$(cat supabase/.temp/project-ref)" != "$PROD" ] || { echo "REFUSED: linked to Production"; exit 1; }

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
echo "pre-checks passed. Backup snapshot named for this change: $LABEL"

STEP="confirmation"
echo "About to APPLY $N_PENDING migration(s) [$PENDING_VERSIONS] (plan $PLAN) to ACCEPTANCE $ACC from $SHA."
read -r -p "Type exactly  APPLY $PLAN TO ACCEPTANCE  to continue: " CONFIRM
[ "$CONFIRM" = "APPLY $PLAN TO ACCEPTANCE" ] || { echo "not confirmed: nothing pushed"; exit 1; }

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
STEP="done"; PUSHED=0
echo "PASS: plan $PLAN applied to Acceptance $ACC; history $POST_APPLIED, permissions match $POST_CONTRACT, catalog diff limited to the plan's functions, media/storage counts verified."
