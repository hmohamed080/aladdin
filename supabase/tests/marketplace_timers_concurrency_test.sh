#!/usr/bin/env bash
set -euo pipefail

# Real multi-session proof for the Marketplace timer runner (PR 14). One pgTAP transaction cannot show that overlapping runs
# never process the same timer, so this races real psql sessions against the local isolated stack:
#
#   RACE 1  overlap       session A runs the runner and holds its transaction open; session B runs the runner meanwhile.
#                         SKIP LOCKED: B finds nothing; the 72 h cancellation happens ONCE, stock is released ONCE.
#   RACE 2  seller wins   a seller session holds the order row (start_preparing, uncommitted); the runner at the 72 h
#                         deadline does NOT wait (SKIP LOCKED on the order) and does not cancel; after the seller commits,
#                         the next run only closes the timer. The order stays 'preparing' with its stock still held.
#
# It commits real rows (unique run id) and removes them afterwards; the append-only guards are disabled by the EXIT trap only
# for the cleanup, as the other concurrency scripts do. Run it ONLY against the local isolated database.
# DB_CONTAINER overrides the container name (default: the first supabase_db_aladdin* container).

db_container="${DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_aladdin' --format '{{.Names}}' | head -n 1)}"
if [[ -z "${db_container}" ]]; then echo "Supabase database container not found" >&2; exit 1; fi
psql_() { docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 "$@"; }

run="$(date +%s)"
org='9c000000-cccc-4ccc-8ccc-000000000001'
buyer='70000009-0000-4000-8000-000000000009'
seller='70000001-0000-4000-8000-000000000001'
product="cc${run:0:6}-0000-4000-8000-0000000000a1"
variant="dd${run:0:6}-0000-4000-8000-0000000000a1"
location="ee${run:0:6}-0000-4000-8000-0000000000a1"
order1="f1${run:0:6}-0000-4000-8000-0000000000a1"
order2="f2${run:0:6}-0000-4000-8000-0000000000a2"

cleanup() {
  psql_ >/dev/null 2>&1 <<SQL || true
begin;
alter table public.marketplace_stock_movements disable trigger marketplace_stock_movement_append_only;
alter table public.marketplace_order_events disable trigger marketplace_order_events_append_only;
delete from public.marketplace_stock_movements where variant_id = '${variant}';
delete from public.notifications where subject_id in ('${order1}', '${order2}');
delete from public.marketplace_timers where subject_id in ('${order1}', '${order2}');
delete from public.marketplace_order_cancellations where order_id in ('${order1}', '${order2}');
delete from public.marketplace_order_events where order_id in ('${order1}', '${order2}');
delete from public.marketplace_order_items where order_id in ('${order1}', '${order2}');
delete from public.marketplace_orders where id in ('${order1}', '${order2}');
alter table public.marketplace_order_events enable trigger marketplace_order_events_append_only;
alter table public.marketplace_stock_movements enable trigger marketplace_stock_movement_append_only;
select set_config('app.marketplace_stock_write', 'on', true);
delete from public.marketplace_inventory_levels where variant_id = '${variant}';
delete from public.marketplace_stock_locations where id = '${location}';
delete from public.marketplace_product_variants where id = '${variant}';
delete from public.marketplace_products where id = '${product}';
delete from public.marketplace_seller_accounts where organization_id = '${org}' and status_reason = 'concurrency-test';
commit;
SQL
}
trap cleanup EXIT

psql_ <<SQL
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en)
select '${product}', '${org}', id, 'timer-race-${run}', 'سباق', 'race' from public.marketplace_product_types where key = 'wallpaper';
insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values ('${variant}', '${product}', '${org}', 'TRACE-${run}', 'roll', 10);
insert into public.marketplace_stock_locations (id, organization_id, key, name_ar, name_en)
values ('${location}', '${org}', 'trace_${run}', 'سباق', 'race');
select set_config('app.marketplace_seller_write', 'on', false);
insert into public.marketplace_seller_accounts (organization_id, status, status_reason, approved_at)
values ('${org}', 'approved', 'concurrency-test', now()) on conflict do nothing;
select applied from public.marketplace_stock_apply('${org}', '${variant}', '${location}', 'initial', 100, 'trace-${run}-initial', 'concurrency test', 'system');
SQL

