#!/usr/bin/env bash
set -euo pipefail

# Real multi-session proof for the Marketplace checkout (PR 12). One pgTAP transaction cannot show two
# simultaneous sessions being serialised, so this script races real psql sessions against the LOCAL isolated stack:
#
#   RACE 1  last unit      two different buyers confirm a checkout for the ONLY unit at once
#                          -> exactly ONE order, the other is refused (mp:insufficient_stock);
#                             reserved ends at 1, never 2; no order is left behind for the loser.
#   RACE 2  idempotency    the same buyer confirms the same session with the same key twice at once
#                          -> exactly ONE order; both calls answer with it (one replayed = true).
#
# It commits real rows (fixtures with a unique run id) and removes every row it created, plus restores the
# settings it changed, in the EXIT trap. Run it ONLY against a local isolated database:
#   DB_NAME=pr12 DB_CONTAINER=<container> bash supabase/tests/marketplace_checkout_concurrency_test.sh

source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require   # explicit DB_CONTAINER only; refuses shared / ambiguous / remote targets (no auto-selection)
db_target_mark_dirty "$(basename "$0")"   # commits rows and toggles guards: pgTAP needs a reset afterwards
db_name="${DB_NAME:-postgres}"
psql_() { docker exec -i "${db_container}" psql -U postgres -d "${db_name}" -qAt -v ON_ERROR_STOP=1 "$@"; }
q() { docker exec -i "${db_container}" psql -U postgres -d "${db_name}" -qAt -v ON_ERROR_STOP=1 -c "$1" </dev/null; }

run="$(date +%s)"
org='9c000000-cccc-4ccc-8ccc-000000000001'          # showroom A (seed-pilot)
buyer1='70000009-0000-4000-8000-000000000009'      # seed-pilot buyers, no org membership in showroom A
buyer2='70000003-0000-4000-8000-000000000003'
product="cc${run:0:6}-0000-4000-8000-000000000002"
variant="dd${run:0:6}-0000-4000-8000-000000000002"
location="ee${run:0:6}-0000-4000-8000-000000000002"
slug="chk-race-${run}"
sku="CHKRACE-${run}"

# remember what the run changes so the trap can restore it
prev_open="$(q "select marketplace_open from public.marketplace_platform_settings limit 1")"
prev_phone1="$(q "select coalesce(phone_e164,'') || '|' || coalesce(phone_country_iso2,'') || '|' || coalesce(phone_national,'') || '|' || coalesce(phone_verified_at::text,'') from public.profiles where user_id='${buyer1}'")"
prev_phone2="$(q "select coalesce(phone_e164,'') || '|' || coalesce(phone_country_iso2,'') || '|' || coalesce(phone_national,'') || '|' || coalesce(phone_verified_at::text,'') from public.profiles where user_id='${buyer2}'")"
had_account="$(q "select count(*) from public.marketplace_seller_accounts where organization_id='${org}'")"
had_pay="$(q "select count(*) from public.marketplace_seller_payment_settings where seller_organization_id='${org}'")"
had_del="$(q "select count(*) from public.marketplace_seller_delivery_settings where seller_organization_id='${org}'")"
prev_prep="$(q "select coalesce((select preparation_days::text from public.marketplace_seller_delivery_settings where seller_organization_id='${org}'), '')")"
prev_cod="$(q "select coalesce((select cod_enabled from public.marketplace_seller_payment_settings where seller_organization_id='${org}'), false)")"

restore_phone() { # user "e164|iso|national|verified"
  IFS='|' read -r e iso nat ver <<<"$2"
  q "update public.profiles set phone_e164 = nullif('${e}',''), phone_country_iso2 = nullif('${iso}',''), phone_national = nullif('${nat}',''), phone_verified_at = nullif('${ver}','')::timestamptz where user_id='$1'" >/dev/null
}

