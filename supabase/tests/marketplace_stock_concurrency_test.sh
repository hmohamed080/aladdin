#!/usr/bin/env bash
set -euo pipefail

# Real multi-session proof for Marketplace inventory (Migration 03). A single pgTAP
# transaction cannot show that two simultaneous sessions are serialised, so this script
# races real psql sessions against the local isolated stack:
#
#   RACE 1  oversell     two sessions each reserve 60 of 100 available -> exactly ONE wins,
#                        the other is refused (23514); reserved ends at 60, never 120.
#   RACE 2  idempotency  two sessions replay the SAME key at once -> stock moves ONCE
#                        (+10), both calls succeed, one with applied = false.
#   RACE 3  stampede     ten sessions each reserve 15 of 100 -> exactly six win (90),
#                        reserved never exceeds on-hand, ledger agrees with the level.
#
# It commits real rows (fixtures with a unique run id) and removes them afterwards: the
# only way to delete append-only ledger rows is the owner disabling the guard trigger for
# the duration of the cleanup, which is what the EXIT trap does. Run it ONLY against the
# local isolated database.

db_container="$(docker ps --filter 'name=supabase_db_aladdin' --format '{{.Names}}' | head -n 1)"
if [[ -z "${db_container}" ]]; then
  echo "Supabase database container not found" >&2
  exit 1
fi
psql_() { docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 "$@"; }
q() { docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1" </dev/null; }

run="$(date +%s)"
org='9c000000-cccc-4ccc-8ccc-000000000001'      # Cairo Ceramics Showroom (seed-pilot)
product="cc${run:0:6}-0000-4000-8000-000000000001"
variant="dd${run:0:6}-0000-4000-8000-000000000001"
location="ee${run:0:6}-0000-4000-8000-000000000001"

cleanup() {
  psql_ >/dev/null 2>&1 <<SQL || true
begin;
alter table public.marketplace_stock_movements disable trigger marketplace_stock_movement_append_only;
delete from public.marketplace_stock_movements where variant_id = '${variant}';
alter table public.marketplace_stock_movements enable trigger marketplace_stock_movement_append_only;
select set_config('app.marketplace_stock_write', 'on', true);
delete from public.marketplace_inventory_levels where variant_id = '${variant}';
delete from public.marketplace_stock_locations where id = '${location}';
delete from public.marketplace_products where id = '${product}';
delete from public.marketplace_seller_accounts where organization_id = '${org}' and status_reason = 'concurrency-test';
commit;
SQL
}
trap cleanup EXIT

psql_ <<SQL
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en)
select '${product}', '${org}', id, 'stock-race-${run}', 'سباق', 'race' from public.marketplace_product_types where key = 'wallpaper';
insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values ('${variant}', '${product}', '${org}', 'RACE-${run}', 'roll', 10);
insert into public.marketplace_stock_locations (id, organization_id, key, name_ar, name_en)
values ('${location}', '${org}', 'race_${run}', 'سباق', 'race');
-- Migration 04: reserve needs an enabled seller. Fixture row, removed by the trap.
select set_config('app.marketplace_seller_write', 'on', false);
insert into public.marketplace_seller_accounts (organization_id, status, status_reason, approved_at)
values ('${org}', 'approved', 'concurrency-test', now()) on conflict do nothing;
SQL

apply_sql() { # type qty key
  echo "select applied from public.marketplace_stock_apply('${org}', '${variant}', '${location}', '$1', $2, '$3', 'concurrency test', 'system');"
}

fail=0
check() { # label expected actual
  if [[ "$2" == "$3" ]]; then echo "PASS  $1 (= $3)"; else echo "FAIL  $1: expected $2, got $3"; fail=1; fi
}

echo "== opening balance =="
apply_sql initial 100 "race-${run}-initial" | psql_ >/dev/null

