#!/usr/bin/env bash
set -euo pipefail

# Real two-session proof that lead source/branch ownership edits are optimistic-
# locked on `version` and cannot lose an update. T1 edits the lead (v1->v2) and
# holds the FOR UPDATE lock ~3s; T2 enters set_lead_source_branch with
# expected_version=1, blocks on the lock, then re-reads the committed (bumped)
# version and fails with 40001 — so only T1's edit applies. The single-session
# pgTAP test cannot prove this stale-after-commit serialization.

db_container="$(docker ps --filter 'name=supabase_db_aladdin' --format '{{.Names}}' | head -n 1)"
if [[ -z "${db_container}" ]]; then
  echo "Supabase database container not found" >&2
  exit 1
fi

# Self-contained fixture: activate 22222222 with sales.manage (org-wide), create a
# Cairo lead (version 1, source referral).
lead_id="$(docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<'SQL'
update public.memberships set status = 'active'
  where id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2';
insert into public.membership_capabilities (membership_id, capability_key)
  values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.manage')
  on conflict do nothing;
insert into public.leads (organization_id, branch_id, title, source, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','Own Race Lead','referral',
        '22222222-2222-4222-8222-222222222222')
returning id;
SQL
)"

t1_output="$(mktemp)"; t2_output="$(mktemp)"
trap 'rm -f "${t1_output}" "${t2_output}"' EXIT

docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v lead="${lead_id}" >"${t1_output}" 2>&1 <<'SQL' &
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public.set_lead_source_branch(:'lead', 1, p_change_source => true, p_new_source => 'campaign');
select pg_sleep(3);
commit;
SQL
t1_pid=$!

sleep 0.5
start_ns="$(date +%s%N)"
set +e
docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v lead="${lead_id}" >"${t2_output}" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public.set_lead_source_branch(:'lead', 1, p_change_source => true, p_new_source => 'phone');
commit;
SQL
t2_status=$?
set -e
end_ns="$(date +%s%N)"

set +e; wait "${t1_pid}"; t1_status=$?; set -e
elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))

if [[ ${t1_status} -ne 0 ]]; then
  echo "first concurrent ownership edit unexpectedly failed" >&2; sed -n '1,120p' "${t1_output}" >&2; exit 1
fi
if [[ ${t2_status} -eq 0 ]]; then
  echo "second concurrent ownership edit unexpectedly succeeded (lost update!)" >&2; sed -n '1,120p' "${t2_output}" >&2; exit 1
fi
if ! grep -q 'modified concurrently' "${t2_output}"; then
  echo "second ownership edit failed for the wrong reason" >&2; sed -n '1,120p' "${t2_output}" >&2; exit 1
fi
if [[ ${elapsed_ms} -lt 2000 ]]; then
  echo "second ownership edit did not wait on the row lock (${elapsed_ms}ms)" >&2; exit 1
fi

final="$(docker exec -i "${db_container}" psql -U postgres -d postgres -At -F '|' -v lead="${lead_id}" <<'SQL'
select version, source from public.leads where id = :'lead';
SQL
)"
if [[ "${final}" != "2|campaign" ]]; then
  echo "expected final version|source = 2|campaign (only T1 applied), got ${final}" >&2; exit 1
fi

echo "lead-ownership concurrency PASS: second edit waited ${elapsed_ms}ms and was rejected (40001); final=${final} (no lost update)"
