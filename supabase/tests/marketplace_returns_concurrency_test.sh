#!/usr/bin/env bash
set -euo pipefail

# Real multi-session proof for Marketplace returns (PR 15). One pgTAP transaction cannot show two simultaneous
# sessions being serialised, so this script races real psql sessions against the LOCAL isolated stack:
#
#   RACE 1  one active return per order   the same buyer creates two returns for one delivered order at once
#                                          (different idempotency keys) -> exactly ONE request, the other mp:return_exists;
#                                          quantity_returned is counted once.
#   RACE 2  idempotent create             the same buyer sends the SAME key twice at once -> ONE request, both answer with it.
#   RACE 3  receive puts stock back once  the showroom presses "received" twice at once for a sellable unit
#                                          -> exactly ONE replenish movement; on hand grows by the units, once.
#
# It commits real rows (fixtures with a unique run id) and removes every row it created in the EXIT trap. Run it ONLY
# against a local isolated database:
#   DB_CONTAINER=<container> bash supabase/tests/marketplace_returns_concurrency_test.sh

source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require   # explicit DB_CONTAINER only; refuses shared / ambiguous / remote targets (no auto-selection)
db_target_mark_dirty "$(basename "$0")"   # commits rows and toggles guards: pgTAP needs a reset afterwards
db_name="${DB_NAME:-postgres}"
psql_() { docker exec -i "${db_container}" psql -U postgres -d "${db_name}" -qAt -v ON_ERROR_STOP=1 "$@"; }
q() { docker exec -i "${db_container}" psql -U postgres -d "${db_name}" -qAt -v ON_ERROR_STOP=1 -c "$1" </dev/null; }

run="$(date +%s)"
org='9c000000-cccc-4ccc-8ccc-000000000001'          # showroom A (seed-pilot)
buyer='70000009-0000-4000-8000-000000000009'       # seed-pilot buyer, no membership in showroom A
seller='70000001-0000-4000-8000-000000000001'      # owner of showroom A (order.manage)
product="cc${run:0:6}-0000-4000-8000-000000000003"
variant="dd${run:0:6}-0000-4000-8000-000000000003"
location="ee${run:0:6}-0000-4000-8000-000000000003"
order="ab${run:0:6}-0000-4000-8000-000000000003"
item="ac${run:0:6}-0000-4000-8000-000000000003"
slug="ret-race-${run}"
sku="RETRACE-${run}"
had_account="$(q "select count(*) from public.marketplace_seller_accounts where organization_id='${org}'")"

cleanup() {
  psql_ >/dev/null 2>&1 <<SQL || true
begin;
set local session_replication_role = replica;
create temp table _r as select id from public.marketplace_return_requests where order_id = '${order}';
delete from public.notifications where subject_id in (select id from _r) or subject_id = '${order}';
delete from public.marketplace_timers where subject_id in (select id from _r);
delete from public.marketplace_return_events where return_id in (select id from _r);
delete from public.marketplace_return_items where return_id in (select id from _r);
delete from public.marketplace_return_requests where order_id = '${order}';
delete from public.marketplace_order_events where order_id = '${order}';
delete from public.marketplace_order_items where order_id = '${order}';
delete from public.marketplace_orders where id = '${order}';
delete from public.marketplace_stock_movements where variant_id = '${variant}';
delete from public.marketplace_inventory_levels where variant_id = '${variant}';
delete from public.marketplace_stock_locations where id = '${location}';
delete from public.marketplace_product_variants where id = '${variant}';
delete from public.marketplace_products where id = '${product}';
commit;
SQL
  if [[ "${had_account}" == "0" ]]; then q "delete from public.marketplace_seller_accounts where organization_id='${org}' and status_reason='concurrency-test'" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

psql_ <<SQL
set session_replication_role = replica;
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en, status, published_at)
select '${product}', '${org}', id, '${slug}', 'سباق المرتجع', 'return race', 'published', now() from public.marketplace_product_types where key = 'wallpaper';
insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values ('${variant}', '${product}', '${org}', '${sku}', 'roll', 100);
insert into public.marketplace_stock_locations (id, organization_id, key, name_ar, name_en, supports_pickup)
values ('${location}', '${org}', 'retrace_${run}', 'سباق', 'race', true);
select set_config('app.marketplace_seller_write', 'on', false);
insert into public.marketplace_seller_accounts (organization_id, status, status_reason, approved_at)
values ('${org}', 'approved', 'concurrency-test', now()) on conflict do nothing;
insert into public.marketplace_orders (id, checkout_id, idempotency_key, buyer_user_id, seller_organization_id, status, payment_method,
  payment_status, fulfilment, buyer_name, buyer_phone, subtotal_egp, delivery_fee_egp, total_egp, source, stock_state, delivered_at,
  paid_now_egp, balance_due_egp)
values ('${order}', gen_random_uuid(), 'retrace-${run}-order', '${buyer}', '${org}', 'delivered', 'cod', 'collected', 'pickup',
  'Race Buyer', '+201999000099', 300, 0, 300, 'v2', 'deducted', now() - interval '1 day', 0, 300);
