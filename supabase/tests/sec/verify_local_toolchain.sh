#!/usr/bin/env bash
set -uo pipefail

# Verification on the LOCAL toolchain (the installed Supabase CLI) - LOCAL ISOLATED STACK ONLY (project aladdin_sec). Each step is logged, its
# exit code recorded, and it fails without its success marker. Steps (V_STEPS selects; the order below is fixed):
#   reset        clean replay of every migration
#   contract     function-permission contract; the 13 PRE-EXISTING local-toolchain differences (see PHONE_PERMISSION_DISCREPANCY_RECONCILIATION.md)
#                are the ONLY differences allowed, and R1 must add none: the check proves the count is still exactly 13
#   pgtap        EVERY pgTAP file, alone
#   unit         frontend unit tests (phone verification, env)
#   integration  real-database run of the B1 service AND the R1 signup service through the local outbox
#   stress       concurrency + deadlock stress (signup_concurrency_stress.test.mjs)
#   matrix       the posture x GoTrue-mode matrix (run_r1.sh, local toolchain)
#   concurrency  the existing committing phone-change concurrency script, LAST

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "${here}/../../.." && pwd)"
cd "${repo}"
project_id="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -n 1)"
[[ "${project_id}" == "aladdin_sec" ]] || { echo "REFUSED: project_id is '${project_id}'" >&2; exit 2; }
export DB_CONTAINER="supabase_db_${project_id}"
steps="${V_STEPS:-reset contract pgtap unit integration stress matrix concurrency}"
logs="${repo}/.sec-logs"; mkdir -p "${logs}"
out="${repo}/docs/security/phone-signup-security/r1-local-toolchain-verification.txt"
if [[ "${V_APPEND:-0}" == "1" ]]; then echo "--- re-run of: ${V_STEPS:-all} (harness fix: integration files run one after another because both switch the shared posture)" >> "${out}"; else : > "${out}"; fi
note() { echo "$*" | tee -a "${out}"; }
want() { [[ " ${steps} " == *" $1 "* ]]; }
rc_all=0
fin() { # label rc log marker
  local status=ok
  if [[ "$2" -ne 0 ]]; then status="FAILED exit=$2"; rc_all=1
  elif ! sed 's/\x1b\[[0-9;]*m//g' "$3" | grep -Eq "$4"; then status="FAILED: exit 0 but no success marker /$4/"; rc_all=1; fi
  note "$1 -> ${status}"
}
note "toolchain: Supabase CLI $(supabase --version); Postgres $(docker inspect -f '{{.Config.Image}}' "${DB_CONTAINER}" 2>/dev/null || echo '(stack stopped)')"
supabase start > "${logs}/local-verify-start.log" 2>&1 || { note "stack did not start"; exit 1; }
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"

if want reset; then
  supabase db reset --yes > "${logs}/local-verify-reset.log" 2>&1; rc=$?
  fin "db reset ($(grep -c '^Applying migration' "${logs}/local-verify-reset.log") migrations from scratch)" $rc "${logs}/local-verify-reset.log" "Applying migration 20261030090002|Finished supabase db reset"
fi
if want contract; then
  node supabase/tests/b1/permission_contract.mjs "${DB_CONTAINER}" check --accept-known-base-drift > "${logs}/local-verify-contract.log" 2>&1; rc=$?
  n="$(grep -m1 -oE 'BASE DRIFT .* - [0-9]+ functions' "${logs}/local-verify-contract.log" | grep -oE '[0-9]+ functions' | head -1)"
  fin "permission contract (local toolchain: ${n:-0 functions} differ - must stay the 13 pre-existing ones)" $rc "${logs}/local-verify-contract.log" '^PASS [0-9]+ exact function permission contracts'
  [[ "${n}" == "13 functions" ]] || { note "  -> UNEXPECTED drift count '${n}' (expected exactly the 13 pre-existing)"; rc_all=1; }
fi
if want pgtap; then
  supabase test db > "${logs}/local-verify-pgtap.log" 2>&1; rc=$?
  fin "pgTAP FULL repository ($(ls supabase/tests/*.sql | wc -l) files) $(grep -E '^(Files=|Result:)' "${logs}/local-verify-pgtap.log" | tr '\n' ' ')" $rc "${logs}/local-verify-pgtap.log" '^Result: PASS'
fi
if want unit || want integration; then
  cd frontend
  if want unit; then
    pnpm exec vitest run src/server/phone-verification src/server/actions/phone-verification.test.ts src/lib/env > "${logs}/local-verify-unit.log" 2>&1; rc=$?
    fin "frontend unit $(sed 's/\x1b\[[0-9;]*m//g' "${logs}/local-verify-unit.log" | grep -E 'Tests ' | tr -s ' ')" $rc "${logs}/local-verify-unit.log" 'Tests +[0-9]+ passed'
    pnpm exec tsc --noEmit > "${logs}/local-verify-tsc.log" 2>&1; rc=$?; if [[ $rc -eq 0 ]]; then note "tsc --noEmit -> ok"; else note "tsc --noEmit -> FAILED exit=$rc"; rc_all=1; fi
  fi
  if want integration; then
    B1_EVIDENCE_NAME="r1-b1-regression-evidence.json" B1_DB_CONTAINER="${DB_CONTAINER}" B1_API_URL="${API_URL}" B1_ANON_KEY="${ANON_KEY}" B1_SERVICE_KEY="${SERVICE_ROLE_KEY}" \
      pnpm exec vitest run --no-file-parallelism src/server/phone-verification/service.local-integration.test.ts src/server/phone-verification/signup.local-integration.test.ts > "${logs}/local-verify-integration.log" 2>&1; rc=$?
    fin "real-database integration (B1 service + R1 signup service via outbox) $(sed 's/\x1b\[[0-9;]*m//g' "${logs}/local-verify-integration.log" | grep -E 'Tests ' | tr -s ' ')" $rc "${logs}/local-verify-integration.log" 'Tests +16 passed \(16\)'
  fi
  cd ..
fi
if want stress; then
  A2_API_URL="${API_URL}" A2_ANON_KEY="${ANON_KEY}" A2_SERVICE_KEY="${SERVICE_ROLE_KEY}" node supabase/tests/sec/signup_concurrency_stress.test.mjs > "${logs}/local-verify-stress.log" 2>&1; rc=$?
  fin "concurrency + deadlock stress $(grep -E '^\[stress\]' "${logs}/local-verify-stress.log" | tail -n 1 | grep -oE '"PASS":[0-9]+,"FAIL":[0-9]+')" $rc "${logs}/local-verify-stress.log" '^\[stress\] .*"FAIL":0'
fi
if want matrix; then
  bash supabase/tests/sec/run_r1.sh > "${logs}/local-verify-matrix.log" 2>&1; rc=$?
  fin "posture x GoTrue-mode matrix (local toolchain), 6 cells" $rc "${logs}/local-verify-matrix.log" '^RESULT \[local\]: all cells clean'
fi
if want concurrency; then
  supabase start >/dev/null 2>&1
  bash supabase/tests/installer_phone_change_concurrency_test.sh > "${logs}/local-verify-concurrency.log" 2>&1; rc=$?
  fin "installer phone-change concurrency (existing)" $rc "${logs}/local-verify-concurrency.log" 'installer phone change concurrency proof passed'
fi
[[ ${rc_all} -eq 0 ]] && note "RESULT [${steps}]: PASS" || note "RESULT [${steps}]: FAIL (see ${logs})"
exit ${rc_all}
