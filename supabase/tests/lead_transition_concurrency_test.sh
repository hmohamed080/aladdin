#!/usr/bin/env bash
set -euo pipefail

# Real two-session proof that lead pipeline transitions are optimistic-locked and
# cannot lose an update. Transaction 1 holds the lead row lock (FOR UPDATE) while
# transaction 2 enters transition_lead with the same expected version. The second
# call must BLOCK on the row lock, then re-read the committed (bumped) version and
# fail with 40001 — so only the first transition applies (no lost update). The
# single-session pgTAP version-mismatch test cannot prove this serialization.

db_container="$(docker ps --filter 'name=supabase_db_aladdin' --format '{{.Names}}' | head -n 1)"
if [[ -z "${db_container}" ]]; then
  echo "Supabase database container not found" >&2
  exit 1
fi

# Self-contained fixture (independent of the other concurrency scripts, which
# mutate the seed and do not roll back): ensure user 22222222's Org-A membership is
# active and holds sales.manage, then create a fresh Org-A Cairo lead at version 1.
lead_id="$(docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<'SQL'
update public.memberships set status = 'active'
  where id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2';
insert into public.membership_capabilities (membership_id, capability_key)
  values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.manage')
  on conflict do nothing;
insert into public.leads (organization_id, branch_id, title, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc',
        'Race Lead', '22222222-2222-4222-8222-222222222222')
returning id;
SQL
)"

t1_output="$(mktemp)"
t2_output="$(mktemp)"
trap 'rm -f "${t1_output}" "${t2_output}"' EXIT

# T1 transitions to 'contacted' (v1->v2) — transition_lead's internal FOR UPDATE
# holds the row lock — then sleeps ~3s before committing so the lock is held while
# T2 races (authenticated is SELECT-only, so it cannot lock the row itself; only
# the security-definer RPC can, which is exactly the boundary under test).
docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v lead_id="${lead_id}" >"${t1_output}" 2>&1 <<'SQL' &
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public.transition_lead(:'lead_id', 1, 'contacted');
select pg_sleep(3);
commit;
SQL
t1_pid=$!

sleep 0.5
start_ns="$(date +%s%N)"
set +e
docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v lead_id="${lead_id}" >"${t2_output}" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public.transition_lead(:'lead_id', 1, 'qualified');
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
  echo "first concurrent transition unexpectedly failed" >&2
  sed -n '1,120p' "${t1_output}" >&2
  exit 1
fi
if [[ ${t2_status} -eq 0 ]]; then
  echo "second concurrent transition unexpectedly succeeded (lost update!)" >&2
  sed -n '1,120p' "${t2_output}" >&2
  exit 1
fi
if ! grep -q 'modified concurrently' "${t2_output}"; then
  echo "second transition failed for the wrong reason" >&2
  sed -n '1,120p' "${t2_output}" >&2
  exit 1
fi
if [[ ${elapsed_ms} -lt 2000 ]]; then
  echo "second transition did not wait on the row lock (${elapsed_ms}ms)" >&2
  exit 1
fi

final="$(docker exec -i "${db_container}" psql -U postgres -d postgres -At -F '|' \
  -v lead_id="${lead_id}" <<'SQL'
select version, stage from public.leads where id = :'lead_id';
SQL
)"
if [[ "${final}" != "2|contacted" ]]; then
  echo "expected final version|stage = 2|contacted (only T1 applied), got ${final}" >&2
  exit 1
fi

echo "lead-transition concurrency PASS: second transition waited ${elapsed_ms}ms and was rejected (40001); final=${final} (no lost update)"
