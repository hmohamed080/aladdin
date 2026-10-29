#!/usr/bin/env bash
# Decides which projects a workflow run covers. Pure: reads only its environment and the clock, so it is tested
# offline (plan-test.sh). Prints one JSON array for the job matrix, or fails with the reason.
#
#   plan.sh backup      ["acceptance","production"] (subset)
#   plan.sh freshness   [{"label":"acceptance","max_age_hours":26}, ...]
#
# Environment (repository variables in aladdin-backups, set by the owner):
#   EVENT                       schedule | workflow_dispatch
#   INPUT_LABEL, INPUT_CONFIRM  manual runs: the chosen project, and for Production the typed confirmation
#   PRODUCTION_BACKUP_ENABLED   "true" only after the owner's Production activation GO
#   ACCEPTANCE_BACKUP_SCHEDULE  off (default) | daily (the Acceptance trial) | weekly (Sundays, Cairo)
#   NOW                         optional UTC time for tests, e.g. 2026-10-29T23:30:00Z
#
# Scheduled backups fire at 22:30 and 23:30 UTC. Only a run whose Cairo hour is 01-03 counts, so the backup is
# taken at 01:30 Cairo both in winter (UTC+2, the second firing) and in summer (UTC+3, the first; the second
# then finds today's backup and does nothing). A late GitHub start up to 03:59 Cairo still counts.
set -euo pipefail
PRODUCTION_CONFIRMATION="back up production"
mode="${1:?usage: plan.sh backup|freshness}"
now="${NOW:-$(date -u +%FT%TZ)}"
read -r hour dow <<< "$(TZ=Africa/Cairo date -d "$now" +'%H %u')"
schedule="${ACCEPTANCE_BACKUP_SCHEDULE:-off}"
case "$schedule" in off|daily|weekly) ;; *) echo "ACCEPTANCE_BACKUP_SCHEDULE must be off, daily or weekly" >&2; exit 1;; esac
production=false; [ "${PRODUCTION_BACKUP_ENABLED:-}" = true ] && production=true

labels=()
case "$mode:${EVENT:-}" in
  backup:schedule)
    case "$hour" in 01|02|03) ;; *) echo '[]'; exit 0;; esac
    { [ "$schedule" = daily ] || { [ "$schedule" = weekly ] && [ "$dow" = 7 ]; }; } && labels+=(acceptance)
    [ "$production" = true ] && labels+=(production) ;;
  backup:workflow_dispatch)
    case "${INPUT_LABEL:-}" in
      acceptance) labels+=(acceptance) ;;
      production)
        [ "$production" = true ] || { echo "Production backups are not activated: PRODUCTION_BACKUP_ENABLED is not true" >&2; exit 1; }
        [ "${INPUT_CONFIRM:-}" = "$PRODUCTION_CONFIRMATION" ] || { echo "type \"$PRODUCTION_CONFIRMATION\" to confirm a manual Production backup" >&2; exit 1; }
        labels+=(production) ;;
      *) echo "choose acceptance or production" >&2; exit 1 ;;
    esac ;;
  freshness:schedule|freshness:workflow_dispatch)
    case "$schedule" in daily) labels+=('{"label":"acceptance","max_age_hours":26}');; weekly) labels+=('{"label":"acceptance","max_age_hours":194}');; esac
    [ "$production" = true ] && labels+=('{"label":"production","max_age_hours":26}') ;;
  *) echo "unknown mode or event: $mode ${EVENT:-}" >&2; exit 1 ;;
esac
if [ "$mode" = backup ]; then
  printf '['; first=1; for l in "${labels[@]}"; do [ $first = 1 ] || printf ','; printf '"%s"' "$l"; first=0; done; echo ']'
else
  ( IFS=,; echo "[${labels[*]}]" )
fi