insert into public.marketplace_order_items (id, order_id, product_id, variant_id, location_id, sku, name_ar, name_en, selling_unit,
  unit_price_egp, quantity)
values ('${item}', '${order}', '${product}', '${variant}', '${location}', '${sku}', 'سباق', 'race', 'roll', 100, 3);
SQL
# 10 units on hand so a returned unit can be put back
q "select applied from public.marketplace_stock_apply('${org}', '${variant}', '${location}', 'initial', 10, 'retrace-${run}-initial', 'concurrency test', 'system')" >/dev/null

fail=0
check() { if [[ "$2" == "$3" ]]; then echo "PASS  $1 (= $3)"; else echo "FAIL  $1: expected $2, got $3"; fail=1; fi; }
as_user() { echo "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false);"; }
reason="$(q "select id from public.marketplace_seller_message_presets where action = 'return_reason' and label_en = 'I changed my mind'")"
lines="[{\"item_id\":\"${item}\",\"quantity\":1}]"
create_sql() { # key
  as_user "${buyer}"
  echo "select 'ok:' || (r ->> 'id') from (select public.marketplace_buyer_return_create('${order}', 'return', '${lines}'::jsonb, '${reason}', null, '{}', null, '$1') r) x;"
}

echo "== RACE 1: two different requests for one order, at once =="
o1="$(mktemp)"; o2="$(mktemp)"
( { echo "begin;"; create_sql "retrace-${run}-k1"; echo "select pg_sleep(2); commit;"; } | psql_ >"${o1}" 2>&1 ) &
sleep 0.5
( { echo "begin;"; create_sql "retrace-${run}-k2"; echo "commit;"; } | psql_ >"${o2}" 2>&1 ) &
wait
wins=0; refused=0
for f in "${o1}" "${o2}"; do
  if grep -q '^ok:' "$f"; then wins=$((wins+1)); elif grep -q 'mp:return_exists' "$f"; then refused=$((refused+1)); fi
done
check "exactly one request was created" 1 "${wins}"
check "the other was refused (mp:return_exists)" 1 "${refused}"
check "one active request on the order" 1 "$(q "select count(*) from public.marketplace_return_requests where order_id='${order}' and status = 'requested'")"
check "quantity_returned counted once" 1 "$(q "select quantity_returned from public.marketplace_order_items where id='${item}'")"
rm -f "${o1}" "${o2}"
ret="$(q "select id from public.marketplace_return_requests where order_id='${order}'")"

echo "== RACE 2: the same key twice, at once =="
q "update public.marketplace_return_requests set status = 'cancelled' where id='${ret}'" >/dev/null
a1="$(mktemp)"; a2="$(mktemp)"
( { echo "begin;"; create_sql "retrace-${run}-same"; echo "select pg_sleep(2); commit;"; } | psql_ >"${a1}" 2>&1 ) &
sleep 0.5
( { echo "begin;"; create_sql "retrace-${run}-same"; echo "commit;"; } | psql_ >"${a2}" 2>&1 ) &
wait
ids="$(cat "${a1}" "${a2}" | grep '^ok:' | sort -u | wc -l | tr -d ' ')"
check "both calls answer with the same request" 1 "${ids}"
check "one request for that key" 1 "$(q "select count(*) from public.marketplace_return_requests where order_id='${order}' and idempotency_key='retrace-${run}-same'")"
rm -f "${a1}" "${a2}"
ret="$(q "select id from public.marketplace_return_requests where order_id='${order}' and idempotency_key='retrace-${run}-same'")"

echo "== RACE 3: receive twice at once puts the unit back once =="
q "update public.marketplace_return_requests set status = 'approved', decided_by_role = 'seller' where id='${ret}'" >/dev/null
before="$(q "select on_hand from public.marketplace_inventory_levels where variant_id='${variant}'")"
sellable="[{\"item_id\":\"${item}\",\"sellable\":true}]"
receive_sql() { as_user "${seller}"; echo "select 'ok:' || (r ->> 'status') from (select public.marketplace_seller_return_receive('${ret}', '${sellable}'::jsonb) r) x;"; }
r1="$(mktemp)"; r2="$(mktemp)"
( { echo "begin;"; receive_sql; echo "select pg_sleep(2); commit;"; } | psql_ >"${r1}" 2>&1 ) &
sleep 0.5
( { echo "begin;"; receive_sql; echo "commit;"; } | psql_ >"${r2}" 2>&1 ) &
wait
check "both calls answer received" 2 "$(cat "${r1}" "${r2}" | grep -c '^ok:received$')"
check "exactly one replenish movement" 1 "$(q "select count(*) from public.marketplace_stock_movements where reference_id='${ret}' and movement_type='replenish'")"
check "on hand grew by one unit, once" "$((before + 1))" "$(q "select on_hand from public.marketplace_inventory_levels where variant_id='${variant}'")"
check "one refund timer" 1 "$(q "select count(*) from public.marketplace_timers where subject_id='${ret}' and kind='return_refund_due' and state='active'")"
rm -f "${r1}" "${r2}"

if [[ "${fail}" -ne 0 ]]; then echo "RESULT: FAIL"; exit 1; fi
echo "RESULT: PASS"