cleanup() {
  psql_ >/dev/null 2>&1 <<SQL || true
begin;
set local session_replication_role = replica;
create temp table _o as select id from public.marketplace_orders where seller_organization_id = '${org}'
  and id in (select order_id from public.marketplace_order_items where variant_id = '${variant}');
delete from public.notifications where subject_id::text in (select id::text from _o);
delete from public.marketplace_timers where subject_id in (select id from _o);
delete from public.marketplace_order_events where order_id in (select id from _o);
delete from public.marketplace_order_items where order_id in (select id from _o);
delete from public.marketplace_orders where id in (select id from _o);
delete from public.marketplace_checkout_sessions where lines::text like '%${sku}%';
delete from public.marketplace_stock_movements where variant_id = '${variant}';
delete from public.marketplace_inventory_levels where variant_id = '${variant}';
delete from public.marketplace_stock_locations where id = '${location}';
delete from public.marketplace_product_variants where id = '${variant}';
delete from public.marketplace_products where id = '${product}';
update public.marketplace_platform_settings set marketplace_open = '${prev_open}'::boolean;
commit;
SQL
  restore_phone "${buyer1}" "${prev_phone1}" || true
  restore_phone "${buyer2}" "${prev_phone2}" || true
  if [[ "${had_account}" == "0" ]]; then q "delete from public.marketplace_seller_accounts where organization_id='${org}' and status_reason='concurrency-test'" >/dev/null 2>&1 || true; fi
  if [[ "${had_del}" == "0" ]]; then q "delete from public.marketplace_seller_delivery_settings where seller_organization_id='${org}'" >/dev/null 2>&1 || true
  else q "update public.marketplace_seller_delivery_settings set preparation_days=nullif('${prev_prep}','')::smallint where seller_organization_id='${org}'" >/dev/null 2>&1 || true; fi
  if [[ "${had_pay}" == "0" ]]; then q "delete from public.marketplace_seller_payment_settings where seller_organization_id='${org}'" >/dev/null 2>&1 || true
  else q "update public.marketplace_seller_payment_settings set cod_enabled=${prev_cod} where seller_organization_id='${org}'" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

psql_ <<SQL
set session_replication_role = replica;
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en, status, published_at)
select '${product}', '${org}', id, '${slug}', 'سباق الدفع', 'checkout race', 'published', now() from public.marketplace_product_types where key = 'wallpaper';
insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values ('${variant}', '${product}', '${org}', '${sku}', 'roll', 10);
insert into public.marketplace_stock_locations (id, organization_id, key, name_ar, name_en, supports_pickup)
values ('${location}', '${org}', 'chkrace_${run}', 'سباق', 'race', true);
select set_config('app.marketplace_seller_write', 'on', false);
insert into public.marketplace_seller_accounts (organization_id, status, status_reason, approved_at)
values ('${org}', 'approved', 'concurrency-test', now()) on conflict do nothing;
insert into public.marketplace_seller_payment_settings (seller_organization_id, cod_enabled) values ('${org}', true)
  on conflict (seller_organization_id) do update set cod_enabled = true;
insert into public.marketplace_seller_delivery_settings (seller_organization_id, preparation_days) values ('${org}', 1)
  on conflict (seller_organization_id) do update set preparation_days = coalesce(public.marketplace_seller_delivery_settings.preparation_days, 1);
update public.marketplace_platform_settings set marketplace_open = true;
update public.profiles set phone_e164 = '+20199910' || right('${buyer1}', 4), phone_country_iso2 = 'EG', phone_national = '0199910' || right('${buyer1}', 4), phone_verified_at = now() where user_id = '${buyer1}';
update public.profiles set phone_e164 = '+20199920' || right('${buyer2}', 4), phone_country_iso2 = 'EG', phone_national = '0199920' || right('${buyer2}', 4), phone_verified_at = now() where user_id = '${buyer2}';
SQL
# the only unit
q "select applied from public.marketplace_stock_apply('${org}', '${variant}', '${location}', 'initial', 1, 'chkrace-${run}-initial', 'concurrency test', 'system')" >/dev/null

fail=0
check() { if [[ "$2" == "$3" ]]; then echo "PASS  $1 (= $3)"; else echo "FAIL  $1: expected $2, got $3"; fail=1; fi; }

as_user() { echo "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false);"; }
lines="[{\"slug\":\"${slug}\",\"sku\":\"${sku}\",\"qty\":1}]"
prepare() { # user -> "session|hash"
  { as_user "$1" >/dev/null; echo "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false);";
    echo "select (r ->> 'session_id') || '|' || (r ->> 'quote_hash') from (select public.marketplace_checkout_prepare('${lines}'::jsonb, 'pickup', null, 'standard', 'cod', null) r) x;"; } | psql_ | tail -n 1
}

