-- pgTAP: Marketplace PR 7 - publication gate v2 and product form
-- (20261123130001_marketplace_publication_gate_v2.sql).
--
--   A. SWITCH       - admin open/close: permission, reason, audit with the acting admin, public reads follow it
--   B. WITHDRAWAL   - stock-out withdraws a product from the storefront; restock brings it back
--   C. NOTIFY       - low-stock and out-of-stock notifications to the showroom owner, once per crossing
--   D. SUSPENSION   - suspended seller: products unpublished at once; reinstatement does not republish
--   E. GATE         - payment method and delivery are publish conditions; the publication-state read
--   F. FORM         - changeable product type (category follows), per-product threshold, 5 image slots, list record
--   G. GUARDS       - every public function that shows published products carries the gates
--   H. NO RETRO     - payment/delivery are checked only when a product becomes published, never on a later save
--
-- Fixtures (seed-pilot): showroom B 91000005-...005 (owner 71000005), staff 55555555 (administrator).
create extension if not exists pgtap;

begin;
select plan(47);

update auth.users set email_confirmed_at = now()
  where id in ('71000005-0000-4000-8000-000000000005', '55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111');
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('t.p', 'c7000000-0000-4000-8000-000000000001', true);
select set_config('t.v', 'c7100000-0000-4000-8000-000000000001', true);
select set_config('t.l', 'c7200000-0000-4000-8000-000000000001', true);

-- the second admin: Super Admin (the platform switch is Super Admin only)
insert into public.admin_role_assignments (user_id, role_id, scope_type, assigned_by)
select '11111111-1111-4111-8111-111111111111', r.id, 'platform', '55555555-5555-4555-8555-555555555555'
from public.admin_roles r where r.key = 'super_admin';

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at) values (current_setting('t.b')::uuid, 'approved', now());
select set_config('app.marketplace_seller_write', 'off', true);

-- a published product with everything the public needs (inserted with triggers off: the publication guard is tested elsewhere)
set session_replication_role = replica;
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en, status, published_at, low_stock_threshold)
select current_setting('t.p')::uuid, current_setting('t.b')::uuid, t.id, 'gate-v2-wallpaper', 'ورق حائط تجريبي', 'Gate V2 wallpaper', 'published', now(), 5
from public.marketplace_product_types t where t.key = 'wallpaper';
set session_replication_role = origin;
insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values (current_setting('t.v')::uuid, current_setting('t.p')::uuid, current_setting('t.b')::uuid, 'GV2-1', 'roll', 100);
insert into public.marketplace_stock_locations (id, organization_id, key, name_ar, name_en)
values (current_setting('t.l')::uuid, current_setting('t.b')::uuid, 'gv2_main', 'مخزن', 'main');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'initial', 20, 'gv2-initial-000001', 'opening balance', 'manual');
insert into public.marketplace_product_images (product_id, object_key, sort_order, is_primary, status)
values (current_setting('t.p')::uuid, 'orgs/b/products/gv2/main.webp', 0, true, 'verified');

-- ===========================================================================
-- A. Switch
-- ===========================================================================
select is(app.marketplace_is_open(), true, 'A1. the Marketplace is open by default');
select is((select count(*)::int from public.admin_role_permissions p join public.admin_roles r on r.id = p.role_id
           where p.permission_key = 'marketplace_platform.manage'), 1, 'A2. the switch permission belongs to one role only');
select is((select r.key from public.admin_role_permissions p join public.admin_roles r on r.id = p.role_id
           where p.permission_key = 'marketplace_platform.manage'), 'super_admin', 'A3. ...Super Admin');

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_like($$ select public.admin_marketplace_set_open(false, 'maintenance window') $$, 'mp:not_permitted%',
  'A4. an Administrator cannot close the Marketplace');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_like($$ select public.admin_marketplace_set_open(false, 'x') $$, 'mp:reason_required%', 'A5. closing needs a reason');
