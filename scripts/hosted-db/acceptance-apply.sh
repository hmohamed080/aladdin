#!/usr/bin/env bash
# APPLIES 20261107090003..090006 to ACCEPTANCE (nxossqhdfltcqdwvbewi) ONLY, with every gate before and after.
# NOT to be run without the owner's separate explicit GO. Production is refused. Never uses --include-all, repair or reset.
#   bash scripts/hosted-db/acceptance-apply.sh --sha <full 40-char origin/main sha> --backup-label <snapshot label>
# Order: checkout gates -> password (hidden) -> link -> PRE checks (history, dry run, permissions vs 20261107090002,
#        table counts, structure) -> typed confirmation -> `supabase db push --linked` -> POST checks (history 207,
#        permissions vs 20261107090006, structure, counts). PASS is printed only when every check succeeded.
# If the push itself fails: nothing is retried. Each migration file is its own transaction, so history stops at the first
# failing file; the script prints the state it can read and stops. Recovery = forward-fix or restore the named snapshot.
set -euo pipefail
set +x
umask 077
export LC_ALL=C
ACC="nxossqhdfltcqdwvbewi"; PROD="kkpkgjrweysgvhvkhzun"
PRE_CONTRACT="20261107090002"; POST_CONTRACT="20261107090006"
SHA=""; LABEL=""
while [ $# -gt 0 ]; do case "$1" in --sha) SHA="${2:-}"; shift 2;; --backup-label) LABEL="${2:-}"; shift 2;; *) echo "unknown argument $1"; exit 2;; esac; done
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: --sha <40-char sha> --backup-label <label>"; exit 2; }
[[ "$LABEL" =~ ^aladdin-acceptance-[0-9]{8}T[0-9]{6}Z$ ]] || { echo "--backup-label must look like aladdin-acceptance-YYYYMMDDTHHMMSSZ"; exit 2; }

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
for f in 20261107090003 20261107090004 20261107090005 20261107090006; do ls supabase/migrations/${f}_*.sql >/dev/null; done
echo "checkout OK: exact $SHA = origin/main, clean tree"
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
run "pre: acceptance gate" "$OUT/gate.out" -- node scripts/hosted-db/acceptance-gate.mjs "$OUT/list.json" "$OUT/dry.json" supabase/migrations; cat "$OUT/gate.out"
run "pre: history guard" "$OUT/guard.out" -- node scripts/migration-history-guard.mjs "$OUT/list.json" --expect plan --dry-run "$OUT/dry.json"
run "pre: permissions inventory" "$OUT/perms-pre.json" -- sb db query --linked -o json -f scripts/function-permissions.sql
run "pre: permissions vs $PRE_CONTRACT" "$OUT/perms-pre.out" -- node scripts/hosted-db/verify-permissions-readonly.mjs "$OUT/perms-pre.json" "$PRE_CONTRACT"; cat "$OUT/perms-pre.out"
run "pre: table counts" "$OUT/counts-pre.json" -- sb db query --linked -o json -f scripts/hosted-db/table-counts.sql
run "pre: structure" "$OUT/struct-pre.json" -- sb db query --linked -o json -f scripts/hosted-db/acceptance-structure.sql
echo "pre-checks passed. Backup snapshot named for this change: $LABEL"

STEP="confirmation"
echo "About to APPLY 4 migrations (20261107090003..090006) to ACCEPTANCE $ACC from $SHA."
read -r -p "Type exactly  APPLY 4 MIGRATIONS TO ACCEPTANCE  to continue: " CONFIRM
[ "$CONFIRM" = "APPLY 4 MIGRATIONS TO ACCEPTANCE" ] || { echo "not confirmed: nothing pushed"; exit 1; }

STEP="push"; PUSHED=1
sb db push --linked 2>"$OUT/push.err" | redact || { echo "--- push error (redacted) ---" >&2; tail -n 20 "$OUT/push.err" | redact >&2; exit 1; }

echo "--- POST checks (read-only) ---"
run "post: migration list" "$OUT/list2.json" -- sb migration list --linked --output-format json
run "post: gate" "$OUT/gate2.out" -- node scripts/hosted-db/acceptance-gate.mjs post "$OUT/list2.json"; cat "$OUT/gate2.out"
run "post: history guard (up to date)" "$OUT/guard2.out" -- node scripts/migration-history-guard.mjs "$OUT/list2.json" --expect up-to-date; cat "$OUT/guard2.out"
run "post: permissions inventory" "$OUT/perms-post.json" -- sb db query --linked -o json -f scripts/function-permissions.sql
run "post: permissions vs $POST_CONTRACT" "$OUT/perms-post.out" -- node scripts/hosted-db/verify-permissions-readonly.mjs "$OUT/perms-post.json" "$POST_CONTRACT"; cat "$OUT/perms-post.out"
run "post: table counts" "$OUT/counts-post.json" -- sb db query --linked -o json -f scripts/hosted-db/table-counts.sql
run "post: structure" "$OUT/struct-post.json" -- sb db query --linked -o json -f scripts/hosted-db/acceptance-structure.sql
run "post: validation" "$OUT/post.out" -- node scripts/hosted-db/acceptance-postcheck.mjs "$OUT/struct-pre.json" "$OUT/counts-pre.json" "$OUT/struct-post.json" "$OUT/counts-post.json"; cat "$OUT/post.out"
STEP="done"; PUSHED=0
echo "PASS: 4 migrations applied to Acceptance $ACC; history 207, permissions match $POST_CONTRACT, structure and media/storage counts verified."
