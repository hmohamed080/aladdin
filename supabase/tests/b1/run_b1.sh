#!/usr/bin/env bash
set -euo pipefail

# Phase B1 runner - LOCAL ISOLATED STACK ONLY.
#
#   DB_CONTAINER=supabase_db_<isolated> bash supabase/tests/b1/run_b1.sh                       # contract focused unit integration concurrency
#   B1_STEPS="full" DB_CONTAINER=... bash supabase/tests/b1/run_b1.sh                          # every pgTAP file, alone
#   B1_STEPS="contract focused unit full integration concurrency" ...                          # everything in one go
#
# Steps (each invocation resets the isolated database first, so any step can be run independently from a clean state):
#   contract     function-permission contract (supabase/tests/b1/permission_contract.mjs)
#   focused      authority pgTAP + the identity / phone / reservation / registration pgTAP files
#   full         EVERY pgTAP file in the repository (`supabase test db`)
#   unit         frontend unit tests
#   integration  real-database run of the real service (fake transport; nothing is sent)
#   concurrency  the existing real-session phone-change concurrency script (it COMMITS data - always last)
#
# Reliability: the runner refuses anything but this worktree's isolated stack; every step's exit code is recorded and any nonzero
# code fails the run; a step ALSO fails if its log lacks the expected success marker, so a truncated or killed step can never read
# as PASS. Raw logs stay in .b1-logs (untracked); only counts go to docs/security/phone-identity-b1/.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "${here}/../../.." && pwd)"
cd "${repo}"
source "${here}/../lib/db_target.sh"
db_target_require

project_id="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -n 1)"
if [[ "supabase_db_${project_id}" != "${db_container}" ]]; then
  echo "[b1] REFUSED: DB_CONTAINER (${db_container}) is not this worktree's stack (supabase_db_${project_id})." >&2
  exit 2
fi

steps="${B1_STEPS:-contract focused unit integration concurrency}"
want() { [[ " ${steps} " == *" $1 "* ]]; }
# Run order is fixed regardless of how B1_STEPS is written: everything that rolls back first, the committing script last.
for s in ${steps}; do
  case "$s" in contract|focused|full|unit|integration|concurrency) ;; *) echo "[b1] unknown step '$s'" >&2; exit 2;; esac
done

logs="${B1_LOG_DIR:-${repo}/.b1-logs}"
mkdir -p "${logs}" docs/security/phone-identity-b1
summary="${repo}/docs/security/phone-identity-b1/${B1_SUMMARY:-regression-summary.txt}"
if [[ "${B1_SUMMARY_APPEND:-0}" != "1" ]]; then : > "${summary}"; fi
note() { echo "$*" | tee -a "${summary}"; }
rc_all=0

# run <logfile> <command...> prints the exit code and never aborts the script. It executes inside $( ), so the caller folds the
# code into rc_all with finish (a variable assigned here would be lost with the subshell).
run() {
  local log="$1"; shift
  set +e; "$@" > "${log}" 2>&1; local rc=$?; set -e
  echo "${rc}"
}
hint() { # plain-language meaning of the codes seen in practice
  case "$1" in
    0) ;;
    127) echo " [127 = a command inside the step could not be launched; seen once when the host was reaping processes for memory - check free memory and the step log]";;
    1[3-9][0-9]) echo " [$(( $1 - 128 )) = killed by signal $(( $1 - 128 )) (137 = SIGKILL, typically the OOM killer or a memory reaper)]";;
    *) echo " [nonzero exit]";;
  esac
}
# finish <label> <rc> <logfile> <success-marker-regex> <summary-text>
finish() {
  local label="$1" rc="$2" log="$3" marker="$4" text="$5" status="ok"
  if [[ "${rc}" -ne 0 ]]; then status="FAILED exit=${rc}$(hint "${rc}")"; rc_all=1
  elif ! sed 's/\x1b\[[0-9;]*m//g' "${log}" | grep -Eq "${marker}"; then status="FAILED: exit 0 but the log lacks the expected success marker (/${marker}/) - treated as unverified"; rc_all=1; fi
  note "${label}: ${text} -> ${status}"
}

echo "[b1] steps: ${steps}; resetting isolated stack ${db_container}"
supabase db reset --yes > "${logs}/db-reset.log" 2>&1 || { tail -n 20 "${logs}/db-reset.log"; exit 1; }
note "db reset: ok ($(grep -c '^Applying migration' "${logs}/db-reset.log") migrations applied from scratch, incl. 20261030090001)"
if ! sed -n '/Applying migration 20261030090001/p' "${logs}/db-reset.log" | grep -q .; then note "db reset: FAILED - the B1 migration was not applied"; exit 1; fi

