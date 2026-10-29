#!/usr/bin/env bash
# Daily alarm. Fails (and, when RESEND_API_KEY is set, emails ALERT_EMAIL) unless the newest database backup is
# younger than MAX_AGE_HOURS (default 26) and at least half the size of the one before it, and, with CHECK_MEDIA,
# that same snapshot's media step finished complete (its .media.json says complete:true). For Production, live
# media records in R2 (which this kit does not copy yet) are an alarm too; for Acceptance a warning.
# Reads object listings and the small plain .media.json only; it never downloads or decrypts a backup.
#
#   BACKUP_LABEL=production BACKUP_BUCKET=... R2_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
#   [CHECK_MEDIA=1] [MAX_AGE_HOURS=26] [RESEND_API_KEY=... ALERT_EMAIL=... ALERT_FROM=...]  bash freshness.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
MAX="${MAX_AGE_HOURS:-26}"
problems=(); warnings=()

# Key, LastModified and Size of the two newest objects under a prefix whose key ends in $2.
newest_two() {
  s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$1" \
    --query "sort_by(Contents[?ends_with(Key, '$2')] || \`[]\`, &LastModified)[-2:].[Key,LastModified,Size]" --output text | grep -v '^None$' || true
}
age_hours() { echo $(( ($(date -u +%s) - $(date -u -d "$1" +%s)) / 3600 )); }

DB="$(newest_two "db/$BACKUP_LABEL/daily/" .tar.age)"
if [ -z "$DB" ]; then problems+=("no database backup exists for $BACKUP_LABEL")
else
  read -r key when size <<< "$(tail -1 <<< "$DB")"
  h="$(age_hours "$when")"; [ "$h" -lt "$MAX" ] || problems+=("newest database backup is ${h} h old ($key)")
  if [ "$(wc -l <<< "$DB")" -ge 2 ]; then
    read -r _ _ prev <<< "$(head -1 <<< "$DB")"
    [ $((size * 2)) -ge "$prev" ] || problems+=("newest database backup is $size bytes, less than half of the previous $prev")
  fi
  if [ -n "${CHECK_MEDIA:-}" ]; then
    M="$(mktemp)"
    if ! s3 s3api get-object --bucket "$BACKUP_BUCKET" --key "${key%.tar.age}.media.json" "$M" >/dev/null 2>&1; then
      problems+=("the media step did not finish for the newest snapshot ($key)")
    else
      python3 - "$M" "$BACKUP_LABEL" > "$M.out" <<'PY' || true
import json, sys
m = json.load(open(sys.argv[1]))
if m.get("complete") is not True:
    print(f"P the newest snapshot's media backup is incomplete: {m.get('missing')} missing, {m.get('copy_failures')} copy failures")
if m.get("r2_media_records_not_covered"):
    kind = "P" if sys.argv[2] == "production" else "W"
    print(f"{kind} {m['r2_media_records_not_covered']} media records live in R2, which this backup does not copy")
PY
      while read -r kind text; do
        case "$kind" in P) problems+=("$text");; W) warnings+=("$text");; esac
      done < "$M.out"
    fi
    rm -f "$M" "$M.out"
  fi
fi
[ "${#warnings[@]}" -eq 0 ] || printf 'warning (%s): %s\n' "$BACKUP_LABEL" "${warnings[@]}"

if [ "${#problems[@]}" -eq 0 ]; then log "backups for $BACKUP_LABEL are fresh"; exit 0; fi
printf 'BACKUP ALERT (%s):\n' "$BACKUP_LABEL"; printf '  %s\n' "${problems[@]}"
if [ -n "${RESEND_API_KEY:-}" ] && [ -n "${ALERT_EMAIL:-}" ]; then
  body="$(printf '%s\n' "${problems[@]}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  curl -fsS https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
    -d "{\"from\":\"${ALERT_FROM:-Aladdin backups <no-reply@aladdindecore.com>}\",\"to\":[\"$ALERT_EMAIL\"],\"subject\":\"Aladdin backup alert: $BACKUP_LABEL\",\"text\":$body}" >/dev/null \
    || echo "could not send the alert email"
fi
exit 1
