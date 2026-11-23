#!/usr/bin/env bash
set -euo pipefail

# Phone-signup security suite runner - LOCAL ISOLATED STACK ONLY.
#
#   bash supabase/tests/sec/run_sec.sh                       # all three GoTrue modes
#   SEC_MODES="confirm-off" bash supabase/tests/sec/run_sec.sh
#
# For each mode this rewrites the UNCOMMITTED local supabase/config.toml (e-mail confirmations on/off, optional
# before_user_created probe hook), restarts THIS worktree's isolated stack, runs the suite, and finally restores the local
# config. Nothing outside the isolated stack is touched; nothing is sent anywhere.
#
# Exit code: non-zero if any mode has FAIL (unexpected) or XPASS (a known gap closed: promote the check), or a mode could not run.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "${here}/../../.." && pwd)"
cd "${repo}"

project_id="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -n 1)"
case "${project_id}" in aladdin_sec) ;; *) echo "[sec] REFUSED: supabase/config.toml project_id is '${project_id}', expected the isolated 'aladdin_sec' stack." >&2; exit 2;; esac
export DB_CONTAINER="supabase_db_${project_id}"
modes="${SEC_MODES:-confirm-on confirm-off hook}"
logs="${SEC_LOG_DIR:-${repo}/.sec-logs}"; mkdir -p "${logs}" docs/security/phone-signup-security
base="${repo}/.sec-config-base.toml"
[[ -f "${base}" ]] || cp supabase/config.toml "${base}"
summary="docs/security/phone-signup-security/run-summary.txt"; : > "${summary}"
note() { echo "$*" | tee -a "${summary}"; }
restore() { cp "${base}" supabase/config.toml; }
trap restore EXIT

configure() { # <mode>
  cp "${base}" supabase/config.toml
  local confirmations=true; [[ "$1" == "confirm-off" ]] && confirmations=false
  sed -i "/^\[auth\.email\]/,/^\[auth\.email\.[a-z]*\]/ s/^enable_confirmations = .*/enable_confirmations = ${confirmations}/" supabase/config.toml
  grep -A40 '^\[auth\.email\]' supabase/config.toml | grep -m1 '^enable_confirmations' | grep -q "= ${confirmations}" || { echo "[sec] could not set enable_confirmations=${confirmations}" >&2; return 1; }
  if [[ "$1" == "hook" ]]; then
    printf '\n[auth.hook.before_user_created]\nenabled = true\nuri = "pg-functions://postgres/public/sec_probe_hook"\n' >> supabase/config.toml
  fi
}

rc_all=0
for mode in ${modes}; do
  note "== mode ${mode}"
  configure "${mode}"
  supabase stop > "${logs}/stop-${mode}.log" 2>&1 || true
  if ! supabase start > "${logs}/start-${mode}.log" 2>&1; then note "${mode}: stack did not start (see ${logs}/start-${mode}.log) -> FAILED"; rc_all=1; continue; fi
  set +e; SEC_MODE="${mode}" node supabase/tests/sec/phone_signup_security.test.mjs > "${logs}/suite-${mode}.log" 2>&1; rc=$?; set -e
  last="$(grep -E '^\[sec\] ' "${logs}/suite-${mode}.log" | tail -n 1)"
  if [[ ${rc} -ne 0 ]]; then note "${mode}: exit=${rc} ${last}"; rc_all=1; else note "${mode}: ${last}"; fi
  if ! grep -q '^\[sec\] .*"total"' "${logs}/suite-${mode}.log"; then note "${mode}: no summary line in the log - treated as unverified"; rc_all=1; fi
done
restore
[[ ${rc_all} -eq 0 ]] && note "RESULT: all modes clean (expected failures only)" || note "RESULT: ATTENTION (see above; logs in ${logs})"
exit ${rc_all}
