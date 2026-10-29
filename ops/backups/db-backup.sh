#!/usr/bin/env bash
# Daily database backup. READ-ONLY on the database: pg_dump (through the Supabase CLI) and SELECTs only.
# Same dump method as scripts/hosted-db/production-rehearsal.sh, whose restore is proven exact: roles, schema,
# data, plus the security tail that `db dump` leaves out (exact grants, storage/auth policies and triggers).
#
#   BACKUP_DB_URL=postgresql://...  BACKUP_LABEL=production  BACKUP_BUCKET=...  R2_ENDPOINT=...
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...  AGE_RECIPIENTS="age1... age1..."  bash db-backup.sh
#
# Writes, never replacing anything (If-None-Match, and the bucket lock):
#   db/<label>/daily/YYYY/MM/DD/<label>-<stamp>.tar.age        always
#   db/<label>/weekly/YYYY/<label>-<stamp>.tar.age              on Sundays (Cairo time)
#   db/<label>/monthly/YYYY/<label>-<stamp>.tar.age             on the 1st (Cairo time)
#   ...<same name>.json                                         a manifest: sizes, hashes, counts; no row data
# Optional: KIT (folder with the hosted-db SQL kit, default ../../scripts/hosted-db), SUPABASE_CLI.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
require_env BACKUP_DB_URL AGE_RECIPIENTS
check_db_url "$BACKUP_DB_URL"
KIT="${KIT:-$HERE/../../scripts/hosted-db}"; [ -s "$KIT/security-tail.sql" ] || KIT="$HERE/kit"
for f in security-tail.sql schema-fingerprint.sql rowcounts.sql auth-storage-columns.sql; do [ -s "$KIT/$f" ] || die "missing kit file $f"; done
read -r -a SB <<< "${SUPABASE_CLI:-npx --yes supabase@2.110.0}"
command -v age >/dev/null || die "age is not installed"
command -v psql >/dev/null || die "psql is not installed"

umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
# Day boundaries follow Cairo, where the owner reads them.
read -r Y M D DOW <<< "$(TZ=Africa/Cairo date +'%Y %m %d %u')"
NAME="aladdin-$BACKUP_LABEL-$STAMP"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
B="$WORK/$NAME"; mkdir -p "$B"

log "dumping $BACKUP_LABEL (read-only)"
# pg_dump warns about circular foreign keys on every data-only dump; the restore loads data with triggers off.
dump() { "${SB[@]}" db dump --db-url "$BACKUP_DB_URL" "$@" >>"$WORK/dump.log" 2>&1 || { tail -20 "$WORK/dump.log" >&2; die "db dump failed"; }; }
dump --role-only -f "$B/roles.sql"
dump -f "$B/schema.sql"
dump --data-only --use-copy -s public,app,auth,storage,supabase_migrations \
  -x storage.buckets_vectors -x storage.vector_indexes -x storage.iceberg_namespaces \
  -x storage.iceberg_tables -x storage.buckets_analytics -f "$B/data.sql"
q() { psql "$BACKUP_DB_URL" -X -At -v ON_ERROR_STOP=1 -c 'set session characteristics as transaction read only' -f "$1" | sed '1{/^SET$/d}'; }
q "$KIT/security-tail.sql" > "$B/security-tail.out.sql"
q "$KIT/schema-fingerprint.sql" > "$B/fingerprint.txt"
q "$KIT/auth-storage-columns.sql" > "$B/columns.txt"
q "$KIT/rowcounts.sql" > "$B/rowcounts-live.txt"
echo "select version from supabase_migrations.schema_migrations order by 1;" > "$WORK/h.sql"; q "$WORK/h.sql" > "$B/history.txt"
for f in roles.sql schema.sql data.sql security-tail.out.sql fingerprint.txt columns.txt history.txt; do
  [ -s "$B/$f" ] || die "backup part $f is empty"
done
# Row counts as the dump holds them (one snapshot). The restore test must reproduce exactly these.
# Live counts are taken a moment later, so on a busy database they may differ by a few rows: recorded, not fatal.
awk '/^COPY /{t=$2; gsub(/"/,"",t); n=0; on=1; next} on && /^\\\.\r?$/ {print t":"n; on=0; next} on {n++}' "$B/data.sql" | sort > "$B/rowcounts.txt"
[ -s "$B/rowcounts.txt" ] || die "the data dump holds no tables"
grep -q '^public\.users:' "$B/rowcounts.txt" || die "the data dump has no public.users table"
DRIFT="$(join -t: -a1 -e0 -o 0,1.2,2.2 <(sort "$B/rowcounts-live.txt") "$B/rowcounts.txt" | awk -F: '$2!=$3' | wc -l | tr -d ' ')"
( cd "$B" && sha256sum -- * > SHA256SUMS )

tar -C "$WORK" -cf "$WORK/$NAME.tar" "$NAME"
age_encrypt "$WORK/$NAME.tar" "$WORK/$NAME.tar.age"
SUM="$(sha256 "$WORK/$NAME.tar.age")"; BYTES="$(wc -c < "$WORK/$NAME.tar.age" | tr -d ' ')"
TABLES="$(wc -l < "$B/rowcounts.txt" | tr -d ' ')"; ROWS="$(awk -F: '{s+=$2} END {print s+0}' "$B/rowcounts.txt")"
cat > "$WORK/$NAME.json" <<JSON
{"label":"$BACKUP_LABEL","taken_utc":"$STAMP","file":"$NAME.tar.age","sha256":"$SUM","bytes":$BYTES,
 "tar_sha256":"$(sha256 "$WORK/$NAME.tar")","migrations":$(wc -l < "$B/history.txt" | tr -d ' '),"latest_migration":"$(tail -1 "$B/history.txt")",
 "tables":$TABLES,"rows":$ROWS,"tables_with_live_drift":$DRIFT,"users":$(grep '^public\.users:' "$B/rowcounts.txt" | cut -d: -f2),
 "parts_sha256":"$(sha256 "$B/SHA256SUMS")","kit_sha256":"$(cat "$KIT"/security-tail.sql "$KIT"/schema-fingerprint.sql | sha256sum | cut -d' ' -f1)"}
JSON

upload() {
  local prefix="$1"
  put_once "$WORK/$NAME.tar.age" "$prefix/$NAME.tar.age" application/octet-stream --metadata "sha256=$SUM"
  put_once "$WORK/$NAME.json" "$prefix/$NAME.json" application/json
  verify_stored "$WORK/$NAME.tar.age" "$prefix/$NAME.tar.age"
  log "stored $prefix/$NAME.tar.age ($BYTES bytes)"
}
upload "db/$BACKUP_LABEL/daily/$Y/$M/$D"
[ "$DOW" != 7 ] || upload "db/$BACKUP_LABEL/weekly/$Y"
[ "$D" != 01 ] || upload "db/$BACKUP_LABEL/monthly/$Y"
log "done: $TABLES tables, $ROWS rows, $(wc -l < "$B/history.txt" | tr -d ' ') migrations, sha256 $SUM"
