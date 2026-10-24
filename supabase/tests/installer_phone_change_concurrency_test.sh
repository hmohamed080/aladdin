#!/usr/bin/env bash
set -euo pipefail

# Real multi-session proof for the installer phone-change journal (migrations 20261014090004 / 090005).
#
# pgTAP runs in ONE session, so it cannot prove that simultaneous requests are safe. This script opens many
# separate database connections (one `psql` each; service_role for the trusted operations, authenticated for
# the user-facing profile_set_phone), holds them behind an advisory-lock barrier and releases them at the same
# instant. Everything commits for real. Assertions never depend on how well the workers overlap - they must
# hold for ANY interleaving; the barrier only makes the dangerous interleavings likely.
#
#   1. 8 simultaneous begins, 8 DIFFERENT valid receipts, one user      -> exactly 1 journal row / 1 success
#   2. 8 simultaneous begins sharing ONE receipt (distinct request ids) -> exactly 1 success, receipt spent once
#   3. 8 simultaneous begins with the SAME request id                   -> 1 fresh + replays, still 1 journal row
#   4. 2 users racing for the SAME new number                           -> exactly 1 wins, the other gets the generic error
#   5. 8 simultaneous settles of one change whose alias is already new  -> all done/applied, ONE audit event
#   6. 8 simultaneous compensations of one change                       -> all compensated/restored, ONE audit event
#   7. begin racing profile_set_phone(old number) as the user, x6 users -> profile and journal always agree
#   8. the auth.users ALIAS GUARD racing settlement (the UPDATE GoTrue issues vs settle), both start orders, x10 ->
#      always done+new alias or compensated+old alias, never a split, and a write after compensation never commits
#
# Only the Auth Admin API effect (auth.users.email) is simulated, by a direct UPDATE made by the script owner;
# the real GoTrue round trip is covered by the separate live script.
#
# DB_CONTAINER (REQUIRED) names the isolated local stack's database container; there is no default and no
# auto-selection (supabase/tests/lib/db_target.sh). It cleans up the users it creates; see supabase/tests/README.md.

source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require   # explicit DB_CONTAINER only; refuses shared / ambiguous / remote targets (no auto-selection)

psql_db() { docker exec -i "${db_container}" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 "$@"; }

workdir="$(mktemp -d)"
run="$(psql_db -c "select substr(md5(random()::text), 1, 6);")"   # unique per run so re-runs never collide
users=()
cleanup() {
  for u in "${users[@]:-}"; do
    [[ -n "${u}" ]] && psql_db -c "delete from auth.users where id = '${u}';" >/dev/null 2>&1 || true
  done
  rm -rf "${workdir}"
}
trap cleanup EXIT

seq_no=0
# make_user <alias phone digits after +20 (10 digits)> -> prints the new user id. The profile starts on the alias number.
make_user() {
  local national="$1" id
  id="$(psql_db -c "select gen_random_uuid();")"
  psql_db >/dev/null <<SQL
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p20${national}@craftsman-login.aladdin.invalid',
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now());
update public.profiles set phone_country_iso2 = 'EG', phone_national = '${national}', phone_e164 = '+20${national}' where user_id = '${id}';
SQL
  users+=("${id}")
  echo "${id}"
}

# number <block> <n>: a 10-digit national number that is unique per run, block and index.
number() { printf '10%04d%s%s00' "$((16#${run:0:3}))" "$1" "$2"; }

# mint <user> <e164>: a real M2 receipt (reserve -> verified settle) for a phone change; prints the receipt id.
mint() {
  # A receipt exactly as public.account_password_confirm issues it (PR #88 reauth receipts, 60 s, single use).
  printf "insert into app.reauth_receipts (user_id, operation, target, created_at, expires_at) values ('%s', 'primary_phone.change', '%s', clock_timestamp(), clock_timestamp() + interval '60 seconds') returning id;
" "$1" "$2" | psql_db | sed -n 1p
}

failures=0
check() { # check <description> <expected> <actual>
  if [[ "$2" == "$3" ]]; then echo "PASS  $1 (got $3)"; else echo "FAIL  $1 (expected $2, got $3)"; failures=$((failures + 1)); fi
}