select is(public.admin_marketplace_set_open(false, 'maintenance window'), false, 'A6. Super Admin closes the Marketplace');
reset role;

select is((select count(*)::int from public.marketplace_platform_events where action = 'marketplace_closed'
           and actor_user_id = '11111111-1111-4111-8111-111111111111' and detail ->> 'reason' = 'maintenance window'), 1,
  'A7. the change is audited with the acting admin and the reason');
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'gate-v2-wallpaper'), 0, 'A8. closed: the public catalogue is empty');
select is(public.marketplace_public_product('gate-v2-wallpaper') is null, true, 'A9. ...and the product page answers nothing');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((public.admin_marketplace_platform_status() ->> 'open')::boolean, false, 'A10. the status read reports closed');
select is(public.admin_marketplace_platform_status() -> 'last_change' ->> 'actor_user_id', '11111111-1111-4111-8111-111111111111',
  'A11. ...and who closed it');
select is(public.admin_marketplace_set_open(true, 'maintenance done'), true, 'A12. Super Admin reopens it');
reset role;
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'gate-v2-wallpaper'), 1, 'A13. open again: the product is public');
reset role;
set local role authenticated;
select throws_ok($$ insert into public.marketplace_platform_events (action) values ('marketplace_closed') $$, '42501', null,
  'A14. the audit trail has no client write path (RLS, no grant)');
reset role;

-- ===========================================================================
-- B + C. Stock-out withdrawal and the owner's notifications (stock moves by the system, so nobody is the actor)
-- ===========================================================================
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'correction', -16, 'gv2-low-0000000001', 'sold', 'manual');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.stock.low'
           and subject_id = current_setting('t.p')::uuid and recipient_user_id = '71000005-0000-4000-8000-000000000005'), 1,
  'C1. crossing the threshold (20 -> 4, threshold 5) notifies the owner once');
select is((select content -> 'ar' ->> 'title' from public.notifications where event_type = 'marketplace.stock.low' and subject_id = current_setting('t.p')::uuid limit 1),
  'المخزون على وشك النفاد', 'C2. the notification carries the rendered Arabic text');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'correction', -1, 'gv2-low-0000000002', 'sold', 'manual');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.stock.low' and subject_id = current_setting('t.p')::uuid), 1,
  'C3. staying below the threshold does not notify again');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'correction', -3, 'gv2-out-0000000001', 'sold', 'manual');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.stock.out' and subject_id = current_setting('t.p')::uuid), 1,
  'C4. running out notifies the owner');
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'gate-v2-wallpaper'), 0,
  'B1. out of stock: the product is withdrawn from the storefront (not listed as sold out)');
select is(public.marketplace_public_product('gate-v2-wallpaper') is null, true, 'B2. ...and from its page');
reset role;
select is((select status from public.marketplace_products where id = current_setting('t.p')::uuid), 'published', 'B3. withdrawal is computed: the product stays published');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'replenish', 10, 'gv2-back-00000001', 'restock', 'manual');
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'gate-v2-wallpaper'), 1, 'B4. restocking brings it back with no manual step');
reset role;

-- recipients are active members holding org.manage ONLY: a former creator with no membership is not notified
update public.organizations set created_by = '70000009-0000-4000-8000-000000000009' where id = current_setting('t.b')::uuid;
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'replenish', 20, 'gv2-again-0000001', 'restock', 'manual');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'correction', -30, 'gv2-again-0000002', 'sold', 'manual');
select is((select count(*)::int from public.notifications where recipient_user_id = '70000009-0000-4000-8000-000000000009'
           and event_type like 'marketplace.stock.%'), 0, 'C5. a former creator without an active membership is not notified');
