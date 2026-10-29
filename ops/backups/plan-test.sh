#!/usr/bin/env bash
# Offline tests of plan.sh (which projects each run covers) and of the label/target checks in lib.sh.
# Proves the real schedule across Cairo's daylight-saving changes. Needs bash, GNU date with tzdata, python3.
#   bash ops/backups/plan-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL  $1: expected [$3], got [$2]"; fi; }
plan() { env -i PATH="$PATH" "$@" bash "$HERE/plan.sh" backup 2>/dev/null || echo ERROR; }

# Schedule: both cron firings (22:30 and 23:30 UTC) around each change. Exactly one counts per Cairo night,
# except in summer where both count and db-backup's SKIP_IF_TAKEN makes the second one do nothing.
echo "Scheduled firings (UTC -> Cairo) and whether they back up Production:"
for d in 2026-04-22 2026-04-23 2026-04-24 2026-07-15 2026-10-28 2026-10-29 2026-10-30 2027-01-15; do
  for t in 22:30 23:30; do
    r="$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=true NOW="${d}T$t:00Z")"
    printf '  %s %s UTC = %s Cairo -> %s\n' "$d" "$t" "$(TZ=Africa/Cairo date -d "${d}T$t:00Z" +'%a %F %H:%M %Z')" "$r"
  done
done
check "winter 22:30 UTC is 00:30 Cairo: skipped" "$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=true NOW=2027-01-15T22:30:00Z)" '[]'
check "winter 23:30 UTC is 01:30 Cairo: runs" "$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=true NOW=2027-01-15T23:30:00Z)" '["production"]'
check "summer 22:30 UTC is 01:30 Cairo: runs" "$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=true NOW=2026-07-15T22:30:00Z)" '["production"]'
check "summer 23:30 UTC is 02:30 Cairo: counts (the backup step finds today's and skips)" "$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=true NOW=2026-07-15T23:30:00Z)" '["production"]'
check "night of the October change (2026-10-29/30): 00:30 skipped" "$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=true NOW=2026-10-29T22:30:00Z)" '[]'
check "night of the October change: 01:30 runs" "$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=true NOW=2026-10-29T23:30:00Z)" '["production"]'
check "night of the April change (2026-04-23/24): 01:30 runs" "$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=true NOW=2026-04-23T22:30:00Z)" '["production"]'
check "a run delayed to 03:59 Cairo still counts" "$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=true NOW=2027-01-16T01:59:00Z)" '["production"]'
check "a run delayed past 04:00 Cairo does not" "$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=true NOW=2027-01-16T02:01:00Z)" '[]'

# Production gate.
check "scheduled Production without activation: nothing" "$(plan EVENT=schedule NOW=2027-01-15T23:30:00Z)" '[]'
check "scheduled Production with the switch at a wrong value: nothing" "$(plan EVENT=schedule PRODUCTION_BACKUP_ENABLED=TRUE NOW=2027-01-15T23:30:00Z)" '[]'
check "manual Production without activation: refused" "$(plan EVENT=workflow_dispatch INPUT_LABEL=production INPUT_CONFIRM='back up production')" ERROR
check "manual Production activated but unconfirmed: refused" "$(plan EVENT=workflow_dispatch INPUT_LABEL=production PRODUCTION_BACKUP_ENABLED=true INPUT_CONFIRM=yes)" ERROR
check "manual Production activated and confirmed: runs" "$(plan EVENT=workflow_dispatch INPUT_LABEL=production PRODUCTION_BACKUP_ENABLED=true INPUT_CONFIRM='back up production')" '["production"]'
check "manual Acceptance: runs, never Production" "$(plan EVENT=workflow_dispatch INPUT_LABEL=acceptance PRODUCTION_BACKUP_ENABLED=true)" '["acceptance"]'
check "unknown manual label: refused" "$(plan EVENT=workflow_dispatch INPUT_LABEL=staging)" ERROR

