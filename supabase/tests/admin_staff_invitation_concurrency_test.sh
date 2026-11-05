#!/usr/bin/env bash
set -euo pipefail

# Admin Staff invitations under simultaneous requests (20261105090001_admin_staff_invitations.sql).
#   A. Two sessions accept the SAME invitation: the row lock serializes them; one assignment, one audit event, the second is an idempotent no-op.
#   B. Two sessions create the SAME pending invitation: the unique index lets exactly one through.
#   C. Revoke races accept: exactly one wins; a revoked invitation never produces an assignment.
# Every fixture is generated per run (random ids), so the script can run repeatedly; it marks the database as mutated.

source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require
db_target_mark_dirty "$(basename "$0")"

dba() { docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

role_mod="$(dba -c "select id from public.admin_roles where key = 'moderator'")"
run_id="$(dba -c "select substr(md5(random()::text), 1, 8)")"
inviter="$(dba -c "select gen_random_uuid()")"
invitee_a="$(dba -c "select gen_random_uuid()")"
invitee_c="$(dba -c "select gen_random_uuid()")"
email_a="conc-a-${run_id}@staffinv.test"
email_b="conc-b-${run_id}@staffinv.test"
email_c="conc-c-${run_id}@staffinv.test"

dba <<SQL
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('${inviter}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conc-inv-${run_id}@staffinv.test', now(), '{"full_name":"Conc Inviter"}', now(), now()),
       ('${invitee_a}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email_a}', now(), '{"full_name":"Conc A"}', now(), now()),
       ('${invitee_c}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email_c}', now(), '{"full_name":"Conc C"}', now(), now());
insert into public.admin_role_assignments (user_id, role_id)
select '${inviter}', id from public.admin_roles where key = 'administrator';
update public.users set status = 'active' where id = '${inviter}';
-- Acceptance requires the current consent receipts (as after a real registration); the races below are about the invitation, not consent.
insert into public.consent_receipts (user_id, consent_type, version, locale)
select u, t, app.current_consent_version(t), 'en'
  from unnest(array['${invitee_a}', '${invitee_c}']::uuid[]) u, unnest(enum_range(null::public.consent_type)) t;
SQL

as_user() { # as_user <uuid> <sql...>: run one statement as a signed-in user, print its single value
  local uid="$1"; shift
  docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
$*
commit;
SQL
}
invite() { # invite <email> -> prints the token
  as_user "${inviter}" "select (public.admin_staff_invite('$1', '${role_mod}'::uuid, 'Concurrency proof of staff invitations')) ->> 'token';" | tail -1
}

# ---------------------------------------------------------------------------
# A. two concurrent acceptances of the same invitation
# ---------------------------------------------------------------------------
token_a="$(invite "${email_a}")"
[[ ${#token_a} -eq 64 ]] || fail "A: no token returned"
t1="$(mktemp)"; t2="$(mktemp)"; trap 'rm -f "${t1}" "${t2}"' EXIT
docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 >"${t1}" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${invitee_a}","role":"authenticated"}', true);
select (public.staff_invitation_accept('${token_a}')) ->> 'status';
select pg_sleep(3);
commit;
SQL
p1=$!
sleep 0.7
start_ns="$(date +%s%N)"
as_user "${invitee_a}" "select (public.staff_invitation_accept('${token_a}')) ->> 'status';" >"${t2}" 2>&1
end_ns="$(date +%s%N)"
wait "${p1}" || fail "A: first acceptance failed: $(cat "${t1}")"
grep -q "^accepted$" "${t1}" || fail "A: the first acceptance was not 'accepted': $(cat "${t1}")"
grep -q "already_accepted" "${t2}" || fail "A: the second acceptance was not an idempotent no-op: $(cat "${t2}")"
(( (end_ns - start_ns) / 1000000 >= 1500 )) || fail "A: the second acceptance did not wait for the first (not serialized)"
[[ "$(dba -c "select count(*) from public.admin_role_assignments where user_id = '${invitee_a}' and is_active")" == "1" ]] || fail "A: expected exactly one active assignment"
[[ "$(dba -c "select count(*) from public.audit_log where action = 'admin_staff.invitation_accepted' and metadata ->> 'invited_by' = '${inviter}' and subject_id = (select id from app.admin_staff_invitations where email = '${email_a}')")" == "1" ]] || fail "A: expected exactly one invitation_accepted audit event"
echo "A ok: serialized acceptance, one assignment, one audit event"

# ---------------------------------------------------------------------------
# B. two concurrent identical invitations
# ---------------------------------------------------------------------------
tb1="$(mktemp)"; tb2="$(mktemp)"; trap 'rm -f "${t1}" "${t2}" "${tb1}" "${tb2}"' EXIT
docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 >"${tb1}" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${inviter}","role":"authenticated"}', true);
select (public.admin_staff_invite('${email_b}', '${role_mod}'::uuid, 'Concurrency proof, first invitation')) ->> 'id';
select pg_sleep(3);
commit;
SQL
pb1=$!
sleep 0.7
set +e
as_user "${inviter}" "select (public.admin_staff_invite('${email_b}', '${role_mod}'::uuid, 'Concurrency proof, second invitation')) ->> 'id';" >"${tb2}" 2>&1
second_status=$?
set -e
wait "${pb1}" || fail "B: first invitation failed: $(cat "${tb1}")"
[[ ${second_status} -ne 0 ]] || fail "B: the duplicate invitation was not refused: $(cat "${tb2}")"
[[ "$(dba -c "select count(*) from app.admin_staff_invitations where email = '${email_b}' and status = 'pending'")" == "1" ]] || fail "B: expected exactly one pending invitation"
echo "B ok: the unique index let exactly one invitation through"

# ---------------------------------------------------------------------------
# C. revoke races accept
# ---------------------------------------------------------------------------
token_c="$(invite "${email_c}")"
inv_c="$(dba -c "select id from app.admin_staff_invitations where email = '${email_c}' and status = 'pending'")"
tc1="$(mktemp)"; tc2="$(mktemp)"; trap 'rm -f "${t1}" "${t2}" "${tb1}" "${tb2}" "${tc1}" "${tc2}"' EXIT
docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 >"${tc1}" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${inviter}","role":"authenticated"}', true);
select public.admin_staff_invitation_revoke('${inv_c}', 'Concurrency proof, withdrawn');
select pg_sleep(3);
commit;
SQL
pc1=$!
sleep 0.7
set +e
as_user "${invitee_c}" "select (public.staff_invitation_accept('${token_c}')) ->> 'status';" >"${tc2}" 2>&1
accept_status=$?
set -e
wait "${pc1}" || fail "C: revoke failed: $(cat "${tc1}")"
[[ ${accept_status} -ne 0 ]] || fail "C: a revoked invitation was accepted: $(cat "${tc2}")"
[[ "$(dba -c "select status from app.admin_staff_invitations where id = '${inv_c}'")" == "revoked" ]] || fail "C: the invitation is not revoked"
[[ "$(dba -c "select count(*) from public.admin_role_assignments where user_id = '${invitee_c}'")" == "0" ]] || fail "C: a revoked invitation produced an assignment"
echo "C ok: revoke won; no assignment was created"
echo "admin staff invitation concurrency: all proofs passed"
