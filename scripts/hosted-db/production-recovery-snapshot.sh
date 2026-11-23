#!/usr/bin/env bash
# READ-ONLY on Production. A fresh, quick recovery snapshot for the minutes before an approved `db push` (P-2).
# It is the backup half of production-rehearsal.sh (same `supabase db dump` commands and the same folder layout, so
# encrypt-backup.sh and restore-acceptance.sh work on it unchanged) WITHOUT the local restore rehearsal: the restore
# procedure was already proven by the rehearsal, this only takes a new copy, validates it and records what it contains.
# Production is only read (pg_dump and read-only SELECTs); this script has no push, reset or write against it.
#   bash scripts/hosted-db/production-recovery-snapshot.sh
#   bash scripts/hosted-db/encrypt-backup.sh ~/aladdin-production-snapshot-<stamp>      # then keep the passphrase safe
# The database password is read at a hidden prompt, never echoed, never written to disk. The snapshot folder is
# created with owner-only permissions and its backup/ files are made read-only after their checksums are taken.
# P-2 is only started through production-p2-push.sh, which refuses unless snapshot-meta.txt shows project=Production,
# history 203 / 20261107090003, row_counts_validated, taken_utc at most 60 minutes old, and the encrypted copy has passed
# encrypt-backup.sh's recovery check. This script prints its own verdict too.
# Test mode (local only): SNAPSHOT_DB_URL=postgresql://...@127.0.0.1:PORT/postgres
set -euo pipefail
export LC_ALL=C
PROD="kkpkgjrweysgvhvkhzun"; EXPECT_COUNT=207; EXPECT_LATEST="20261107090006"
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE/../.."
KIT="$HERE"
sb() { pnpm exec supabase "$@"; }
rows() { node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const j=JSON.parse(b),r=Array.isArray(j)?j:j.rows;if(!Array.isArray(r)){console.error("query failed: "+b.slice(0,400));process.exit(1)}process.stdout.write(r.map(x=>'"$1"').join("\n")+"\n")})'; }
for f in security-tail.sql schema-fingerprint.sql rowcounts.sql; do [ -s "$KIT/$f" ] || { echo "missing $KIT/$f"; exit 1; }; done
OUT="${SNAPSHOT_OUT:-${HOME}/aladdin-production-snapshot-$(date +%Y%m%d-%H%M%S)}"
if [ -n "${SNAPSHOT_DB_URL:-}" ]; then
  case "$SNAPSHOT_DB_URL" in *@127.0.0.1:*) ;; *) echo "test mode only accepts a local database"; exit 1;; esac
  SRC=(--db-url "$SNAPSHOT_DB_URL"); TARGET="local-test"
else
  read -r -s -p "Production database password (input hidden; only read access is used): " SUPABASE_DB_PASSWORD; echo
  export SUPABASE_DB_PASSWORD
  trap 'rm -rf supabase/.temp' EXIT                                  # always unlink again
  sb link --project-ref "$PROD" >/dev/null
  [ "$(cat supabase/.temp/project-ref)" = "$PROD" ] || { echo "not linked to Production: stopping"; exit 1; }
  SRC=(--linked); TARGET="$PROD"
fi
q() { sb db query "${SRC[@]}" -f "$1" --output-format json 2>/dev/null; }   # the SQL files are SELECT-only
umask 077; mkdir -p "$OUT/backup"; B="$OUT/backup"
# Counts bracket the dump: Production is live, so a table may move while the dump runs.
q "$KIT/rowcounts.sql" | rows 'x.t' > "$OUT/rowcounts-before.txt"
sb db dump "${SRC[@]}" --role-only -f "$B/roles.sql"
sb db dump "${SRC[@]}" -f "$B/schema.sql"
sb db dump "${SRC[@]}" --data-only --use-copy -s public,app,auth,storage,supabase_migrations \
  -x storage.buckets_vectors -x storage.vector_indexes -x storage.iceberg_namespaces \
  -x storage.iceberg_tables -x storage.buckets_analytics -f "$B/data.sql"
