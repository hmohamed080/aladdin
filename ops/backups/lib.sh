# shellcheck shell=bash
# Shared by the backup scripts. Sourced, never run. Bash, `set -euo pipefail` in the caller.
# Talks to R2 through its S3 API with the AWS CLI (preinstalled on GitHub's Ubuntu runners).
#
# Required in the environment of every script:
#   BACKUP_LABEL     production | acceptance | local-test (which project this backup is of)
#   BACKUP_BUCKET    the R2 bucket of that label ONLY: production -> aladdin-production-db-backups,
#                    acceptance -> aladdin-acceptance-backups (see expected_bucket; no bucket is shared)
#   R2_ENDPOINT      https://<account id>.r2.cloudflarestorage.com (local-test: http://127.0.0.1:<port>)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   an R2 token scoped to BACKUP_BUCKET only
export LC_ALL=C AWS_DEFAULT_REGION=auto AWS_EC2_METADATA_DISABLED=true AWS_PAGER=""
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "backup: $*" >&2; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

require_env() { local v; for v in "$@"; do [ -n "${!v:-}" ] || die "$v is not set"; done; }

# The only hosted targets. Project refs are not secrets; pinning them here means a credential of the other
# project fails closed instead of producing a backup filed under the wrong label.
expected_ref() {
  case "$BACKUP_LABEL" in
    production) echo kkpkgjrweysgvhvkhzun;;
    acceptance) echo nxossqhdfltcqdwvbewi;;
    *) echo "";;
  esac
}

# Each hosted label has its OWN backup bucket: Acceptance and Production never share storage, tokens or rules.
expected_bucket() {
  case "$BACKUP_LABEL" in
    production) echo aladdin-production-db-backups;;
    acceptance) echo aladdin-acceptance-backups;;
    *) echo "";;
  esac
}

# Retention windows, in days. r2/*-lifecycle.json must say the same (retention-test.sh fails if they drift).
#   DB_MONTHLY_RETENTION_DAYS    the longest a database snapshot lives (monthly: locked 365, expires at 366)
#   R2_MEDIA_RETENTION_DAYS      an R2 media copy expires this long after it was WRITTEN
#   R2_GENERATION_DAYS           a generation is one Cairo month: a copy is written at the first run that needs it
#                                in that generation, so it can already be up to 31 days old when a later snapshot of
#                                the same month relies on it
#   LEGACY_MEDIA_RETENTION_DAYS  a legacy Supabase-Storage copy (opt-in) expires this long after it was written
# A snapshot is a FULL restore (database + files) only while ALL its media copies exist. Because copies age from
# when they were written, not from the snapshot, the GUARANTEED full-restore window is
#   R2 media:    90 - 31 = 59 days after the snapshot (copies may be gone from day 59, are all gone by day 90)
#   legacy:      none beyond the day of the snapshot (a long-lived file's copy can expire at any time and is re-copied
#                by the next run)
# Database snapshots outlive that (366 days for monthly): an older snapshot is a database-only restore. Its
# inventory still proves what existed and media-verify.sh reports it as such instead of failing on expired copies.
# shellcheck disable=SC2034  # read by retention-test.sh
DB_MONTHLY_RETENTION_DAYS=366
R2_MEDIA_RETENTION_DAYS=90
R2_GENERATION_DAYS=31
LEGACY_MEDIA_RETENTION_DAYS=30
media_retention_days() { case "$1" in r2) echo "$R2_MEDIA_RETENTION_DAYS";; supabase) echo "$LEGACY_MEDIA_RETENTION_DAYS";; *) die "unknown media kind $1";; esac; }
media_guarantee_days() { case "$1" in r2) echo $((R2_MEDIA_RETENTION_DAYS - R2_GENERATION_DAYS));; supabase) echo 1;; *) die "unknown media kind $1";; esac; }

# "20261031T013000Z" (snapshot stamp) or any date(1)-readable UTC time -> epoch seconds.
epoch_of() {
  local t="$1"
  if [[ "$t" =~ ^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$ ]]; then
    t="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}T${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}Z"
  fi
  date -u -d "$t" +%s 2>/dev/null || die "'$1' is not a date"
}

# Whole days since the snapshot. VERIFY_NOW pins the clock for tests; a hosted label refuses it.
snapshot_age_days() {
  local now
  if [ -n "${VERIFY_NOW:-}" ]; then [ "$BACKUP_LABEL" = local-test ] || die "VERIFY_NOW is only for local tests"; now="$(epoch_of "$VERIFY_NOW")"; else now="$(date -u +%s)"; fi
  echo $(( (now - $(epoch_of "$1")) / 86400 ))
}

