#!/usr/bin/env bash
# READ-ONLY on Production. Backs up Production (kkpkgjrweysgvhvkhzun), restores the backup into a
# throwaway local Supabase stack on THIS machine, applies the pending baseline migrations there, and
# writes a report of counts and hashes only (no row data) that you can share.
# Production is only read (pg_dump and SELECT); this script contains no push, reset or write to it.
# The local stack runs the same Auth, Storage and Postgres versions as Production (read by `supabase link`),
# and every Auth/Storage column in the backup is checked against it before anything is restored. The local
# schema is never patched: any difference stops the rehearsal with one complete report.
#
# Run from a checkout of the aladdin repo. Needs git, pnpm, node, Docker running, `pnpm exec supabase login`.
#   bash production-rehearsal.sh
# Reuse an earlier, already verified backup without contacting Production at all (no link, no password, no query):
#   bash production-rehearsal.sh --resume-backup ~/aladdin-production-rehearsal-<date>
# The earlier folder is only read; results go to a new folder ending in -resumed.
# Test mode (Claude, local only): REHEARSAL_SOURCE_DB_URL=postgresql://...@127.0.0.1:PORT/postgres
#   REHEARSAL_VERSIONS_DIR=<dir with gotrue-version, storage-version, postgres-version> pins the stack like `link` does.
set -euo pipefail
export LC_ALL=C

PROD="kkpkgjrweysgvhvkhzun"
# The release under test is named on the command line (--sha, 40 hex, must be on origin/main) instead of being hard-coded.
# Production is expected to be at 203 applied / latest 20261107090003 with exactly these four pending (override only for tests).
EXPECT_PENDING="${REHEARSAL_EXPECT_PENDING:-20261105090001 20261107090004 20261107090005 20261107090006}"
CONTRACT="${REHEARSAL_CONTRACT:-20261107090006}"
SHA=""; MANIFEST=""
HERE="$(cd "$(dirname "$0")" && pwd)"; KIT="${KIT:-$HERE}"; [ -s "$KIT/security-tail.sql" ] || KIT="$HERE/../acceptance-rebuild"
OUT="${HOME}/aladdin-production-rehearsal-$(date +%Y%m%d-%H%M%S)"
sb() { pnpm exec supabase "$@"; }
# Git Bash (MSYS) rewrites arguments that look like POSIX paths, which breaks container paths such as
# /tmp/bk/roles.sql. dk() turns that off for docker; hp() hands docker host paths in Windows form.
dk() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker "$@"; }
hp() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
rows() { node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const j=JSON.parse(b),r=Array.isArray(j)?j:j.rows;if(!Array.isArray(r)){console.error("query failed: "+b.slice(0,400));process.exit(1)}process.stdout.write(r.map(x=>'"$1"').join("\n")+"\n")})'; }
PINS="gotrue-version storage-version postgres-version"
for f in schema-fingerprint.sql schema-detail.sql security-tail.sql rowcounts.sql auth-storage-columns.sql local-only-roles-cleanup.sql \
         local-default-privileges-reset.sql local-noseed-fingerprint.txt local-noseed-detail.txt; do [ -s "$KIT/$f" ] || { echo "missing $KIT/$f"; exit 1; }; done
RESUME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --resume-backup) RESUME="${2:?usage: --resume-backup <earlier rehearsal folder, or its backup folder>}"; shift 2;;
    --sha) SHA="${2:?usage: --sha <40-hex commit on origin/main>}"; shift 2;;
    *) echo "unknown option: $1"; exit 1;;
  esac
done
if [ -n "${REHEARSAL_SOURCE_DB_URL:-}" ] && [ -z "$SHA" ]; then SHA="$(git rev-parse HEAD)"; fi
printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{40}$' || { echo "usage: bash production-rehearsal.sh --sha <40-hex main commit> [--resume-backup <folder>]"; exit 2; }
if [ -n "$RESUME" ]; then
  RESUME="$(cd "$RESUME" && pwd)"; [ "$(basename "$RESUME")" != backup ] || RESUME="$(dirname "$RESUME")"
  [ -z "${REHEARSAL_SOURCE_DB_URL:-}" ] || { echo "--resume-backup never connects to a database: unset REHEARSAL_SOURCE_DB_URL"; exit 1; }
  OUT="${HOME}/$(basename "$RESUME")-resumed-$(date +%H%M%S)"
