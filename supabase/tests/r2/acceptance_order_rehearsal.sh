#!/usr/bin/env bash
set -euo pipefail

# LOCAL rehearsal of the Acceptance migration step (nothing hosted). It reproduces the exact history read from Acceptance on
# 2026-11-01: 197 migrations applied, latest 20261029090002, and exactly two repository migrations missing - 20261030090001
# and 20261030090002. There is no out-of-order version and no applied-not-in-repo version, so a PLAIN forward push is the
# expected path.
#
#   R2_PROJECT=aladdin_r2acc R2_PORT_PREFIX=541 R2_STACK_DIR=<...>/aladdin-r2-stack-acc \
#   R2_HOLD_BACK="20261030090001 20261030090002" bash supabase/tests/r2/stack.sh up
#   bash supabase/tests/r2/acceptance_order_rehearsal.sh <stack dir> <db container>
#
# Proves: (1) the pre-state equals the hosted Acceptance history; (2) a plain `db push` (no --include-all, no repair) lists
# and applies exactly the two missing migrations, in version order; (3) pre-existing email accounts, phone aliases and their
# passwords still work, and no auth/users row is rewritten; (4) the new switches ship OFF (enabled=false, signup_enabled=false,
# alias_guard_mode=off) and the auth.users alias guard is installed but deferred/inert; (5) a second push finds nothing to do.
work="${1:?stack dir}"; db="${2:?db container}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; repo="$(cd "${here}/../../.." && pwd)"
IFS=" " read -r -a cli <<< "${R2_CLI:-npx -y supabase@2.110.0}"
set -a; . "${work}/.stack.env"; set +a
psqlq() { docker exec -i "${db}" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c "$1"; }
fail=0; ok() { echo "  PASS  $1"; }; bad() { echo "  FAIL  $1"; fail=1; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }

echo "== state before (must equal hosted Acceptance on 2026-11-01)"
check "history count is 197" "$(psqlq "select count(*) from supabase_migrations.schema_migrations")" "197"
check "latest applied is 20261029090002" "$(psqlq "select max(version) from supabase_migrations.schema_migrations")" "20261029090002"
check "20261030090001 absent" "$(psqlq "select count(*) from supabase_migrations.schema_migrations where version='20261030090001'")" "0"
check "20261030090002 absent" "$(psqlq "select count(*) from supabase_migrations.schema_migrations where version='20261030090002'")" "0"
check "authority absent" "$(psqlq "select coalesce(to_regclass('app.phone_verification_config')::text,'none')")" "none"

echo "== seed pre-existing accounts through the real Auth API"
admin() { curl -s -o /dev/null -w "%{http_code}" -X POST "${API_URL}/auth/v1/admin/users" -H "apikey: ${SERVICE_ROLE_KEY}" -H "authorization: Bearer ${SERVICE_ROLE_KEY}" -H "content-type: application/json" -d "$1"; }
check "email account created" "$(admin '{"email":"existing.email@example.test","password":"Pre-Existing-Pass-1!","email_confirm":true}')" "200"
check "phone-alias account created" "$(admin '{"email":"p201000000001@craftsman-login.aladdin.invalid","password":"Pre-Existing-Pass-2!","email_confirm":true}')" "200"
signin() { curl -s -o /dev/null -w "%{http_code}" -X POST "${API_URL}/auth/v1/token?grant_type=password" -H "apikey: ${ANON_KEY}" -H "content-type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\"}"; }
check "email login before" "$(signin existing.email@example.test 'Pre-Existing-Pass-1!')" "200"
check "phone-alias login before" "$(signin p201000000001@craftsman-login.aladdin.invalid 'Pre-Existing-Pass-2!')" "200"
snap() { psqlq "select md5(string_agg(id::text||coalesce(email,'')||coalesce(encrypted_password,'')||coalesce(raw_app_meta_data::text,''), '|' order by id)) from auth.users"; }
before_accounts="$(snap)"; before_count="$(psqlq 'select count(*) from auth.users')"; before_pub="$(psqlq 'select count(*) from public.users')"
before_hist="$(psqlq "select md5(string_agg(version||coalesce(name,''), '|' order by version)) from supabase_migrations.schema_migrations where version not in ('20261030090001','20261030090002')")"
before_profiles="$(psqlq "select md5(coalesce(string_agg(id::text||coalesce(phone_e164,'')||coalesce(phone_verified_at::text,''), '|' order by id),'')) from public.profiles")"

