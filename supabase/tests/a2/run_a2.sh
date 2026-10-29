#!/usr/bin/env bash
set -euo pipefail

# Phase A2 runner - LOCAL ISOLATED STACK ONLY.
#
#   DB_CONTAINER=supabase_db_<isolated> bash supabase/tests/a2/run_a2.sh
#
# 1. refuses anything that is not the isolated stack of THIS worktree (db_target.sh + project_id match);
# 2. resets that stack's database (the suite creates audited fixtures that cannot be deleted: audit_log is
#    append-only) so every run starts from migrations + seeds and is reproducible;
# 3. runs the A2 suite (real GoTrue + PostgREST + Postgres, fake OTP only, nothing is sent);
# 4. re-runs the existing identity / phone / reservation / registration pgTAP files that this work must not break;
# 5. re-runs the existing real-session phone-change concurrency script.
#
# Needs a running stack started with the fake-provider settings documented in
# docs/security/PHONE_IDENTITY_A2_LOCAL_VERIFICATION_REPORT.md ("Reproduce"). Nothing here touches hosted projects.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Native Windows node needs D:/... rather than /d/...; `pwd -W` exists only in Git Bash.
node_here="$(cd "${here}" && (pwd -W 2>/dev/null || pwd))"
repo="$(cd "${here}/../../.." && pwd)"
cd "${repo}"
source "${here}/../lib/db_target.sh"
db_target_require

project_id="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -n 1)"
if [[ "supabase_db_${project_id}" != "${db_container}" ]]; then
  echo "[a2] REFUSED: DB_CONTAINER (${db_container}) is not this worktree's stack (supabase_db_${project_id})." >&2
  exit 2
fi
export SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN="${SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN:-a2-fake-never-valid}"

logs="${A2_LOG_DIR:-${repo}/.a2-logs}"
mkdir -p "${logs}"
summary="${repo}/docs/security/phone-identity-a2/${A2_SUMMARY:-regression-summary.txt}"
: > "${summary}"
note() { echo "$*" | tee -a "${summary}"; }

echo "[a2] resetting isolated stack ${db_container}"
supabase db reset --yes > "${logs}/db-reset.log" 2>&1 || { tail -n 20 "${logs}/db-reset.log"; exit 1; }
note "db reset: ok ($(grep -c '^Applying migration' "${logs}/db-reset.log") migrations applied from scratch)"

echo "[a2] A2 suite"
set +e
A2_EVIDENCE="${A2_EVIDENCE:-evidence.json}" DB_CONTAINER="${db_container}" node "${node_here}/phone_identity_a2_local.test.mjs" | tee "${logs}/a2-suite.log"
suite_rc=${PIPESTATUS[0]}
set -e
note "A2 suite: $(tail -n 1 "${logs}/a2-suite.log") exit=${suite_rc}"

echo "[a2] existing pgTAP regression (identity / phone / reservation / registration)"
files=(
  # A2_EXTRA_PGTAP (space separated, optional) is appended below, e.g. the pending-registration overlay tests.
  01_identity_profiles_test.sql
  10_account_type_eligibility_test.sql
  87_registration_data_sync_test.sql
  93_business_rpc_compatibility_phone_test.sql
  98_secondary_phone_reservations_test.sql
  104_installer_phone_alias_guard_test.sql
  105_installer_phone_change_journal_test.sql
  106_installer_sensitive_action_audit_test.sql
  107_installer_alias_email_guard_test.sql
  108_installer_integration_compat_test.sql
  109_reauth_operations_and_phone_coexistence_test.sql
  110_contact_email_claims_test.sql
)
args=()
for f in "${files[@]}"; do args+=("supabase/tests/${f}"); done
for f in ${A2_EXTRA_PGTAP:-}; do args+=("supabase/tests/${f}"); files+=("${f}"); done
set +e
supabase test db "${args[@]}" > "${logs}/pgtap-regression.log" 2>&1
pg_rc=$?
set -e
note "pgTAP regression (${#files[@]} files): $(grep -E '^(Files=|Result:)' "${logs}/pgtap-regression.log" | tr '\n' ' ') exit=${pg_rc}"

echo "[a2] existing real-session concurrency script (phone change journal)"
set +e
DB_CONTAINER="${db_container}" bash supabase/tests/installer_phone_change_concurrency_test.sh > "${logs}/phone-change-concurrency.log" 2>&1
cc_rc=$?
set -e
note "installer phone-change concurrency: $(tail -n 1 "${logs}/phone-change-concurrency.log") exit=${cc_rc}"

# Raw logs stay local (.a2-logs is untracked); only the counts above are committed.
[[ ${suite_rc} -eq 0 && ${pg_rc} -eq 0 && ${cc_rc} -eq 0 ]] && note "OVERALL: PASS (0 FAIL; GAP/EVAL rows are expected, see evidence.json)" || { note "OVERALL: FAIL"; exit 1; }