echo "== RACE 1: oversell (2 x reserve 60 of 100) =="
out1="$(mktemp)"; out2="$(mktemp)"
( { echo "begin;"; apply_sql reserve 60 "race-${run}-r1a"; echo "select pg_sleep(2); commit;"; } | psql_ >"${out1}" 2>&1 ) &
sleep 0.4
( { echo "begin;"; apply_sql reserve 60 "race-${run}-r1b"; echo "commit;"; } | psql_ >"${out2}" 2>&1 ) &
wait
wins=0; refused=0
for f in "${out1}" "${out2}"; do
  if grep -q '^t$' "$f"; then wins=$((wins+1)); elif grep -q 'insufficient stock' "$f"; then refused=$((refused+1)); fi
done
check "exactly one reservation won" 1 "${wins}"
check "the other was refused as insufficient stock" 1 "${refused}"
check "reserved on the level" 60 "$(q "select reserved from public.marketplace_inventory_levels where variant_id='${variant}'")"
rm -f "${out1}" "${out2}"

echo "== release so the next races start from 100 available =="
apply_sql release 60 "race-${run}-release-1" | psql_ >/dev/null

echo "== RACE 2: same idempotency key at once =="
o1="$(mktemp)"; o2="$(mktemp)"
( { echo "begin;"; apply_sql replenish 10 "race-${run}-same-key"; echo "select pg_sleep(2); commit;"; } | psql_ >"${o1}" 2>&1 ) &
sleep 0.4
( { echo "begin;"; apply_sql replenish 10 "race-${run}-same-key"; echo "commit;"; } | psql_ >"${o2}" 2>&1 ) &
wait
applied_true=0; applied_false=0
for f in "${o1}" "${o2}"; do
  grep -q '^t$' "$f" && applied_true=$((applied_true+1)) || true
  grep -q '^f$' "$f" && applied_false=$((applied_false+1)) || true
done
check "exactly one call applied" 1 "${applied_true}"
check "the other replayed (applied = false)" 1 "${applied_false}"
check "on-hand moved once (110)" 110 "$(q "select on_hand from public.marketplace_inventory_levels where variant_id='${variant}'")"
check "one ledger row for the key" 1 "$(q "select count(*) from public.marketplace_stock_movements where idempotency_key='race-${run}-same-key'")"
rm -f "${o1}" "${o2}"

echo "== RACE 3: stampede (10 x reserve 15 of 110) =="
tmpdir="$(mktemp -d)"
for i in $(seq 1 10); do
  ( apply_sql reserve 15 "race-${run}-stampede-${i}" | psql_ >"${tmpdir}/${i}.out" 2>&1 ) &
done
wait
won=$(grep -l '^t$' "${tmpdir}"/*.out 2>/dev/null | wc -l | tr -d ' ')
check "winners (floor(110/15) = 7)" 7 "${won}"
check "reserved never exceeds on-hand (105 <= 110)" 105 "$(q "select reserved from public.marketplace_inventory_levels where variant_id='${variant}'")"
check "available is not negative" t "$(q "select available >= 0 from public.marketplace_inventory_levels where variant_id='${variant}'")"
check "ledger equals level (on-hand)" t "$(q "select l.on_hand = coalesce(sum(m.delta_on_hand),0) from public.marketplace_inventory_levels l join public.marketplace_stock_movements m on m.variant_id=l.variant_id and m.location_id=l.location_id where l.variant_id='${variant}' group by l.on_hand")"
check "ledger equals level (reserved)" t "$(q "select l.reserved = coalesce(sum(m.delta_reserved),0) from public.marketplace_inventory_levels l join public.marketplace_stock_movements m on m.variant_id=l.variant_id and m.location_id=l.location_id where l.variant_id='${variant}' group by l.reserved")"
rm -rf "${tmpdir}"

if [[ "${fail}" -ne 0 ]]; then echo "RESULT: FAIL"; exit 1; fi
echo "RESULT: PASS"
