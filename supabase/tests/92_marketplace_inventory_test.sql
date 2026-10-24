-- pgTAP: Marketplace Migration 03 — inventory
-- (20261013090002_marketplace_inventory.sql).
--
-- Sections, and the failure each one exists to prevent:
--   A. SHAPE        — three tables, RLS on, SELECT-only grants, nothing for anon,
--                     one trusted function executable by service_role only.
--   B. FLOW         — initial / replenish / correction / reserve / release / deduct and
--                     the available = on_hand - reserved formula after each.
--   C. RULES        — no oversell, no negative stock, no release/deduct beyond reserved,
--                     no correction below reserved, bad arguments.
--   D. IDEMPOTENCY  — a replayed key changes nothing; a reused key for something else fails.
--   E. LEDGER       — append-only, and levels always equal the sum of their ledger.
--   F. OWNERSHIP    — variant / location / branch must belong to the seller.
--   G. DIRECT WRITES— levels change only through the function; CHECKs are the backstop.
--   H. LOCATIONS    — multi-location availability, inactive locations excluded.
--   I. ACCESS       — tenant isolation, no client writes, no client EXECUTE.
--   J. PUBLICATION  — real stock rule, seller enablement still blocks.
--   K. ISOLATION    — FKs only to organizations / branches, none from existing tables.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (member 70000001, branch b0000001-…),
-- showroom B 91000005-…005 (member 71000005, branch b1000005-…), 70000009 (outsider),
-- 11111111 (platform moderator, granted HERE).
-- The two-session proof of the row lock lives in marketplace_stock_concurrency_test.sh.
create extension if not exists pgtap;

begin;
select plan(101);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '71000005-0000-4000-8000-000000000005',
               '70000009-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111');

select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);

-- products and variants (owner-level fixtures; Migration 02 is not under test here)
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en)
select v.id::uuid, v.org::uuid, t.id, v.slug, 'منتج', v.slug
from (values
  ('a1000000-0000-4000-8000-0000000000a1', current_setting('t.a'), 'wallpaper', 'inv-product-a'),
  ('b1000000-0000-4000-8000-0000000000b1', current_setting('t.b'), 'wallpaper', 'inv-product-b')
) as v(id, org, type_key, slug)
join public.marketplace_product_types t on t.key = v.type_key;

insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values ('a1100000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1', current_setting('t.a')::uuid, 'INV-A1', 'roll', 100),
       ('a1100000-0000-4000-8000-0000000000a2', 'a1000000-0000-4000-8000-0000000000a1', current_setting('t.a')::uuid, 'INV-A2', 'roll', 120),
       ('b1100000-0000-4000-8000-0000000000b1', 'b1000000-0000-4000-8000-0000000000b1', current_setting('t.b')::uuid, 'INV-B1', 'roll', 90);

-- stock locations: A1 (showroom, mirrors a real branch), A2 (warehouse), B1
insert into public.marketplace_stock_locations (id, organization_id, branch_id, key, name_ar, name_en, kind, supports_pickup)
values ('a1200000-0000-4000-8000-0000000000a1', current_setting('t.a')::uuid, 'b0000001-0000-4000-8000-000000000001',
        'nasr_city_showroom', 'معرض مدينة نصر', 'Nasr City showroom', 'showroom', true),
       ('a1200000-0000-4000-8000-0000000000a2', current_setting('t.a')::uuid, null,
        'main_warehouse', 'المخزن الرئيسي', 'Main warehouse', 'warehouse', false),
       ('b1200000-0000-4000-8000-0000000000b1', current_setting('t.b')::uuid, 'b1000005-0000-4000-8000-000000000005',
        'zayed_showroom', 'معرض زايد', 'Zayed showroom', 'showroom', true);

