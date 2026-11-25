-- pgTAP: Marketplace PR 11 — the account cart, the guest-cart merge and the own-showroom rule
-- (20261125090002_marketplace_account_cart.sql).
--
--   A. SHAPE       RPC-only cart tables, owner-only SELECT, authenticated-only RPCs.
--   B. OWN SHOWROOM  a member of a showroom cannot merge / replace / insert its products, nor place an order with it.
--   C. MERGE       guest lines land in the account cart exactly once per key; quantities add and are capped;
--                  unknown / dead / own lines are skipped; limits and bad input are refused; a closed Marketplace refuses.
--   D. REPLACE     the browser mirror: edits, removal, a line that sold out stays, a dead NEW line is dropped.
--   E. ISOLATION   another buyer and anon see and change nothing; the cart never holds a price.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001), buyer 70000009, other user 70000002 (member of A, sales-only).
create extension if not exists pgtap;

begin;
select no_plan();

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002', '70000009-0000-4000-8000-000000000009');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.seller', '70000001-0000-4000-8000-000000000001', true);
select set_config('t.buyer', '70000009-0000-4000-8000-000000000009', true);
select set_config('t.other', '70000002-0000-4000-8000-000000000002', true);

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.cart_qty(p_user text, p_sku text) returns integer language sql security definer as $$
  select c.quantity from public.marketplace_cart_items c join public.marketplace_product_variants v on v.id = c.variant_id
  where c.user_id = p_user::uuid and v.sku = p_sku;
$$;

-- fixture: three published products of showroom A with stock, a payment method and delivery
set local role authenticated;
select pg_temp.as_user(current_setting('t.seller'));
select set_config('t.p1', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق سلة', 'name_en', 'Cart paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'CRT-1', 'selling_unit', 'roll', 'price_egp', 100)))) ->> 'id'), true);
select set_config('t.p2', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق ثاني', 'name_en', 'Second cart paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'CRT-2', 'selling_unit', 'roll', 'price_egp', 250)))) ->> 'id'), true);
select set_config('t.p3', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق مسودة', 'name_en', 'Draft cart paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'CRT-3', 'selling_unit', 'roll', 'price_egp', 90)))) ->> 'id'), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'CRT-1'),
  current_setting('t.loc')::uuid, 10, 'crt-stock-0001');
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'CRT-2'),
  current_setting('t.loc')::uuid, 5, 'crt-stock-0002');
select public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid, '[{"governorate_key":"cairo"}]'::jsonb);
select public.marketplace_seller_delivery_prices_save(current_setting('t.a')::uuid, '[{"governorate_key":"cairo","fee_egp":50}]'::jsonb);
select public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid, '{"cod_enabled":true}'::jsonb);
reset role;
set local session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now()
 where id in (current_setting('t.p1')::uuid, current_setting('t.p2')::uuid);
set local session_replication_role = origin;
select set_config('t.slug1', (select slug from public.marketplace_products where id = current_setting('t.p1')::uuid), true);
select set_config('t.slug2', (select slug from public.marketplace_products where id = current_setting('t.p2')::uuid), true);
select set_config('t.slug3', (select slug from public.marketplace_products where id = current_setting('t.p3')::uuid), true);
select set_config('t.line1', jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'CRT-1', 'qty', 2)::text, true);
select set_config('t.line2', jsonb_build_object('slug', current_setting('t.slug2'), 'sku', 'CRT-2', 'qty', 1)::text, true);
select set_config('t.line3', jsonb_build_object('slug', current_setting('t.slug3'), 'sku', 'CRT-3', 'qty', 1)::text, true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is((select count(*)::int from information_schema.role_table_grants
           where table_name = 'marketplace_cart_items' and grantee in ('anon', 'authenticated', 'service_role')
             and privilege_type <> 'SELECT'), 0, 'A1. the cart table has no client write grant');
select is((select count(*)::int from information_schema.role_table_grants
           where table_name = 'marketplace_cart_items' and grantee = 'anon'), 0, 'A2. anon has no grant on the cart table');
select is((select count(*)::int from information_schema.role_table_grants
           where table_name = 'marketplace_cart_merges' and grantee in ('anon', 'authenticated', 'service_role')), 0,
  'A3. the merge ledger is RPC-only');
select is((select count(*)::int from pg_class where relname in ('marketplace_cart_items', 'marketplace_cart_merges') and relrowsecurity), 2,
  'A4. row level security is on for both cart tables');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('marketplace_cart_get', 'marketplace_cart_merge', 'marketplace_cart_replace', 'marketplace_cart_own_sellers')
             and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 4,
  'A5. the four cart RPCs are SECURITY DEFINER and authenticated-only (never anon)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname in ('marketplace_user_belongs_to_seller', 'marketplace_cart_variant_any', 'marketplace_cart_variant_is_live',
             'marketplace_refuse_own_showroom', 'marketplace_cart_parse_line')
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0,
  'A6. the internal helpers are not callable by clients');

