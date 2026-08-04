#!/usr/bin/env bash
set -euo pipefail

# Real two-session proof that customer edits are optimistic-locked on updated_at
# and cannot lose an update. Customers have no version column, so update_customer
# takes p_expected_updated_at and rejects a stale edit under the row lock.
# T1 edits (bumping updated_at via the trigger) and holds the FOR UPDATE lock for
# ~3s; T2 enters update_customer with the SAME (now stale) expected updated_at,
# blocks on the lock, then re-reads the committed row and fails with 40001 — so
# only T1's edit applies. The single-session pgTAP test cannot prove this.

db_container="$(docker ps --filter 'name=supabase_db_aladdin' --format '{{.Names}}' | head -n 1)"
if [[ -z "${db_container}" ]]; then
  echo "Supabase database container not found" >&2
  exit 1
fi

# Self-contained fixture: activate user 22222222's Org-A membership with
# sales.manage, create a fresh Cairo customer (direct insert, as postgres), and
# capture its updated_at token. `|` delimiter — the timestamp contains a space.
IFS='|' read -r customer_id u0 < <(docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 <<'SQL'
update public.memberships set status = 'active'
  where id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2';
insert into public.membership_capabilities (membership_id, capability_key)
  values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.manage')
  on conflict do nothing;
insert into public.customers (organization_id, branch_id, display_name, primary_phone, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc',
        'Race Customer','01000000008','22222222-2222-4222-8222-222222222222')
returning id, updated_at;
SQL
)

t1_output="$(mktemp)"; t2_output="$(mktemp)"
trap 'rm -f "${t1_output}" "${t2_output}"' EXIT

# T1: edit with the correct token (succeeds, bumps updated_at), then hold the lock.
docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v customer_id="${customer_id}" -v u0="${u0}" >"${t1_output}" 2>&1 <<'SQL' &
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public.update_customer(:'customer_id', p_expected_updated_at => :'u0'::timestamptz, p_display_name => 'T1 Name');
select pg_sleep(3);
commit;
SQL
t1_pid=$!

sleep 0.5
start_ns="$(date +%s%N)"
set +e
docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v customer_id="${customer_id}" -v u0="${u0}" >"${t2_output}" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public.update_customer(:'customer_id', p_expected_updated_at => :'u0'::timestamptz, p_display_name => 'T2 Name');
commit;
SQL
t2_status=$?
set -e
end_ns="$(date +%s%N)"

set +e; wait "${t1_pid}"; t1_status=$?; set -e
elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))

if [[ ${t1_status} -ne 0 ]]; then
  echo "first concurrent customer edit unexpectedly failed" >&2; sed -n '1,120p' "${t1_output}" >&2; exit 1
fi
if [[ ${t2_status} -eq 0 ]]; then
  echo "second concurrent customer edit unexpectedly succeeded (lost update!)" >&2; sed -n '1,120p' "${t2_output}" >&2; exit 1
fi
if ! grep -q 'modified concurrently' "${t2_output}"; then
  echo "second customer edit failed for the wrong reason" >&2; sed -n '1,120p' "${t2_output}" >&2; exit 1
fi
if [[ ${elapsed_ms} -lt 2000 ]]; then
  echo "second customer edit did not wait on the row lock (${elapsed_ms}ms)" >&2; exit 1
fi

final="$(docker exec -i "${db_container}" psql -U postgres -d postgres -At -v customer_id="${customer_id}" <<'SQL'
select display_name from public.customers where id = :'customer_id';
SQL
)"
if [[ "${final}" != "T1 Name" ]]; then
  echo "expected final display_name = 'T1 Name' (only T1 applied), got '${final}'" >&2; exit 1
fi

# Exactly one 'customer.updated' audit row for this customer (no audit on conflict).
audit_count="$(docker exec -i "${db_container}" psql -U postgres -d postgres -At -v customer_id="${customer_id}" <<'SQL'
select count(*) from public.audit_log where action='customer.updated' and subject_id = :'customer_id';
SQL
)"
if [[ "${audit_count}" != "1" ]]; then
  echo "expected exactly 1 customer.updated audit row, got ${audit_count}" >&2; exit 1
fi

echo "customer-update concurrency PASS: second edit waited ${elapsed_ms}ms and was rejected (40001); final='${final}', audit rows=${audit_count} (no lost update)"