-- Migration 04: reserving needs an enabled seller. Fixture-level approval (owner
-- session + the transition flag); the approval workflow itself is tested in 93_.
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now());
select set_config('app.marketplace_seller_write', 'off', true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select has_table('public'::name, 'marketplace_stock_locations'::name,  'A1. marketplace_stock_locations exists');
select has_table('public'::name, 'marketplace_inventory_levels'::name, 'A2. marketplace_inventory_levels exists');
select has_table('public'::name, 'marketplace_stock_movements'::name,  'A3. marketplace_stock_movements exists');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and c.relname in ('marketplace_stock_locations', 'marketplace_inventory_levels', 'marketplace_stock_movements')),
  3, 'A4. RLS is enabled on all three inventory tables');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
     and privilege_type <> 'SELECT'
     and table_name in ('marketplace_stock_locations', 'marketplace_inventory_levels', 'marketplace_stock_movements')),
  0, 'A5. no role holds a write privilege on any inventory table');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and table_name in ('marketplace_stock_locations', 'marketplace_inventory_levels', 'marketplace_stock_movements')),
  0, 'A6. anon holds nothing on the inventory tables');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and cmd <> 'SELECT'
     and tablename in ('marketplace_stock_locations', 'marketplace_inventory_levels', 'marketplace_stock_movements')),
  0, 'A7. there is no insert / update / delete policy on any inventory table');
select is(
  (select array[has_function_privilege('anon', f, 'execute'), has_function_privilege('authenticated', f, 'execute'),
                has_function_privilege('service_role', f, 'execute')]
   from (select 'public.marketplace_stock_apply(uuid,uuid,uuid,text,integer,text,text,text,text,text,uuid)'::regprocedure as f) x),
  array[false, false, true], 'A8. marketplace_stock_apply is executable by service_role ONLY');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
          unnest(array['anon', 'authenticated', 'service_role']) r
   where n.nspname = 'app' and p.proname like 'marketplace\_%' and has_function_privilege(r, p.oid, 'execute')
     -- storage-policy predicates (Migration 06) must be callable by the querying role
     and p.proname not in ('marketplace_storage_can_delete_image', 'marketplace_storage_can_upload_image', 'marketplace_storage_can_upload_import',
                        'marketplace_storage_moderator_can_read', 'marketplace_storage_owns_image')),
  0, 'A9. NO client role can execute any app.marketplace_* function (hardening)');
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.marketplace_stock_apply(uuid,uuid,uuid,text,integer,text,text,text,text,text,uuid)'::regprocedure),
  true, 'A10. the trusted function is SECURITY DEFINER...');
select ok(
  (select exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""') from pg_proc p
   where p.oid = 'public.marketplace_stock_apply(uuid,uuid,uuid,text,integer,text,text,text,text,text,uuid)'::regprocedure),
  'A11. ...with an empty search_path');
select is(
  (select attgenerated from pg_attribute where attrelid = 'public.marketplace_inventory_levels'::regclass and attname = 'available'),
  's', 'A12. available is a STORED generated column (on_hand - reserved)');

-- ===========================================================================
-- B. Flow and formula
-- ===========================================================================
select is((select applied from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'initial', 100, 'key-a1-initial-01', 'opening balance', 'manual')), true,
  'B1. initial entry applies');
select is((select on_hand::text || '/' || reserved::text || '/' || available::text from public.marketplace_inventory_levels
           where variant_id = 'a1100000-0000-4000-8000-0000000000a1' and location_id = 'a1200000-0000-4000-8000-0000000000a1'),
  '100/0/100', 'B2. on_hand 100, reserved 0, available 100');
select is((select available from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', 50, 'key-a1-replenish-1', 'new shipment', 'manual')), 150,
  'B3. replenish +50 -> available 150');
select is((select available from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'correction', -10, 'key-a1-correct-001', 'damaged in storage', 'manual')), 140,
  'B4. correction -10 -> available 140');
select is((select available from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'reserve', 30, 'key-a1-reserve-001', 'held for an order', 'order')), 110,
  'B5. reserve 30 -> available 110 (on_hand unchanged)');