fi
# The migration files always come from the pinned commit. If GitHub cannot be reached, the commit already in
# this clone is used (offline fallback); the manifest check below still proves the files are the tested ones.
pinned_worktree() {
  git fetch -q origin main 2>/dev/null || echo "git fetch failed (offline?): using commit $SHA from this clone"
  git cat-file -e "$SHA^{commit}" 2>/dev/null || { echo "commit $SHA is not in this clone: stopping"; exit 1; }
  git merge-base --is-ancestor "$SHA" origin/main 2>/dev/null || { echo "commit $SHA is not on origin/main: stopping"; exit 1; }
  WT="$(mktemp -d)/aladdin-rehearsal"; git -c core.autocrlf=false -c core.eol=lf worktree add -q --detach "$WT" "$SHA"; cd "$WT"
  [ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "wrong commit"; exit 1; }
  pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install --frozen-lockfile --offline >/dev/null
}

if [ -n "${REHEARSAL_SOURCE_DB_URL:-}" ]; then
  case "$REHEARSAL_SOURCE_DB_URL" in *@127.0.0.1:*) ;; *) echo "test mode only accepts a local database"; exit 1;; esac
  SRC=(--db-url "$REHEARSAL_SOURCE_DB_URL"); VERSIONS="${REHEARSAL_VERSIONS_DIR:-}"
  WT="$(pwd)"
elif [ -n "$RESUME" ]; then
  pinned_worktree; SRC=(); VERSIONS=""                              # nothing below talks to any hosted project
else
  pinned_worktree
  read -r -s -p "Production database password (input hidden; only read access is used): " SUPABASE_DB_PASSWORD; echo
  export SUPABASE_DB_PASSWORD
  sb link --project-ref "$PROD" >/dev/null
  [ "$(cat supabase/.temp/project-ref)" = "$PROD" ] || { echo "not linked to Production: stopping"; exit 1; }
  SRC=(--linked); VERSIONS="$WT/supabase/.temp"
  for v in $PINS; do [ -s "$VERSIONS/$v" ] || { echo "supabase link did not report Production's $v: stopping"; exit 1; }; done
fi
# The migration files are exactly the ones at $SHA; their manifest is recorded with the backup so a resumed run can prove it.
MANIFEST="$(cd supabase/migrations && shasum -a 256 *.sql | tr -d '\r' | sed 's/ \*/  /' | shasum -a 256 | cut -d' ' -f1)"

umask 077; mkdir -p "$OUT"
echo "select coalesce(string_agg(format('%s=%s', parname, array_to_string(paracl, ',')), E'\\n' order by parname), '') as t from pg_parameter_acl;" > "$OUT/.p.sql"
if [ -n "$RESUME" ]; then
# 1. Reuse the earlier backup. It is only read: never written, moved or deleted. Its Production metadata is copied.
B="$RESUME/backup"
for f in fingerprint-production.txt rowcounts-production.txt columns-production.txt parameter-acl-production.txt history-production.txt backup.SHA256SUMS; do
  [ ! -f "$RESUME/$f" ] || cp "$RESUME/$f" "$OUT/$f"
done
mkdir -p "$OUT/versions-production"; for v in $PINS; do [ ! -f "$RESUME/versions-production/$v" ] || cp "$RESUME/versions-production/$v" "$OUT/versions-production/$v"; done
[ ! -f "$RESUME/backup-meta.txt" ] || cp "$RESUME/backup-meta.txt" "$OUT/backup-meta.txt"
echo "Reusing the backup in $B (Production is not contacted)."
else
# 1. Backup Production (read-only), owner-only permissions.
mkdir -p "$OUT/backup"; B="$OUT/backup"
sb db dump "${SRC[@]}" --role-only -f "$B/roles.sql"
sb db dump "${SRC[@]}" -f "$B/schema.sql"
sb db dump "${SRC[@]}" --data-only --use-copy -s public,app,auth,storage,supabase_migrations \
  -x storage.buckets_vectors -x storage.vector_indexes -x storage.iceberg_namespaces \
  -x storage.iceberg_tables -x storage.buckets_analytics -f "$B/data.sql"
