#!/usr/bin/env bash
set -euo pipefail

# Real two-session proof for the last-owner invariant. Transaction 1 holds the
# stable organization row lock while transaction 2 enters the revoke RPC. The
# second call must block, then re-check committed state and fail, leaving one owner.

db_container="$(docker ps --filter 'name=supabase_db_aladdin' --format '{{.Names}}' | head -n 1)"
if [[ -z "${db_container}" ]]; then
  echo "Supabase database container not found" >&2
  exit 1
fi

docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
insert into public.membership_capabilities (membership_id, capability_key)
values
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'org.manage'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'org.members.manage')
on conflict do nothing;
SQL

t1_output="$(mktemp)"
t2_output="$(mktemp)"
trap 'rm -f "${t1_output}" "${t2_output}"' EXIT

docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >"${t1_output}" 2>&1 <<'SQL' &
begin;
select id from public.organizations
where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
for update;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
select pg_sleep(3);
select public.membership_revoke('e1111111-eeee-4eee-8eee-eeeeeeeeeee1');
commit;
SQL
t1_pid=$!

sleep 0.5
start_ns="$(date +%s%N)"
set +e
docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >"${t2_output}" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
select public.membership_revoke('e2222222-eeee-4eee-8eee-eeeeeeeeeee2');
commit;
SQL
t2_status=$?
set -e
end_ns="$(date +%s%N)"

set +e
wait "${t1_pid}"
t1_status=$?
set -e

elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))

if [[ ${t1_status} -ne 0 ]]; then
  echo "first concurrent revoke unexpectedly failed" >&2
  sed -n '1,120p' "${t1_output}" >&2
  exit 1
fi
if [[ ${t2_status} -eq 0 ]]; then
  echo "second concurrent revoke unexpectedly succeeded" >&2
  sed -n '1,120p' "${t2_output}" >&2
  exit 1
fi
if ! grep -q 'cannot remove the last active org.manage owner' "${t2_output}"; then
  echo "second concurrent revoke failed for the wrong reason" >&2
  sed -n '1,120p' "${t2_output}" >&2
  exit 1
fi
if [[ ${elapsed_ms} -lt 2000 ]]; then
  echo "second revoke did not wait on the stable organization lock (${elapsed_ms}ms)" >&2
  exit 1
fi

remaining_owners="$(docker exec -i "${db_container}" psql -U postgres -d postgres -Atc "
select count(*)
from public.memberships m
join public.membership_capabilities c on c.membership_id=m.id
where m.organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and m.status='active'
  and c.capability_key='org.manage';")"

if [[ "${remaining_owners}" != "1" ]]; then
  echo "expected exactly one active org.manage owner, found ${remaining_owners}" >&2
  exit 1
fi

echo "last-owner concurrency PASS: second transaction waited ${elapsed_ms}ms; active owners=${remaining_owners}"