echo "== RACE 1: the last unit, two buyers =="
p1="$(prepare "${buyer1}")"; p2="$(prepare "${buyer2}")"
s1="${p1%%|*}"; h1="${p1##*|}"; s2="${p2%%|*}"; h2="${p2##*|}"
confirm_sql() { # user session hash key
  as_user "$1"; echo "select (r ->> 'replayed') || ':' || jsonb_array_length(r -> 'orders') from (select public.marketplace_checkout_confirm('$2'::uuid, '$3', '$4', null) r) x;"
}
o1="$(mktemp)"; o2="$(mktemp)"
( { echo "begin;"; confirm_sql "${buyer1}" "${s1}" "${h1}" "chkrace-${run}-k1"; echo "select pg_sleep(2); commit;"; } | psql_ >"${o1}" 2>&1 ) &
sleep 0.5
( { echo "begin;"; confirm_sql "${buyer2}" "${s2}" "${h2}" "chkrace-${run}-k2"; echo "commit;"; } | psql_ >"${o2}" 2>&1 ) &
wait
wins=0; refused=0
for f in "${o1}" "${o2}"; do
  if grep -q '^false:1$' "$f"; then wins=$((wins+1)); elif grep -q 'mp:insufficient_stock' "$f"; then refused=$((refused+1)); fi
done
check "exactly one buyer got the unit" 1 "${wins}"
check "the other was refused (mp:insufficient_stock)" 1 "${refused}"
check "reserved on the level is 1, never 2" "1" "$(q "select reserved from public.marketplace_inventory_levels where variant_id='${variant}'")"
check "one order exists for the variant" 1 "$(q "select count(distinct order_id) from public.marketplace_order_items where variant_id='${variant}'")"
check "the order's stock is PENDING" "pending" "$(q "select o.stock_state from public.marketplace_orders o join public.marketplace_order_items i on i.order_id=o.id where i.variant_id='${variant}' limit 1")"
check "ledger equals level (reserved)" t "$(q "select l.reserved = coalesce(sum(m.delta_reserved),0) from public.marketplace_inventory_levels l join public.marketplace_stock_movements m on m.variant_id=l.variant_id and m.location_id=l.location_id where l.variant_id='${variant}' group by l.reserved")"
rm -f "${o1}" "${o2}"

echo "== RACE 2: the same buyer, the same key, at once =="
# put a second unit on the shelf for the idempotency race
q "select applied from public.marketplace_stock_apply('${org}', '${variant}', '${location}', 'replenish', 3, 'chkrace-${run}-more', 'concurrency test', 'system')" >/dev/null
p3="$(prepare "${buyer1}")"
s3="${p3%%|*}"; h3="${p3##*|}"
a1="$(mktemp)"; a2="$(mktemp)"
( { echo "begin;"; confirm_sql "${buyer1}" "${s3}" "${h3}" "chkrace-${run}-same"; echo "select pg_sleep(2); commit;"; } | psql_ >"${a1}" 2>&1 ) &
sleep 0.5
( { echo "begin;"; confirm_sql "${buyer1}" "${s3}" "${h3}" "chkrace-${run}-same"; echo "commit;"; } | psql_ >"${a2}" 2>&1 ) &
wait
fresh=0; replay=0
for f in "${a1}" "${a2}"; do
  if grep -q '^false:1$' "$f"; then fresh=$((fresh+1)); elif grep -q '^true:1$' "$f"; then replay=$((replay+1)); fi
done
check "exactly one call placed the order" 1 "${fresh}"
check "the other replayed it (replayed = true)" 1 "${replay}"
check "one order for the session" 1 "$(q "select count(*) from public.marketplace_orders where checkout_session_id='${s3}'")"
check "reserved is 2 (race 1 order + race 2 order)" 2 "$(q "select reserved from public.marketplace_inventory_levels where variant_id='${variant}'")"
rm -f "${a1}" "${a2}"

if [[ "${fail}" -ne 0 ]]; then echo "RESULT: FAIL"; exit 1; fi
echo "RESULT: PASS"
