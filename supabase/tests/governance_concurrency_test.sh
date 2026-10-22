#!/usr/bin/env bash
set -euo pipefail

# Real two-session proof that governance writers cannot commit on authority withdrawn mid-flight
# (check-then-act). branch_create takes a SHARE lock on the organization row and on the caller's
# membership BEFORE it checks authority.
#
#   A. a manager's membership is suspended while another session is inside branch_create:
#      the suspension must WAIT for the writer (it cannot slip in between check and insert).
#   B. a membership suspension is already in flight (uncommitted) when branch_create starts:
#      branch_create waits, then re-checks, finds the membership suspended and refuses -
#      no branch is created.

source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require   # explicit DB_CONTAINER only; refuses shared / ambiguous / remote targets (no auto-selection)
db_target_mark_dirty "$(basename "$0")"   # this script changes shared/seed rows: pgTAP must not run on this database afterwards

psql_run() { docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

run="$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
uid="78c0${run:0:4}-0000-4000-8000-0000${run}"
oid="78c1${run:0:4}-0000-4000-8000-0000${run}"
mid="78c2${run:0:4}-0000-4000-8000-0000${run}"

psql_run >/dev/null <<SQL
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
values ('${uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'gov-concurrency-${run}@example.test', '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"G78","locale":"en"}'::jsonb, now(), now(), now());
insert into public.organizations (id, name, org_type, status, is_verified, created_by)
values ('${oid}', 'G78 Approved Showroom', 'showroom_dealer', 'active', true, '${uid}');
insert into public.memberships (id, user_id, organization_id, status)
values ('${mid}', '${uid}', '${oid}', 'active');
insert into public.membership_capabilities (membership_id, capability_key)
values ('${mid}', 'org.manage'), ('${mid}', 'branch.manage');
SQL

branch_count() { psql_run -c "select count(*) from public.branches where organization_id = '${oid}';"; }

# ---- A: the suspension must wait for the in-flight writer ------------------------------------
writer_sql() {
  cat <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
select 'CREATED:' || public.branch_create('${oid}', 'Race Branch A');
select pg_sleep(3);
commit;
SQL
}
tA="$(mktemp)"; tB="$(mktemp)"; tC="$(mktemp)"
trap 'rm -f "${tA}" "${tB}" "${tC}"' EXIT

writer_sql | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tA}" 2>&1 &
pw=$!
sleep 1
start=$(date +%s)
psql_run -c "update public.memberships set status = 'suspended' where id = '${mid}';" >/dev/null
elapsed=$(( $(date +%s) - start ))
wait "${pw}" || true
created_a="$(grep -c 'CREATED:' "${tA}" || true)"
echo "A: writer created=${created_a} suspension waited ${elapsed}s"
if [[ "${created_a}" != "1" || "${elapsed}" -lt 1 ]]; then
  echo "FAIL (A): the suspension did not wait for the in-flight branch_create" >&2
  cat "${tA}" >&2
  exit 1
fi

# ---- B: a suspension in flight makes branch_create refuse -----------------------------------
psql_run -c "update public.memberships set status = 'active' where id = '${mid}';" >/dev/null
before="$(branch_count)"

{
  cat <<SQL
begin;
update public.memberships set status = 'suspended' where id = '${mid}';
select pg_sleep(3);
commit;
SQL
} | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tB}" 2>&1 &
ps=$!
sleep 1
{
  cat <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
select 'CREATED:' || public.branch_create('${oid}', 'Race Branch B');
commit;
SQL
} | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tC}" 2>&1 || true
wait "${ps}" || true
after="$(branch_count)"
created_b="$(grep -c 'CREATED:' "${tC}" || true)"
echo "B: created=${created_b} branches before=${before} after=${after}"
if [[ "${created_b}" != "0" || "${before}" != "${after}" ]]; then
  echo "FAIL (B): a branch was created on authority that was withdrawn" >&2
  cat "${tC}" >&2
  exit 1
fi
echo "PASS: governance writers serialise with authority changes - no write on withdrawn authority"
