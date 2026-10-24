#!/usr/bin/env bash
# READ-ONLY on Production. Backs up Production (kkpkgjrweysgvhvkhzun), restores the backup into a
# throwaway local Supabase stack on THIS machine, applies the pending baseline migrations there, and
# writes a report of counts and hashes only (no row data) that you can share.
# Production is only read (pg_dump and SELECT); this script contains no push, reset or write to it.
#
# Run from a checkout of the aladdin repo. Needs git, pnpm, node, Docker running, `pnpm exec supabase login`.
#   bash production-rehearsal.sh
# Test mode (Claude, local only): REHEARSAL_SOURCE_DB_URL=postgresql://...@127.0.0.1:PORT/postgres
set -euo pipefail
export LC_ALL=C

PROD="kkpkgjrweysgvhvkhzun"
BRANCH="claude/project-thread-lz98jd"
SHA="e27358c1c27a2697ebe71fb55f8c5e335076d55e"
MANIFEST="76353b2d7555f6b1b124c58e31a005c21efaa4a40668d2edfe71e0d9584ed183"
HERE="$(cd "$(dirname "$0")" && pwd)"; KIT="${KIT:-$HERE}"; [ -s "$KIT/security-tail.sql" ] || KIT="$HERE/../acceptance-rebuild"
OUT="${HOME}/aladdin-production-rehearsal-$(date +%Y%m%d-%H%M%S)"
sb() { pnpm exec supabase "$@"; }
rows() { node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const j=JSON.parse(b),r=Array.isArray(j)?j:j.rows;if(!Array.isArray(r)){console.error("query failed: "+b.slice(0,400));process.exit(1)}process.stdout.write(r.map(x=>'"$1"').join("\n")+"\n")})'; }
for f in schema-fingerprint.sql security-tail.sql rowcounts.sql local-noseed-fingerprint.txt; do [ -s "$KIT/$f" ] || { echo "missing $KIT/$f"; exit 1; }; done

if [ -n "${REHEARSAL_SOURCE_DB_URL:-}" ]; then
  case "$REHEARSAL_SOURCE_DB_URL" in *@127.0.0.1:*) ;; *) echo "test mode only accepts a local database"; exit 1;; esac
  SRC=(--db-url "$REHEARSAL_SOURCE_DB_URL"); WT="$(pwd)"
else
  git fetch -q origin "$BRANCH"
  WT="$(mktemp -d)/aladdin-rehearsal"; git -c core.autocrlf=false -c core.eol=lf worktree add -q --detach "$WT" "$SHA"; cd "$WT"
  [ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "wrong commit"; exit 1; }
  pnpm install --frozen-lockfile >/dev/null
  read -r -s -p "Production database password (input hidden; only read access is used): " SUPABASE_DB_PASSWORD; echo
  export SUPABASE_DB_PASSWORD
  sb link --project-ref "$PROD" >/dev/null
  [ "$(cat supabase/.temp/project-ref)" = "$PROD" ] || { echo "not linked to Production: stopping"; exit 1; }
  SRC=(--linked)
fi
[ "$(cd supabase/migrations && shasum -a 256 *.sql | tr -d '\r' | sed 's/ \*/  /' | shasum -a 256 | cut -d' ' -f1)" = "$MANIFEST" ] \
  || { echo "migration files differ from the tested baseline: stopping"; exit 1; }

# 1. Backup Production (read-only), owner-only permissions.
umask 077; mkdir -p "$OUT/backup"; B="$OUT/backup"
sb db dump "${SRC[@]}" --role-only -f "$B/roles.sql"
sb db dump "${SRC[@]}" -f "$B/schema.sql"
sb db dump "${SRC[@]}" --data-only --use-copy -s public,app,auth,storage,supabase_migrations \
  -x storage.buckets_vectors -x storage.vector_indexes -x storage.iceberg_namespaces \
  -x storage.iceberg_tables -x storage.buckets_analytics -f "$B/data.sql"
q() { sb db query "${SRC[@]}" -f "$1" --output-format json 2>/dev/null; }
q "$KIT/security-tail.sql" | rows 'x.s' > "$B/security-tail.out.sql"
q "$KIT/schema-fingerprint.sql" | rows '`${x.k}|${x.h}|${x.len}`' > "$OUT/fingerprint-production.txt"
q "$KIT/rowcounts.sql" | rows 'x.t' > "$OUT/rowcounts-production.txt"
echo "select version from supabase_migrations.schema_migrations order by 1;" > "$OUT/.v.sql"
q "$OUT/.v.sql" | rows 'x.version' > "$OUT/history-production.txt"
for f in roles.sql schema.sql data.sql security-tail.out.sql; do [ -s "$B/$f" ] || { echo "backup $f is empty: stopping"; exit 1; }; done
( cd "$B" && shasum -a 256 * > SHA256SUMS )
[ -n "${REHEARSAL_SOURCE_DB_URL:-}" ] || rm -rf supabase/.temp      # unlink: nothing below can reach Production
echo "Production backup: $B"

