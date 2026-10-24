-- pgTAP: Marketplace catalog foundation (ADR-0011) — the two discovery splits,
-- the closed-by-default seller model, and the anonymous read boundary.
--
-- What each section exists to make impossible:
--   A. A taxonomy that drifted from the approved one (3 categories, 6 types,
--      7 units, 5 finishing groups, one task per existing installer trade).
--   B/C. A seller that is not an eligible organization type, or an enrollment
--      path a client can call. NO ROW = CLOSED.
--   D. A product that can be published without a variant, in a unit its type
--      does not allow, with a negative price, or with stock that oversells.
--   E/F. Anonymous reads of anything but the fixed public projection: no exact
--      stock, no seller-owned base tables, nothing while browse is disabled.
--   G. A suspended seller's listings staying public.
--
-- Fixtures come from seed.sql / seed-pilot.sql: one showroom_dealer and one
-- supplier organization are looked up, never created here.
create extension if not exists pgtap;

begin;
select plan(47);

create temp table _mkt_fx as
select
  (select id from public.organizations where org_type = 'showroom_dealer' order by id limit 1) as showroom,
  (select id from public.organizations where org_type = 'supplier'        order by id limit 1) as supplier;
grant select on _mkt_fx to public;

-- ===========================================================================
-- A. Seeded taxonomy
-- ===========================================================================
select is((select count(*) from public.marketplace_categories), 3::bigint, 'three approved categories');
select is((select count(*) from public.marketplace_product_types), 6::bigint, 'six approved product types');
select is((select count(*) from public.marketplace_units), 7::bigint, 'seven units of sale');
select is((select count(*) from public.marketplace_finishing_groups), 5::bigint, 'five finishing groups');
select is((select count(*) from public.marketplace_finishing_tasks), 14::bigint, 'one finishing task per existing installer trade');
select is((select count(*) from public.marketplace_finishing_tasks where trade_id is null), 0::bigint,
  'every finishing task reuses an existing public.trades row');
select is((select count(*) from public.marketplace_finishing_task_product_types), 6::bigint,
  'only the explicitly approved task-to-type links are seeded');
select is(
  (select array_agg(pt.key order by pt.sort_order)
     from public.marketplace_product_types pt
     join public.marketplace_categories c on c.id = pt.category_id
    where c.key = 'wall_coverings'),
  array['wallpaper', 'wood_alternative', 'marble_alternative', 'sheeboard']::text[],
  'Wall Coverings holds the four wall product types in order');
select is((select browse_enabled from public.marketplace_settings), false, 'browse is closed by default');
select is((select array_agg(org_type::text) from public.marketplace_seller_eligible_org_types),
  array['showroom_dealer']::text[], 'V1 sellers: showroom_dealer only');
select is((select count(*) from public.marketplace_seller_accounts), 0::bigint, 'no seller exists until activated (closed by default)');

-- ===========================================================================
-- B. Fixtures
-- ===========================================================================
select isnt((select showroom from _mkt_fx), null::uuid, 'fixture: a showroom organization exists');
select isnt((select supplier from _mkt_fx), null::uuid, 'fixture: a supplier organization exists');

-- ===========================================================================
-- C. Seller enrollment
-- ===========================================================================
select throws_ok(
  $$insert into public.marketplace_seller_accounts (organization_id) select supplier from _mkt_fx$$,
  '23514', null, 'an organization type that is not eligible cannot be enrolled');
select lives_ok(
  $$select public.marketplace_ops_activate_seller((select showroom from _mkt_fx), 'pgTAP controlled activation')$$,
  'the controlled operation enrolls an eligible showroom');
select is((select status::text from public.marketplace_seller_accounts), 'approved', 'enrolled seller is approved');

-- ===========================================================================
-- D. Catalog integrity
-- ===========================================================================
select lives_ok(
  $$insert into public.marketplace_products (organization_id, product_type_id, slug, name_ar, name_en)
    select fx.showroom, pt.id, 'test-wallpaper-one', 'ورق حائط تجريبي', 'Test wallpaper'
      from _mkt_fx fx, public.marketplace_product_types pt where pt.key = 'wallpaper'$$,
  'a seller may create a draft product');
select throws_ok(
  $$update public.marketplace_products set status = 'published', published_at = now() where slug = 'test-wallpaper-one'$$,
  '23514', null, 'a product cannot be published without an active variant');
select throws_ok(
  $$insert into public.marketplace_variants (organization_id, product_id, sku, sale_unit_id, price_egp)
    select p.organization_id, p.id, 'TW-BAR', u.id, 100
      from public.marketplace_products p, public.marketplace_units u
     where p.slug = 'test-wallpaper-one' and u.key = 'bar'$$,
  '23514', null, 'a unit the product type does not allow is refused');
