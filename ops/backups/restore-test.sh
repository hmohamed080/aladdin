#!/usr/bin/env bash
# Monthly restore test. Touches NO hosted project: it downloads the newest daily backup (or BACKUP_KEY, any
# retained snapshot), checks its hashes and that it is the label's own project, decrypts it, restores it into a
# throwaway local Supabase stack on this machine and proves the restore is exact (schema fingerprint and the row
# count of every table equal what the dump holds). Then media-verify.sh proves the snapshot's media inventory
# against the restored database (object id, bucket, complete path, size), that every copy exists, and restores a
# sample (files deleted after the snapshot included) checking size and sha256. Writes REPORT.txt (counts, no row data).
#
#   BACKUP_LABEL=production BACKUP_BUCKET=... R2_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
#   AGE_IDENTITY_FILE=<restore-test private key file>  bash restore-test.sh
# Optional: BACKUP_KEY (a specific daily object instead of the newest complete one), REPO_ROOT (holds supabase/config.toml and
# supabase/templates; default the aladdin checkout, or the backup repo root), KIT, MEDIA_SAMPLE (default 20), OUT (report folder), SUPABASE_CLI, KEEP_STACK=1.
#
# The restore steps are the ones scripts/hosted-db/production-rehearsal.sh proved exact on 2026-10-25.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
require_env AGE_IDENTITY_FILE
[ -s "$AGE_IDENTITY_FILE" ] || die "AGE_IDENTITY_FILE is empty"
KIT="${KIT:-$HERE/../../scripts/hosted-db}"; [ -s "$KIT/security-tail.sql" ] || KIT="$HERE/kit"
REPO_ROOT="${REPO_ROOT:-$HERE/../..}"; [ -s "$REPO_ROOT/supabase/config.toml" ] || REPO_ROOT="$HERE/.."
for f in schema-fingerprint.sql rowcounts.sql auth-storage-columns.sql local-only-roles-cleanup.sql local-default-privileges-reset.sql; do
  [ -s "$KIT/$f" ] || die "missing kit file $f"; done
[ -s "$REPO_ROOT/supabase/config.toml" ] || die "no supabase/config.toml under $REPO_ROOT"
read -r -a SB <<< "${SUPABASE_CLI:-npx --yes supabase@2.110.0}"
sb() { "${SB[@]}" "$@"; }
umask 077
OUT="${OUT:-$(mktemp -d)/restore-test}"; mkdir -p "$OUT"; W="$OUT/work"; mkdir -p "$W"
fails=()

