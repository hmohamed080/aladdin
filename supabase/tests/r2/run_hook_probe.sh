#!/usr/bin/env bash
set -euo pipefail

# Runs the before_user_created hook probe on both GoTrue toolchains x e-mail confirmations on/off. LOCAL ISOLATED STACKS ONLY.
#   bash supabase/tests/r2/run_hook_probe.sh                       # 2 toolchains x 2 modes
#   R2_TOOLCHAINS="ci110" R2_MODES="confirm-on" bash supabase/tests/r2/run_hook_probe.sh
# ci110 = the CI toolchain (npx supabase@2.110.0); local = the installed `supabase` CLI. Output: docs/security/hook-probe/.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; repo="$(cd "${here}/../../.." && pwd)"; cd "${repo}"
out="docs/security/hook-probe"; mkdir -p "${out}"; summary="${out}/run-summary.txt"; : > "${summary}"
note() { echo "$*" | tee -a "${summary}"; }
rc_all=0
for tc in ${R2_TOOLCHAINS:-ci110 local}; do
  case "${tc}" in ci110) cli="npx -y supabase@2.110.0";; local) cli="supabase";; *) echo "unknown toolchain ${tc}" >&2; exit 2;; esac
  for mode in ${R2_MODES:-confirm-on confirm-off}; do
    note "== ${tc} / ${mode}: $(${cli} --version 2>/dev/null | tail -n 1)"
    R2_CLI="${cli}" R2_PROJECT=aladdin_r2hk R2_PORT_PREFIX=537 R2_STACK_DIR="$(cd "${repo}/.." && pwd)/aladdin-r2-stack-hk" bash supabase/tests/r2/stack.sh up "${mode}" hook > "${out}/stack-${tc}-${mode}.log" 2>&1 \
      || { note "${tc}/${mode}: stack did not start"; rc_all=1; continue; }
    eval "$(cat "$(cd "${repo}/.." && pwd)/aladdin-r2-stack-hk/.stack.env")"
    set +e
    DB_CONTAINER=supabase_db_aladdin_r2hk A2_API_URL="${API_URL}" A2_ANON_KEY="${ANON_KEY}" A2_SERVICE_KEY="${SERVICE_ROLE_KEY}" SEC_TOOLCHAIN="${tc}" SEC_MODE="${mode}" \
      node supabase/tests/r2/hook_probe.test.mjs > "${out}/probe-${tc}-${mode}.log" 2>&1
    rc=$?; set -e
    last="$(grep -E '^\[sec\] ' "${out}/probe-${tc}-${mode}.log" | tail -n 1)"
    if [[ -z "${last}" ]]; then note "${tc}/${mode}: no summary line -> unverified"; rc_all=1
    elif [[ ${rc} -ne 0 ]]; then note "${tc}/${mode}: exit=${rc} ${last}"; rc_all=1
    else note "${tc}/${mode}: ${last}"; fi
  done
done
R2_PROJECT=aladdin_r2hk R2_PORT_PREFIX=537 R2_STACK_DIR="$(cd "${repo}/.." && pwd)/aladdin-r2-stack-hk" bash supabase/tests/r2/stack.sh down >/dev/null 2>&1 || true
[[ ${rc_all} -eq 0 ]] && note "RESULT: all cells clean (no FAIL)" || note "RESULT: ATTENTION (see ${out})"
exit ${rc_all}
