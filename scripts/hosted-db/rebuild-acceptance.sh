#!/usr/bin/env bash
# Rebuild the Supabase ACCEPTANCE database (nxossqhdfltcqdwvbewi) from the consolidated migration baseline.
# Run on your own machine from a checkout of the aladdin repo. Needs: git, pnpm, node, Docker running,
# and `pnpm exec supabase login` done once. The database password is read silently into this
# process only; it is never echoed, written to disk, or sent anywhere except Supabase.
#
#   bash rebuild-acceptance.sh            backup + check the backup, then stop (no changes)
#   bash rebuild-acceptance.sh --rebuild  the same, then reset acceptance and replay the baseline
set -euo pipefail

REF="nxossqhdfltcqdwvbewi"                                 # aladdin-r2-acceptance ONLY
FORBIDDEN="kkpkgjrweysgvhvkhzun"                           # staging / live data: never
BRANCH="claude/project-thread-lz98jd"
SHA="c7d34c648639f4f5a3ecd74b31f8067c829a8674"             # consolidated baseline, tested locally
MANIFEST="5a26a710d5f54cb0a4eeed5435c93bf873a44517a202afd8af214b1036277e37"  # sha256 of `shasum -a 256 *.sql`
HERE="$(cd "$(dirname "$0")" && pwd)"
BACKUP="${HOME}/aladdin-acceptance-backup-$(date +%Y%m%d-%H%M%S)"
MODE="${1:-}"
sb() { pnpm exec supabase "$@"; }
rows() { node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const j=JSON.parse(b),r=Array.isArray(j)?j:j.rows;if(!Array.isArray(r)){console.error("query failed: "+b.slice(0,400));process.exit(1)}process.stdout.write(r.map(x=>'"$1"').join("\n")+"\n")})'; }
fp() { sb db query --linked -f "$HERE/schema-fingerprint.sql" --output-format json 2>/dev/null | rows '`${x.k}|${x.h}|${x.len}`'; }

[ "$REF" != "$FORBIDDEN" ] || { echo "refusing: forbidden ref"; exit 1; }
for f in schema-fingerprint.sql security-tail.sql rowcounts.sql local-noseed-fingerprint.txt restore-acceptance.sh; do
  [ -s "$HERE/$f" ] || { echo "missing $HERE/$f"; exit 1; }
done

# Separate worktree, so your current checkout and uncommitted work are untouched.
git fetch -q origin "$BRANCH"
WT="$(mktemp -d)/aladdin-acceptance"
git -c core.autocrlf=false -c core.eol=lf worktree add -q --detach "$WT" "$SHA"
cd "$WT"
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "wrong commit"; exit 1; }
[ "$(cd supabase/migrations && shasum -a 256 *.sql | tr -d '\r' | sed 's/ \*/  /' | shasum -a 256 | cut -d' ' -f1)" = "$MANIFEST" ] \
  || { echo "migration files differ from the tested baseline: stopping"; exit 1; }
COUNT="$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')"
echo "Baseline $SHA: $COUNT migrations."
pnpm install --frozen-lockfile >/dev/null

read -r -s -p "Database password for aladdin-r2-acceptance (input hidden): " SUPABASE_DB_PASSWORD; echo
export SUPABASE_DB_PASSWORD

sb link --project-ref "$REF" >/dev/null
LINKED="$(cat supabase/.temp/project-ref)"
[ "$LINKED" = "$REF" ] || { echo "linked to $LINKED, not $REF: stopping"; exit 1; }
echo "Linked to $LINKED (acceptance)."

# 1. Backup, kept outside the repo, readable only by you.
#    `db dump` alone is NOT a complete restore: it drops the storage.objects media policies, the
#    auth.users trigger and the media_edge membership, and leaves anon/authenticated with platform
#    default privileges. security-tail.sql captures exactly those; restore-acceptance.sh applies it.
umask 077; mkdir -p "$BACKUP"
sb db dump --linked --role-only -f "$BACKUP/roles.sql"
sb db dump --linked -f "$BACKUP/schema.sql"
sb db dump --linked --data-only --use-copy -s public,app,auth,storage,supabase_migrations \
  -x storage.buckets_vectors -x storage.vector_indexes -x storage.iceberg_namespaces \
  -x storage.iceberg_tables -x storage.buckets_analytics -f "$BACKUP/data.sql"
sb db query --linked -f "$HERE/security-tail.sql" --output-format json 2>/dev/null | rows 'x.s' > "$BACKUP/security-tail.out.sql"
fp > "$BACKUP/fingerprint-before.txt"
sb db query --linked -f "$HERE/rowcounts.sql" --output-format json 2>/dev/null | rows 'x.t' > "$BACKUP/rowcounts-before.txt"
sb migration list --linked > "$BACKUP/migration-list-before.txt"
cp "$HERE/restore-acceptance.sh" "$HERE/schema-fingerprint.sql" "$HERE/rowcounts.sql" "$BACKUP/"
for f in roles.sql schema.sql data.sql security-tail.out.sql fingerprint-before.txt rowcounts-before.txt; do
  [ -s "$BACKUP/$f" ] || { echo "backup $f is empty: stopping"; exit 1; }
done
grep -q "media_storage_locations" "$BACKUP/schema.sql" || { echo "schema backup looks incomplete: stopping"; exit 1; }
grep -q "^grant " "$BACKUP/security-tail.out.sql" || { echo "security tail looks incomplete: stopping"; exit 1; }
( cd "$BACKUP" && shasum -a 256 * > SHA256SUMS )
echo "Backup written to $BACKUP"

if [ "$MODE" != "--rebuild" ]; then
  echo "Backup only, nothing changed. Re-run with --rebuild once the reset is approved."
  exit 0
fi

# 2. Rebuild: drop app objects on the linked (acceptance) project and replay the baseline. No seed data.
echo "About to reset $LINKED and replay $COUNT migrations. The CLI will ask you to confirm."
sb db reset --linked --no-seed

# 3. Verify: migration history and schema fingerprint against the tested local replay.
sb migration list --linked | tee "$BACKUP/migration-list-after.txt" | tail -3
fp > "$BACKUP/fingerprint-after.txt"
if diff "$HERE/local-noseed-fingerprint.txt" "$BACKUP/fingerprint-after.txt"; then
  echo "Schema fingerprint MATCHES the locally tested baseline."
else
  echo "Schema fingerprint DIFFERS from the tested baseline (categories above). Tell Claude before using acceptance."
fi
echo "Done. Tell Claude in the thread; it re-checks through the Supabase connection."
echo "If anything is wrong: bash $BACKUP/restore-acceptance.sh $BACKUP"
echo "Afterwards you can remove the temporary checkout with: git worktree remove $WT"