# 0 when media copies of kind $1 for a snapshot taken at $2 are no longer guaranteed to all exist.
outside_media_guarantee() { [ "$(snapshot_age_days "$2")" -ge "$(media_guarantee_days "$1")" ]; }

# Fail closed on a label/target mix-up: a local test never reaches a hosted bucket or database,
# and a hosted label never runs against a local one.
check_target() {
  require_env BACKUP_LABEL BACKUP_BUCKET R2_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  case "$BACKUP_LABEL" in
    production|acceptance)
      case "$R2_ENDPOINT" in https://[0-9a-f]*.r2.cloudflarestorage.com) ;; *) die "a hosted backup must go to R2 ($R2_ENDPOINT)";; esac
      [ "$BACKUP_BUCKET" = "$(expected_bucket)" ] || die "a $BACKUP_LABEL backup must use its own bucket $(expected_bucket), not $BACKUP_BUCKET";;
    local-test)
      case "$R2_ENDPOINT" in http://127.0.0.1:*) ;; *) die "local-test only writes to a local S3 endpoint";; esac ;;
    *) die "BACKUP_LABEL must be production, acceptance or local-test";;
  esac
}

# Writing a Production backup needs the owner's activation switch, on top of the workflow's own gate.
require_production_go() {
  [ "$BACKUP_LABEL" != production ] || [ "${PRODUCTION_BACKUP_ENABLED:-}" = true ] \
    || die "Production backups are not activated (PRODUCTION_BACKUP_ENABLED is not true)"
}

# The database URL must belong to the label's own project: the Session pooler (user postgres.<ref>, port 5432)
# or the direct host db.<ref>.supabase.co. The transaction pooler (6543) is refused: pg_dump needs a session.
check_db_url() {
  local url="$1" ref; ref="$(expected_ref)"
  case "$BACKUP_LABEL:$url" in
    local-test:postgresql://*@127.0.0.1:*) return 0;;
    local-test:*) die "local-test only reads a local database";;
    *:postgresql://*@127.0.0.1:*|*:postgresql://*@localhost:*) die "a hosted label cannot read a local database";;
    *:postgresql://*) ;;
    *) die "the database URL must start with postgresql://";;
  esac
  python3 - "$url" "$ref" <<'PY' || die "the database URL is not the $BACKUP_LABEL project ($ref)"
import sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1]); ref = sys.argv[2]
user, host, port = urllib.parse.unquote(u.username or ""), (u.hostname or "").lower(), u.port
pooler = user == f"postgres.{ref}" and host.endswith(".pooler.supabase.com") and port == 5432
direct = user == "postgres" and host == f"db.{ref}.supabase.co" and port in (5432, None)
sys.exit(0 if ref and (pooler or direct) and u.path == "/postgres" else 1)
PY
}

check_supabase_url() {
  case "$BACKUP_LABEL:$1" in
    local-test:http://127.0.0.1:*) ;;
    local-test:*) die "local-test only reads local Storage";;
    *) [ "$1" = "https://$(expected_ref).supabase.co" ] || die "SUPABASE_URL is not the $BACKUP_LABEL project";;
  esac
}

# A JWT service-role key names its project: it must be this label's. (New sb_secret_ keys carry no project;
# the URL check above binds them, and a key of the other project is refused by that project's Storage.)
check_service_key() {
  [ "$BACKUP_LABEL" != local-test ] || return 0
  case "$1" in
    sb_secret_*) return 0;;
    *.*.*) python3 - "$1" "$(expected_ref)" <<'PY' || die "the service-role key is not the $BACKUP_LABEL project's"
import base64, json, sys
part = sys.argv[1].split(".")[1]; claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
sys.exit(0 if claims.get("ref") == sys.argv[2] and claims.get("role") == "service_role" else 1)
PY
    ;;
    *) die "the service-role key has an unknown format";;
  esac
}

s3() { aws --endpoint-url "$R2_ENDPOINT" "$@"; }

# Upload once. A key that already exists is never replaced (If-None-Match); the bucket lock enforces the same.
put_once() {
  local file="$1" key="$2" type="${3:-application/octet-stream}"; shift 3 || true
  s3 s3api put-object --bucket "$BACKUP_BUCKET" --key "$key" --body "$file" --content-type "$type" \
    --if-none-match '*' "$@" >/dev/null
}