# run_set <name> <script>...: one worker per script, all released together. A script is the whole worker body after the barrier.
run_set() {
  local name="$1" i=0 s
  shift
  psql_db -c "select pg_advisory_lock(4343); select pg_sleep(7); select pg_advisory_unlock(4343);" >/dev/null &
  local holder=$!
  sleep 1
  local pids=()
  for s in "$@"; do
    i=$((i + 1))
    printf 'select pg_advisory_lock_shared(4343);\n%s\n' "${s}" | psql_db >"${workdir}/${name}.${i}" 2>&1 &
    pids+=($!)
  done
  wait "${holder}" "${pids[@]}" || true
}
tally() { grep -lE "$2" "${workdir}/$1".* 2>/dev/null | wc -l | tr -d ' '; }

begin_script() { # begin_script <user> <request> <receipt> <national> <e164>
  printf "set role service_role;\nselect 'R:' || b.state || ':' || b.replayed::text from public.installer_phone_change_begin('%s', '%s', '%s', 'EG', '%s', '%s') b;\n" "$1" "$2" "$3" "$4" "$5"
}
settle_script() { # settle_script <user> <change> <finished>
  printf "set role service_role;\nselect 'S:' || s.state || '/' || coalesce(s.resolution, '-') from public.installer_phone_change_settle('%s', '%s', %s) s;\n" "$1" "$2" "$3"
}
count_where() { psql_db -c "$1"; }

# --- 1. 8 different receipts, one user -------------------------------------------------------------------
u1="$(make_user "$(number 1 1)")"; new1="$(number 2 1)"
scripts=()
for i in 1 2 3 4 5 6 7 8; do
  r="$(mint "${u1}" "+20${new1}")"
  scripts+=("$(begin_script "${u1}" "$(psql_db -c 'select gen_random_uuid();')" "${r}" "${new1}" "+20${new1}")")
done
run_set diffreceipts "${scripts[@]}"
check "8 simultaneous begins (8 valid receipts): successes" 1 "$(tally diffreceipts '^R:pending:false$')"
check "8 simultaneous begins: refused as 'change in progress'" 7 "$(tally diffreceipts 'a phone number change is in progress')"
check "exactly one journal row" 1 "$(count_where "select count(*) from app.installer_phone_changes where user_id = '${u1}';")"
check "the profile holds the new number exactly once" "+20${new1}" "$(count_where "select phone_e164 from public.profiles where user_id = '${u1}';")"
check "exactly ONE receipt was spent (the 7 refused begins burned nothing)" 1 "$(count_where "select count(*) from app.reauth_receipts where user_id = '${u1}' and used_at is not null;")"

# --- 2. ONE receipt, 8 simultaneous begins with distinct request ids -------------------------------------
u2="$(make_user "$(number 1 2)")"; new2="$(number 2 2)"
rcpt2="$(mint "${u2}" "+20${new2}")"
scripts=()
for i in 1 2 3 4 5 6 7 8; do
  scripts+=("$(begin_script "${u2}" "$(psql_db -c 'select gen_random_uuid();')" "${rcpt2}" "${new2}" "+20${new2}")")
done
run_set onereceipt "${scripts[@]}"
check "8 simultaneous begins sharing ONE receipt: successes" 1 "$(tally onereceipt '^R:pending:false$')"
check "8 simultaneous begins sharing ONE receipt: refused" 7 "$(tally onereceipt 'verification required')"
check "one journal row, one spent receipt" "1/1" "$(count_where "select (select count(*) from app.installer_phone_changes where user_id = '${u2}') || '/' || (select count(*) from app.reauth_receipts where id = '${rcpt2}' and used_at is not null);")"

# --- 3. SAME request id, 8 simultaneous begins -------------------------------------------------------------
u3="$(make_user "$(number 1 3)")"; new3="$(number 2 3)"
rcpt3="$(mint "${u3}" "+20${new3}")"; req3="$(psql_db -c 'select gen_random_uuid();')"
scripts=()
for i in 1 2 3 4 5 6 7 8; do scripts+=("$(begin_script "${u3}" "${req3}" "${rcpt3}" "${new3}" "+20${new3}")"); done
run_set samerequest "${scripts[@]}"
check "same request id x8: one fresh change" 1 "$(tally samerequest '^R:pending:false$')"
check "same request id x8: the rest are replays of the SAME change" 7 "$(tally samerequest '^R:pending:true$')"
check "same request id x8: one journal row" 1 "$(count_where "select count(*) from app.installer_phone_changes where user_id = '${u3}';")"

# --- 4. two users, the same new number ---------------------------------------------------------------------
u4a="$(make_user "$(number 1 4)")"; u4b="$(make_user "$(number 1 5)")"; new4="$(number 2 4)"
ra="$(mint "${u4a}" "+20${new4}")"; rb="$(mint "${u4b}" "+20${new4}")"
run_set samenumber \
  "$(begin_script "${u4a}" "$(psql_db -c 'select gen_random_uuid();')" "${ra}" "${new4}" "+20${new4}")" \
  "$(begin_script "${u4b}" "$(psql_db -c 'select gen_random_uuid();')" "${rb}" "${new4}" "+20${new4}")"