select is((select count(*)::int from public.notifications n where n.event_type like 'marketplace.stock.%' and n.subject_id = current_setting('t.p')::uuid
           and not exists (select 1 from public.memberships m join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
                           where m.user_id = n.recipient_user_id and m.organization_id = current_setting('t.b')::uuid and m.status = 'active')), 0,
  'C6. every stock notification went to an active member holding org.manage');
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'gate-v2-wallpaper'), 0, 'B5. out of stock again: withdrawn');
reset role;
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'replenish', 10, 'gv2-again-0000003', 'restock', 'manual');

-- ===========================================================================
-- D. Suspension
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_suspend(current_setting('t.b')::uuid, 'review');
reset role;
select is((select status from public.marketplace_products where id = current_setting('t.p')::uuid), 'unpublished',
  'D1. suspending the seller unpublishes its products at once');
select is((select count(*)::int from public.marketplace_product_status_events where product_id = current_setting('t.p')::uuid and action = 'unpublished'), 1,
  'D2. ...and records it in the product trail');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_reinstate(current_setting('t.b')::uuid, 'review closed');
reset role;
select is((select status from public.marketplace_products where id = current_setting('t.p')::uuid), 'unpublished',
  'D3. reinstatement does not republish: the seller republishes manually');

-- ===========================================================================
-- E. Gate
-- ===========================================================================
select ok('seller_no_payment_method' = any(app.marketplace_publication_blockers(current_setting('t.p')::uuid)),
  'E1. no payment method enabled blocks publication');
select ok('seller_no_delivery' = any(app.marketplace_publication_blockers(current_setting('t.p')::uuid)),
  'E2. no delivery place or pickup blocks publication');
insert into public.marketplace_seller_payment_settings (seller_organization_id, cod_enabled) values (current_setting('t.b')::uuid, true);
insert into public.marketplace_delivery_rates (seller_organization_id, governorate_key, fee_egp, duration_min_days, duration_max_days) values (current_setting('t.b')::uuid, 'cairo', 50, 1, 2);
insert into public.marketplace_seller_delivery_settings (seller_organization_id, preparation_days) values (current_setting('t.b')::uuid, 1);
select ok(not ('seller_no_payment_method' = any(app.marketplace_publication_blockers(current_setting('t.p')::uuid)))
      and not ('seller_no_delivery' = any(app.marketplace_publication_blockers(current_setting('t.p')::uuid))),
  'E3. a cash-on-delivery method and a priced delivery place satisfy both');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select ok(public.marketplace_seller_product_publication_state(current_setting('t.p')::uuid) ->> 'review_state' = 'approved'
      and (public.marketplace_seller_product_publication_state(current_setting('t.p')::uuid) ->> 'payment_ready')::boolean,
  'E4. the publication state reports the review record and the store setup');
reset role;
set local role anon;
select throws_ok($$ select public.marketplace_seller_product_publication_state(current_setting('t.p')::uuid) $$, '42501', null,
  'E5. anon cannot read the publication state');
reset role;

-- ===========================================================================
-- F. Form
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select set_config('t.other', (select key from public.marketplace_product_types where is_active and key <> 'wallpaper' order by sort_order limit 1), true);
select is((public.marketplace_seller_product_save(jsonb_build_object('id', current_setting('t.p'), 'product_type_key', current_setting('t.other'),
  'name_ar', 'ورق', 'name_en', 'Changed type', 'low_stock_threshold', 8)) ->> 'id'), current_setting('t.p'),
  'F1. the product type can be changed on an existing product');
select is(public.marketplace_seller_product_get(current_setting('t.p')::uuid) ->> 'product_type_key', current_setting('t.other'),
  'F2. ...and the product reports the new type');
select is(public.marketplace_seller_product_get(current_setting('t.p')::uuid) ->> 'category_key',
  (select c.key from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id where t.key = current_setting('t.other')),
  'F3. the category follows the type');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object('id', current_setting('t.p'),
  'name_ar', 'س', 'name_en', 's', 'low_stock_threshold', 'abc')) $$, 'mp:low_stock_invalid%', 'F4. an invalid threshold is refused');
