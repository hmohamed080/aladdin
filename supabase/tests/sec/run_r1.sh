#!/usr/bin/env bash
set -euo pipefail

# R1 signup authority + alias guard: posture x e-mail-confirmation matrix on a chosen toolchain - LOCAL ISOLATED STACK ONLY.
#
#   bash supabase/tests/sec/run_r1.sh                                   # local toolchain (the installed Supabase CLI), 2 modes x 3 postures
#   R1_TOOLCHAIN=ci110 bash supabase/tests/sec/run_r1.sh                # the CI toolchain: Supabase CLI 2.110.0 (Postgres 17.6.1.143, GoTrue v2.193.0)
#   R1_MODES="confirm-on" R1_POSTURES="enforce" bash supabase/tests/sec/run_r1.sh
#
# local : uses THIS worktree's isolated stack (supabase/config.toml project_id must be aladdin_sec). The uncommitted local config is rewritten
#         per mode (e-mail confirmations on/off) and restored on exit.
# ci110 : creates a SEPARATE scratch project directory outside the repo (project aladdin_r1ci, ports 520xx) holding a copy of this repo's
#         supabase/ migrations + the committed config, and drives it with `npx supabase@2.110.0` - the CLI the GitHub workflow uses.
#
# Exit code is non-zero on any FAIL, any XPASS, a missing summary line, or a stack that does not start.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "${here}/../../.." && pwd)"
cd "${repo}"
toolchain="${R1_TOOLCHAIN:-local}"
modes="${R1_MODES:-confirm-on confirm-off}"
postures="${R1_POSTURES:-shipped observe enforce}"
logs="${R1_LOG_DIR:-${repo}/.sec-logs}"; mkdir -p "${logs}" docs/security/phone-signup-security
summary="docs/security/phone-signup-security/r1-run-summary-${toolchain}.txt"; : > "${summary}"
note() { echo "$*" | tee -a "${summary}"; }

case "${toolchain}" in
  local)
    project_id="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -n 1)"
    [[ "${project_id}" == "aladdin_sec" ]] || { echo "[r1] REFUSED: supabase/config.toml project_id is '${project_id}', expected 'aladdin_sec'." >&2; exit 2; }
    cli=(supabase); work="${repo}"; cli_label="$(supabase --version)"
    base="${repo}/.sec-config-base.toml"; [[ -f "${base}" ]] || cp supabase/config.toml "${base}"
    cfg="${repo}/supabase/config.toml"
    ;;
  ci110)
    project_id="aladdin_r1ci"; work="$(cd "${repo}/.." && pwd)/aladdin-r1ci"
    cli=(npx -y supabase@2.110.0); cli_label="$(npx -y supabase@2.110.0 --version)"
    rm -rf "${work}"; mkdir -p "${work}/supabase"
    cp -r supabase/migrations supabase/templates "${work}/supabase/"; cp supabase/seed*.sql "${work}/supabase/"
    git show HEAD:supabase/config.toml | sed -e "s/^project_id = .*/project_id = \"${project_id}\"/" -e 's/\b543\([0-9][0-9]\)\b/520\1/g' -e 's/\b8083\b/53583/' > "${work}/supabase/base.toml"
    base="${work}/supabase/base.toml"; cfg="${work}/supabase/config.toml"
    ;;
  *) echo "[r1] unknown toolchain '${toolchain}'" >&2; exit 2;;
esac
export DB_CONTAINER="supabase_db_${project_id}"
restore() { if [[ "${toolchain}" == "local" ]]; then cp "${base}" "${cfg}"; fi; }
trap restore EXIT
note "== toolchain ${toolchain}: ${cli_label}; project ${project_id}"

configure() { # <mode>
  cp "${base}" "${cfg}"
  local confirmations=true; [[ "$1" == "confirm-off" ]] && confirmations=false
  sed -i "/^\[auth\.email\]/,/^\[auth\.email\.[a-z]*\]/ s/^enable_confirmations = .*/enable_confirmations = ${confirmations}/" "${cfg}"
  grep -A40 '^\[auth\.email\]' "${cfg}" | grep -m1 '^enable_confirmations' | grep -q "= ${confirmations}" || { echo "[r1] could not set enable_confirmations=${confirmations}" >&2; return 1; }
}

rc_all=0
for mode in ${modes}; do
  note "-- mode ${mode}"
  configure "${mode}"
  ( cd "${work}" && "${cli[@]}" stop > "${logs}/r1-${toolchain}-stop-${mode}.log" 2>&1 ) || true
  if ! ( cd "${work}" && "${cli[@]}" start > "${logs}/r1-${toolchain}-start-${mode}.log" 2>&1 ); then note "${mode}: stack did not start (see ${logs}) -> FAILED"; rc_all=1; continue; fi
  # keys for the lib guards (loopback only); never printed
  eval "$(cd "${work}" && "${cli[@]}" status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
  export A2_API_URL="${API_URL}" A2_ANON_KEY="${ANON_KEY}" A2_SERVICE_KEY="${SERVICE_ROLE_KEY}"
  for posture in ${postures}; do
    set +e
    SEC_MODE="${mode}" SEC_POSTURE="${posture}" SEC_TOOLCHAIN="${toolchain}" SEC_CLI="${cli_label}" node supabase/tests/sec/signup_authority.test.mjs > "${logs}/r1-${toolchain}-${mode}-${posture}.log" 2>&1
    rc=$?; set -e
    last="$(grep -E '^\[sec\] ' "${logs}/r1-${toolchain}-${mode}-${posture}.log" | tail -n 1 | sed -E 's/"suite":"[^"]*",//; s/"gotrue_image":"[^"]*",//; s/"cli":"[^"]*",//')"
    if ! grep -q '^\[sec\] .*"total"' "${logs}/r1-${toolchain}-${mode}-${posture}.log"; then note "${mode}/${posture}: no summary line in the log - treated as unverified"; rc_all=1
    elif [[ ${rc} -ne 0 ]]; then note "${mode}/${posture}: exit=${rc} ${last}"; rc_all=1
    else note "${mode}/${posture}: ${last}"; fi
  done
done
unset A2_API_URL A2_ANON_KEY A2_SERVICE_KEY
if [[ "${toolchain}" == "ci110" && "${R1_KEEP_STACK:-0}" != "1" ]]; then ( cd "${work}" && "${cli[@]}" stop >/dev/null 2>&1 ) || true; fi
[[ ${rc_all} -eq 0 ]] && note "RESULT [${toolchain}]: all cells clean (no FAIL, no XPASS)" || note "RESULT [${toolchain}]: ATTENTION (see above; logs in ${logs})"
exit ${rc_all}