# Acceptance schedule.
check "Acceptance off by default" "$(plan EVENT=schedule NOW=2026-11-01T23:30:00Z)" '[]'
check "Acceptance trial: every night" "$(plan EVENT=schedule ACCEPTANCE_BACKUP_SCHEDULE=daily NOW=2026-11-03T23:30:00Z)" '["acceptance"]'
check "Acceptance weekly: a Sunday (Cairo)" "$(plan EVENT=schedule ACCEPTANCE_BACKUP_SCHEDULE=weekly NOW=2026-10-31T23:30:00Z)" '["acceptance"]'
check "Acceptance weekly: not a Monday" "$(plan EVENT=schedule ACCEPTANCE_BACKUP_SCHEDULE=weekly NOW=2026-11-01T23:30:00Z)" '[]'
check "both projects" "$(plan EVENT=schedule ACCEPTANCE_BACKUP_SCHEDULE=daily PRODUCTION_BACKUP_ENABLED=true NOW=2026-11-03T23:30:00Z)" '["acceptance","production"]'
check "bad Acceptance schedule: refused" "$(plan EVENT=schedule ACCEPTANCE_BACKUP_SCHEDULE=sometimes NOW=2026-11-03T23:30:00Z)" ERROR

fresh() { env -i PATH="$PATH" "$@" bash "$HERE/plan.sh" freshness 2>/dev/null || echo ERROR; }
check "freshness: nothing before any activation" "$(fresh EVENT=schedule)" '[]'
check "freshness: the Acceptance trial is watched daily" "$(fresh EVENT=schedule ACCEPTANCE_BACKUP_SCHEDULE=daily)" '[{"label":"acceptance","max_age_hours":26}]'
check "freshness: weekly Acceptance allows 8 days" "$(fresh EVENT=schedule ACCEPTANCE_BACKUP_SCHEDULE=weekly PRODUCTION_BACKUP_ENABLED=true)" \
  '[{"label":"acceptance","max_age_hours":194},{"label":"production","max_age_hours":26}]'

# Target checks: a credential or URL of the other project, or a wrong bucket, is refused before any request.
lib() { ( export BACKUP_LABEL="$1" BACKUP_BUCKET="${4:-aladdin-production-db-backups}" R2_ENDPOINT=https://0123abcd.r2.cloudflarestorage.com \
  AWS_ACCESS_KEY_ID=x AWS_SECRET_ACCESS_KEY=x; . "$HERE/lib.sh"; check_target && $2 "$3" ) >/dev/null 2>&1 && echo ok || echo refused; }
jwt() { python3 -c 'import base64,json,sys; e=lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("="); print(e({"alg":"HS256"})+"."+e({"ref":sys.argv[1],"role":sys.argv[2]})+".sig")' "$1" "$2"; }
PROD=kkpkgjrweysgvhvkhzun; ACC=nxossqhdfltcqdwvbewi
check "Acceptance pooler URL for Acceptance" "$(lib acceptance check_db_url "postgresql://postgres.$ACC:p%40ss@aws-0-eu-central-1.pooler.supabase.com:5432/postgres")" ok
check "Production pooler URL under the Acceptance label" "$(lib acceptance check_db_url "postgresql://postgres.$PROD:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres")" refused
check "Acceptance URL under the Production label" "$(lib production check_db_url "postgresql://postgres.$ACC:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres")" refused
check "Production direct host for Production" "$(lib production check_db_url "postgresql://postgres:pw@db.$PROD.supabase.co:5432/postgres")" ok
check "the transaction pooler (6543) is refused" "$(lib production check_db_url "postgresql://postgres.$PROD:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres")" refused
check "a look-alike host is refused" "$(lib production check_db_url "postgresql://postgres.$PROD:pw@pooler.supabase.com.evil.test:5432/postgres")" refused
check "SUPABASE_URL of the other project is refused" "$(lib acceptance check_supabase_url "https://$PROD.supabase.co")" refused
check "SUPABASE_URL of its own project" "$(lib acceptance check_supabase_url "https://$ACC.supabase.co")" ok
check "a Production service key under the Acceptance label is refused" "$(lib acceptance check_service_key "$(jwt $PROD service_role)")" refused
check "an anon key is refused" "$(lib acceptance check_service_key "$(jwt $ACC anon)")" refused
check "its own service key" "$(lib acceptance check_service_key "$(jwt $ACC service_role)")" ok
check "a hosted label with another bucket is refused" "$(lib acceptance check_supabase_url "https://$ACC.supabase.co" some-other-bucket)" refused
check "Production writes need the activation switch" "$(lib production require_production_go "")" refused
check "Acceptance writes do not" "$(lib acceptance require_production_go "")" ok

echo "plan-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