# Proves the stored object is the local file: same size, and the bytes read back hash the same.
verify_stored() {
  local file="$1" key="$2" back; back="$(mktemp)"
  s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$key" "$back" >/dev/null
  cmp -s "$file" "$back" || { rm -f "$back"; die "stored object $key differs from the local file"; }
  rm -f "$back"
}

# Newest object key under a prefix ("" when none), by LastModified.
newest_key() {
  s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$1" \
    --query 'sort_by(Contents || `[]`, &LastModified)[-1].Key' --output text | sed 's/^None$//'
}

sha256() { sha256sum "$1" | cut -d' ' -f1; }

# "Y M D DOW" of the Cairo day backups are filed under. BACKUP_NOW pins it for the local tests (a Sunday, the 1st);
# any hosted label refuses it, so a stray variable can never misfile a real backup.
cairo_day() {
  if [ -n "${BACKUP_NOW:-}" ]; then
    [ "$BACKUP_LABEL" = local-test ] || die "BACKUP_NOW is only for local tests"
    TZ=Africa/Cairo date -d "$BACKUP_NOW" +'%Y %m %d %u'
  else
    TZ=Africa/Cairo date +'%Y %m %d %u'
  fi
}

# Where the copy of one Supabase Storage object (id, bucket, etag) lives. The key holds only the random id.
media_copy_key() { echo "media/$BACKUP_LABEL/supabase/objects/$2/$1-${3:-noetag}.age"; }

# Where the copy of one R2-hosted original lives: <generation>/<content hash> only (no owner, page or name), so the
# same bytes are stored once per generation. The generation is the Cairo month: every month the whole live set is
# copied afresh and a bucket lifecycle rule expires a generation after R2_MEDIA_RETENTION_DAYS, so what a user
# removed leaves the backup within that time. Written once, never replaced.
r2_generation() { local y m; read -r y m _ < <(cairo_day); echo "$y$m"; }
r2_copy_key() { echo "media/$BACKUP_LABEL/r2/${2:-$(r2_generation)}/objects/$1.age"; }

# Findings about one stored snapshot's media step in one prefix, as "P|A|W text" lines (see media-record.py).
# Fails CLOSED: a missing, unreadable, malformed or incomplete record, or a missing inventory, is a "P" line.
# $3 is the record kind: "media" (Supabase Storage files, default) or "r2media" (originals hosted in R2).
media_findings() {
  local prefix="$1" name="$2" kind="${3:-media}" tmp len out; tmp="$(mktemp)"
  if ! s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "$prefix/$name.$kind.json" "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"; echo "P no readable $kind record for $name in $prefix (its $kind step did not finish)"; return 0
  fi
  len="$(s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$prefix/$name.$kind.tsv.age" --query ContentLength --output text 2>/dev/null || true)"
  case "$len" in ''|*[!0-9]*) echo "P no $kind inventory for $name in $prefix";; 0) [ "$kind" = r2media ] || echo "P no $kind inventory for $name in $prefix";; esac
  if out="$(python3 "$LIB_DIR/media-record.py" "$tmp" "$BACKUP_LABEL" "$name" "$BACKUP_LABEL")"; then
    [ -z "$out" ] || echo "$out"
  else
    echo "P the media record of $name in $prefix could not be checked"
  fi
  rm -f "$tmp"
}

# 0 when snapshot $1 is stored in every given prefix and each holds a valid, complete media record for it.
# Only "P" findings count: an alarm a new snapshot cannot fix (Production media in R2) must not cause endless retries.
snapshot_done() {
  local name="$1" p found; shift
  for p in "$@"; do
    s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$p/$name.tar.age" >/dev/null 2>&1 || return 1
    if [ "${LEGACY_MEDIA_BACKUP:-0}" = 1 ]; then
      found="$(media_findings "$p" "$name")"
      if grep -q '^P ' <<< "$found"; then return 1; fi
    fi
    if [ "${R2_MEDIA_BACKUP:-0}" = 1 ]; then
      found="$(media_findings "$p" "$name" r2media)"
      if grep -q '^P ' <<< "$found"; then return 1; fi
    fi
  done
  return 0
}

# age encryption to every public recipient in AGE_RECIPIENTS (space or newline separated).
# The backup job holds only public keys: it can encrypt, never decrypt.
age_encrypt() {
  local in="$1" out="$2" args=() r
  for r in $AGE_RECIPIENTS; do case "$r" in age1*) args+=(-r "$r");; *) die "AGE_RECIPIENTS holds something that is not an age public key";; esac; done
  [ "${#args[@]}" -ge 1 ] || die "AGE_RECIPIENTS is empty"
  age "${args[@]}" -o "$out" "$in"
}