select is((select on_hand::text || '/' || reserved::text from public.marketplace_inventory_levels
           where variant_id = 'a1100000-0000-4000-8000-0000000000a1' and location_id = 'a1200000-0000-4000-8000-0000000000a1'),
  '140/30', 'B6. on_hand 140, reserved 30');
select is((select available from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'release', 10, 'key-a1-release-001', 'order line cancelled', 'order')), 120,
  'B7. release 10 -> reserved 20, available 120');
select is((select on_hand::text || '/' || reserved::text || '/' || available::text from public.marketplace_stock_apply(
  current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1', 'a1200000-0000-4000-8000-0000000000a1',
  'deduct', 20, 'key-a1-deduct-0001', 'order confirmed', 'order', 'order', 'ORD-1')),
  '120/0/120', 'B8. deduct 20 consumes the reservation: on_hand 120, reserved 0, available 120');
select is((select count(*)::int from public.marketplace_stock_movements
           where variant_id = 'a1100000-0000-4000-8000-0000000000a1' and location_id = 'a1200000-0000-4000-8000-0000000000a1'),
  6, 'B9. six movements were recorded for six operations');
select is((select reference_type || ':' || reference_id from public.marketplace_stock_movements where idempotency_key = 'key-a1-deduct-0001'),
  'order:ORD-1', 'B10. a business reference is stored with the movement');

-- ===========================================================================
-- C. Rules
-- ===========================================================================
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'reserve', 121, 'key-a1-oversell-01', 'too many', 'order') $$,
  '23514', null, 'C1. reserving more than available is refused (no oversell)');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'release', 1, 'key-a1-overrelease', 'nothing reserved', 'order') $$,
  '23514', null, 'C2. releasing more than reserved is refused');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'deduct', 1, 'key-a1-overdeduct', 'nothing reserved', 'order') $$,
  '23514', null, 'C3. deducting more than reserved is refused');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'correction', -121, 'key-a1-negative-01', 'would go negative', 'manual') $$,
  '23514', null, 'C4. a correction cannot take on-hand below zero');
select lives_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'reserve', 120, 'key-a1-reserve-big1', 'big order', 'order') $$,
  'C5. reserving exactly what is available is allowed (available becomes 0)');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'reserve', 1, 'key-a1-reserve-last', 'one too many', 'order') $$,
  '23514', null, 'C6. ...and the next unit is refused');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'correction', -30, 'key-a1-below-resrv', 'below reserved', 'manual') $$,
  '23514', null, 'C7. a correction cannot take on-hand below what is reserved');
select is((select available from public.marketplace_inventory_levels
           where variant_id = 'a1100000-0000-4000-8000-0000000000a1' and location_id = 'a1200000-0000-4000-8000-0000000000a1'),
  0, 'C8. refused operations left the level untouched (120 on hand, 120 reserved, 0 available)');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'sell', 1, 'key-a1-unknown-typ', 'x', 'manual') $$,
  '22023', null, 'C9. an unknown movement type is rejected');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', 0, 'key-a1-zero-qty-01', 'x', 'manual') $$,
  '22023', null, 'C10. a zero quantity is rejected');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', -5, 'key-a1-neg-replen1', 'x', 'manual') $$,
  '22023', null, 'C11. a negative quantity is only valid for a correction');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', 5, 'short', 'x', 'manual') $$,
  '22023', null, 'C12. a short idempotency key is rejected');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', 5, 'key-a1-blank-reasn', '   ', 'manual') $$,
  '22023', null, 'C13. a blank reason is rejected');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', 5, 'key-a1-bad-source1', 'x', 'carrier-pigeon') $$,
  '22023', null, 'C14. an unknown source is rejected');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'initial', 5, 'key-a1-second-init1', 'again', 'manual') $$,
  '23505', null, 'C15. a second opening balance for the same variant and location is rejected');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a2',
  'a1200000-0000-4000-8000-0000000000a1', 'reserve', 1, 'key-a2-no-record-01', 'never stocked', 'order') $$,
  '23503', null, 'C16. reserving a variant that has no stock record is rejected');