-- ===========================================================================
-- B. A showroom's own people cannot buy from it
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user(current_setting('t.seller'));
select is((public.marketplace_cart_own_sellers() ->> 0), (select slug from public.organizations where id = current_setting('t.a')::uuid),
  'B1. the cart tells the page which showroom the buyer works for (to hide the button)');
select is((public.marketplace_cart_merge('11111111-1111-4111-8111-111111111111', jsonb_build_array(current_setting('t.line1')::jsonb)) ->> 'own_showroom'), '1',
  'B2. merging a guest line of her own showroom skips it');
select is(jsonb_array_length(public.marketplace_cart_get() -> 'lines'), 0, 'B3. nothing of her own showroom is in her cart');
select throws_like(format($$ select public.marketplace_cart_replace(jsonb_build_array(%L::jsonb)) $$, current_setting('t.line1')),
  'mp:own_showroom%', 'B4. replacing the cart with her own showroom''s product is refused');
select pg_temp.as_user(current_setting('t.other'));
select throws_like(format($$ select public.marketplace_cart_replace(jsonb_build_array(%L::jsonb)) $$, current_setting('t.line2')),
  'mp:own_showroom%', 'B5. so is any other member of that showroom (sales-only too)');
reset role;
select throws_like(format($$ insert into public.marketplace_cart_items (user_id, variant_id, quantity)
  values (%L, (select id from public.marketplace_product_variants where sku = 'CRT-1'), 1) $$, current_setting('t.seller')),
  'mp:own_showroom%', 'B6. the database refuses the row itself, whoever writes it');
set local role authenticated;
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_checkout_place(jsonb_build_array(jsonb_build_object('slug', %L, 'sku', 'CRT-1', 'qty', 1)),
  '{"name":"Owner Self","phone":"01012345678","governorate":"cairo","address":"12 Nasr Road, Cairo"}'::jsonb,
  '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'own-key-0001') $$, current_setting('t.slug1')),
  'mp:own_showroom%', 'B7. the checkout path refuses an order of her own showroom');
reset role;
select is((select count(*)::int from public.marketplace_orders where buyer_user_id = current_setting('t.seller')::uuid), 0,
  'B8. and no order was written');
-- an order of anybody else's goes through the same insert path untouched
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select is((select jsonb_array_length(public.marketplace_checkout_place(jsonb_build_array(jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'CRT-1', 'qty', 1)),
  '{"name":"Test Buyer","phone":"01012345678","governorate":"cairo","address":"12 Nasr Road, Cairo"}'::jsonb,
  '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'buyer-key-0001') -> 'orders')), 1,
  'B9. an unrelated buyer still checks out');
reset role;

-- ===========================================================================
-- C. Merge
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.m1', public.marketplace_cart_merge('22222222-2222-4222-8222-222222222222', jsonb_build_array(
  current_setting('t.line1')::jsonb, current_setting('t.line2')::jsonb,
  jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'NOPE-9', 'qty', 1),
  current_setting('t.line3')::jsonb))::text, true);
