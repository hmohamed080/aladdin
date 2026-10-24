#!/usr/bin/env bash
# Restore aladdin-r2-acceptance (nxossqhdfltcqdwvbewi) from a backup made by rebuild-acceptance.sh.
# Usage: bash restore-acceptance.sh ~/aladdin-acceptance-backup-YYYYMMDD-HHMMSS
# Run from a checkout of the aladdin repo (for `pnpm exec supabase`), with Docker running.
# It asks for the acceptance Session pooler connection string (hidden input; Supabase dashboard →
# Connect → Session pooler, with your password filled in). Nothing is written to disk but the result files.
set -euo pipefail
REF="nxossqhdfltcqdwvbewi"; FORBIDDEN="kkpkgjrweysgvhvkhzun"
BK="$(cd "${1:?backup directory}" && pwd)"
sb() { pnpm exec supabase "$@"; }
rows() { node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const j=JSON.parse(b),r=Array.isArray(j)?j:j.rows;if(!Array.isArray(r)){console.error("query failed: "+b.slice(0,400));process.exit(1)}process.stdout.write(r.map(x=>'"$1"').join("\n")+"\n")})'; }

( cd "$BK" && shasum -a 256 -c SHA256SUMS --quiet ) || { echo "backup checksum mismatch: stopping"; exit 1; }
read -r -s -p "Session pooler URI for aladdin-r2-acceptance (input hidden): " DB_URL; echo
case "$DB_URL" in *"$FORBIDDEN"*) echo "refusing: that is not acceptance"; exit 1;; *"postgres.$REF"*) ;; *) echo "URI is not for $REF: stopping"; exit 1;; esac
read -r -s -p "Database password again (for the CLI, hidden): " SUPABASE_DB_PASSWORD; echo; export SUPABASE_DB_PASSWORD

# 1. Empty the app schemas: reset with an empty migrations folder (the CLI asks you to confirm).
EMPTY="$(mktemp -d)"; mkdir -p "$EMPTY/supabase/migrations"; cp supabase/config.toml "$EMPTY/supabase/"
sb link --workdir "$EMPTY" --project-ref "$REF" >/dev/null
[ "$(cat "$EMPTY/supabase/.temp/project-ref")" = "$REF" ] || { echo "not linked to $REF: stopping"; exit 1; }
sb db reset --workdir "$EMPTY" --linked --no-seed

# 2. Restore in one transaction: roles, schema, migration history table, data (triggers off), then the security tail.
cat > "$BK/.migrations-schema.sql" <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
create table if not exists supabase_migrations.seed_files (path text primary key, hash text not null);
SQL
docker run --rm -i -e DB_URL="$DB_URL" -v "$BK":/bk:ro postgres:17 sh -c 'psql "$DB_URL" -q --single-transaction -v ON_ERROR_STOP=1 \
  -f /bk/roles.sql -f /bk/schema.sql -f /bk/.migrations-schema.sql -c "SET session_replication_role = replica" \
  -f /bk/data.sql -c "SET session_replication_role = origin" -f /bk/security-tail.out.sql'

# 3. Verify against what the backup recorded before the rebuild.
( sb db query --workdir "$EMPTY" --linked -f "$BK/schema-fingerprint.sql" --output-format json 2>/dev/null | rows '`${x.k}|${x.h}|${x.len}`' ) > "$BK/fingerprint-restored.txt"
( sb db query --workdir "$EMPTY" --linked -f "$BK/rowcounts.sql" --output-format json 2>/dev/null | rows 'x.t' ) > "$BK/rowcounts-restored.txt"
OK=1
if diff "$BK/fingerprint-before.txt" "$BK/fingerprint-restored.txt"; then echo "Schema fingerprint matches the backup."; else echo "FAILED: schema fingerprint differs from the backup."; OK=0; fi
if diff "$BK/rowcounts-before.txt" "$BK/rowcounts-restored.txt"; then echo "Row counts match the backup."; else echo "FAILED: row counts differ from the backup."; OK=0; fi
[ "$OK" = 1 ] || { echo "The restore is NOT verified. Tell Claude in the thread."; exit 1; }