# 1. Fetch and check the backup. By default the newest snapshot WITH A COMPLETE MEDIA RECORD: a newer one whose
# media step failed or was interrupted is skipped (and reported), because it cannot be restored with its files.
SKIPPED_NEWER=0
KINDS=()
[ "${LEGACY_MEDIA_BACKUP:-0}" != 1 ] || KINDS+=(media)
[ "${R2_MEDIA_BACKUP:-0}" != 1 ] || KINDS+=(r2media)
pick_snapshot() {
  local k
  for k in $(s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "db/$BACKUP_LABEL/daily/" \
      --query "reverse(sort_by(Contents[?ends_with(Key, '.tar.age')] || \`[]\`, &LastModified))[:15].Key" --output text | tr '\t' '\n' | grep -v '^None$'); do
    ok=1
    for kind in "${KINDS[@]}"; do
      if grep -q '^P ' <<< "$(media_findings "${k%/*}" "$(basename "$k" .tar.age)" "$kind")"; then ok=0; fi
    done
    if [ "$ok" = 1 ]; then KEY="$k"; return 0; fi
    SKIPPED_NEWER=$((SKIPPED_NEWER+1))
  done
  KEY=""
}
if [ -n "${BACKUP_KEY:-}" ]; then KEY="$BACKUP_KEY"; else pick_snapshot; fi
case "$KEY" in db/"$BACKUP_LABEL"/*.tar.age) ;; "") die "no daily backup with a complete media record found";; *) die "BACKUP_KEY must be a $BACKUP_LABEL .tar.age backup";; esac
log "restore test of $KEY"
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$KEY" "$W/b.tar.age" > "$W/head.json"
s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "${KEY%.tar.age}.json" "$W/manifest.json" >/dev/null
SUM="$(sha256 "$W/b.tar.age")"
grep -q "\"sha256\":\"$SUM\"" "$W/manifest.json" || fails+=("download sha256 $SUM is not the manifest's")
grep -q "\"sha256\": *\"$SUM\"" "$W/head.json" || fails+=("download sha256 is not the object's stored metadata")
AGE_TS="$(sed -n 's/.*"taken_utc":"\([^"]*\)".*/\1/p' "$W/manifest.json")"
grep -q "\"label\":\"$BACKUP_LABEL\"" "$W/manifest.json" || fails+=("the manifest is not a $BACKUP_LABEL backup")
[ "$BACKUP_LABEL" = local-test ] || grep -q "\"project_ref\":\"$(expected_ref)\"" "$W/manifest.json" || fails+=("the backup is not of the $BACKUP_LABEL project")
age -d -i "$AGE_IDENTITY_FILE" -o "$W/b.tar" "$W/b.tar.age" || die "cannot decrypt with the restore-test key"
grep -q "\"tar_sha256\":\"$(sha256 "$W/b.tar")\"" "$W/manifest.json" || fails+=("decrypted archive hash is not the manifest's")
tar -C "$W" -xf "$W/b.tar"; B="$(find "$W" -mindepth 1 -maxdepth 1 -type d -name 'aladdin-*' | head -1)"
[ -n "$B" ] || die "the archive holds no backup folder"
( cd "$B" && sha256sum -c --quiet SHA256SUMS ) || fails+=("backup part checksums differ")
for f in roles.sql schema.sql data.sql security-tail.out.sql fingerprint.txt rowcounts.txt columns.txt; do [ -s "$B/$f" ] || fails+=("backup part $f missing"); done
[ "${#fails[@]}" -eq 0 ] || { printf '  %s\n' "${fails[@]}" | tee "$OUT/REPORT.txt"; die "backup checks failed before any restore"; }

# 2. Throwaway local stack, no migrations, ports 645xx so it never collides with a developer stack.
R="$W/stack"; mkdir -p "$R/supabase/migrations"; cp -r "$REPO_ROOT/supabase/templates" "$R/supabase/" 2>/dev/null || true
sed 's/^project_id = .*/project_id = "aladdin_restore_test"/; s/543\([0-9][0-9]\)/645\1/g; s/^sql_paths = .*/sql_paths = []/' \
  "$REPO_ROOT/supabase/config.toml" > "$R/supabase/config.toml"
C="supabase_db_aladdin_restore_test"
[ -n "${KEEP_STACK:-}" ] || trap 'sb stop --workdir "$R" --no-backup >/dev/null 2>&1 || true' EXIT
sb start --workdir "$R" -x edge-runtime,logflare,vector,studio,supavisor,imgproxy,realtime,mailpit,postgres-meta > "$OUT/stack-start.log" 2>&1 \
  || { tail -20 "$OUT/stack-start.log"; die "local stack did not start"; }
lq() { docker exec -i "$C" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 < "$1"; }

# 3. The local Auth/Storage schema must hold every column the backup loads, as the backed-up project had it.
lq "$KIT/auth-storage-columns.sql" > "$OUT/columns-local.txt"
if ! diff <(grep -v '^marker ' "$B/columns.txt" | sort) <(grep -v '^marker ' "$OUT/columns-local.txt" | sort) > "$OUT/columns-diff.txt"; then
  { echo "STACK MISMATCH: the local Auth/Storage schema differs from the backed-up project (< backup, > local stack):"
    sed 's/^/  /' "$OUT/columns-diff.txt"; echo "Update SUPABASE_CLI to the version the project runs, then retry."; } | tee "$OUT/REPORT.txt"
  exit 2
fi

# 4. Restore exactly as the rehearsal does.
X="$W/rx"; mkdir -p "$X"
grep -E '^(GRANT|REVOKE) .* ON PARAMETER ' "$B/roles.sql" > "$X/roles-parameters.sql" || true
grep -vE '^(GRANT|REVOKE) .* ON PARAMETER ' "$B/roles.sql" > "$X/roles.sql"
mig_cols() { sed -n "s/^COPY \"\{0,1\}supabase_migrations\"\{0,1\}\.\"\{0,1\}$1\"\{0,1\} (\(.*\)) FROM stdin;\r\{0,1\}\$/\1/p" "$B/data.sql" | tr -d '"' | sed 's/, /\n/g'; }
coltype() { case "$1.$2" in schema_migrations.version) echo "text primary key";; schema_migrations.statements|schema_migrations.rollback) echo "text[]";;
  schema_migrations.name|schema_migrations.created_by|schema_migrations.idempotency_key) echo text;; seed_files.path) echo "text primary key";;
  seed_files.hash) echo "text not null";; *) return 1;; esac; }
echo "create schema if not exists supabase_migrations;" > "$X/migrations-schema.sql"
for t in schema_migrations seed_files; do
  cols="$(mig_cols "$t")"; [ -n "$cols" ] || continue
  defs=""; while read -r c; do ty="$(coltype "$t" "$c")" || die "supabase_migrations.$t.$c has no known type"; defs="$defs${defs:+, }\"$c\" $ty"; done <<< "$cols"
  echo "create table if not exists supabase_migrations.$t ($defs);" >> "$X/migrations-schema.sql"