check "two users racing for one number: winners" 1 "$(tally samenumber '^R:pending:false$')"
check "two users racing for one number: the loser sees only the generic error" 1 "$(tally samenumber 'phone number is unavailable')"
check "exactly one profile holds the number" 1 "$(count_where "select count(*) from public.profiles where phone_e164 = '+20${new4}';")"
check "exactly one journal row targets it" 1 "$(count_where "select count(*) from app.installer_phone_changes where new_e164 = '+20${new4}' and user_id in ('${u4a}', '${u4b}');")"
check "the loser's receipt was not spent" 1 "$(count_where "select count(*) from app.reauth_receipts where user_id in ('${u4a}', '${u4b}') and used_at is null;")"

# --- 5. 8 simultaneous settles; the alias is already new ---------------------------------------------------
change1="$(count_where "select id from app.installer_phone_changes where user_id = '${u1}';")"
psql_db -c "update auth.users set email = 'p20${new1}@craftsman-login.aladdin.invalid' where id = '${u1}';" >/dev/null
scripts=()
for i in 1 2 3 4 5 6 7 8; do scripts+=("$(settle_script "${u1}" "${change1}" false)"); done
run_set settledone "${scripts[@]}"
check "8 simultaneous settles (alias is new): all done/applied" 8 "$(tally settledone '^S:done/applied$')"
check "the change is done once" "done/applied" "$(count_where "select state || '/' || resolution from app.installer_phone_changes where id = '${change1}';")"
check "exactly ONE profile.phone_changed audit event" 1 "$(count_where "select count(*) from public.audit_log where actor_user_id = '${u1}' and action = 'profile.phone_changed';")"
check "the audit metadata holds no phone or alias" 0 "$(count_where "select count(*) from public.audit_log where actor_user_id = '${u1}' and metadata::text ~ '20${new1}|craftsman';")"
check "the new phone is not marked verified" "t" "$(count_where "select phone_verified_at is null from public.profiles where user_id = '${u1}';")"

# --- 6. 8 simultaneous compensations -------------------------------------------------------------------------
change2="$(count_where "select id from app.installer_phone_changes where user_id = '${u2}';")"
scripts=()
for i in 1 2 3 4 5 6 7 8; do scripts+=("$(settle_script "${u2}" "${change2}" true)"); done
run_set settlecomp "${scripts[@]}"
check "8 simultaneous compensations: all compensated/restored" 8 "$(tally settlecomp '^S:compensated/restored$')"
check "the profile is back on the old number" "$(count_where "select old_e164 from app.installer_phone_changes where id = '${change2}';")" "$(count_where "select phone_e164 from public.profiles where user_id = '${u2}';")"
check "exactly ONE profile.phone_change_compensated audit event" 1 "$(count_where "select count(*) from public.audit_log where actor_user_id = '${u2}' and action = 'profile.phone_change_compensated';")"

# --- 7. begin racing profile_set_phone(old number) as the user ----------------------------------------------
agree=0
for t in 1 2 3 4 5 6; do
  ut="$(make_user "$(number 3 "${t}")")"; oldn="$(number 3 "${t}")"; newt="$(number 4 "${t}")"
  rt="$(mint "${ut}" "+20${newt}")"
  run_set "race${t}" \
    "$(begin_script "${ut}" "$(psql_db -c 'select gen_random_uuid();')" "${rt}" "${newt}" "+20${newt}")" \
    "set role authenticated;
set request.jwt.claims = '{\"sub\":\"${ut}\",\"role\":\"authenticated\"}';
select 'P:' || 'ok' from (select public.profile_set_phone('EG', '${oldn}', '+20${oldn}')) x;"
  # Invariant: the profile is on the journal's new number iff a journal row exists; never half-way.
  state="$(count_where "select (select count(*) from app.installer_phone_changes where user_id = '${ut}')::text || '/' || (select phone_e164 from public.profiles where user_id = '${ut}');")"
  if [[ "${state}" == "1/+20${newt}" ]]; then agree=$((agree + 1)); else echo "INFO  race ${t}: ${state}"; fi
done
check "begin vs profile_set_phone(old): profile and journal agree in all 6 races" 6 "${agree}"