q() { sb db query "${SRC[@]}" -f "$1" --output-format json 2>/dev/null; }
q "$KIT/security-tail.sql" | rows 'x.s' > "$B/security-tail.out.sql"
q "$KIT/schema-fingerprint.sql" | rows '`${x.k}|${x.h}|${x.len}`' > "$OUT/fingerprint-production.txt"
q "$KIT/rowcounts.sql" | rows 'x.t' > "$OUT/rowcounts-production.txt"
q "$KIT/auth-storage-columns.sql" | rows 'x.t' > "$OUT/columns-production.txt"
q "$OUT/.p.sql" | rows 'x.t' > "$OUT/parameter-acl-production.txt"
mkdir -p "$OUT/versions-production"
for v in $PINS; do [ -z "$VERSIONS" ] || [ ! -s "$VERSIONS/$v" ] || tr -d '\r\n' < "$VERSIONS/$v" > "$OUT/versions-production/$v"; done
echo "select version from supabase_migrations.schema_migrations order by 1;" > "$OUT/.v.sql"
q "$OUT/.v.sql" | rows 'x.version' > "$OUT/history-production.txt"
for f in roles.sql schema.sql data.sql security-tail.out.sql; do [ -s "$B/$f" ] || { echo "backup $f is empty: stopping"; exit 1; }; done
printf 'baseline_sha=%s\nmanifest=%s\ntaken_utc=%s\nproject=%s\n' "$SHA" "$MANIFEST" "$(date -u +%FT%TZ)" "${REHEARSAL_SOURCE_DB_URL:+local-test}${REHEARSAL_SOURCE_DB_URL:-$PROD}" > "$OUT/backup-meta.txt"
( cd "$B" && shasum -a 256 * > SHA256SUMS ); cp "$B/SHA256SUMS" "$OUT/backup.SHA256SUMS"
chmod -R a-w "$B"                                                   # the backup is never modified after this point
[ -n "${REHEARSAL_SOURCE_DB_URL:-}" ] || rm -rf supabase/.temp      # unlink: nothing below can reach Production
echo "Production backup: $B"
fi

# 1b. Fail closed unless the backup and every piece of Production metadata the verification needs are present,
# untouched and consistent with each other. Checked before any local stack is started.
fails=()
for f in roles.sql schema.sql data.sql security-tail.out.sql SHA256SUMS; do [ -s "$B/$f" ] || fails+=("backup/$f missing or empty"); done
for f in fingerprint-production.txt rowcounts-production.txt columns-production.txt history-production.txt backup.SHA256SUMS; do [ -s "$OUT/$f" ] || fails+=("$f missing or empty"); done
[ -f "$OUT/parameter-acl-production.txt" ] || fails+=("parameter-acl-production.txt missing")
for v in $PINS; do [ -s "$OUT/versions-production/$v" ] || fails+=("Production $v missing"); done
if [ -s "$B/SHA256SUMS" ]; then
  ( cd "$B" && shasum -a 256 -c --quiet SHA256SUMS >/dev/null 2>&1 ) || fails+=("backup checksum mismatch (SHA256SUMS)")
  [ "$(awk '{sub(/^\*/,"",$2); print $2}' "$B/SHA256SUMS" | sort | tr '\n' ' ')" = "data.sql roles.sql schema.sql security-tail.out.sql " ] \
    || fails+=("SHA256SUMS does not list exactly the four backup files")
  cmp -s <(tr -d '\r' < "$B/SHA256SUMS") <(tr -d '\r' < "$OUT/backup.SHA256SUMS" 2>/dev/null) || fails+=("backup/SHA256SUMS differs from the copy taken with the backup")
fi
if [ -f "$OUT/backup-meta.txt" ]; then
  grep -qx "baseline_sha=$SHA" "$OUT/backup-meta.txt" || fails+=("backup-meta.txt names another baseline commit")
  grep -qx "manifest=$MANIFEST" "$OUT/backup-meta.txt" || fails+=("backup-meta.txt names another migration manifest")
fi
[ "$(cut -d'|' -f1 "$OUT/fingerprint-production.txt" 2>/dev/null | sort | tr '\n' ' ')" = "$(cut -d'|' -f1 "$KIT/local-noseed-fingerprint.txt" | sort | tr '\n' ' ')" ] \
  || fails+=("fingerprint-production.txt does not have every fingerprint category")
