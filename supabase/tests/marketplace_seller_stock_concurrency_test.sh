#!/usr/bin/env bash
set -euo pipefail

# Real multi-session proof for the SELLER stock path (Migration 06):
# public.marketplace_seller_stock_adjust, called as an authenticated seller, the
# way the workspace calls it. Two browsers removing stock at the same moment must
# not take the level below zero, and a double-submitted click must apply once.
#
#   RACE 1  two sessions each remove 6 of 10  -> exactly ONE succeeds, on-hand 4
#   RACE 2  the same click key sent twice      -> applied once
#
# Commits real fixture rows with a unique run id and removes them on exit (the
# owner disables the ledger's append-only guard only for that cleanup). Run it
# ONLY against the local isolated database.

db_container="$(docker ps --filter 'name=supabase_db_aladdin' --format '{{.Names}}' | head -n 1)"
if [[ -z "${db_container}" ]]; then
  echo "Supabase database container not found" >&2
  exit 1
fi
psql_() { docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 "$@"; }
q() { docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1" </dev/null; }

run="$(date +%s)"
org='9c000000-cccc-4ccc-8ccc-000000000001'      # showroom A (seed-pilot)
seller='70000001-0000-4000-8000-000000000001'    # its owner
product="c6${run:0:6}-0000-4000-8000-000000000001"
variant="d6${run:0:6}-0000-4000-8000-000000000001"
location="e6${run:0:6}-0000-4000-8000-000000000001"
created_account=0

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
select set_config('app.marketplace_seller_write', 'on', true);
delete from public.marketplace_seller_accounts where organization_id = '${org}' and status_reason = 'seller-concurrency-test';
commit;
SQL
}
trap cleanup EXIT

psql_ <<SQL
select set_config('app.marketplace_seller_write', 'on', false);
insert into public.marketplace_seller_accounts (organization_id, status, status_reason, approved_at)
values ('${org}', 'approved', 'seller-concurrency-test', now()) on conflict do nothing;
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en)
select '${product}', '${org}', id, 'seller-race-${run}', 'سباق', 'race' from public.marketplace_product_types where key = 'wallpaper';
insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values ('${variant}', '${product}', '${org}', 'SRACE-${run}', 'roll', 10);
insert into public.marketplace_stock_locations (id, organization_id, key, name_ar, name_en)
values ('${location}', '${org}', 'srace_${run}', 'سباق', 'race');
SQL

# One seller call as the authenticated owner. Args: delta key [sleep-before-commit]
adjust() {
  {
    echo "begin;"
    echo "set local role authenticated;"
    echo "set local request.jwt.claims = '{\"sub\":\"${seller}\",\"role\":\"authenticated\"}';"
    echo "select (public.marketplace_seller_stock_adjust('${variant}', '${location}', $1, '$2') ->> 'applied');"
    if [[ -n "${3:-}" ]]; then echo "select pg_sleep($3);"; fi
    echo "commit;"
  } | psql_
}

fail=0
check() { if [[ "$2" == "$3" ]]; then echo "PASS  $1 (= $3)"; else echo "FAIL  $1: expected $2, got $3"; fail=1; fi; }

echo "== opening stock: 10 =="
adjust 10 "srace-${run}-initial" >/dev/null

echo "== RACE 1: two sellers remove 6 of 10 at once =="
o1="$(mktemp)"; o2="$(mktemp)"
( adjust -6 "srace-${run}-a" 2 >"${o1}" 2>&1 || true ) &
sleep 0.4
( adjust -6 "srace-${run}-b" >"${o2}" 2>&1 || true ) &
wait
wins=0; refused=0
for f in "${o1}" "${o2}"; do
  if grep -q '^true$' "$f"; then wins=$((wins+1)); elif grep -q 'mp:insufficient_stock' "$f"; then refused=$((refused+1)); fi
done
check "exactly one removal succeeded" 1 "${wins}"
check "the other was refused (insufficient stock)" 1 "${refused}"
check "on-hand never went below zero (4)" 4 "$(q "select on_hand from public.marketplace_inventory_levels where variant_id='${variant}'")"
rm -f "${o1}" "${o2}"

echo "== RACE 2: the same click (same key) twice at once =="
o1="$(mktemp)"; o2="$(mktemp)"
( adjust 5 "srace-${run}-click" 2 >"${o1}" 2>&1 || true ) &
sleep 0.4
( adjust 5 "srace-${run}-click" >"${o2}" 2>&1 || true ) &
wait
check "applied exactly once" 1 "$(cat "${o1}" "${o2}" | grep -c '^true$' || true)"
check "on-hand moved once (9)" 9 "$(q "select on_hand from public.marketplace_inventory_levels where variant_id='${variant}'")"
check "ledger equals level" t "$(q "select l.on_hand = sum(m.delta_on_hand) from public.marketplace_inventory_levels l join public.marketplace_stock_movements m on m.variant_id = l.variant_id and m.location_id = l.location_id where l.variant_id='${variant}' group by l.on_hand")"
rm -f "${o1}" "${o2}"

if [[ "${fail}" -ne 0 ]]; then echo "RESULT: FAIL"; exit 1; fi
echo "RESULT: PASS"