mk_order() { # id
  cat <<SQL
insert into public.marketplace_orders (id, checkout_id, idempotency_key, buyer_user_id, seller_organization_id, status, payment_method,
  payment_status, fulfilment, buyer_name, buyer_phone, subtotal_egp, delivery_fee_egp, total_egp, source, stock_state, paid_now_egp,
  balance_due_egp, placed_at)
values ('$1', gen_random_uuid(), 'trace-$1', '${buyer}', '${org}', 'new', 'cod', 'pending', 'pickup', 'Race Buyer', '+201999000009',
  20, 0, 20, 'v2', 'pending', 0, 20, now() - interval '80 hours');
insert into public.marketplace_order_items (order_id, product_id, variant_id, location_id, sku, name_ar, name_en, selling_unit, unit_price_egp, quantity, product_slug)
values ('$1', '${product}', '${variant}', '${location}', 'TRACE-${run}', 'ورق', 'Paper', 'roll', 10, 2, 'timer-race');
select app.marketplace_order_stock('$1', 'reserve');
select app.marketplace_timer_open('order', '$1', 'order_seller_start', now() - interval '80 hours');
SQL
}

fail=0
check() { if [[ "$2" == "$3" ]]; then echo "PASS  $1 (= $3)"; else echo "FAIL  $1: expected $2, got $3"; fail=1; fi; }
reserved() { psql_ -c "select reserved from public.marketplace_inventory_levels where variant_id = '${variant}'"; }
processed() { echo "$1" | sed -E 's/.*"processed": ?([0-9]+).*/\1/'; }

echo "== RACE 1: two overlapping runners, one expired order =="
mk_order "${order1}" | psql_ >/dev/null
check "reserved before" "2" "$(reserved)"
out1="$(mktemp)"; out2="$(mktemp)"
( { echo "begin;"; echo "select public.marketplace_timers_run(200, now());"; echo "select pg_sleep(3); commit;"; } | psql_ >"${out1}" 2>&1 ) &
sleep 1
( echo "select public.marketplace_timers_run(200, now());" | psql_ >"${out2}" 2>&1 ) &
wait
check "runner A processed the timer" "1" "$(processed "$(head -n 1 "${out1}")")"
check "runner B (overlapping) found nothing" "0" "$(processed "$(head -n 1 "${out2}")")"
check "order cancelled once" "cancelled" "$(psql_ -c "select status from public.marketplace_orders where id = '${order1}'")"
check "stock released once" "0" "$(reserved)"
check "one release movement" "1" "$(psql_ -c "select count(*) from public.marketplace_stock_movements where variant_id = '${variant}' and movement_type = 'release'")"
check "one cancellation event" "1" "$(psql_ -c "select count(*) from public.marketplace_order_events where order_id = '${order1}' and action = 'cancelled_timeout_seller'")"

echo "== RACE 2: the seller holds the order, the runner must not wait or cancel =="
mk_order "${order2}" | psql_ >/dev/null
check "reserved before" "2" "$(reserved)"
out3="$(mktemp)"
( { echo "begin;"; echo "select app.marketplace_order_apply('${order2}', 'start_preparing', 'seller', '${seller}', '{}'::jsonb) is not null;"; echo "select pg_sleep(4); commit;"; } | psql_ >"${out3}" 2>&1 ) &
sleep 1.5
start="$(date +%s)"
r="$(echo "select public.marketplace_timers_run(200, now());" | psql_)"
elapsed=$(( $(date +%s) - start ))
check "runner did not process the locked order" "0" "$(processed "${r}")"
if (( elapsed < 3 )); then echo "PASS  runner returned without waiting (${elapsed}s)"; else echo "FAIL  runner waited ${elapsed}s for the order lock"; fail=1; fi
wait
check "order is preparing (seller won)" "preparing" "$(psql_ -c "select status from public.marketplace_orders where id = '${order2}'")"
r="$(echo "select public.marketplace_timers_run(200, now());" | psql_)"
check "next run only closes the (already closed) timer" "0" "$(processed "${r}")"
check "timer closed by the machine" "done" "$(psql_ -c "select state from public.marketplace_timers where subject_id = '${order2}'")"
check "stock still held for the started order" "2" "$(reserved)"

if (( fail )); then echo "FAILED"; exit 1; fi
echo "All timer concurrency checks passed"