done
{ grep -o 'cli_login_[A-Za-z0-9_]*' "$B/security-tail.out.sql" || true; } | sort -u > "$X/transient-roles.txt"
sed 's/.*/create role "&" nologin;/' "$X/transient-roles.txt" > "$X/pre-tail.sql"
sed 's/.*/drop role "&";/' "$X/transient-roles.txt" > "$X/post-tail.sql"
sed -n '/^revoke all on table .* from public, /{s/^.* from public, \(.*\);\r\{0,1\}$/\1/p;q;}' "$B/security-tail.out.sql" | tr -d ' "' > "$X/production-roles.txt"
[ -s "$X/production-roles.txt" ] || die "cannot read the project's role list from security-tail.out.sql"
cp "$KIT/local-only-roles-cleanup.sql" "$KIT/local-default-privileges-reset.sql" "$X/"
docker cp "$B" "$C:/tmp/bk"; docker cp "$X" "$C:/tmp/rx"
cleanup_local_only() { docker exec "$C" psql -U supabase_admin -d postgres -At -v ON_ERROR_STOP=1 -v prod_roles="$(cat "$X/production-roles.txt")" -f /tmp/rx/local-only-roles-cleanup.sql | grep '^local-only role' || true; }
cleanup_local_only > "$OUT/local-only-roles.txt"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$C" psql -U postgres -d postgres -q --single-transaction -v ON_ERROR_STOP=1 \
  -f /tmp/rx/roles.sql -f /tmp/rx/local-default-privileges-reset.sql -f /tmp/bk/schema.sql -f /tmp/rx/migrations-schema.sql -c 'SET session_replication_role = replica' \
  -f /tmp/bk/data.sql -c 'SET session_replication_role = origin' \
  -f /tmp/rx/pre-tail.sql -f /tmp/bk/security-tail.out.sql -f /tmp/rx/post-tail.sql > "$OUT/restore.log" 2>&1 \
  || { tail -20 "$OUT/restore.log"; die "restore failed"; }
docker exec "$C" psql -U supabase_admin -d postgres -q --single-transaction -v ON_ERROR_STOP=1 -f /tmp/rx/roles-parameters.sql >/dev/null
cleanup_local_only >> "$OUT/local-only-roles.txt"

# 5. Prove it: the restored schema fingerprint and row counts equal the backup's.
lq "$KIT/schema-fingerprint.sql" > "$OUT/fingerprint-restored.txt"
lq "$KIT/rowcounts.sql" > "$OUT/rowcounts-restored.txt"
SCHEMA=exact; diff -q "$B/fingerprint.txt" "$OUT/fingerprint-restored.txt" >/dev/null || { SCHEMA=DIFFERS; fails+=("schema fingerprint differs"); }
# Every counted table must be restored with the dump's row count (tables the count query skips are not compared).
join -t: -a1 -e MISSING -o 0,1.2,2.2 <(sort "$OUT/rowcounts-restored.txt") <(sort "$B/rowcounts.txt") | awk -F: '$2!=$3' > "$OUT/rowcount-diff.txt" || true
ROWS=exact; [ ! -s "$OUT/rowcount-diff.txt" ] || { ROWS="DIFFER in $(wc -l < "$OUT/rowcount-diff.txt") tables"; fails+=("row counts differ (rowcount-diff.txt)"); }

# 6. Media: media-verify.sh proves this snapshot's inventory against the restored database (object id, bucket,
# complete path, size, copy key), that every copy exists with its recorded size, and a sample by sha256.
MEDIA=""
for kind in "${KINDS[@]}"; do
  case "$kind" in media) mk=supabase;; r2media) mk=r2;; esac
  mkdir -p "$OUT/media-$mk"
  env MEDIA_KIND="$mk" MEDIA_DB_CONTAINER="$C" KEY="$KEY" OUT="$OUT/media-$mk" bash "$HERE/media-verify.sh" > "$OUT/media-$mk/verify.log" 2>&1 || true
  one="$(cat "$OUT/media-$mk/media-summary.txt" 2>/dev/null || true)"
  if [ -z "$one" ]; then one="check did not run"; fails+=("the $mk media check did not finish (see media-$mk/verify.log)"); fi
  MEDIA="${MEDIA:+$MEDIA | }$one"
  if [ -s "$OUT/media-$mk/media-fails.txt" ]; then while IFS= read -r l; do fails+=("$l"); done < "$OUT/media-$mk/media-fails.txt"; fi
done
[ -n "$MEDIA" ] || MEDIA="no media backup is switched on for this restore test"

{
  echo "Restore test $(date -u +%FT%TZ) of $KEY"
  echo "Backup taken: $AGE_TS; sha256 $SUM (matches manifest and stored metadata)"
  echo "Decryption with the restore-test key: ok; part checksums: ok"
  echo "Local Auth/Storage schema: identical to the backed-up project"
  echo "Schema fingerprint after restore: $SCHEMA"
  echo "Row counts after restore: $ROWS ($(wc -l < "$OUT/rowcounts-restored.txt" | tr -d ' ') tables, $(awk -F: '{s+=$2} END {print s+0}' "$OUT/rowcounts-restored.txt") rows)"
  echo "Media: $MEDIA"
  [ "$SKIPPED_NEWER" -eq 0 ] || echo "Newer snapshots skipped because their media backup is not complete: $SKIPPED_NEWER"
  if [ "${#fails[@]}" -eq 0 ]; then echo "RESULT: PASS"; else echo "RESULT: FAIL"; printf '  %s\n' "${fails[@]}"; fi
} | tee "$OUT/REPORT.txt"
[ "${#fails[@]}" -eq 0 ]