select is((public.marketplace_seller_products_page(current_setting('t.b')::uuid) -> 'items' -> 0 ->> 'low_stock_threshold')::int, 8,
  'F5. the per-product threshold is saved and listed');
select is(public.marketplace_seller_products_page(current_setting('t.b')::uuid) -> 'items' -> 0 ->> 'review_state', 'approved',
  'F6. the list carries the review record beside the price');
reset role;
select throws_like($$ update public.marketplace_products set product_type_id = (select id from public.marketplace_product_types where key = 'wallpaper')
  where id = current_setting('t.p')::uuid $$, '%changes only through the seller save%', 'F7. a direct type write is still refused');

-- 5 live image slots
insert into public.marketplace_product_images (product_id, object_key, sort_order, is_primary, status)
select current_setting('t.p')::uuid, 'orgs/b/products/gv2/extra-' || g || '.webp', g, false, 'pending' from generate_series(1, 4) g;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') $$, 'mp:too_many_images%',
  'F8. a product holds at most 5 live images');
reset role;

-- ===========================================================================
-- G. Guards
-- ===========================================================================
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
           and p.prosrc like '%p.status = ''published''%' and p.prosrc like '%marketplace_seller_is_enabled(%'), 0,
  'G1. no public function shows published products while checking only seller enablement (the open switch is always consulted)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('marketplace_public_catalog', 'marketplace_public_catalog_page', 'marketplace_public_facets', 'marketplace_public_product')
           and p.prosrc like '%marketplace_product_is_listed(%'), 4,
  'G2. the four listing surfaces withdraw products with nothing to sell');
select is((select count(*)::int from pg_proc p where p.proname in ('admin_marketplace_set_open', 'admin_marketplace_platform_status',
  'marketplace_seller_product_publication_state') and p.pronamespace = 'public'::regnamespace and not has_function_privilege('anon', p.oid, 'execute')
  and has_function_privilege('authenticated', p.oid, 'execute')), 3, 'G3. the new RPCs are executable by authenticated only');

-- ===========================================================================
-- H. A published product is not unpublished for the seller's setup
-- ===========================================================================
-- a published product is never unpublished for lacking payment/delivery (owner decision 2026-11-23): not on save either.
-- The fixture product has other (unrelated) blockers, so the blocker list is stubbed for this check (rolled back with the test).
select set_config('t.ev', (select count(*)::text from public.marketplace_product_status_events where product_id = current_setting('t.p')::uuid and action = 'unpublished'), true);
create or replace function app.marketplace_publication_blockers(p_product_id uuid) returns text[]
language sql stable set search_path = '' as $f$ select array['seller_no_payment_method', 'seller_no_delivery']::text[] $f$;
set session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now() where id = current_setting('t.p')::uuid;
set session_replication_role = origin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select is((public.marketplace_seller_product_save(jsonb_build_object('id', current_setting('t.p'), 'name_ar', 'ورق حائط تجريبي', 'name_en', 'Gate V2 wallpaper')) ->> 'status'),
  'published', 'H1. saving a published product of a seller with no payment method and no delivery keeps it published');
reset role;
select is((select count(*)::int from public.marketplace_product_status_events where product_id = current_setting('t.p')::uuid and action = 'unpublished'), current_setting('t.ev')::int,
  'H2. ...and records no unpublish');
create or replace function app.marketplace_publication_blockers(p_product_id uuid) returns text[]
language sql stable set search_path = '' as $f$ select array['seller_no_payment_method', 'no_active_variant']::text[] $f$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select is((public.marketplace_seller_product_save(jsonb_build_object('id', current_setting('t.p'), 'name_ar', 'ورق حائط تجريبي', 'name_en', 'Gate V2 wallpaper')) ->> 'status'),
  'unpublished', 'H3. any other blocker still unpublishes a published product on save');
reset role;

select * from finish();
rollback;