if want contract; then
  if [[ "${B1_SKIP_CONTRACT:-0}" == "1" ]]; then
    note "function permission contract: SKIPPED (overlay run: the committed contract does not cover the overlaid migrations)"
  else
    # Strict by default would FAIL on the 13 pre-existing discrepancies (docs/security/PHONE_VERIFICATION_B1_BASE_PERMISSION_DRIFT.md); this
    # runner accepts them explicitly and logs that it did. B1_STRICT_CONTRACT=1 removes the acceptance.
    accept="--accept-known-base-drift"; [[ "${B1_STRICT_CONTRACT:-0}" == "1" ]] && accept=""
    rc=$(run "${logs}/permission-contract.log" node supabase/tests/b1/permission_contract.mjs "${db_container}" check ${accept})
    finish "function permission contract" "${rc}" "${logs}/permission-contract.log" '^PASS [0-9]+ exact function permission contracts' "$(grep -E '^(PASS|ACCEPTED-FOR-B1-ONLY)' "${logs}/permission-contract.log" | tr '\n' ' ')"
  fi
fi

if want focused; then
  files=(
    119_phone_verification_authority_test.sql
    01_identity_profiles_test.sql 10_account_type_eligibility_test.sql 87_registration_data_sync_test.sql
    93_business_rpc_compatibility_phone_test.sql 98_secondary_phone_reservations_test.sql
    100_client_role_privileges_test.sql 101_rls_platform_initplan_test.sql 102_data_api_session_revocation_test.sql
    104_installer_phone_alias_guard_test.sql 105_installer_phone_change_journal_test.sql 106_installer_sensitive_action_audit_test.sql
    107_installer_alias_email_guard_test.sql 108_installer_integration_compat_test.sql 109_reauth_operations_and_phone_coexistence_test.sql
    110_contact_email_claims_test.sql 07_audit_test.sql 09_privilege_hardening_test.sql 05_unauthorized_access_test.sql
  )
  for f in ${B1_EXTRA_PGTAP:-}; do files+=("${f}"); done   # e.g. the pending-registration overlay tests
  args=(); for f in "${files[@]}"; do args+=("supabase/tests/${f}"); done
  rc=$(run "${logs}/pgtap-focused.log" supabase test db "${args[@]}")
  finish "pgTAP focused (${#files[@]} files)" "${rc}" "${logs}/pgtap-focused.log" '^Result: PASS' "$(grep -E '^(Files=|Result:)' "${logs}/pgtap-focused.log" | tr '\n' ' ')"
fi

if want full; then
  rc=$(run "${logs}/pgtap-full.log" supabase test db)
  finish "pgTAP FULL repository" "${rc}" "${logs}/pgtap-full.log" '^Result: PASS' "$(grep -E '^(Files=|Result:)' "${logs}/pgtap-full.log" | tr '\n' ' ')"
fi

if want unit || want integration; then
  eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
  cd frontend
  if want unit; then
    rc=$(run "${logs}/vitest-unit.log" pnpm exec vitest run src/server/phone-verification src/server/actions/phone-verification.test.ts src/server/queries/profile-identity-legacy.test.ts src/lib/env)
    finish "frontend unit" "${rc}" "${logs}/vitest-unit.log" 'Tests +[0-9]+ passed' "$(grep -E 'Tests ' "${logs}/vitest-unit.log" | sed 's/\x1b\[[0-9;]*m//g' | tr -s ' ')"
  fi
  if want integration; then
    rc=$(run "${logs}/vitest-integration.log" env B1_EVIDENCE_NAME="${B1_EVIDENCE_NAME:-evidence.json}" B1_DB_CONTAINER="${db_container}" B1_API_URL="${API_URL:-}" B1_ANON_KEY="${ANON_KEY:-}" B1_SERVICE_KEY="${SERVICE_ROLE_KEY:-}" \
      pnpm exec vitest run src/server/phone-verification/service.local-integration.test.ts)
    # 'skipped' would mean the target guard did not engage: that is NOT a pass.
    finish "real-database integration" "${rc}" "${logs}/vitest-integration.log" 'Tests +10 passed \(10\)' "$(grep -E 'Tests ' "${logs}/vitest-integration.log" | sed 's/\x1b\[[0-9;]*m//g' | tr -s ' ')"
  fi
  cd ..
fi

# LAST on purpose. The existing concurrency script COMMITS its fixtures (receipts, journal rows). Everything that rolls back runs first;
# the one committing script runs after it, on a database that is reset at the start of every run anyway. (Test 98 A17 used to assert
# over every global receipt row and failed on those leftovers; it is now scoped to its own fixtures, but the order stays.)
if want concurrency; then
  rc=$(run "${logs}/phone-change-concurrency.log" env DB_CONTAINER="${db_container}" bash supabase/tests/installer_phone_change_concurrency_test.sh)
  finish "installer phone-change concurrency (existing)" "${rc}" "${logs}/phone-change-concurrency.log" 'installer phone change concurrency proof passed' "$(tail -n 1 "${logs}/phone-change-concurrency.log")"
fi

if [[ ${rc_all} -eq 0 ]]; then note "RESULT [${steps}]: PASS"; else note "RESULT [${steps}]: FAIL (see ${logs})"; exit 1; fi
