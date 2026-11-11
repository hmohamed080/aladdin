#!/usr/bin/env bash
# Binds a database to its Admin Backup environment (public.admin_backup_initialize), the one step #140 left undone.
# Default = READ-ONLY preflight: calls only public.backup_schedule_read and reports the binding. Nothing is written.
# --apply = the single hosted write. It needs the owner's GO for that exact environment, a typed phrase, and a super
# admin user id as the audited actor. Idempotent for the same environment; a different value is refused by the database.
#   BACKUP_LABEL=acceptance SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... bash ops/backups/admin-initialize.sh
#   ... ACTOR_USER_ID=<uuid> CONFIRM="initialize acceptance" bash ops/backups/admin-initialize.sh --apply
# Schedules stay OFF and Production stays disabled: this changes neither. The service-role key is never printed.
set -uo pipefail
die() { echo "admin-initialize: $*" >&2; exit 1; }
MODE=preflight
case "${1:-}" in "") ;; --apply) MODE=apply ;; *) die "unknown argument (only --apply is accepted)" ;; esac

case "${BACKUP_LABEL:-}" in
  acceptance) REF=nxossqhdfltcqdwvbewi ;;
  production) REF=kkpkgjrweysgvhvkhzun ;;
  *) die "BACKUP_LABEL must be acceptance or production" ;;
esac
URL="${SUPABASE_URL:-}"; URL="${URL%/}"
[ "$URL" = "https://$REF.supabase.co" ] || die "SUPABASE_URL is not the $BACKUP_LABEL project (expected https://$REF.supabase.co)"
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || die "SUPABASE_SERVICE_ROLE_KEY is required"
case "$SUPABASE_SERVICE_ROLE_KEY" in eyJ*.*.*)
  # A JWT key must name this project and the service role; an sb_secret_ key is bound by the URL check above.
  payload=$(printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="$payload="; done
  claims=$(printf '%s' "$payload" | base64 -d 2>/dev/null) || die "service-role key is not readable"
  printf '%s' "$claims" | grep -q "\"ref\":\"$REF\"" || die "service-role key does not belong to the $BACKUP_LABEL project"
  printf '%s' "$claims" | grep -q '"role":"service_role"' || die "key is not a service_role key" ;; esac

rpc() { # <function> <json body>; prints the body, never the key
  curl -fsS --max-time 20 -X POST "$URL/rest/v1/rpc/$1" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "$2" 2>/dev/null
}
field() { python3 -c 'import json,sys; v=json.load(sys.stdin).get(sys.argv[1]); print("null" if v is None else str(v).lower() if isinstance(v,bool) else v)' "$1"; }

state=$(rpc backup_schedule_read '{}') || die "backup_schedule_read failed (is migration 20261107090006 applied?)"
init=$(printf '%s' "$state" | field initialized) || die "unexpected response"
env_now=$(printf '%s' "$state" | field environment)
echo "label=$BACKUP_LABEL project=$REF initialized=$init environment=$env_now acceptance_schedule=$(printf '%s' "$state" | field acceptance_schedule) production_enabled=$(printf '%s' "$state" | field production_enabled) version=$(printf '%s' "$state" | field version)"
if [ "$init" = true ] && [ "$env_now" != "$BACKUP_LABEL" ]; then die "bound to '$env_now', not '$BACKUP_LABEL': refusing"; fi
if [ "$MODE" = preflight ]; then
  [ "$init" = true ] && echo "RESULT: ALREADY INITIALIZED (read-only; nothing written)" || echo "RESULT: NOT INITIALIZED (read-only; nothing written). --apply needs the owner's GO."
  exit 0
fi
[ "$init" = true ] && { echo "RESULT: ALREADY INITIALIZED (idempotent; nothing written)"; exit 0; }
[ "${CONFIRM:-}" = "initialize $BACKUP_LABEL" ] || die "type CONFIRM=\"initialize $BACKUP_LABEL\" to write"
printf '%s' "${ACTOR_USER_ID:-}" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' || die "ACTOR_USER_ID must be the super admin's user uuid"
out=$(rpc admin_backup_initialize "{\"p_actor\":\"$ACTOR_USER_ID\",\"p_environment\":\"$BACKUP_LABEL\"}") || die "admin_backup_initialize was refused (actor must hold backup.schedule_manage)"
[ "$out" = "\"$BACKUP_LABEL\"" ] || die "unexpected result from admin_backup_initialize"
state=$(rpc backup_schedule_read '{}') || die "post-check failed"
[ "$(printf '%s' "$state" | field initialized)" = true ] && [ "$(printf '%s' "$state" | field environment)" = "$BACKUP_LABEL" ] || die "post-check: binding not visible"
echo "RESULT: INITIALIZED as $BACKUP_LABEL (post-check read back; schedule and Production switch unchanged)"