[ "$(grep -c '^marker ' "$OUT/columns-production.txt" 2>/dev/null)" = 2 ] || fails+=("columns-production.txt lacks the Auth/Storage migration markers")
grep -qvE '^[0-9]{14}$' "$OUT/history-production.txt" 2>/dev/null && fails+=("history-production.txt has a malformed version")
sort -c -u "$OUT/history-production.txt" 2>/dev/null || fails+=("history-production.txt is not sorted and unique")
# Row counts from the dump itself (COPY text format: one line per row) must equal the counts taken from Production.
awk '/^COPY /{t=$2; gsub(/"/,"",t); n=0; on=1; next} on && /^\\\.\r?$/ {print t":"n; on=0; next} on {n++}' "$B/data.sql" | sort > "$OUT/rowcounts-in-backup.txt"
while IFS=: read -r t n; do
  d="$(grep -m1 "^$t:" "$OUT/rowcounts-in-backup.txt" | cut -d: -f2)"; [ "${d:-0}" = "$n" ] || fails+=("$t: Production counted $n rows, the backup holds ${d:-0}")
done < "$OUT/rowcounts-production.txt"
awk -v on=0 '/^COPY "?supabase_migrations"?\."?schema_migrations"? /{on=1; next} on && /^\\\.\r?$/ {on=0} on {split($0,f,"\t"); print f[1]}' "$B/data.sql" | sort > "$OUT/history-in-backup.txt"
cmp -s "$OUT/history-in-backup.txt" "$OUT/history-production.txt" || fails+=("the migration history in the backup differs from history-production.txt")
# The local migration-history tables are created exactly as the backup's COPY statements describe them.
mig_cols() { sed -n "s/^COPY \"\{0,1\}supabase_migrations\"\{0,1\}\.\"\{0,1\}$1\"\{0,1\} (\(.*\)) FROM stdin;\r\{0,1\}\$/\1/p" "$B/data.sql" | tr -d '"' | sed 's/, /\n/g'; }
coltype() { case "$1.$2" in schema_migrations.version) echo "text primary key";; schema_migrations.statements|schema_migrations.rollback) echo "text[]";;
  schema_migrations.name|schema_migrations.created_by|schema_migrations.idempotency_key) echo text;; seed_files.path) echo "text primary key";;
  seed_files.hash) echo "text not null";; *) return 1;; esac; }
echo "create schema if not exists supabase_migrations;" > "$OUT/.migrations-schema.sql"
for t in schema_migrations seed_files; do
  cols="$(mig_cols "$t")"; [ -n "$cols" ] || { [ "$t" = seed_files ] || fails+=("backup has no supabase_migrations.schema_migrations data"); continue; }
  defs=""; while read -r c; do ty="$(coltype "$t" "$c")" || { fails+=("supabase_migrations.$t.$c has no known type"); continue; }; defs="$defs${defs:+, }\"$c\" $ty"; done <<< "$cols"
  echo "create table if not exists supabase_migrations.$t ($defs);" >> "$OUT/.migrations-schema.sql"
done
if [ "${#fails[@]}" -gt 0 ]; then
  { echo "Backup validation FAILED ($B):"; printf '  %s\n' "${fails[@]}"; } | tee "$OUT/REPORT.txt"
  echo "REHEARSAL FAILED before starting any local stack. Production push is NO-GO."; exit 1
fi
echo "Backup validation passed: checksums, file list, metadata, row counts and migration history are consistent."

