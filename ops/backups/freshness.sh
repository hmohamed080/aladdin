#!/usr/bin/env bash
# Daily alarm. Fails (and, when RESEND_API_KEY is set, emails ALERT_EMAIL) unless the newest database backup is
# younger than MAX_AGE_HOURS (default 26) and at least half the size of the one before it, and, unless
# switched off, that same snapshot's media steps finished: its .media.json is present, readable, well formed,
# consistent and says complete, and its inventory is stored. For Production, live media records in R2 that this
# kit does not copy are an alarm too; for Acceptance a warning.
# It FAILS CLOSED: anything it cannot read or verify is a problem, never silence, and a crash of the check itself
# raises the alarm too. It reads object listings and the small plain .media.json only; it never downloads or
# decrypts a backup.
#
#   BACKUP_LABEL=production BACKUP_BUCKET=... R2_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
#   [CHECK_MEDIA=0] [MAX_AGE_HOURS=26] [RESEND_API_KEY=... ALERT_EMAIL=... ALERT_FROM=...]  bash freshness.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
MAX="${MAX_AGE_HOURS:-26}"
problems=(); warnings=(); ALERTED=0

notify() {
  ALERTED=1
  printf 'BACKUP ALERT (%s):\n' "$BACKUP_LABEL"; printf '  %s\n' "${problems[@]}"
  if [ -n "${RESEND_API_KEY:-}" ] && [ -n "${ALERT_EMAIL:-}" ]; then
    local body
    body="$(printf '%s\n' "${problems[@]}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
    curl -fsS https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
      -d "{\"from\":\"${ALERT_FROM:-Aladdin backups <no-reply@aladdindecore.com>}\",\"to\":[\"$ALERT_EMAIL\"],\"subject\":\"Aladdin backup alert: $BACKUP_LABEL\",\"text\":$body}" >/dev/null \
      || echo "could not send the alert email"
  fi
}
# A check that dies half way must not look like a pass or go quiet.
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$ALERTED" -eq 0 ]; then problems=("the freshness check itself failed (exit $rc) before it could finish"); notify; fi
}
trap on_exit EXIT

# Key, LastModified and Size of the two newest objects under a prefix whose key ends in $2. Fails when the
# listing itself fails, so an unreadable bucket is not reported as an empty one.
newest_two() {
  local out
  out="$(s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$1" \
    --query "sort_by(Contents[?ends_with(Key, '$2')] || \`[]\`, &LastModified)[-2:].[Key,LastModified,Size]" --output text)" || return 1
  grep -v '^None$' <<< "$out" || true
}
age_hours() { echo $(( ($(date -u +%s) - $(date -u -d "$1" +%s)) / 3600 )); }

if ! DB="$(newest_two "db/$BACKUP_LABEL/daily/" .tar.age)"; then
  problems+=("the backup bucket cannot be listed for $BACKUP_LABEL")
elif [ -z "$DB" ]; then
  problems+=("no database backup exists for $BACKUP_LABEL")
else
  read -r key when size <<< "$(tail -1 <<< "$DB")"
  h="$(age_hours "$when")" || h=""
  case "$h" in ''|*[!0-9-]*) problems+=("cannot read the age of the newest database backup ($key)");;
    *) [ "$h" -lt "$MAX" ] || problems+=("newest database backup is ${h} h old ($key)");; esac
  if [ "$(wc -l <<< "$DB")" -ge 2 ]; then
    read -r _ _ prev <<< "$(head -1 <<< "$DB")"
    [ $((size * 2)) -ge "$prev" ] || problems+=("newest database backup is $size bytes, less than half of the previous $prev")
  fi
  # Legacy Supabase-Storage files (opt-in, being retired) and R2-hosted originals each have their own record.
  kinds=()
  [ "${CHECK_MEDIA:-${LEGACY_MEDIA_BACKUP:-0}}" = 0 ] || kinds+=(media)
  [ "${CHECK_R2_MEDIA:-${R2_MEDIA_BACKUP:-0}}" = 0 ] || kinds+=(r2media)
  for kind in "${kinds[@]}"; do
    if ! found="$(media_findings "${key%/*}" "$(basename "$key" .tar.age)" "$kind")"; then
      problems+=("the $kind record of the newest snapshot could not be checked ($key)")
    fi
    while IFS= read -r line; do
      case "$line" in
        "") ;;
        "P "*|"A "*) problems+=("${line#? }");;
        "W "*) warnings+=("${line#? }");;
        *) problems+=("unexpected result of the $kind record check: $line");;
      esac
    done <<< "${found:-}"
  done
  # R2 media records exist but nothing backs them up: never silent. Read from the snapshot's small plain manifest.
  if [ "${CHECK_R2_MEDIA:-${R2_MEDIA_BACKUP:-0}}" = 0 ]; then
    manifest="$(mktemp)"
    if ! s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "${key%.tar.age}.json" "$manifest" >/dev/null 2>&1 \
        || ! r2n="$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["r2_media_records"]))' "$manifest" 2>/dev/null)"; then
      rm -f "$manifest"
      problems+=("the snapshot manifest of $key cannot be read, so R2 media coverage is unknown")
    elif rm -f "$manifest"; [ "$r2n" -gt 0 ]; then
      msg="$r2n media records live in R2 and no independent R2 media backup is switched on (R2_MEDIA_BACKUP)"
      if [ "$BACKUP_LABEL" = production ]; then problems+=("$msg"); else warnings+=("$msg"); fi
    fi
  fi
fi
[ "${#warnings[@]}" -eq 0 ] || printf 'warning (%s): %s\n' "$BACKUP_LABEL" "${warnings[@]}"

if [ "${#problems[@]}" -eq 0 ]; then log "backups for $BACKUP_LABEL are fresh"; exit 0; fi
notify
exit 1
