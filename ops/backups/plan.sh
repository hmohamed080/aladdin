#!/usr/bin/env bash
# Decides which projects a workflow run covers. Pure: reads only its environment and the clock, so it is tested
# offline (plan-test.sh). Prints one JSON array for the job matrix, or fails with the reason.
#
#   plan.sh backup      ["acceptance","production"] (subset)
#   plan.sh restore     true | false: whether this run of the Monthly restore test may start (see below)
#   plan.sh freshness   [{"label":"acceptance","max_age_hours":26}, ...]  (scheduled: per switches; manual: Acceptance always)
#
# Environment (repository variables in aladdin-backups, set by the owner):
#   EVENT                       schedule | workflow_dispatch
#   PRODUCTION_RESTORE_SCHEDULE_ENABLED  "true" only when the owner separately approves the SCHEDULED monthly Production restore
#   INPUT_LABEL, INPUT_CONFIRM  manual runs: the chosen project, and for Production the typed confirmation
#   PRODUCTION_BACKUP_ENABLED   "true" only after the owner's Production activation GO
#   ACCEPTANCE_BACKUP_SCHEDULE  off (default) | daily (the Acceptance trial) | weekly (Sundays, Cairo)
#   INPUT_MAX_AGE_HOURS         manual freshness only: a LOWER age limit (1-25) for the alarm drill; never raises it
#   NOW                         optional UTC time for tests, e.g. 2026-10-29T23:30:00Z
#
# Scheduled backups fire at 22:30, 23:30, 00:30 and 01:30 UTC. Only a run whose Cairo hour is 01-03 counts, so
# exactly three firings a night count, whatever Cairo's offset: 01:30, 02:30 and 03:30 Cairo (winter UTC+2: the
# 23:30, 00:30 and 01:30 firings; summer UTC+3: 22:30, 23:30 and 00:30). The first takes the backup; the others
# are its retries: db-backup.sh does nothing when one of today's snapshots is complete (media included) and
# takes a new snapshot when none is. A late GitHub start up to 03:59 Cairo still counts.
set -euo pipefail
PRODUCTION_CONFIRMATION="back up production"
mode="${1:?usage: plan.sh backup|freshness|restore}"
now="${NOW:-$(date -u +%FT%TZ)}"
read -r hour dow <<< "$(TZ=Africa/Cairo date -d "$now" +'%H %u')"
schedule="${ACCEPTANCE_BACKUP_SCHEDULE:-off}"
case "$schedule" in off|daily|weekly) ;; *) echo "ACCEPTANCE_BACKUP_SCHEDULE must be off, daily or weekly" >&2; exit 1;; esac
production=false; [ "${PRODUCTION_BACKUP_ENABLED:-}" = true ] && production=true

# Monthly restore test. A manual run is always allowed (it restores what it is asked to). A SCHEDULED run restores
# Production, so it needs BOTH Production backups switched on AND its own switch: enabling backups alone never
# starts a scheduled restore, whose environment and keys may not exist yet.
if [ "$mode" = restore ]; then
  case "${EVENT:-}" in
    workflow_dispatch) echo true ;;
    schedule) if [ "$production" = true ] && [ "${PRODUCTION_RESTORE_SCHEDULE_ENABLED:-}" = true ]; then echo true; else echo false; fi ;;
    *) echo "unknown event: ${EVENT:-}" >&2; exit 1 ;;
  esac
  exit 0
fi

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
  freshness:schedule)
    case "$schedule" in daily) labels+=('{"label":"acceptance","max_age_hours":26}');; weekly) labels+=('{"label":"acceptance","max_age_hours":194}');; esac
    [ "$production" = true ] && labels+=('{"label":"production","max_age_hours":26}') ;;
  freshness:workflow_dispatch)
    # A manual check always covers Acceptance, even while its schedule is off (the first manual backup and restore
    # test happen before any schedule exists); it only reads the bucket. Production only once activated.
    case "$schedule" in weekly) labels+=('{"label":"acceptance","max_age_hours":194}');; *) labels+=('{"label":"acceptance","max_age_hours":26}');; esac
    [ "$production" = true ] && labels+=('{"label":"production","max_age_hours":26}') ;;
  *) echo "unknown mode or event: $mode ${EVENT:-}" >&2; exit 1 ;;
esac
# Alarm drill: a manual freshness run may tighten the age limit (so a healthy, real snapshot trips the alarm and the
# alert path can be seen working) but never loosen it. Scheduled runs ignore it.
if [ "$mode" = freshness ] && [ "${EVENT:-}" = workflow_dispatch ] && [ -n "${INPUT_MAX_AGE_HOURS:-}" ]; then
  case "$INPUT_MAX_AGE_HOURS" in ''|*[!0-9]*|0*) echo "max_age_hours must be a whole number from 1 up" >&2; exit 1;; esac
  for i in "${!labels[@]}"; do
    limit="$(sed -n 's/.*"max_age_hours":\([0-9]*\).*/\1/p' <<< "${labels[$i]}")"
    [ "$INPUT_MAX_AGE_HOURS" -lt "$limit" ] || { echo "max_age_hours may only be lowered (below $limit)" >&2; exit 1; }
    labels[i]="${labels[$i]/\"max_age_hours\":$limit/\"max_age_hours\":$INPUT_MAX_AGE_HOURS}"
  done
fi
if [ "$mode" = backup ]; then
  printf '['; first=1; for l in "${labels[@]}"; do [ $first = 1 ] || printf ','; printf '"%s"' "$l"; first=0; done; echo ']'
else
  ( IFS=,; echo "[${labels[*]}]" )
fi