q "$KIT/security-tail.sql" | rows 'x.s' > "$B/security-tail.out.sql"
q "$KIT/schema-fingerprint.sql" | rows '`${x.k}|${x.h}|${x.len}`' > "$OUT/fingerprint-production.txt"
q "$KIT/rowcounts.sql" | rows 'x.t' > "$OUT/rowcounts-after.txt"
echo "select version from supabase_migrations.schema_migrations order by 1;" > "$OUT/.v.sql"
q "$OUT/.v.sql" | rows 'x.version' > "$OUT/history-production.txt"; rm -f "$OUT/.v.sql"
unset SUPABASE_DB_PASSWORD
for f in roles.sql schema.sql data.sql security-tail.out.sql; do [ -s "$B/$f" ] || { echo "backup $f is empty: stopping"; exit 1; }; done

# Validation, as in production-rehearsal.sh: the dump's own COPY blocks (text format: one line per row) must hold the
# number of rows SELECT counted in Production. Because Production is live, the dump may fall anywhere between the count
# taken before it and the one taken after it; outside that range, or any malformed history, fails the snapshot.
fails=()
for f in rowcounts-before.txt rowcounts-after.txt history-production.txt; do [ -s "$OUT/$f" ] || fails+=("$f missing or empty"); done
if grep -qvE '^[0-9]{14}$' "$OUT/history-production.txt"; then fails+=("history has a malformed version"); fi
sort -c -u "$OUT/history-production.txt" 2>/dev/null || fails+=("history is not sorted and unique")
awk '/^COPY /{t=$2; gsub(/"/,"",t); n=0; on=1; next} on && /^\\\.\r?$/ {print t":"n; on=0; next} on {n++}' "$B/data.sql" | sort > "$OUT/rowcounts-in-backup.txt"
while IFS=: read -r t n; do
  a="$(grep -m1 "^$t:" "$OUT/rowcounts-after.txt" | cut -d: -f2)"; a="${a:-$n}"
  d="$(grep -m1 "^$t:" "$OUT/rowcounts-in-backup.txt" | cut -d: -f2)"
  if [ "$n" -lt "$a" ]; then lo="$n"; hi="$a"; else lo="$a"; hi="$n"; fi
  { [ -n "$d" ] && [ "$d" -ge "$lo" ] && [ "$d" -le "$hi" ]; } || fails+=("$t: Production counted $n before and $a after the dump, the backup holds ${d:-nothing}")
done < "$OUT/rowcounts-before.txt"
awk -v on=0 '/^COPY "?supabase_migrations"?\."?schema_migrations"? /{on=1; next} on && /^\\\.\r?$/ {on=0} on {split($0,f,"\t"); print f[1]}' "$B/data.sql" | sort > "$OUT/history-in-backup.txt"
cmp -s "$OUT/history-in-backup.txt" "$OUT/history-production.txt" || fails+=("the migration history in the backup differs from the history queried after it")
if [ "${#fails[@]}" -gt 0 ]; then
  echo "SNAPSHOT INVALID, do not rely on it:"; printf '  - %s\n' "${fails[@]}"
  echo "Production may have been busy: re-run once. If it repeats, stop and investigate."; exit 1
fi
echo "Validated: $(wc -l < "$OUT/rowcounts-before.txt" | tr -d ' ') table row counts (COPY vs SELECT) and $(wc -l < "$OUT/history-production.txt" | tr -d ' ') history versions agree."

COUNT="$(wc -l < "$OUT/history-production.txt" | tr -d ' ')"; LATEST="$(tail -1 "$OUT/history-production.txt")"
printf 'taken_utc=%s\nproject=%s\nhistory_count=%s\nhistory_latest=%s\nrow_counts_validated=copy-vs-select\n' "$(date -u +%FT%TZ)" "$TARGET" "$COUNT" "$LATEST" > "$OUT/snapshot-meta.txt"
( cd "$B" && shasum -a 256 * > SHA256SUMS ); cp "$B/SHA256SUMS" "$OUT/backup.SHA256SUMS"
chmod -R a-w "$B"
echo "Snapshot: $OUT"
if [ "$COUNT" = "$EXPECT_COUNT" ] && [ "$LATEST" = "$EXPECT_LATEST" ]; then
  echo "OK for P-2 (valid for 60 minutes): history $COUNT, latest $LATEST. Next: bash scripts/hosted-db/encrypt-backup.sh \"$OUT\""
else
  echo "NOT OK for P-2: history $COUNT / latest $LATEST, expected $EXPECT_COUNT / $EXPECT_LATEST. Production changed since the release was prepared: stop and re-run P-0."
  exit 1
fi
