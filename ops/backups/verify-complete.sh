#!/usr/bin/env bash
# Must be the final successful data-moving step, never run for a plan or skip.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
check_target
if [ "${BACKUP_KIND:-backup}" = restore_test ]; then
  grep -qx 'RESULT: PASS' "$OUT/REPORT.txt"
  # A database-only rehearsal must not claim full database + media verification.
  [ "${LEGACY_MEDIA_BACKUP:-}" = 1 ] || [ "${R2_MEDIA_BACKUP:-}" = 1 ] || die 'media verification disabled'
else
  . "${BACKUP_STATE_DIR:?}/db.env"
  [ "${SKIPPED:-0}" != 1 ] || die 'already completed: no new backup was performed'
  [ "${LEGACY_MEDIA_BACKUP:-}" = 1 ] || [ "${R2_MEDIA_BACKUP:-}" = 1 ] || die 'media coverage disabled'
  # Read the immutable manifests back; a partial upload cannot pass.
  snapshot_done "$NAME" $PREFIXES || die 'incomplete database/media coverage'
  for prefix in $PREFIXES; do
    findings="$(media_coverage "$prefix" "$NAME")"
    ! grep -q '^[PAW] ' <<< "$findings" || die 'required media is not covered'
  done
fi
