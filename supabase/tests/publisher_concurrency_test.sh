#!/usr/bin/env bash
set -euo pipefail

# Real two-session proof that a revocation cannot be bypassed by a concurrent write.
#   A. an independent publisher is inside a publish (holding authority) while an administrator revokes:
#      the revocation WAITS for the writer, then withdraws the content -> the item ends up NOT published.
#   B. a revocation is already in flight (uncommitted) when the publisher tries to publish:
#      the publish WAITS, then sees the revoked status and is refused -> the item stays unpublished.

source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require   # explicit DB_CONTAINER only; refuses shared / ambiguous / remote targets (no auto-selection)
db_target_mark_dirty "$(basename "$0")"   # this script changes shared/seed rows: pgTAP must not run on this database afterwards
psql_run() { docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

run="$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
uid="79c0${run:0:4}-0000-4000-8000-0000${run}"
vid="79c1${run:0:4}-0000-4000-8000-0000${run}"
pid="79c2${run:0:4}-0000-4000-8000-0000${run}"
admin="55555555-5555-4555-8555-555555555555"

psql_run >/dev/null <<SQL
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
values ('${uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'pub-concurrency-${run}@example.test', '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"PC","locale":"en"}'::jsonb, now(), now(), now());
update public.users set primary_account_type = 'contractor', status = 'active' where id = '${uid}';
insert into public.verifications (id, subject_type, user_id, verification_type, requested_account_type, status, reviewer_id, decided_at, applied_at)
values ('${vid}', 'user', '${uid}', 'independent_publisher', 'contractor', 'approved', '${admin}', now(), now());
insert into public.publishers (id, kind, user_id, display_name, status, approval_id, approved_by, approved_at)
values ('${pid}', 'independent_contractor', '${uid}', 'PC', 'active', '${vid}', '${admin}', now());
SQL

as_user() {
  cat <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
SQL
}

setup_product() {
  local out id
  out="$(psql_run <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
select 'NEWID:' || public.publisher_product_create('${pid}', 'Race Tile $1', 'RACE-$1', 'wallpaper', 'roll');
commit;
SQL
)"
  id="$(echo "${out}" | grep -o 'NEWID:[0-9a-f-]*' | cut -d: -f2)"
  psql_run >/dev/null -c "insert into public.product_audiences (product_id, audience) values ('${id}', 'showroom_dealer') on conflict do nothing;"
  echo "${id}"
}
status_of() { psql_run -c "select status from public.products where id = '$1';" | tr -d '[:space:]'; }

tA="$(mktemp)"; tB="$(mktemp)"; tC="$(mktemp)"
trap 'rm -f "${tA}" "${tB}" "${tC}"' EXIT

# ---- A: revoke while a publish is in flight --------------------------------------------------
prodA="$(setup_product A)"
{
  as_user
  echo "select 'PUBLISHED:' || public.set_product_published('${prodA}', true, (select version from public.products where id = '${prodA}'));"
  echo "select pg_sleep(3);"
  echo "commit;"
} | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tA}" 2>&1 &
pw=$!
sleep 1
start=$(date +%s)
psql_run >/dev/null <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${admin}","role":"authenticated"}', true);
select public.publisher_revoke('${pid}', 'race A');
commit;
SQL
elapsed=$(( $(date +%s) - start ))
wait "${pw}" || true
published_a="$(grep -c 'PUBLISHED:' "${tA}" || true)"
final_a="$(status_of "${prodA}")"
echo "A: publish ran=${published_a} revoke waited ${elapsed}s final status=${final_a}"
if [[ "${published_a}" != "1" || "${elapsed}" -lt 1 || "${final_a}" != "draft" ]]; then
  echo "FAIL (A): the revocation did not wait for the in-flight writer, or content stayed published" >&2
  cat "${tA}" >&2
  exit 1
fi

# re-approve the publisher for scenario B (direct, as the database owner)
psql_run >/dev/null <<SQL
update public.publishers set status = 'active', revoked_at = null, revoked_by = null, status_reason = null where id = '${pid}';
SQL
prodB="$(setup_product B)"

# ---- B: a revocation in flight makes the publish refuse ------------------------------------------
{
  cat <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${admin}","role":"authenticated"}', true);
select public.publisher_revoke('${pid}', 'race B');
select pg_sleep(3);
commit;
SQL
} | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tB}" 2>&1 &
pr=$!
sleep 1
{
  as_user
  echo "select 'PUBLISHED:' || public.set_product_published('${prodB}', true, (select version from public.products where id = '${prodB}'));"
  echo "commit;"
} | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${tC}" 2>&1 || true
wait "${pr}" || true
published_b="$(grep -c 'PUBLISHED:' "${tC}" || true)"
final_b="$(status_of "${prodB}")"
echo "B: publish ran=${published_b} final status=${final_b}"
if [[ "${published_b}" != "0" || "${final_b}" != "draft" ]]; then
  echo "FAIL (B): a publish committed on revoked authority" >&2
  cat "${tC}" >&2
  exit 1
fi
echo "PASS: publisher revocation serialises with writes - no publish survives a revocation"