-- ===========================================================================
-- D. Idempotency
-- ===========================================================================
select is((select applied from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a2',
  'a1200000-0000-4000-8000-0000000000a1', 'initial', 40, 'key-a2-initial-001', 'opening', 'import')), true,
  'D1. the first use of a key applies');
select is((select applied from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a2',
  'a1200000-0000-4000-8000-0000000000a1', 'initial', 40, 'key-a2-initial-001', 'opening', 'import')), false,
  'D2. replaying the same key reports applied = false...');
select is((select on_hand from public.marketplace_inventory_levels
           where variant_id = 'a1100000-0000-4000-8000-0000000000a2' and location_id = 'a1200000-0000-4000-8000-0000000000a1'),
  40, 'D3. ...and stock is NOT applied twice (still 40)');
select is((select count(*)::int from public.marketplace_stock_movements where idempotency_key = 'key-a2-initial-001'), 1,
  'D4. ...and no second ledger row exists');
select is((select movement_id from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a2',
  'a1200000-0000-4000-8000-0000000000a1', 'initial', 40, 'key-a2-initial-001', 'opening', 'import')),
  (select id from public.marketplace_stock_movements where idempotency_key = 'key-a2-initial-001'),
  'D5. a replay returns the ORIGINAL movement id');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a2',
  'a1200000-0000-4000-8000-0000000000a1', 'initial', 41, 'key-a2-initial-001', 'opening', 'import') $$,
  '23505', null, 'D6. the same key with a different quantity is an error, not a replay');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', 40, 'key-a2-initial-001', 'x', 'import') $$,
  '23505', null, 'D7. the same key for a different variant / type is an error');
select is((select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, 'b1100000-0000-4000-8000-0000000000b1',
  'b1200000-0000-4000-8000-0000000000b1', 'initial', 40, 'key-a2-initial-001', 'opening', 'import')), true,
  'D8. the same key text is independent across sellers');

-- ===========================================================================
-- E. Ledger
-- ===========================================================================
select throws_ok($$ update public.marketplace_stock_movements set reason = 'rewritten' $$,
  '23514', null, 'E1. a movement cannot be updated');
select throws_ok($$ delete from public.marketplace_stock_movements $$,
  '23514', null, 'E2. a movement cannot be deleted');
select is(
  (select count(*)::int from public.marketplace_inventory_levels l
   where l.on_hand <> (select coalesce(sum(m.delta_on_hand), 0) from public.marketplace_stock_movements m
                       where m.variant_id = l.variant_id and m.location_id = l.location_id)
      or l.reserved <> (select coalesce(sum(m.delta_reserved), 0) from public.marketplace_stock_movements m
                        where m.variant_id = l.variant_id and m.location_id = l.location_id)),
  0, 'E3. every level equals the sum of its ledger (on-hand and reserved)');
select is(
  (select count(*)::int from public.marketplace_inventory_levels l
   where (select m.on_hand_after::text || '/' || m.reserved_after::text from public.marketplace_stock_movements m
          where m.variant_id = l.variant_id and m.location_id = l.location_id
          order by m.sequence desc limit 1) is distinct from l.on_hand::text || '/' || l.reserved::text),
  0, 'E4. the latest movement''s balances equal the level');
select is(
  (select count(*)::int from public.marketplace_stock_movements
   where reason is null or source is null or created_at is null or idempotency_key is null),
  0, 'E5. every movement carries reason, source, time and key');
select is(
  (select count(*)::int from public.marketplace_stock_movements where on_hand_after < 0 or reserved_after > on_hand_after),
  0, 'E6. no historical balance was negative or oversold');
select lives_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a2',
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', 1, 'key-a2-actor-0001', 'actor recorded', 'manual', null, null,
  '70000001-0000-4000-8000-000000000001') $$, 'E7. an actor can be supplied');
select is((select actor_user_id from public.marketplace_stock_movements where idempotency_key = 'key-a2-actor-0001'),
  '70000001-0000-4000-8000-000000000001'::uuid, 'E8. ...and is stored with the movement');

