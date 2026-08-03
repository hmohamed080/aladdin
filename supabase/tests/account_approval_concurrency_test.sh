#!/usr/bin/env bash
set -euo pipefail

# Two sessions submit conflicting listing flags through the same assigned
# reviewer. The verification-row lock must serialize the calls; the second call
# becomes an idempotent no-op and cannot overwrite the committed approval flag.

db_container="$(docker ps --filter 'name=supabase_db_aladdin' --format '{{.Names}}' | head -n 1)"
if [[ -z "${db_container}" ]]; then
  echo "Supabase database container not found" >&2
  exit 1
fi

verification_id="$(docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<'SQL'
delete from public.verifications
where user_id = '44444444-4444-4444-8444-444444444444'
  and verification_type = 'professional';
insert into public.verifications (
  subject_type, user_id, verification_type, requested_account_type, status
)
values (
  'user', '44444444-4444-4444-8444-444444444444',
  'professional', 'engineer', 'submitted'
)
returning id;
SQL
)"

docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v verification_id="${verification_id}" <<'SQL'
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',
  true
);
select public.review_start(:'verification_id');
commit;
SQL

t1_output="$(mktemp)"
t2_output="$(mktemp)"
trap 'rm -f "${t1_output}" "${t2_output}"' EXIT

docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v verification_id="${verification_id}" >"${t1_output}" 2>&1 <<'SQL' &
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',
  true
);
select public.review_approve(:'verification_id', true);
select pg_sleep(3);
commit;
SQL
t1_pid=$!

sleep 0.5
start_ns="$(date +%s%N)"
docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v verification_id="${verification_id}" >"${t2_output}" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',
  true
);
select public.review_approve(:'verification_id', false);
commit;
SQL
end_ns="$(date +%s%N)"

set +e
wait "${t1_pid}"
t1_status=$?
set -e
if [[ ${t1_status} -ne 0 ]]; then
  echo "first concurrent approval unexpectedly failed" >&2
  sed -n '1,120p' "${t1_output}" >&2
  exit 1
fi

elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
if [[ ${elapsed_ms} -lt 2000 ]]; then
  echo "second approval did not wait on the verification row lock (${elapsed_ms}ms)" >&2
  exit 1
fi

result="$(docker exec -i "${db_container}" psql -U postgres -d postgres -At -F '|' \
  -v verification_id="${verification_id}" <<'SQL'
select v.status, v.grants_public_listing, v.reviewer_id,
       (select count(*) from public.audit_log a
        where a.action='verification.approved' and a.subject_id=v.id)
from public.verifications v where v.id=:'verification_id';
SQL
)"

expected="approved|t|55555555-5555-4555-8555-555555555555|1"
if [[ "${result}" != "${expected}" ]]; then
  echo "concurrent approval produced unexpected state: ${result}" >&2
  exit 1
fi

echo "account-approval concurrency PASS: second transaction waited ${elapsed_ms}ms; one immutable approval persisted"
