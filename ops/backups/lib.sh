# shellcheck shell=bash
# Shared by the backup scripts. Sourced, never run. Bash, `set -euo pipefail` in the caller.
# Talks to R2 through its S3 API with the AWS CLI (preinstalled on GitHub's Ubuntu runners).
#
# Required in the environment of every script:
#   BACKUP_LABEL     production | acceptance | local-test (which project this backup is of)
#   BACKUP_BUCKET    the R2 bucket, e.g. aladdin-production-db-backups
#   R2_ENDPOINT      https://<account id>.r2.cloudflarestorage.com (local-test: http://127.0.0.1:<port>)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   an R2 token scoped to BACKUP_BUCKET only
export LC_ALL=C AWS_DEFAULT_REGION=auto AWS_EC2_METADATA_DISABLED=true AWS_PAGER=""

die() { echo "backup: $*" >&2; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

require_env() { local v; for v in "$@"; do [ -n "${!v:-}" ] || die "$v is not set"; done; }

# The only hosted targets. Project refs are not secrets; pinning them here means a credential of the other
# project fails closed instead of producing a backup filed under the wrong label.
HOSTED_BUCKET=aladdin-production-db-backups
expected_ref() {
  case "$BACKUP_LABEL" in
    production) echo kkpkgjrweysgvhvkhzun;;
    acceptance) echo nxossqhdfltcqdwvbewi;;
    *) echo "";;
  esac
}

# Fail closed on a label/target mix-up: a local test never reaches a hosted bucket or database,
# and a hosted label never runs against a local one.
check_target() {
  require_env BACKUP_LABEL BACKUP_BUCKET R2_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  case "$BACKUP_LABEL" in
    production|acceptance)
      case "$R2_ENDPOINT" in https://[0-9a-f]*.r2.cloudflarestorage.com) ;; *) die "a hosted backup must go to R2 ($R2_ENDPOINT)";; esac
      [ "$BACKUP_BUCKET" = "$HOSTED_BUCKET" ] || die "a hosted backup must use the bucket $HOSTED_BUCKET";;
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

# age encryption to every public recipient in AGE_RECIPIENTS (space or newline separated).
# The backup job holds only public keys: it can encrypt, never decrypt.
age_encrypt() {
  local in="$1" out="$2" args=() r
  for r in $AGE_RECIPIENTS; do case "$r" in age1*) args+=(-r "$r");; *) die "AGE_RECIPIENTS holds something that is not an age public key";; esac; done
  [ "${#args[@]}" -ge 1 ] || die "AGE_RECIPIENTS is empty"
  age "${args[@]}" -o "$out" "$in"
}