# 2. What a push would apply. Unknown versions on Production stop the rehearsal: they need review first.
ls supabase/migrations/*.sql | xargs -n1 basename | cut -c1-14 | sort > "$OUT/history-files.txt"
comm -13 "$OUT/history-files.txt" "$OUT/history-production.txt" > "$OUT/only-on-production.txt"
comm -23 "$OUT/history-files.txt" "$OUT/history-production.txt" > "$OUT/pending.txt"
echo "Pending: $(wc -l < "$OUT/pending.txt") migrations. Only on Production: $(wc -l < "$OUT/only-on-production.txt")."
[ ! -s "$OUT/only-on-production.txt" ] || { echo "Production has versions the baseline lacks (see only-on-production.txt): stopping"; exit 1; }
[ -s "$OUT/pending.txt" ] || { echo "Nothing to apply: Production already has the whole baseline."; exit 0; }
# Exactly the reviewed set may be pending. 20261105090001 sorts before Production's latest version, which is why the push
# (and the local apply below) use --include-all; any other out-of-order version needs review first.
[ "$(tr '\n' ' ' < "$OUT/pending.txt" | sed 's/ $//')" = "$EXPECT_PENDING" ] \
  || { echo "pending set differs from the reviewed one ($EXPECT_PENDING), see pending.txt: stopping"; exit 1; }
OOO="$(awk -v l="$(tail -1 "$OUT/history-production.txt")" '$0 < l' "$OUT/pending.txt" | tr '\n' ' ' | sed 's/ $//')"
[ "$OOO" = "20261105090001" ] || [ -z "$OOO" ] || { echo "unexpected out-of-order pending versions: $OOO"; exit 1; }

# 3. Restore into a throwaway local stack and prove the restore is exact.
R="$OUT/stack"; mkdir -p "$R/supabase/migrations"; cp -r supabase/templates "$R/supabase/"
sed 's/project_id = "aladdin"/project_id = "aladdin_prod_rehearsal"/; s/543\([0-9][0-9]\)/644\1/g; s/^sql_paths = .*/sql_paths = []/' supabase/config.toml > "$R/supabase/config.toml"
C="supabase_db_aladdin_prod_rehearsal"
mkdir -p "$R/supabase/.temp"; cp "$OUT/versions-production/"* "$R/supabase/.temp/" 2>/dev/null || true
[ -n "${REHEARSAL_KEEP:-}" ] || trap 'sb stop --workdir "$R" --no-backup >/dev/null 2>&1 || true' EXIT
for p in 64420 64421 64422 64423 64424 64425 64426 64427 64428 64429; do ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null || { echo "port $p is in use (another local stack?): stop it and retry"; exit 1; }; done
sb start --workdir "$R" -x edge-runtime,logflare,vector,studio,supavisor,imgproxy,realtime,mailpit,postgres-meta > "$OUT/stack-start.log" 2>&1 || { tail -20 "$OUT/stack-start.log"; exit 1; }
lq() { dk exec -i "$C" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 < "$1"; }
lq "$KIT/auth-storage-columns.sql" > "$OUT/columns-local.txt"

# 3a. One complete Auth/Storage compatibility report before restoring anything: every table and column the
# backup's COPY statements load, and every Production column's type and nullability, must exist locally as is.
sed -n 's/^COPY \([^ ]*\) (\(.*\)) FROM stdin;\r\{0,1\}$/\1|\2/p' "$B/data.sql" | tr -d '"' \
  | awk -F'|' '$1 ~ /^(auth|storage)\./ { n=split($2,c,", "); for(i=1;i<=n;i++) print $1"."c[i] }' | sort -u > "$OUT/copy-columns.txt"
key() { grep -v '^marker ' "$1" | cut -d: -f1 | sort -u; }
tbl() { key "$1" | cut -d. -f1-2 | sort -u; }
{
  echo "Local stack versions: $(dk inspect -f '{{.Config.Image}}' supabase_auth_aladdin_prod_rehearsal supabase_storage_aladdin_prod_rehearsal "$C" | tr '\n' ' ')"
  echo "Production versions (from supabase link): $(for v in $PINS; do printf '%s=%s ' "$v" "$(cat "$OUT/versions-production/$v" 2>/dev/null || echo unknown)"; done)"
  echo "Missing tables (in the backup or on Production, not local):"
  comm -23 <(sort -u <(tbl "$OUT/columns-production.txt") <(cut -d. -f1-2 "$OUT/copy-columns.txt" | sort -u)) <(tbl "$OUT/columns-local.txt") | sed 's/^/  /'
  echo "Missing columns:"
  comm -23 <(sort -u <(key "$OUT/columns-production.txt") "$OUT/copy-columns.txt") <(key "$OUT/columns-local.txt") \
    | awk -F. 'NR==FNR {have[$0]=1; next} ($1"."$2) in have {print "  "$0}' <(tbl "$OUT/columns-local.txt") -
  echo "Different type or nullability (Production -> local):"
  join -t'|' <(grep -v '^marker ' "$OUT/columns-production.txt" | sed 's/:/|/' | sort -t'|' -k1,1) \
             <(grep -v '^marker ' "$OUT/columns-local.txt" | sed 's/:/|/' | sort -t'|' -k1,1) | awk -F'|' '$2!=$3 {print "  "$1": "$2" -> "$3}'
  echo "Columns only in the local stack (on tables Production has):"
  comm -13 <(key "$OUT/columns-production.txt") <(key "$OUT/columns-local.txt") \
    | awk -F. 'NR==FNR {have[$0]=1; next} ($1"."$2) in have {print "  "$0}' <(tbl "$OUT/columns-production.txt") -
  echo "Service migration markers (Production / local):"
  paste -d'|' <(grep '^marker ' "$OUT/columns-production.txt") <(grep '^marker ' "$OUT/columns-local.txt") | sed 's/^marker /  /; s/|marker [^:]*:/  \/  /'
} > "$OUT/auth-storage-check.txt"
if diff -q "$OUT/columns-production.txt" "$OUT/columns-local.txt" >/dev/null && [ -s "$OUT/copy-columns.txt" ] \
   && [ -z "$(comm -23 "$OUT/copy-columns.txt" <(key "$OUT/columns-local.txt"))" ]; then AUTHSTORAGE=identical; else AUTHSTORAGE=DIFFERS; fi