select lives_ok(
  $$insert into public.marketplace_variants (organization_id, product_id, sku, sale_unit_id, price_egp)
    select p.organization_id, p.id, 'TW-ROLL', u.id, 550
      from public.marketplace_products p, public.marketplace_units u
     where p.slug = 'test-wallpaper-one' and u.key = 'roll'$$,
  'a variant in an allowed unit is accepted');
select is(
  (select count(*) from public.marketplace_inventory i
     join public.marketplace_variants v on v.id = i.variant_id where v.sku = 'TW-ROLL'),
  1::bigint, 'creating a variant creates its zero stock row');
select throws_ok(
  $$insert into public.marketplace_variants (organization_id, product_id, sku, sale_unit_id, price_egp)
    select p.organization_id, p.id, 'TW-NEG', u.id, -1
      from public.marketplace_products p, public.marketplace_units u
     where p.slug = 'test-wallpaper-one' and u.key = 'roll'$$,
  '23514', null, 'a negative price is refused');
select throws_ok(
  $$insert into public.marketplace_variants (organization_id, product_id, sku, sale_unit_id, price_egp)
    select p.organization_id, p.id, 'TW-ROLL', u.id, 10
      from public.marketplace_products p, public.marketplace_units u
     where p.slug = 'test-wallpaper-one' and u.key = 'roll'$$,
  '23505', null, 'a SKU is unique per seller');
select throws_ok(
  $$update public.marketplace_inventory set reserved = 1
     where variant_id = (select id from public.marketplace_variants where sku = 'TW-ROLL')$$,
  '23514', null, 'reserved stock can never exceed on-hand stock (oversell backstop)');
select lives_ok(
  $$update public.marketplace_products set status = 'published', published_at = now() where slug = 'test-wallpaper-one'$$,
  'a product with an active variant can be published');

-- ===========================================================================
-- E. Public read RPCs (as the database owner: logic, not privileges)
-- ===========================================================================
select is((select count(*) from public.marketplace_public_products()), 0::bigint,
  'nothing is visible while browse is disabled');
select lives_ok($$update public.marketplace_settings set browse_enabled = true$$, 'open browse (release flag)');
select is((select count(*) from public.marketplace_public_products()), 1::bigint, 'the published product is listed');
select is((select availability from public.marketplace_public_products() limit 1), 'out_of_stock',
  'no stock => out_of_stock bucket');
select lives_ok(
  $$update public.marketplace_inventory set on_hand = 10
     where variant_id = (select id from public.marketplace_variants where sku = 'TW-ROLL')$$,
  'stock is received');
select is((select availability from public.marketplace_public_products() limit 1), 'in_stock', 'stock => in_stock bucket');
select is((select count(*) from public.marketplace_public_finishing_tasks()), 1::bigint,
  'only the finishing task that leads to a visible product is listed');
select is((select count(*) from public.marketplace_public_products(p_task_key => 'wallpaper_installation')), 1::bigint,
  'Split 2: the finishing task reaches the product through its product type');
select is((select count(*) from public.marketplace_public_products(p_task_key => 'foutek_installation')), 0::bigint,
  'Split 2: a task whose types have no visible product returns nothing');
select is((select product_count from public.marketplace_public_type_counts() where product_type_key = 'wallpaper'),
  1::integer, 'Split 1: per-type counts reflect visible products');
select is((public.marketplace_public_product_detail('test-wallpaper-one') ->> 'product_type_key'), 'wallpaper',
  'detail document resolves by slug');
select is(jsonb_exists((public.marketplace_public_product_detail('test-wallpaper-one') -> 'variants') -> 0, 'on_hand'),
  false, 'the public detail never exposes exact stock');

-- ===========================================================================
-- F. Anonymous boundary
-- ===========================================================================
set local role anon;
select is((select count(*) from public.marketplace_public_products()), 1::bigint, 'anon browses through the RPC');
select throws_ok($$select count(*) from public.marketplace_products$$, '42501', null,
  'anon cannot read the seller-owned products table');
select throws_ok($$select count(*) from public.marketplace_inventory$$, '42501', null,
  'anon cannot read stock');
select throws_ok($$select count(*) from public.marketplace_seller_accounts$$, '42501', null,
  'anon cannot read seller accounts');
select is((select count(*) from public.marketplace_categories), 3::bigint, 'anon may read the reference taxonomy');
select throws_ok($$select public.marketplace_ops_activate_seller(null::uuid)$$, '42501', null,
  'anon cannot run the controlled activation');
select isnt(public.marketplace_public_product_detail('test-wallpaper-one'), null::jsonb, 'anon reads the public detail');
reset role;

-- ===========================================================================
-- G. Suspension withdraws listings
-- ===========================================================================
select lives_ok($$update public.marketplace_seller_accounts set status = 'suspended'$$, 'suspend the seller');
select is((select count(*) from public.marketplace_public_products()), 0::bigint,
  'a suspended seller has no public listings');
select is(public.marketplace_public_product_detail('test-wallpaper-one'), null::jsonb,
  'a suspended seller has no public detail');

select * from finish();
rollback;