select is((current_setting('t.m1')::jsonb ->> 'merged'), '2', 'C1. two live guest lines were merged');
select is((current_setting('t.m1')::jsonb ->> 'skipped'), '2', 'C2. an unknown SKU and a product that is not on sale were skipped');
select is((current_setting('t.m1')::jsonb ->> 'replayed'), 'false', 'C3. the first call is not a replay');
select is(pg_temp.cart_qty(current_setting('t.buyer'), 'CRT-1'), 2, 'C4. the quantity is the guest quantity');
select is((public.marketplace_cart_merge('22222222-2222-4222-8222-222222222222', jsonb_build_array(current_setting('t.line1')::jsonb)) ->> 'replayed'), 'true',
  'C5. the same merge key again is a replay');
select is(pg_temp.cart_qty(current_setting('t.buyer'), 'CRT-1'), 2, 'C6. a replay changes nothing (merged exactly once)');
select is((public.marketplace_cart_merge('33333333-3333-4333-8333-333333333333', jsonb_build_array(current_setting('t.line1')::jsonb)) ->> 'merged'), '1',
  'C7. a new key merges again');
select is(pg_temp.cart_qty(current_setting('t.buyer'), 'CRT-1'), 4, 'C8. quantities add up');
select is(pg_temp.cart_qty(current_setting('t.buyer'), 'CRT-3'), null, 'C9. a dead product never entered the cart');
select public.marketplace_cart_merge('44444444-4444-4444-8444-444444444444',
  jsonb_build_array(jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'CRT-1', 'qty', 9999)));
select is(pg_temp.cart_qty(current_setting('t.buyer'), 'CRT-1'), 9999, 'C10. a line is capped at 9999');
select is((public.marketplace_cart_merge('55555555-5555-4555-8555-555555555555', jsonb_build_array(
  jsonb_build_object('slug', current_setting('t.slug2'), 'sku', 'CRT-2', 'qty', 1), jsonb_build_object('slug', current_setting('t.slug2'), 'sku', 'CRT-2', 'qty', 2))) ->> 'merged'),
  '1', 'C11. the same variant twice in the guest cart is one line');
select is(pg_temp.cart_qty(current_setting('t.buyer'), 'CRT-2'), 4, 'C12. with the summed quantity (1 + 1 + 2)');
select throws_like($$ select public.marketplace_cart_merge('66666666-6666-4666-8666-666666666666',
  (select jsonb_agg(jsonb_build_object('slug', 'x', 'sku', 'y' || g, 'qty', 1)) from generate_series(1, 51) g)) $$,
  'mp:too_many_lines%', 'C13. more than 50 guest lines are refused');
select throws_like($$ select public.marketplace_cart_merge('77777777-7777-4777-8777-777777777777',
  '[{"slug":"x","sku":"y","qty":0}]'::jsonb) $$, 'mp:invalid_quantity%', 'C14. a zero quantity is refused');
select throws_like($$ select public.marketplace_cart_merge('88888888-8888-4888-8888-888888888888',
  '[{"slug":"x","sku":"y","qty":"many"}]'::jsonb) $$, 'mp:invalid_quantity%', 'C15. a non-numeric quantity is refused');
select throws_like($$ select public.marketplace_cart_merge(null, '[]'::jsonb) $$, 'mp:invalid_lines%', 'C16. a missing merge key is refused');
reset role;
select is((select count(*)::int from public.marketplace_cart_merges where user_id = current_setting('t.buyer')::uuid), 4,
  'C17. a refused call leaves no ledger row (four successful merges)');
update public.marketplace_platform_settings set marketplace_open = false where singleton;
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_cart_merge('99999999-9999-4999-8999-999999999999', jsonb_build_array(%L::jsonb)) $$, current_setting('t.line2')),
  'mp:marketplace_closed%', 'C18. a closed Marketplace takes no merge');