if [ "$AUTHSTORAGE" != identical ]; then
  cp "$OUT/auth-storage-check.txt" "$OUT/REPORT.txt"; cat "$OUT/REPORT.txt"
  echo "REHEARSAL FAILED before restoring: the local Auth/Storage schema is not identical to Production (details above). Production push is NO-GO."
  exit 1
fi
# Hosted-only parameter grants (e.g. GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin") need a
# superuser locally, which `postgres` is not there. Split them into a derived copy in $OUT/restore (the backup
# itself is never edited) and replay them as supabase_admin, so the restored grants still equal Production's.
mkdir -p "$OUT/restore"
grep -E '^(GRANT|REVOKE) .* ON PARAMETER ' "$B/roles.sql" > "$OUT/restore/roles-parameters.sql" || true
grep -vE '^(GRANT|REVOKE) .* ON PARAMETER ' "$B/roles.sql" > "$OUT/restore/roles.sql"
cp "$OUT/.migrations-schema.sql" "$OUT/restore/migrations-schema.sql"
# Backups taken before the generator skipped them name the CLI's temporary login role (cli_login_postgres, present on
# Production only while the CLI is connected) in their REVOKE lists. Create it as a NOLOGIN placeholder for the tail
# and drop it again in the same transaction; the backup file itself is left as it is.
{ grep -o 'cli_login_[A-Za-z0-9_]*' "$B/security-tail.out.sql" || true; } | sort -u > "$OUT/restore/transient-roles.txt"
sed 's/.*/create role "&" nologin;/' "$OUT/restore/transient-roles.txt" > "$OUT/restore/pre-tail.sql"
sed 's/.*/drop role "&";/' "$OUT/restore/transient-roles.txt" > "$OUT/restore/post-tail.sql"
# Roles the local image creates but Production lacks are absent from the tail's REVOKE lists, so their default
# privileges would leak into every restored table. Strip them before the restore and once more after it.
sed -n '/^revoke all on table .* from public, /{s/^.* from public, \(.*\);\r\{0,1\}$/\1/p;q;}' "$B/security-tail.out.sql" | tr -d ' "' > "$OUT/restore/production-roles.txt"
[ -s "$OUT/restore/production-roles.txt" ] || { echo "cannot read Production's role list from security-tail.out.sql: stopping"; exit 1; }
cp "$KIT/local-only-roles-cleanup.sql" "$KIT/local-default-privileges-reset.sql" "$OUT/restore/"
dk cp "$(hp "$B")" "$C:/tmp/bk"; dk cp "$(hp "$OUT/restore")" "$C:/tmp/rx"
cleanup_local_only() { dk exec "$C" psql -U supabase_admin -d postgres -At -v ON_ERROR_STOP=1 -v prod_roles="$(cat "$OUT/restore/production-roles.txt")" -f /tmp/rx/local-only-roles-cleanup.sql | grep '^local-only role' || true; }
cleanup_local_only > "$OUT/local-only-roles.txt"
dk exec -e PGOPTIONS='-c client_min_messages=warning' "$C" psql -U postgres -d postgres -q --single-transaction -v ON_ERROR_STOP=1 \
  -f /tmp/rx/roles.sql -f /tmp/rx/local-default-privileges-reset.sql -f /tmp/bk/schema.sql -f /tmp/rx/migrations-schema.sql -c 'SET session_replication_role = replica' \
  -f /tmp/bk/data.sql -c 'SET session_replication_role = origin' \
  -f /tmp/rx/pre-tail.sql -f /tmp/bk/security-tail.out.sql -f /tmp/rx/post-tail.sql >/dev/null
