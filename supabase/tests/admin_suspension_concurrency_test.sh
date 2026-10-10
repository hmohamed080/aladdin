#!/usr/bin/env bash
set -euo pipefail

# Real two-session proofs for Admin Core 1B-B suspension (PD-010):
#   1. The two remaining Super Admins suspend EACH OTHER at the same moment:
#      exactly one suspension may succeed — never zero usable Super Admins.
#   2. Two Administrators suspend the SAME user at the same moment: one
#      episode and one audit row (the second call is a no-op).
# MANUAL / ISOLATED-STACK CONTRACT TEST — not run by CI. It COMMITS data, so run it only against an
# isolated local stack, then rebuild that stack (`supabase db reset`):
#   supabase/tests/admin_suspension_concurrency_test.sh <db-container>
# The container must be named explicitly; the shared local stack (supabase_db_aladdin) is refused, and it only
# ever talks to a local Docker container — never to a hosted project.

db_container="${1:-}"
if [[ -z "${db_container}" ]]; then
  echo "usage: $0 <supabase db container of an ISOLATED stack>" >&2
  exit 2
fi
if [[ "${db_container}" == "supabase_db_aladdin" ]]; then
  echo "Refusing to run against the shared local stack (supabase_db_aladdin). Use an isolated stack's container." >&2
  exit 2
fi
psql_run() { docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

psql_run <<'SQL'
select app.admin_bootstrap_super_admin('11111111-1111-4111-8111-111111111111')
where not exists (select 1 from public.admin_role_assignments a join public.admin_roles r on r.id = a.role_id
                  where r.key = 'super_admin' and a.is_active);
insert into public.admin_role_assignments (user_id, role_id)
select '22222222-2222-4222-8222-222222222222', id from public.admin_roles where key = 'super_admin'
on conflict do nothing;
insert into public.admin_role_assignments (user_id, role_id)
select '33333333-3333-4333-8333-333333333333', id from public.admin_roles where key = 'administrator'
on conflict do nothing;
SQL

out_a="$(mktemp)"; out_b="$(mktemp)"
trap 'rm -f "${out_a}" "${out_b}"' EXIT

suspend_sql() { # $1 actor, $2 target, $3 sleep seconds before commit
  cat <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
select public.admin_user_suspend('$2', 'concurrency proof');
select pg_sleep($3);
commit;
SQL
}

# --- 1. mutual Super Admin suspension --------------------------------------
suspend_sql 11111111-1111-4111-8111-111111111111 22222222-2222-4222-8222-222222222222 2 | psql_run >"${out_a}" 2>&1 &
pid_a=$!
sleep 0.5
set +e
suspend_sql 22222222-2222-4222-8222-222222222222 11111111-1111-4111-8111-111111111111 0 | psql_run >"${out_b}" 2>&1
status_b=$?
wait "${pid_a}"; status_a=$?
set -e

active_supers="$(psql_run -c "select count(*) from public.admin_role_assignments a join public.admin_roles r on r.id = a.role_id join public.users u on u.id = a.user_id where r.key = 'super_admin' and a.is_active and a.scope_type = 'platform' and u.status not in ('suspended','deactivated')")"
echo "mutual suspension: session A exit ${status_a}, session B exit ${status_b}, usable Super Admins left: ${active_supers}"
if [[ "${status_a}" -ne 0 || "${status_b}" -eq 0 || "${active_supers}" -ne 1 ]]; then
  echo "FAIL: expected A to succeed, B to be refused, and exactly one usable Super Admin" >&2
  cat "${out_b}" >&2
  exit 1
fi
grep -q "the last active Super Admin cannot be suspended" "${out_b}" || { echo "FAIL: B refused for the wrong reason" >&2; cat "${out_b}" >&2; exit 1; }

# restore for the next proof
psql_run >/dev/null <<'SQL'
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
set role authenticated;
select public.admin_user_restore('22222222-2222-4222-8222-222222222222', 'concurrency proof');
SQL

# --- 2. two Administrators suspend the same user ---------------------------
target=44444444-4444-4444-8444-444444444444
suspend_sql 55555555-5555-4555-8555-555555555555 "${target}" 2 | psql_run >"${out_a}" 2>&1 &
pid_a=$!
sleep 0.5
suspend_sql 33333333-3333-4333-8333-333333333333 "${target}" 0 | psql_run >"${out_b}" 2>&1
wait "${pid_a}"

episodes="$(psql_run -c "select count(*) from public.admin_suspensions where user_id = '${target}'")"
audits="$(psql_run -c "select count(*) from public.audit_log where action = 'account.suspended' and subject_id = '${target}'")"
echo "double suspension: episodes ${episodes}, audit rows ${audits}; second call returned: $(grep -o '"changed": [a-z]*' "${out_b}")"
if [[ "${episodes}" -ne 1 || "${audits}" -ne 1 ]] || ! grep -q '"changed": false' "${out_b}"; then
  echo "FAIL: expected one episode, one audit row and a no-op second call" >&2
  exit 1
fi
echo "PASS"