reset role;
update public.marketplace_platform_settings set marketplace_open = true where singleton;

-- ===========================================================================
-- D. Replace (the browser mirror)
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select is(jsonb_array_length(public.marketplace_cart_replace(jsonb_build_array(
  jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'CRT-1', 'qty', 3))) -> 'lines'), 1, 'D1. replace leaves exactly the listed lines');
select is(pg_temp.cart_qty(current_setting('t.buyer'), 'CRT-1'), 3, 'D2. with the listed quantity');
select is(pg_temp.cart_qty(current_setting('t.buyer'), 'CRT-2'), null, 'D3. an unlisted line is removed');
select is(jsonb_array_length(public.marketplace_cart_replace(jsonb_build_array(
  jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'CRT-1', 'qty', 3), current_setting('t.line3')::jsonb)) -> 'lines'), 1,
  'D4. a NEW line that is not on sale is dropped');
reset role;
-- the product is withdrawn from sale after it was put in the cart
set local session_replication_role = replica;
update public.marketplace_products set status = 'archived' where id = current_setting('t.p1')::uuid;
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select is(jsonb_array_length(public.marketplace_cart_get() -> 'lines'), 1, 'D5. a line that was withdrawn stays in the cart (the page marks it and blocks checkout)');
select is(jsonb_array_length(public.marketplace_cart_replace(jsonb_build_array(
  jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'CRT-1', 'qty', 5))) -> 'lines'), 1, 'D6. replace keeps it and takes the new quantity');
select is(pg_temp.cart_qty(current_setting('t.buyer'), 'CRT-1'), 5, 'D7. quantity updated');
select throws_like(format($$ select public.marketplace_cart_replace(jsonb_build_array(%L::jsonb, %L::jsonb)) $$,
  current_setting('t.line2'), current_setting('t.line2')), 'mp:duplicate_line%', 'D8. a duplicate line is refused');
select is(jsonb_array_length(public.marketplace_cart_replace('[]'::jsonb) -> 'lines'), 0, 'D9. the empty list empties the cart');
select throws_like($$ select public.marketplace_cart_replace('{}'::jsonb) $$, 'mp:invalid_lines%', 'D10. a non-array is refused');

-- ===========================================================================
-- E. Isolation, no price
-- ===========================================================================
select public.marketplace_cart_replace(jsonb_build_array(current_setting('t.line2')::jsonb));
select is((select array_agg(k order by k) from jsonb_object_keys((public.marketplace_cart_get() -> 'lines') -> 0) k), array['qty', 'sku', 'slug'],
  'E1. a cart line carries only slug, sku and quantity (never a price)');
select is((select count(*)::int from public.marketplace_cart_items), 1, 'E1b. the owner reads her own cart row directly (RLS owner-only SELECT)');
select pg_temp.as_user(current_setting('t.other'));
select is((select count(*)::int from public.marketplace_cart_items), 0, 'E2.another signed-in user cannot read the buyer''s cart rows');
select is(jsonb_array_length(public.marketplace_cart_get() -> 'lines'), 0, 'E3. nor through the RPC');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.marketplace_cart_get() $$, '42501', null, 'E4. anon cannot read a cart');
select throws_ok($$ select public.marketplace_cart_merge('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]'::jsonb) $$, '42501', null, 'E5. anon cannot merge');
select throws_ok($$ insert into public.marketplace_cart_items (user_id, variant_id, quantity) values (gen_random_uuid(), gen_random_uuid(), 1) $$,
  '42501', null, 'E6. anon cannot write the table');
reset role;
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select throws_ok($$ insert into public.marketplace_cart_items (user_id, variant_id, quantity)
  values ((select auth.uid()), (select id from public.marketplace_product_variants where sku = 'CRT-2'), 1) $$,
  '42501', null, 'E7. a signed-in buyer cannot write the table directly either');
reset role;

select * from finish();
rollback;