echo "== restore the two held migrations into the project (as the release branch has them)"
check "held 20261030090001 present" "$(find "${work}/held" -maxdepth 1 -name '20261030090001_*.sql' | wc -l | tr -d ' ')" "1"
check "held 20261030090002 present" "$(find "${work}/held" -maxdepth 1 -name '20261030090002_*.sql' | wc -l | tr -d ' ')" "1"
cp "${work}/held/20261030090001_"*.sql "${work}/held/20261030090002_"*.sql "${work}/supabase/migrations/"

echo "== (1) a plain dry run lists exactly the two pending migrations"
dry="$(cd "${work}" && "${cli[@]}" db push --local --dry-run 2>&1)"
grep -q "20261030090001" <<<"${dry}" && ok "would apply 20261030090001" || { bad "dry run misses 20261030090001"; echo "${dry}" | tail -10; }
grep -q "20261030090002" <<<"${dry}" && ok "would apply 20261030090002" || { bad "dry run misses 20261030090002"; echo "${dry}" | tail -10; }
if grep -qi "include-all" <<<"${dry}"; then bad "plain push wants --include-all (out-of-order history)"; else ok "no --include-all needed (forward-only history)"; fi

echo "== (2) plain forward push, no --include-all and no history repair"
if (cd "${work}" && "${cli[@]}" db push --local --yes >/tmp/acc_push.log 2>&1); then ok "plain db push succeeded"; else bad "plain db push failed"; tail -15 /tmp/acc_push.log; fi
check "history has both new versions" "$(psqlq "select count(*) from supabase_migrations.schema_migrations where version in ('20261030090001','20261030090002')")" "2"
check "both applied in repository order" "$(psqlq "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations where version in ('20261030090001','20261030090002')")" "20261030090001,20261030090002"
check "history count is now 199" "$(psqlq "select count(*) from supabase_migrations.schema_migrations")" "199"

echo "== (3) existing accounts, aliases, profiles and logins are untouched"
check "auth.users fingerprint unchanged" "$(snap)" "${before_accounts}"
check "auth.users count unchanged" "$(psqlq 'select count(*) from auth.users')" "${before_count}"
check "public.users count unchanged" "$(psqlq 'select count(*) from public.users')" "${before_pub}"
check "profiles phone/verified fingerprint unchanged" "$(psqlq "select md5(coalesce(string_agg(id::text||coalesce(phone_e164,'')||coalesce(phone_verified_at::text,''), '|' order by id),'')) from public.profiles")" "${before_profiles}"
check "email login after" "$(signin existing.email@example.test 'Pre-Existing-Pass-1!')" "200"
check "phone-alias login after" "$(signin p201000000001@craftsman-login.aladdin.invalid 'Pre-Existing-Pass-2!')" "200"
check "pre-existing history rows unedited" "$(psqlq "select md5(string_agg(version||coalesce(name,''), '|' order by version)) from supabase_migrations.schema_migrations where version not in ('20261030090001','20261030090002')")" "${before_hist}"

echo "== (4) the new feature ships OFF, and the alias guard is inert at off"
check "switches enabled|signup|guard" "$(psqlq "select enabled||'|'||signup_enabled||'|'||alias_guard_mode from app.phone_verification_config")" "false|false|off"
check "alias guard trigger present on auth.users" "$(psqlq "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relname='users' and not t.tgisinternal and t.tgname='phone_alias_guard'")" "1"
check "alias guard trigger is deferred" "$(psqlq "select tgdeferrable::text||'|'||tginitdeferred::text from pg_trigger where tgname='phone_alias_guard'")" "true|true"
check "authority functions are service_role-only" "$(psqlq "select count(*) from information_schema.routine_privileges where routine_schema='public' and routine_name in ('phone_verification_start','phone_verification_verify','phone_verification_invalidate','phone_signup_start','phone_signup_verify','phone_signup_attach','phone_signup_invalidate') and grantee in ('anon','authenticated','PUBLIC')")" "0"
# The guard's mode is off, so an alias sign-up is not blocked by this release. This is the behaviour the hosted Acceptance
# now has; the migration only installs the deferred trigger.
check "new alias sign-up still allowed while guard is off" "$(admin '{"email":"p201000000002@craftsman-login.aladdin.invalid","password":"Post-Migration-Pass-3!","email_confirm":true}')" "200"
check "new alias login allowed while guard is off" "$(signin p201000000002@craftsman-login.aladdin.invalid 'Post-Migration-Pass-3!')" "200"

echo "== (5) a second dry run finds nothing to do"
again="$(cd "${work}" && "${cli[@]}" db push --local --dry-run 2>&1)"
grep -qi "up to date" <<<"${again}" && ok "remote up to date" || { bad "second dry run still has work"; echo "${again}" | tail -5; }

[[ ${fail} -eq 0 ]] && echo "REHEARSAL PASS" || { echo "REHEARSAL FAILED"; exit 1; }
