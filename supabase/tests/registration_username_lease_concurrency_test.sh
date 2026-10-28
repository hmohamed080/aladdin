#!/usr/bin/env bash
set -euo pipefail

# Real two-session proof that a pending-registration username lease is concurrency-safe
# (20261028090003_registration_username_lease.sql).
#   A. two unconfirmed registrations stage the SAME name at the same time: the second
#      save WAITS on the per-name lock, then is refused -> exactly one lease exists.
#   B. a verified account claims a name while a registration's save of that name is in
#      flight (uncommitted): the claim WAITS, then is refused with 23505.
#   C. a verified account's claim is in flight when a registration stages the same name:
#      the save WAITS, then gets no lease -> the claim wins, no duplicate holder.

source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require   # explicit DB_CONTAINER only; refuses shared / ambiguous / remote targets (no auto-selection)
psql_run() { docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

run="$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
p1="7a10${run:0:4}-0000-4000-8000-0000${run}"
p2="7a11${run:0:4}-0000-4000-8000-0000${run}"
p3="7a12${run:0:4}-0000-4000-8000-0000${run}"
v1="7a13${run:0:4}-0000-4000-8000-0000${run}"
v2="7a14${run:0:4}-0000-4000-8000-0000${run}"
nameA="raceA${run}"
nameB="raceB${run}"
nameC="raceC${run}"

psql_run >/dev/null <<SQL
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, confirmed, now(), now()
from (values
  ('${p1}', 'lease-race-p1-${run}@example.test', null::timestamptz),
  ('${p2}', 'lease-race-p2-${run}@example.test', null::timestamptz),
  ('${p3}', 'lease-race-p3-${run}@example.test', null::timestamptz),
  ('${v1}', 'lease-race-v1-${run}@example.test', now()),
  ('${v2}', 'lease-race-v2-${run}@example.test', now())) v(id, email, confirmed);
SQL

cleanup() {
  rm -f "${tA:-}" "${tB:-}" "${tC:-}"
  psql_run >/dev/null -c "delete from auth.users where id in ('${p1}','${p2}','${p3}','${v1}','${v2}');" || true
}
tA="$(mktemp)"; tB="$(mktemp)"; tC="$(mktemp)"
trap cleanup EXIT

save_sql() { # user name sleep
  cat <<SQL
begin;
set local role service_role;
select 'LEASE:' || public.pending_registration_save('$1', '$2', 'persona_type', 'engineer');
select pg_sleep($3);
commit;
SQL
}
claim_sql() { # user name sleep
  cat <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
select 'CLAIMED:' || coalesce(public.profile_set_username('$2')::text, 'ok');
select pg_sleep($3);
commit;
SQL
}
holders() { psql_run -c "select count(*) from app.pending_registrations where lower(username) = lower('$1') and username_reserved_at > now() - interval '30 minutes';" | tr -d '[:space:]'; }

# ---- A: two registrations, same name, same moment ---------------------------------------
save_sql "${p1}" "${nameA}" 3 | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tA}" 2>&1 &
pa=$!
sleep 1
start=$(date +%s)
save_sql "${p2}" "${nameA}" 0 | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tB}" 2>&1
elapsed=$(( $(date +%s) - start ))
wait "${pa}"
a1="$(grep -o 'LEASE:[a-z]*' "${tA}" | cut -d: -f2)"
a2="$(grep -o 'LEASE:[a-z]*' "${tB}" | cut -d: -f2)"
echo "A: first=${a1} second=${a2} second waited ${elapsed}s holders=$(holders "${nameA}")"
if [[ "${a1}" != "true" || "${a2}" != "false" || "${elapsed}" -lt 1 || "$(holders "${nameA}")" != "1" ]]; then
  echo "FAIL (A): concurrent saves did not serialize to exactly one lease" >&2; cat "${tA}" "${tB}" >&2; exit 1
fi

# ---- B: a claim races an in-flight save of the same name ---------------------------------
save_sql "${p3}" "${nameB}" 3 | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tA}" 2>&1 &
pb=$!
sleep 1
start=$(date +%s)
claim_sql "${v1}" "${nameB}" 0 | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tC}" 2>&1 || true
elapsed=$(( $(date +%s) - start ))
wait "${pb}"
b_lease="$(grep -o 'LEASE:[a-z]*' "${tA}" | cut -d: -f2)"
b_claim="$(grep -c 'CLAIMED:' "${tC}" || true)"
b_err="$(grep -c 'username is unavailable' "${tC}" || true)"
echo "B: lease=${b_lease} claim ran=${b_claim} refused=${b_err} claim waited ${elapsed}s"
if [[ "${b_lease}" != "true" || "${b_claim}" != "0" || "${b_err}" != "1" || "${elapsed}" -lt 1 ]]; then
  echo "FAIL (B): a verified claim took a name a registration was leasing" >&2; cat "${tA}" "${tC}" >&2; exit 1
fi

# ---- C: a save races an in-flight claim of the same name ---------------------------------
claim_sql "${v2}" "${nameC}" 3 | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tC}" 2>&1 &
pc=$!
sleep 1
start=$(date +%s)
save_sql "${p1}" "${nameC}" 0 | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tB}" 2>&1
elapsed=$(( $(date +%s) - start ))
wait "${pc}"
c_claim="$(grep -c 'CLAIMED:' "${tC}" || true)"
c_lease="$(grep -o 'LEASE:[a-z]*' "${tB}" | cut -d: -f2)"
echo "C: claim ran=${c_claim} lease=${c_lease} save waited ${elapsed}s"
if [[ "${c_claim}" != "1" || "${c_lease}" != "false" || "${elapsed}" -lt 1 || "$(holders "${nameC}")" != "0" ]]; then
  echo "FAIL (C): a registration leased a name a verified claim was taking" >&2; cat "${tB}" "${tC}" >&2; exit 1
fi

echo "PASS: username leases and claims serialize per name - never two holders"