# 2. What a push would apply. Unknown versions on Production stop the rehearsal: they need review first.
ls supabase/migrations/*.sql | xargs -n1 basename | cut -c1-14 | sort > "$OUT/history-files.txt"
comm -13 "$OUT/history-files.txt" "$OUT/history-production.txt" > "$OUT/only-on-production.txt"
comm -23 "$OUT/history-files.txt" "$OUT/history-production.txt" > "$OUT/pending.txt"
echo "Pending: $(wc -l < "$OUT/pending.txt") migrations. Only on Production: $(wc -l < "$OUT/only-on-production.txt")."
[ ! -s "$OUT/only-on-production.txt" ] || { echo "Production has versions the baseline lacks (see only-on-production.txt): stopping"; exit 1; }
[ -s "$OUT/pending.txt" ] || { echo "Nothing to apply: Production already has the whole baseline."; exit 0; }
[ "$(tail -1 "$OUT/history-production.txt")" \< "$(head -1 "$OUT/pending.txt")" ] \
  || { echo "a pending migration sorts before Production's latest version (see pending.txt): stopping"; exit 1; }

# 3. Restore into a throwaway local stack and prove the restore is exact.
R="$OUT/stack"; mkdir -p "$R/supabase/migrations"; cp -r supabase/templates "$R/supabase/"
sed 's/project_id = "aladdin"/project_id = "aladdin_prod_rehearsal"/; s/543\([0-9][0-9]\)/644\1/g; s/^sql_paths = .*/sql_paths = []/' supabase/config.toml > "$R/supabase/config.toml"
C="supabase_db_aladdin_prod_rehearsal"
[ -n "${REHEARSAL_KEEP:-}" ] || trap 'sb stop --workdir "$R" --no-backup >/dev/null 2>&1 || true' EXIT
sb start --workdir "$R" -x edge-runtime,logflare,vector,studio,supavisor,imgproxy,realtime,mailpit,postgres-meta >/dev/null
cat > "$B/.migrations-schema.sql" <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
create table if not exists supabase_migrations.seed_files (path text primary key, hash text not null);
SQL
docker cp "$B" "$C:/tmp/bk"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$C" psql -U postgres -d postgres -q --single-transaction -v ON_ERROR_STOP=1 \
  -f /tmp/bk/roles.sql -f /tmp/bk/schema.sql -f /tmp/bk/.migrations-schema.sql -c 'SET session_replication_role = replica' \
  -f /tmp/bk/data.sql -c 'SET session_replication_role = origin' -f /tmp/bk/security-tail.out.sql >/dev/null
lq() { docker exec -i "$C" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 < "$1"; }
lq "$KIT/schema-fingerprint.sql" > "$OUT/fingerprint-restored.txt"
lq "$KIT/rowcounts.sql" > "$OUT/rowcounts-restored.txt"
RESTORE="exact"
diff -q "$OUT/fingerprint-production.txt" "$OUT/fingerprint-restored.txt" >/dev/null || RESTORE="SCHEMA DIFFERS"
diff -q "$OUT/rowcounts-production.txt" "$OUT/rowcounts-restored.txt" >/dev/null || RESTORE="$RESTORE; ROW COUNTS DIFFER"

# 4. Apply exactly what `db push` would apply, the same way (one file at a time, recorded in history).
cp supabase/migrations/*.sql "$R/supabase/migrations/"
set +e; sb migration up --workdir "$R" --local > "$OUT/migration-up.log" 2>&1; UP=$?; set -e
lq "$KIT/schema-fingerprint.sql" > "$OUT/fingerprint-after.txt"
lq "$KIT/rowcounts.sql" > "$OUT/rowcounts-after.txt"

# 5. Report: counts and hashes only.
SCHEMA=same
{
  echo "Production rehearsal $(date -u +%FT%TZ), baseline $SHA"
  echo "Production history: $(wc -l < "$OUT/history-production.txt") versions; pending: $(wc -l < "$OUT/pending.txt")"
  echo "Restore of the backup: $RESTORE"
  echo "migration up exit code: $UP (log: migration-up.log)"
  if diff -q <(grep -v '^seeded_rowcounts|' "$KIT/local-noseed-fingerprint.txt") <(grep -v '^seeded_rowcounts|' "$OUT/fingerprint-after.txt") >/dev/null
  then echo "Schema after the push equals the tested baseline."
  else SCHEMA=differs; echo "Schema after the push differs from the tested baseline in:"; diff <(sort "$KIT/local-noseed-fingerprint.txt") <(sort "$OUT/fingerprint-after.txt") | grep '^>' | cut -d'|' -f1; fi
  echo "Tables whose row count changed (table: before -> after):"
  join -t'|' <(sed 's/:\([0-9]*\)$/|\1/' "$OUT/rowcounts-restored.txt" | sort -t'|' -k1,1) <(sed 's/:\([0-9]*\)$/|\1/' "$OUT/rowcounts-after.txt" | sort -t'|' -k1,1) \
    | awk -F'|' '$2!=$3 {print "  "$1": "$2" -> "$3}'
  echo "Tables that disappeared:"; comm -23 <(cut -d: -f1 "$OUT/rowcounts-restored.txt" | sort) <(cut -d: -f1 "$OUT/rowcounts-after.txt" | sort) | sed 's/^/  /'
} > "$OUT/REPORT.txt"
cat "$OUT/REPORT.txt"
echo "Share $OUT/REPORT.txt with Claude (it has no row data). Keep $B private; it holds Production data."
if [ "$RESTORE" != exact ] || [ "$UP" != 0 ] || [ "$SCHEMA" != same ]; then
  echo "REHEARSAL FAILED: restore=$RESTORE, migration up exit=$UP, schema=$SCHEMA. Production push is NO-GO."
  exit 1
fi
echo "Rehearsal passed: restore exact, migrations applied, schema equals the tested baseline."
