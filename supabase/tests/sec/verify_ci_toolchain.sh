#!/usr/bin/env bash
set -uo pipefail

# CI-parity verification on the CI toolchain (Supabase CLI 2.110.0), LOCAL ISOLATED STACK ONLY: run AFTER run_r1.sh created the scratch
# project (../aladdin-r1ci). Steps (each logged, each exit code recorded; the run fails if any step fails or lacks its success marker):
#   reset        clean replay of every migration (db reset)
#   contract     regenerate (GEN=1) or strictly check the function-permission contract: NO accepted drift
#   lint         supabase db lint (plpgsql_check) on public/app
#   pgtap        EVERY pgTAP file, alone
#   concurrency  the existing committing phone-change concurrency script, LAST
#
#   bash supabase/tests/sec/verify_ci_toolchain.sh            # reset contract lint pgtap concurrency
#   GEN=1 bash supabase/tests/sec/verify_ci_toolchain.sh      # also (re)generate supabase/permissions/<latest>.json first

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "${here}/../../.." && pwd)"
work="$(cd "${repo}/.." && pwd)/aladdin-r1ci"
logs="${repo}/.sec-logs"; mkdir -p "${logs}"
cli=(npx -y supabase@2.110.0)
container="supabase_db_aladdin_r1ci"
steps="${V_STEPS:-reset contract lint pgtap concurrency}"
out="${repo}/docs/security/phone-signup-security/r1-ci-toolchain-verification.txt"; : > "${out}"
note() { echo "$*" | tee -a "${out}"; }
rc_all=0
[[ -d "${work}/supabase" ]] || { echo "run supabase/tests/sec/run_r1.sh with R1_TOOLCHAIN=ci110 first" >&2; exit 2; }
rm -rf "${work}/supabase/tests"; cp -r "${repo}/supabase/tests" "${work}/supabase/tests"; cp -r "${repo}/supabase/permissions" "${work}/supabase/permissions" 2>/dev/null || true
cp "${repo}/supabase/migrations/"*.sql "${work}/supabase/migrations/" 2>/dev/null
( cd "${work}" && "${cli[@]}" start > "${logs}/ci-verify-start.log" 2>&1 ) || { note "stack did not start"; exit 1; }
want() { [[ " ${steps} " == *" $1 "* ]]; }
fin() { # label rc log marker
  local status=ok
  if [[ "$2" -ne 0 ]]; then status="FAILED exit=$2"; rc_all=1
  elif ! sed 's/\x1b\[[0-9;]*m//g' "$3" | grep -Eq "$4"; then status="FAILED: exit 0 but no success marker /$4/"; rc_all=1; fi
  note "$1 -> ${status}"
}

if want reset; then
  ( cd "${work}" && "${cli[@]}" db reset --yes > "${logs}/ci-verify-reset.log" 2>&1 ); rc=$?
  fin "db reset ($(grep -c '^Applying migration' "${logs}/ci-verify-reset.log") migrations from scratch on CLI 2.110.0 / Postgres 17.6.1.143)" $rc "${logs}/ci-verify-reset.log" "Finished supabase db reset|Applying migration 20261030090002"
fi
if want contract; then
  cd "${repo}"
  if [[ "${GEN:-0}" == "1" ]]; then node supabase/tests/b1/permission_contract.mjs "${container}" generate > "${logs}/ci-verify-contract-gen.log" 2>&1; rc=$?; fin "permission contract generate" $rc "${logs}/ci-verify-contract-gen.log" "ADDED"; grep -E "^(previous contract|ADDED|DIFFERENT|REMOVED|  )" "${logs}/ci-verify-contract-gen.log" | head -40 >> "${out}"; fi
  node supabase/tests/b1/permission_contract.mjs "${container}" check > "${logs}/ci-verify-contract.log" 2>&1; rc=$?   # STRICT: no --accept-known-base-drift
  fin "permission contract (strict, no accepted drift)" $rc "${logs}/ci-verify-contract.log" '^PASS [0-9]+ exact function permission contracts'
fi
if want lint; then
  ( cd "${work}" && "${cli[@]}" db lint --schema public,app --level warning > "${logs}/ci-verify-lint.log" 2>&1 ); rc=$?
  node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8").replace(/[[0-9;]*m/g,"");const j=JSON.parse(t.slice(t.indexOf("{\"results\"")));const r=j.results||[];const mine=r.filter(x=>/phone_signup|phone_alias|phone_verification/.test(x.function));const errs=r.flatMap(x=>(x.issues||[]).filter(i=>i.level==="error"));console.log("lint: functions with warnings="+r.length+" ours="+mine.length+" errors="+errs.length);process.exit(mine.length||errs.length?1:0)' "${logs}/ci-verify-lint.log" >> "${logs}/ci-verify-lint.log" 2>&1; rc2=$?; [[ $rc -eq 0 ]] && rc=$rc2
  fin "db lint (public, app): no error, none in the phone authority objects" $rc "${logs}/ci-verify-lint.log" "lint: functions with warnings=[0-9]+ ours=0 errors=0"
fi
if want pgtap; then
  ( cd "${work}" && "${cli[@]}" test db > "${logs}/ci-verify-pgtap.log" 2>&1 ); rc=$?
  fin "pgTAP FULL repository ($(ls "${repo}/supabase/tests"/*.sql | wc -l) files) $(grep -E '^(Files=|Result:)' "${logs}/ci-verify-pgtap.log" | tr '\n' ' ')" $rc "${logs}/ci-verify-pgtap.log" '^Result: PASS'
fi
if want concurrency; then
  cd "${repo}"
  DB_CONTAINER="${container}" bash supabase/tests/installer_phone_change_concurrency_test.sh > "${logs}/ci-verify-concurrency.log" 2>&1; rc=$?
  fin "installer phone-change concurrency (existing)" $rc "${logs}/ci-verify-concurrency.log" 'installer phone change concurrency proof passed'
fi
( cd "${work}" && "${cli[@]}" stop >/dev/null 2>&1 ) || true
[[ ${rc_all} -eq 0 ]] && note "RESULT [${steps}]: PASS" || note "RESULT [${steps}]: FAIL (see ${logs})"
exit ${rc_all}
