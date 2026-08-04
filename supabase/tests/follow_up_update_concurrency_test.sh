#!/usr/bin/env bash
set -euo pipefail

# Real two-session proof that follow-up edits are optimistic-locked on `version`
# and cannot lose an update. T1 edits the open follow-up (v1->v2) and holds the
# FOR UPDATE lock ~3s; T2 enters update_follow_up with expected_version=1, blocks
# on the lock, then re-reads the committed (bumped) version and fails with 40001 —
# so only T1's edit applies. The single-session pgTAP test cannot prove this.

db_container="$(docker ps --filter 'name=supabase_db_aladdin' --format '{{.Names}}' | head -n 1)"
if [[ -z "${db_container}" ]]; then
  echo "Supabase database container not found" >&2
  exit 1
fi

# Self-contained fixture: activate 22222222 with sales.manage, create a Cairo lead
# and an open follow-up on it (version 1).
follow_up_id="$(docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<'SQL'
update public.memberships set status = 'active'
  where id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2';
insert into public.membership_capabilities (membership_id, capability_key)
  values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.manage')
  on conflict do nothing;
insert into public.leads (organization_id, branch_id, title, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','FU Race Lead',
        '22222222-2222-4222-8222-222222222222');
insert into public.follow_up_tasks (organization_id, branch_id, lead_id, assigned_membership_id, title, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc',
        (select id from public.leads where title='FU Race Lead'),
        'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','Race Follow-up',
        '22222222-2222-4222-8222-222222222222')
returning id;
SQL
)"

t1_output="$(mktemp)"; t2_output="$(mktemp)"
trap 'rm -f "${t1_output}" "${t2_output}"' EXIT

docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v fu="${follow_up_id}" >"${t1_output}" 2>&1 <<'SQL' &
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public.update_follow_up(:'fu', p_expected_version => 1, p_title => 'T1 Title');
select pg_sleep(3);
commit;
SQL
t1_pid=$!

sleep 0.5
start_ns="$(date +%s%N)"
set +e
docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v fu="${follow_up_id}" >"${t2_output}" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public.update_follow_up(:'fu', p_expected_version => 1, p_title => 'T2 Title');
commit;
SQL
t2_status=$?
set -e
end_ns="$(date +%s%N)"

set +e; wait "${t1_pid}"; t1_status=$?; set -e
elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))

if [[ ${t1_status} -ne 0 ]]; then
  echo "first concurrent follow-up edit unexpectedly failed" >&2; sed -n '1,120p' "${t1_output}" >&2; exit 1
fi
if [[ ${t2_status} -eq 0 ]]; then
  echo "second concurrent follow-up edit unexpectedly succeeded (lost update!)" >&2; sed -n '1,120p' "${t2_output}" >&2; exit 1
fi
if ! grep -q 'modified concurrently' "${t2_output}"; then
  echo "second follow-up edit failed for the wrong reason" >&2; sed -n '1,120p' "${t2_output}" >&2; exit 1
fi
if [[ ${elapsed_ms} -lt 2000 ]]; then
  echo "second follow-up edit did not wait on the row lock (${elapsed_ms}ms)" >&2; exit 1
fi

final="$(docker exec -i "${db_container}" psql -U postgres -d postgres -At -F '|' -v fu="${follow_up_id}" <<'SQL'
select version, title from public.follow_up_tasks where id = :'fu';
SQL
)"
if [[ "${final}" != "2|T1 Title" ]]; then
  echo "expected final version|title = 2|T1 Title (only T1 applied), got ${final}" >&2; exit 1
fi

echo "follow-up-update concurrency PASS: second edit waited ${elapsed_ms}ms and was rejected (40001); final=${final} (no lost update)"