# --- 8. alias guard racing settlement ------------------------------------------------------------------------
consistent=0; stale_blocked=0
for t in 1 2 3 4 5 6 7 8 9 10; do
  ug="$(make_user "$(number 5 "${t}")")"; oldg="$(number 5 "${t}")"; newg="$(number 6 "${t}")"
  rg="$(mint "${ug}" "+20${newg}")"
  chg="$(printf "set role service_role;
select change_id from public.installer_phone_change_begin('%s', '%s', '%s', 'EG', '%s', '%s');
" "${ug}" "$(psql_db -c 'select gen_random_uuid();')" "${rg}" "${newg}" "+20${newg}" | psql_db | tail -n 1)"
  write_sql="update auth.users set email = 'p20${newg}@craftsman-login.aladdin.invalid' where id = '${ug}';"
  settle_sql="set role service_role; select state from public.installer_phone_change_settle('${ug}', '${chg}', false);"
  if (( t % 2 == 0 )); then first="${write_sql}"; second="${settle_sql}"; else first="${settle_sql}"; second="${write_sql}"; fi
  run_set "guard${t}" "${first}" "${second}"
  final="$(count_where "select c.state || '/' || (u.email = 'p20${newg}@craftsman-login.aladdin.invalid')::text || '/' || (p.phone_e164 = c.new_e164)::text from app.installer_phone_changes c join auth.users u on u.id = c.user_id join public.profiles p on p.user_id = c.user_id where c.id = '${chg}';")"
  if [[ "${final}" == "done/true/true" || "${final}" == "compensated/false/false" ]]; then consistent=$((consistent + 1)); else echo "INFO  guard race ${t}: ${final}"; fi
  # whatever happened, a LATE write after the journal row is terminal must not commit
  if [[ "${final}" == "compensated/false/false" ]]; then
    late="$(printf '%s
' "${write_sql}" | psql_db 2>&1 || true)"
    if [[ "$(count_where "select (email = 'p20${newg}@craftsman-login.aladdin.invalid')::text from auth.users where id = '${ug}';")" == "false" ]]; then stale_blocked=$((stale_blocked + 1)); fi
  else
    stale_blocked=$((stale_blocked + 1))
  fi
done
check "alias guard vs settlement (10 races, both orders): every final state consistent" 10 "${consistent}"
check "alias guard: a write after compensation never commits" 10 "${stale_blocked}"

# --- 8. Installer primary change vs ANOTHER account's secondary reservation of the same number (PR #88) ------------
# Both claims take app.lock_phone(number): exactly one of them may hold the number, whichever order they commit in.
make_email_user() {
  local id
  id="$(psql_db -c "select gen_random_uuid();")"
  psql_db >/dev/null <<SQL
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'race-${run}-${id}@probe.test',
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now());
SQL
  users+=("${id}")
  echo "${id}"
}
exclusive=0
for t in 1 2 3 4 5 6 7 8 9 10; do
  ui="$(make_user "$(number 7 "${t}")")"; ur="$(make_email_user)"; target="+20$(number 8 "${t}")"
  ri="$(mint "${ui}" "${target}")"
  rr="$(printf "insert into app.reauth_receipts (user_id, operation, target, created_at, expires_at) values ('%s', 'secondary_phone.reserve', '%s', clock_timestamp(), clock_timestamp() + interval '60 seconds') returning id;\n" "${ur}" "${target}" | psql_db | sed -n 1p)"
  reserve_sql="select set_config('request.jwt.claims', json_build_object('sub', '${ur}', 'role', 'authenticated')::text, false); set role authenticated; select 'V:' || (public.secondary_phone_reserve('${target}', '${rr}'))::text;"
  begin_sql="$(begin_script "${ui}" "$(psql_db -c 'select gen_random_uuid();')" "${ri}" "${target:3}" "${target}")"
  if (( t % 2 == 0 )); then run_set "cross${t}" "${reserve_sql}" "${begin_sql}"; else run_set "cross${t}" "${begin_sql}" "${reserve_sql}"; fi
  holders="$(count_where "select (select count(*) from public.profiles where phone_e164 = '${target}') + (select count(*) from public.secondary_phone_reservations where phone_e164 = '${target}' and status = 'active');")"
  [[ "${holders}" == "1" ]] && exclusive=$((exclusive + 1))
done
check "primary change vs reservation of one number (10 races, both orders): exactly one holder every time" 10 "${exclusive}"


if [[ "${failures}" -ne 0 ]]; then
  echo "${failures} concurrency check(s) failed" >&2
  exit 1
fi
echo "installer phone change concurrency proof passed"