dk exec "$C" psql -U supabase_admin -d postgres -q --single-transaction -v ON_ERROR_STOP=1 -f /tmp/rx/roles-parameters.sql >/dev/null
cleanup_local_only >> "$OUT/local-only-roles.txt"
lq "$KIT/schema-fingerprint.sql" > "$OUT/fingerprint-restored.txt"
lq "$KIT/rowcounts.sql" > "$OUT/rowcounts-restored.txt"
RESTORE="exact"
diff -q "$OUT/fingerprint-production.txt" "$OUT/fingerprint-restored.txt" >/dev/null || RESTORE="SCHEMA DIFFERS"
diff -q "$OUT/rowcounts-production.txt" "$OUT/rowcounts-restored.txt" >/dev/null || RESTORE="$RESTORE; ROW COUNTS DIFFER"
lq "$OUT/.p.sql" > "$OUT/parameter-acl-restored.txt"
diff -q "$OUT/parameter-acl-production.txt" "$OUT/parameter-acl-restored.txt" >/dev/null || RESTORE="$RESTORE; PARAMETER GRANTS DIFFER"
# Names, hashes and privileges only (no row data): which objects stand behind a fingerprint difference.
lq "$KIT/schema-detail.sql" > "$OUT/detail-restored.txt"

# 4. Apply exactly what `db push` would apply, the same way (one file at a time, recorded in history).
cp supabase/migrations/*.sql "$R/supabase/migrations/"
set +e; sb migration up --workdir "$R" --local --include-all > "$OUT/migration-up.log" 2>&1; UP=$?; set -e
lq "$KIT/rowcounts.sql" > "$OUT/rowcounts-after.txt"

# 5. Verify the result on the restored copy (counts, hashes and booleans only). The old fixed schema baseline no longer
# applies; the checks are: history, structural facts, no row changes, and function permissions against the reviewed contract.
HIST_AFTER="$(dk exec -i "$C" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c 'select version from supabase_migrations.schema_migrations order by 1')"
printf '%s\n' "$HIST_AFTER" > "$OUT/history-after.txt"
cat "$OUT/history-production.txt" "$OUT/pending.txt" | sort > "$OUT/history-expected-after.txt"
HISTORY=ok; cmp -s "$OUT/history-after.txt" "$OUT/history-expected-after.txt" || HISTORY="DIFFERS (see history-after.txt)"
dk exec -i "$C" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 < "$HERE/acceptance-structure.sql" > "$OUT/structure-after.json" || true
STRUCT="$(node -e '
const f=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")), a=process.argv.slice(2), bad=[];
if(!f.storage_key_column)bad.push("storage_key column missing"); if(f.backup_tables!==4)bad.push("backup tables="+f.backup_tables);
if(!f.delivery_requests_table)bad.push("delivery requests table missing"); if(f.latest_migration!==a[0])bad.push("latest="+f.latest_migration);
process.stdout.write(bad.length?"FAILED: "+bad.join("; "):"ok")' "$OUT/structure-after.json" "$(tail -1 "$OUT/pending.txt")" 2>&1 || echo "FAILED: unreadable structure output")"
# Existing tables must keep their rows (schema_migrations grows by the pending count and is excluded).
CHANGED="$(join -t'|' <(sed 's/:\([0-9]*\)$/|\1/' "$OUT/rowcounts-restored.txt" | sort -t'|' -k1,1) <(sed 's/:\([0-9]*\)$/|\1/' "$OUT/rowcounts-after.txt" | sort -t'|' -k1,1) \
  | awk -F'|' '
    $2==$3 || $1 ~ /schema_migrations/ {next}
    # Reviewed seed rows of 20261107090006: four admin_permissions rows (exactly) and the role assignments for them (growth only).
    $1 ~ /(^|[."])admin_permissions"?$/ && $3-$2==4 {next}
    $1 ~ /(^|[."])admin_role_permissions"?$/ && $3>$2 {next}
    {print "  "$1": "$2" -> "$3}')"
DISAPPEARED="$(comm -23 <(cut -d: -f1 "$OUT/rowcounts-restored.txt" | sort) <(cut -d: -f1 "$OUT/rowcounts-after.txt" | sort))"
dk cp "$(hp "$HERE/../function-permissions.sql")" "$C:/tmp/fp.sql"
{ printf '[{"permissions":'; dk exec "$C" psql -U postgres -d postgres -At -q -1 -v ON_ERROR_STOP=1 -f /tmp/fp.sql | grep -v '^SET$'; printf '}]\n'; } > "$OUT/permissions-after.json"
set +e
PERMS="$(node "$HERE/verify-permissions-readonly.mjs" "$OUT/permissions-after.json" "$CONTRACT" 2>&1)"; PERMS_RC=$?
( cd "$B" && shasum -a 256 -c --quiet "$OUT/backup.SHA256SUMS" >/dev/null 2>&1 ) && cmp -s <(tr -d '\r' < "$B/SHA256SUMS") <(tr -d '\r' < "$OUT/backup.SHA256SUMS") \
  && BACKUP=unchanged || BACKUP=CHANGED
set -e
{
  echo "Production rehearsal $(date -u +%FT%TZ), release commit $SHA (migration manifest $MANIFEST)"
  if [ -n "$RESUME" ]; then echo "Backup: reused from $RESUME (Production was not contacted by this run)"; else echo "Backup: taken by this run"; fi
  echo "Backup validation: passed (checksums before restore, file list, metadata, $(wc -l < "$OUT/rowcounts-production.txt") table row counts, $(wc -l < "$OUT/history-production.txt") history versions)"
  echo "Production history: $(wc -l < "$OUT/history-production.txt") versions; pending: $(tr '\n' ' ' < "$OUT/pending.txt")"
  cat "$OUT/auth-storage-check.txt"
  echo "Auth/Storage schema versus Production: $AUTHSTORAGE"
  echo "Restore of the backup: $RESTORE (public/app schema fingerprint, the row count of every restored table, parameter grants)"
  echo "Parameter grants replayed as supabase_admin: $(grep -c . "$OUT/restore/roles-parameters.sql" || true)"
  echo "Local-only roles stripped (present in the local image, not on Production):"; sed 's/^/  /' "$OUT/local-only-roles.txt"
  echo "migration up --include-all exit code: $UP (log: migration-up.log)"
  echo "History after the apply: $HISTORY ($(wc -l < "$OUT/history-after.txt") versions)"
  echo "Structure after the apply: $STRUCT"
  echo "Existing tables whose row count changed, apart from the reviewed 20261107090006 permission seeds (must be none):"; [ -z "$CHANGED" ] || echo "$CHANGED"
  echo "Tables that disappeared (must be none):"; [ -z "$DISAPPEARED" ] || echo "$DISAPPEARED" | sed 's/^/  /'
  echo "Function permissions versus contract $CONTRACT: $PERMS"
  echo "Production backup files: $BACKUP since the checksum was taken (checked again after the rehearsal)"
} > "$OUT/REPORT.txt"
cat "$OUT/REPORT.txt"
echo "Share $OUT/REPORT.txt with Claude (it has no row data). Keep $B private; it holds Production data."
if [ "$RESTORE" != exact ] || [ "$UP" != 0 ] || [ "$HISTORY" != ok ] || [ "$STRUCT" != ok ] || [ -n "$CHANGED" ] || [ -n "$DISAPPEARED" ] || [ "$PERMS_RC" != 0 ] || [ "$BACKUP" != unchanged ]; then
  echo "REHEARSAL FAILED: restore=$RESTORE, migration up exit=$UP, history=$HISTORY, structure=$STRUCT, permissions rc=$PERMS_RC, backup=$BACKUP. Production push is NO-GO."
  exit 1
fi
echo "Rehearsal passed: faithful restore (Auth/Storage identical to Production, every row count equal), the pending migrations applied with --include-all, history, structure and function permissions (contract $CONTRACT) verified, no row changes."