-- ===========================================================================
-- F. Ownership
-- ===========================================================================
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.b')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'b1200000-0000-4000-8000-0000000000b1', 'replenish', 1, 'key-x-seller-b-var', 'cross tenant', 'manual') $$,
  '23503', null, 'F1. seller B cannot touch a variant of seller A');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'b1200000-0000-4000-8000-0000000000b1', 'replenish', 1, 'key-x-seller-a-loc', 'cross tenant', 'manual') $$,
  '23503', null, 'F2. seller A cannot use seller B''s stock location');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, gen_random_uuid(),
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', 1, 'key-x-ghost-var-01', 'no such variant', 'manual') $$,
  '23503', null, 'F3. an unknown variant is rejected');
select throws_ok($$ insert into public.marketplace_stock_locations (organization_id, branch_id, key, name_ar, name_en)
                    values (current_setting('t.a')::uuid, 'b1000005-0000-4000-8000-000000000005', 'wrong_branch', 'x', 'x') $$,
  '23514', null, 'F4. a location cannot mirror another organization''s branch');
select throws_ok($$ insert into public.marketplace_stock_locations (organization_id, key, name_ar, name_en)
                    values (current_setting('t.a')::uuid, 'main_warehouse', 'x', 'x') $$,
  '23505', null, 'F5. a location key is unique per organization');
select lives_ok($$ insert into public.marketplace_stock_locations (organization_id, key, name_ar, name_en)
                   values (current_setting('t.b')::uuid, 'main_warehouse', 'x', 'x') $$,
  'F6. ...but the same key may exist for another organization');
select throws_ok($$ update public.marketplace_stock_locations set organization_id = current_setting('t.b')::uuid
                    where id = 'a1200000-0000-4000-8000-0000000000a2' $$,
  '23514', null, 'F7. a location cannot move to another organization');
select throws_ok($$ insert into public.marketplace_stock_locations (organization_id, key, name_ar, name_en, kind)
                    values (current_setting('t.a')::uuid, 'moon_base', 'x', 'x', 'moon') $$,
  '23514', null, 'F8. an unknown location kind is rejected');
select throws_ok($$ insert into public.marketplace_stock_locations (organization_id, key, name_ar, name_en)
                    values (gen_random_uuid(), 'ghost_org', 'x', 'x') $$,
  '23503', null, 'F9. a location must belong to a real organization');

-- ===========================================================================
-- G. Direct writes
-- ===========================================================================
select throws_ok($$ update public.marketplace_inventory_levels set on_hand = on_hand + 1000 $$,
  '42501', null, 'G1. a direct UPDATE of a level is refused (only the trusted function may change stock)');
select throws_ok($$ insert into public.marketplace_inventory_levels (variant_id, location_id, seller_organization_id, on_hand)
                    values ('a1100000-0000-4000-8000-0000000000a2', 'a1200000-0000-4000-8000-0000000000a2', current_setting('t.a')::uuid, 5) $$,
  '42501', null, 'G2. a direct INSERT of a level is refused');
