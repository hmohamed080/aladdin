#!/usr/bin/env bash
set -uo pipefail

# Rollback DRILL for the interim before_user_created hook. LOCAL ISOLATED STACK ONLY (project aladdin_r2hk, ports 537xx, scratch dir outside the repo).
#
#   bash supabase/tests/r2/hook_rollback_drill.sh
#
# Rehearses the documented procedure (docs/security/PHONE_SIGNUP_R2_INTERIM_ALIAS_HOOK.md section 6):
#   1  hook ON + function installed          -> an alias sign-up is refused (403), nothing created
#   2  ROLLBACK = disable the HOOK (the function stays)  -> public sign-up of every kind works again, an alias sign-up is accepted again
#                                               (the exposure returns - that is what "rolled back" means), Admin creation and existing logins untouched
#   3  re-enable the hook                    -> alias refused again
#   4  the WRONG rollback (drop the function while the hook is still enabled) -> every public sign-up fails with 500 (why the order matters)
# Exit code is non-zero if any expectation is not met. Nothing leaves the machine; no hosted project is referenced.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; repo="$(cd "${here}/../../.." && pwd)"; cd "${repo}"
export R2_PROJECT=aladdin_r2hk R2_PORT_PREFIX=537 R2_STACK_DIR="$(cd "${repo}/.." && pwd)/aladdin-r2-stack-hk"
work="${R2_STACK_DIR}"; DB=supabase_db_aladdin_r2hk
IFS=" " read -r -a cli <<< "${R2_CLI:-npx -y supabase@2.110.0}"
fails=0
ok()   { echo "ok    $1"; }
bad()  { echo "FAIL  $1 -- $2"; fails=$((fails + 1)); }
psqlx() { docker exec -i "${DB}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1; }
call() { curl -s -o /tmp/r2drill.out -w "%{http_code}" -X "$1" "${API_URL}$2" -H "apikey: $3" -H "authorization: Bearer $3" -H "content-type: application/json" ${4:+-d "$4"}; }
load() { set -a; . "${work}/.stack.env"; set +a; }
alias_email() { printf "p2010%05d%02d@craftsman-login.aladdin.invalid" "${RANDOM}" "$((RANDOM % 100))"; }
tag="$(date +%s)"

bash supabase/tests/r2/stack.sh up confirm-on hook > "${work}.drill-start.log" 2>&1 || { echo "stack did not start"; exit 1; }
load
psqlx < supabase/proposals/before_user_created_alias_gate.sql > /dev/null

# an existing legacy-style account for the "untouched" checks (Admin creation, not consulted by the hook)
legacy="$(alias_email)"
st=$(call POST /auth/v1/admin/users "${SERVICE_ROLE_KEY}" "{\"email\":\"${legacy}\",\"password\":\"Dr1ll-passw0rd-2026\",\"email_confirm\":true,\"app_metadata\":{\"registration_source\":\"temporary_craftsman_password_flow\"}}")
[[ "${st}" == "200" ]] && ok "setup: legacy alias account created through the Admin API" || bad "setup" "status ${st}"
signin() { call POST "/auth/v1/token?grant_type=password" "${ANON_KEY}" "{\"email\":\"$1\",\"password\":\"Dr1ll-passw0rd-2026\"}"; }

echo "== 1. hook ON"
a1="$(alias_email)"; st=$(call POST /auth/v1/signup "${ANON_KEY}" "{\"email\":\"${a1}\",\"password\":\"Dr1ll-passw0rd-2026\"}")
[[ "${st}" == "403" ]] && ok "alias sign-up refused (403)" || bad "hook ON blocks alias" "status ${st}"
[[ "$(echo "select count(*) from auth.users where email = '${a1}';" | psqlx)" == "0" ]] && ok "no Auth user was created" || bad "no user" "a row exists"

echo "== 2. ROLLBACK: disable the hook, keep the function"
( cd "${work}" && "${cli[@]}" stop > /dev/null 2>&1 )
sed -i '/^\[auth\.hook\.before_user_created\]/,/^uri = /d' "${work}/supabase/config.toml"
grep -qE "^\[auth\.hook\.before_user_created\]" "${work}/supabase/config.toml" && bad "config" "hook block still present"  # uncommented table only: the base config has a commented template
( cd "${work}" && "${cli[@]}" start --exclude studio,postgres-meta,edge-runtime,logflare,vector,supavisor > "${work}.drill-start2.log" 2>&1 ) || { bad "restart without the hook" "stack did not start"; exit 1; }
load
[[ "$(echo "select to_regprocedure('public.hook_before_user_created(jsonb)') is not null;" | psqlx)" == "t" ]] && ok "the function is still installed (harmless while the hook is off)" || bad "function" "missing"
n1="drill-${tag}-1@example.test"
st=$(call POST /auth/v1/signup "${ANON_KEY}" "{\"email\":\"${n1}\",\"password\":\"Dr1ll-passw0rd-2026\"}"); [[ "${st}" == "200" ]] && ok "public e-mail sign-up works" || bad "e-mail sign-up after rollback" "status ${st}"
n2="drill-${tag}-2@example.test"
st=$(call POST /auth/v1/otp "${ANON_KEY}" "{\"email\":\"${n2}\",\"create_user\":true}"); [[ "${st}" == "200" ]] && ok "public e-mail OTP sign-up works" || bad "otp after rollback" "status ${st}"
st=$(signin "${legacy}"); [[ "${st}" == "200" ]] && ok "existing legacy alias account still signs in" || bad "legacy sign-in" "status ${st}"
a2="$(alias_email)"; st=$(call POST /auth/v1/signup "${ANON_KEY}" "{\"email\":\"${a2}\",\"password\":\"Dr1ll-passw0rd-2026\"}")
[[ "${st}" == "200" ]] && ok "baseline restored: an alias sign-up is accepted again (the exposure is back, as expected after a rollback)" || bad "baseline" "status ${st}"
a3="$(alias_email)"; st=$(call POST /auth/v1/admin/users "${SERVICE_ROLE_KEY}" "{\"email\":\"${a3}\",\"password\":\"Dr1ll-passw0rd-2026\",\"email_confirm\":true,\"app_metadata\":{\"registration_source\":\"phone_whatsapp_sign_up\"}}")
[[ "${st}" == "200" ]] && ok "Admin creation unaffected" || bad "admin creation" "status ${st}"
echo "delete from auth.users where email = '${a2}';" | psqlx > /dev/null   # remove the squat this drill created

echo "== 3. re-enable the hook"
( cd "${work}" && "${cli[@]}" stop > /dev/null 2>&1 )
printf '\n[auth.hook.before_user_created]\nenabled = true\nuri = "pg-functions://postgres/public/hook_before_user_created"\n' >> "${work}/supabase/config.toml"
( cd "${work}" && "${cli[@]}" start --exclude studio,postgres-meta,edge-runtime,logflare,vector,supavisor > "${work}.drill-start3.log" 2>&1 ) || { bad "restart with the hook" "stack did not start"; exit 1; }
load
a4="$(alias_email)"; st=$(call POST /auth/v1/signup "${ANON_KEY}" "{\"email\":\"${a4}\",\"password\":\"Dr1ll-passw0rd-2026\"}")
[[ "${st}" == "403" ]] && ok "alias refused again after re-enabling" || bad "re-enable" "status ${st}"
n3="drill-${tag}-3@example.test"; st=$(call POST /auth/v1/signup "${ANON_KEY}" "{\"email\":\"${n3}\",\"password\":\"Dr1ll-passw0rd-2026\"}"); [[ "${st}" == "200" ]] && ok "e-mail sign-up works with the hook on" || bad "e-mail sign-up with hook" "status ${st}"

echo "== 4. the WRONG rollback order: drop the function while the hook is still enabled"
echo "drop function public.hook_before_user_created(jsonb);" | psqlx > /dev/null
n4="drill-${tag}-4@example.test"; st=$(call POST /auth/v1/signup "${ANON_KEY}" "{\"email\":\"${n4}\",\"password\":\"Dr1ll-passw0rd-2026\"}")
[[ "${st}" == "500" ]] && ok "confirmed: dropping the function first makes EVERY public sign-up fail (500) - always disable the hook first" || bad "wrong-order demonstration" "status ${st}"
psqlx < supabase/proposals/before_user_created_alias_gate.sql > /dev/null

bash supabase/tests/r2/stack.sh down > /dev/null 2>&1 || true
[[ ${fails} -eq 0 ]] && { echo "RESULT: rollback drill clean"; exit 0; } || { echo "RESULT: ${fails} expectation(s) failed"; exit 1; }