select set_config('app.marketplace_stock_write', 'on', true);
select throws_ok($$ update public.marketplace_inventory_levels set on_hand = -1
                    where variant_id = 'a1100000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'G3. even with the guard open, negative on-hand violates the CHECK');
select throws_ok($$ update public.marketplace_inventory_levels set reserved = on_hand + 1
                    where variant_id = 'a1100000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'G4. ...and reserved > on-hand violates the CHECK (the oversell backstop)');
select throws_ok($$ update public.marketplace_inventory_levels set available = 999
                    where variant_id = 'a1100000-0000-4000-8000-0000000000a1' $$,
  '428C9', null, 'G5. the generated available column cannot be written');
select set_config('app.marketplace_stock_write', 'off', true);
select throws_ok($$ insert into public.marketplace_stock_movements (variant_id, location_id, seller_organization_id, movement_type,
                      delta_on_hand, delta_reserved, on_hand_after, reserved_after, request_quantity, idempotency_key, reason, source)
                    values ('a1100000-0000-4000-8000-0000000000a1', 'a1200000-0000-4000-8000-0000000000a1', current_setting('t.a')::uuid,
                            'reserve', 5, 0, 5, 0, 5, 'key-bad-shape-0001', 'inconsistent', 'manual') $$,
  '23514', null, 'G6. a ledger row whose deltas do not fit its type is rejected');

-- ===========================================================================
-- H. Multi-location
-- ===========================================================================
select is((select applied from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a2', 'initial', 70, 'key-a1-wh-initial-1', 'warehouse opening', 'manual')), true,
  'H1. the same variant can hold stock at a second location');
select is(app.marketplace_variant_available('a1100000-0000-4000-8000-0000000000a1'), 70,
  'H2. variant availability sums locations: 0 (showroom, fully reserved) + 70 (warehouse)');
select is((select count(*)::int from public.marketplace_inventory_levels where variant_id = 'a1100000-0000-4000-8000-0000000000a1'), 2,
  'H3. one level row per (variant, location)');
update public.marketplace_stock_locations set is_active = false where id = 'a1200000-0000-4000-8000-0000000000a2';
select is(app.marketplace_variant_available('a1100000-0000-4000-8000-0000000000a1'), 0,
  'H4. an inactive location no longer counts toward availability (only the fully reserved showroom is left)');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a2', 'replenish', 1, 'key-a1-inactive-loc', 'x', 'manual') $$,
  '23503', null, 'H5. stock cannot be moved at an inactive location');
select is((select supports_pickup from public.marketplace_stock_locations where id = 'a1200000-0000-4000-8000-0000000000a1'), true,
  'H6. a location can declare it supports pickup (showroom branch)');
select is((select branch_id from public.marketplace_stock_locations where id = 'a1200000-0000-4000-8000-0000000000a1'),
  'b0000001-0000-4000-8000-000000000001'::uuid, 'H7. ...and mirrors an existing showroom branch without altering it');

-- ===========================================================================
-- I. Access
-- ===========================================================================
set local role anon;
select throws_ok($$ select count(*) from public.marketplace_stock_movements $$, '42501', null,
  'I1. anon cannot read the stock ledger');
select throws_ok($$ select count(*) from public.marketplace_inventory_levels $$, '42501', null,
  'I2. anon cannot read stock levels');
select throws_ok($$ select * from public.marketplace_stock_apply(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'initial', 1, 'key-anon-call-0001', 'x') $$,
  '42501', null, 'I3. anon cannot call the stock function');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_stock_locations), 2, 'I4. a member of showroom A sees A''s two locations');
select is((select count(*)::int from public.marketplace_stock_locations where organization_id = current_setting('t.b')::uuid), 0,
  'I5. ...and none of B''s');
select ok((select count(*)::int from public.marketplace_inventory_levels) >= 2, 'I6. ...sees A''s levels');
select is((select count(*)::int from public.marketplace_inventory_levels where seller_organization_id = current_setting('t.b')::uuid), 0,
  'I7. ...and none of B''s');
select is((select count(*)::int from public.marketplace_stock_movements where seller_organization_id = current_setting('t.b')::uuid), 0,
  'I8. ...and none of B''s ledger');
select throws_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', 1000, 'key-auth-call-0001', 'self service', 'manual') $$,
  '42501', null, 'I9. a signed-in seller member cannot call the stock function directly');
select throws_ok($$ update public.marketplace_inventory_levels set on_hand = 999999 $$, '42501', null,
  'I10. ...nor update a level');
select throws_ok($$ insert into public.marketplace_stock_movements (variant_id, location_id, seller_organization_id, movement_type,
                      delta_on_hand, delta_reserved, on_hand_after, reserved_after, request_quantity, idempotency_key, reason, source)
                    values ('a1100000-0000-4000-8000-0000000000a1', 'a1200000-0000-4000-8000-0000000000a1', current_setting('t.a')::uuid,
                            'replenish', 5, 0, 5, 0, 5, 'key-forged-ledger-1', 'forged', 'manual') $$,
  '42501', null, 'I11. ...nor forge a ledger row');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_stock_locations), 2,
  'I12. showroom B''s member sees only B''s locations (its two)');
select is((select count(distinct seller_organization_id)::int from public.marketplace_stock_movements), 1,
  'I13. ...and only one seller in the ledger');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_inventory_levels), 0,
  'I14. a user with no seller membership sees no stock at all');
reset role;

insert into public.platform_role_grants (user_id, role, granted_by)
values ('11111111-1111-4111-8111-111111111111', 'moderator', '11111111-1111-4111-8111-111111111111');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select ok((select count(distinct seller_organization_id)::int from public.marketplace_stock_movements) >= 2,
  'I15. platform staff read every seller''s ledger');
reset role;

set local role service_role;
select lives_ok($$ select * from public.marketplace_stock_apply(current_setting('t.a')::uuid, 'a1100000-0000-4000-8000-0000000000a1',
  'a1200000-0000-4000-8000-0000000000a1', 'replenish', 3, 'key-service-role-01', 'trusted backend', 'system') $$,
  'I16. the service role can call the trusted function');
reset role;

-- ===========================================================================
-- J. Publication stays closed
-- ===========================================================================
select ok(not ('no_available_stock' = any(app.marketplace_publication_blockers('a1000000-0000-4000-8000-0000000000a1'))),
  'J1. a product with a variant in stock no longer reports a stock blocker');
select ok(not ('no_available_stock' = any(app.marketplace_publication_blockers('b1000000-0000-4000-8000-0000000000b1'))),
  'J2. seller B''s variant has stock too, so it reports no stock blocker');
update public.marketplace_stock_locations set is_active = false where organization_id = current_setting('t.b')::uuid;
select ok('no_available_stock' = any(app.marketplace_publication_blockers('b1000000-0000-4000-8000-0000000000b1')),
  'J3. a product whose stock sits only at inactive locations reports no_available_stock');
select ok(not ('seller_not_approved' = any(app.marketplace_publication_blockers('a1000000-0000-4000-8000-0000000000a1')))
      and 'media_verification_not_available' = any(app.marketplace_publication_blockers('a1000000-0000-4000-8000-0000000000a1')),
  'J4. with the seller approved, publication is STILL closed by the media-verification flag (Migration 04)');
select throws_ok($$ update public.marketplace_products set status = 'published' where id = 'a1000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'J5. publication is still refused');

-- ===========================================================================
-- K. Isolation from existing objects
-- ===========================================================================
select is(
  (select array_agg(distinct dst.relname::text order by dst.relname::text) from pg_constraint c
   join pg_class src on src.oid = c.conrelid and src.relname in
     ('marketplace_stock_locations', 'marketplace_inventory_levels', 'marketplace_stock_movements')
   join pg_class dst on dst.oid = c.confrelid
   where c.contype = 'f' and dst.relname not like 'marketplace\_%'),
  array['branches', 'organizations'], 'K1. inventory references exactly two existing tables: organizations and branches');
select is(
  (select array_agg(distinct c.confdeltype::text) from pg_constraint c
   join pg_class src on src.oid = c.conrelid and src.relname = 'marketplace_stock_locations'
   join pg_class dst on dst.oid = c.confrelid and dst.relname in ('organizations', 'branches')
   where c.contype = 'f'),
  array['r'], 'K2. both are ON DELETE RESTRICT (they can only block a hard delete, never cascade into B2B)');
select is(
  (select count(*)::int from pg_constraint c join pg_class src on src.oid = c.conrelid
   join pg_class dst on dst.oid = c.confrelid
   where c.contype = 'f' and dst.relname like 'marketplace\_%' and src.relname not like 'marketplace\_%'),
  0, 'K3. no existing table references a marketplace table');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name in ('branches', 'organizations', 'products')
     and column_name like '%marketplace%'),
  0, 'K4. organizations, branches and public.products gained no column');

select * from finish();
rollback;
