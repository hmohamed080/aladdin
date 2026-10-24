-- pgTAP: Marketplace Migration 04 — seller enablement, publication, safe public catalog
-- (20261013090003_marketplace_seller_enablement_and_catalog.sql).
--
-- Sections, and the failure each one exists to prevent:
--   A. SHAPE         — RLS on, no client writes, anon holds nothing on tables, only the
--                      two public-read functions executable by anon, new permissions seeded.
--   B. ELIGIBILITY   — approval needs an ACTIVE, live Showroom; no auto-approval; no duplicates.
--   C. LIFECYCLE     — approve / suspend / reinstate / revoke rules, reasons, event history.
--   D. AUTHORISATION — only marketplace_sellers.manage can transition; read-only staff, support,
--                      sellers and anonymous callers cannot; direct writes are impossible.
--   E. BLOCKERS      — every publication condition is evaluated live and fails closed.
--   F. PUBLISH       — trusted publish / unpublish RPC: membership, ownership, blockers, audit.
--   G. PUBLIC READ   — only published + enabled + eligible; fixed projection; no leaks.
--   H. SELLER VIEW   — members see only the safe columns of their own account.
--   I. RESERVATION   — a suspended seller cannot take new reservations.
--   J. ISOLATION     — new tables reference only organizations / marketplace_*.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (member 70000001), showroom B 91000005-…005
-- (member 71000005), supplier aaaaaaaa-…, staff 55555555 (administrator), 11111111
-- (moderator, granted HERE), 70000009 (support, granted HERE).
create extension if not exists pgtap;

begin;
select plan(119);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '71000005-0000-4000-8000-000000000005',
               '70000009-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111',
               '55555555-5555-4555-8555-555555555555');

select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('t.sup', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

-- staff fixtures: a read-only moderator and a support agent
insert into public.admin_role_assignments (user_id, role_id, scope_type, assigned_by)
select '11111111-1111-4111-8111-111111111111', r.id, 'platform', '55555555-5555-4555-8555-555555555555'
from public.admin_roles r where r.key = 'moderator';
insert into public.admin_role_assignments (user_id, role_id, scope_type, assigned_by)
select '70000009-0000-4000-8000-000000000009', r.id, 'platform', '55555555-5555-4555-8555-555555555555'
from public.admin_roles r where r.key = 'support';

-- two products, one per showroom; A's is fully populated below
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en, brand)
select v.id::uuid, v.org::uuid, t.id, v.slug, 'ورق حائط', v.slug, 'TestBrand'
from (values
  ('a3000000-0000-4000-8000-000000000001', current_setting('t.a'), 'wallpaper', 'sel-wallpaper-a'),
  ('a3000000-0000-4000-8000-000000000002', current_setting('t.a'), 'wallpaper', 'sel-wallpaper-a-empty'),
  ('b3000000-0000-4000-8000-000000000001', current_setting('t.b'), 'wallpaper', 'sel-wallpaper-b')
) as v(id, org, type_key, slug)
join public.marketplace_product_types t on t.key = v.type_key;

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and c.relname in ('marketplace_seller_accounts', 'marketplace_seller_account_events',
                       'marketplace_product_status_events', 'marketplace_platform_settings')),
  4, 'A1. RLS is enabled on all four new tables');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
     and privilege_type <> 'SELECT'
     and table_name in ('marketplace_seller_accounts', 'marketplace_seller_account_events',
                        'marketplace_product_status_events', 'marketplace_platform_settings')),
  0, 'A2. no client role holds a write privilege on any new table');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and table_name in ('marketplace_seller_accounts', 'marketplace_seller_account_events',
                        'marketplace_product_status_events', 'marketplace_platform_settings')),
  0, 'A3. anon holds nothing on the new tables');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and cmd <> 'SELECT'
     and tablename in ('marketplace_seller_accounts', 'marketplace_seller_account_events',
                       'marketplace_product_status_events', 'marketplace_platform_settings')),
  0, 'A4. there is no insert / update / delete policy on any new table');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '%marketplace%' and has_function_privilege('anon', p.oid, 'execute')),
  array['marketplace_public_cart', 'marketplace_public_catalog', 'marketplace_public_catalog_page', 'marketplace_public_facets', 'marketplace_public_product'],
  'A5. anon can execute exactly the public-read functions (catalog, page, facets, product — and the cart read from Migration 12)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
          unnest(array['anon', 'authenticated', 'service_role']) r
   where n.nspname = 'app' and p.proname like 'marketplace\_%' and has_function_privilege(r, p.oid, 'execute')
     -- storage-policy predicates (Migration 06) must be callable by the querying role
     and p.proname not in ('marketplace_storage_can_delete_image', 'marketplace_storage_can_upload_image', 'marketplace_storage_can_upload_import',
                        'marketplace_storage_moderator_can_read', 'marketplace_storage_owns_image')),
  0, 'A6. NO client role can execute any app.marketplace_* function (hardening, incl. the new helpers)');
select is(
  (select count(*)::int from public.admin_permissions where key in ('marketplace_sellers.read', 'marketplace_sellers.manage')),
  2, 'A7. both new permissions exist in the catalogue');
select is(
  (select array_agg(r.key order by r.key) from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
   where rp.permission_key = 'marketplace_sellers.manage'),
  array['administrator', 'super_admin'], 'A8. manage is held by Super Admin and Administrator only');
select is(
  (select array_agg(r.key order by r.key) from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
   where rp.permission_key = 'marketplace_sellers.read'),
  array['administrator', 'moderator', 'super_admin'], 'A9. read adds Moderator; Support has neither');
select is((select count(*)::int from public.marketplace_seller_accounts), 0,
  'A10. nobody is approved by default (the migration seeds no seller)');
select is((select media_verification_ready from public.marketplace_platform_settings), false,
  'A11. media verification is OFF by default (publication closed)');
select is(
  (select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('admin_marketplace_seller_approve', 'admin_marketplace_seller_suspend',
     'admin_marketplace_seller_revoke', 'admin_marketplace_seller_reinstate', 'marketplace_product_publish',
     'marketplace_product_unpublish', 'marketplace_public_catalog', 'marketplace_public_product')
     and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')),
  true, 'A12. every new RPC is SECURITY DEFINER with an empty search_path');

-- ===========================================================================
-- B. Eligibility (the admin acts as 55555555, an Administrator)
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select throws_ok($$ select public.admin_marketplace_seller_approve('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'supplier is not a showroom') $$,
  '23514', null, 'B1. a non-showroom organization (supplier) cannot be approved');
select throws_ok($$ select public.admin_marketplace_seller_approve('00000000-0000-4000-8000-0000000000ff', 'unknown organization') $$,
  '23503', null, 'B2. an unknown organization cannot be approved');
select throws_ok($$ select public.admin_marketplace_seller_approve('9c000000-cccc-4ccc-8ccc-000000000001', '') $$,
  '22023', null, 'B3. a reason is mandatory');
select is((select count(*)::int from public.admin_marketplace_sellers()), 0,
  'B4. refused approvals left no account behind');

reset role;
-- an inactive and a soft-deleted showroom (fixture-level change, in this transaction only)
update public.organizations set status = 'suspended' where id = current_setting('t.b')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok($$ select public.admin_marketplace_seller_approve('91000005-1111-4111-8111-000000000005', 'org is suspended') $$,
  '23514', null, 'B5. a suspended (inactive) showroom cannot be approved');
reset role;
update public.organizations set status = 'active', deleted_at = now() where id = current_setting('t.b')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok($$ select public.admin_marketplace_seller_approve('91000005-1111-4111-8111-000000000005', 'org is soft deleted') $$,
  '23514', null, 'B6. a soft-deleted showroom cannot be approved');
reset role;
update public.organizations set deleted_at = null where id = current_setting('t.b')::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(public.admin_marketplace_seller_approve('9c000000-cccc-4ccc-8ccc-000000000001', 'verified showroom, documents checked'),
  'approved', 'B7. an active showroom is approved by an Administrator');
select throws_ok($$ select public.admin_marketplace_seller_approve('9c000000-cccc-4ccc-8ccc-000000000001', 'second approval') $$,
  '23514', null, 'B8. approving an already-approved seller is refused (no duplicate)');
select is((select count(*)::int from public.admin_marketplace_sellers() where organization_id = current_setting('t.a')::uuid), 1,
  'B9. exactly one account row exists for the organization');
reset role;
select set_config('app.marketplace_seller_write', 'on', true);
select throws_ok($$ insert into public.marketplace_seller_accounts (organization_id, status, approved_at) values ('9c000000-cccc-4ccc-8ccc-000000000001', 'approved', now()) $$,
  '23505', null, 'B10. the primary key itself forbids a second row for the organization');
select set_config('app.marketplace_seller_write', 'off', true);
select throws_ok($$ insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
                    values ('91000005-1111-4111-8111-000000000005', 'approved', now()) $$,
  '42501', null, 'B11. even the table owner cannot insert outside the transition function (guard trigger)');

-- ===========================================================================
-- C. Lifecycle and history
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(public.admin_marketplace_seller_suspend('9c000000-cccc-4ccc-8ccc-000000000001', 'complaint under review'),
  'suspended', 'C1. an approved seller can be suspended');
select throws_ok($$ select public.admin_marketplace_seller_suspend('9c000000-cccc-4ccc-8ccc-000000000001', 'again') $$,
  '23514', null, 'C2. only an approved seller can be suspended');
select is(public.admin_marketplace_seller_reinstate('9c000000-cccc-4ccc-8ccc-000000000001', 'complaint resolved'),
  'approved', 'C3. a suspended seller can be reinstated');
select throws_ok($$ select public.admin_marketplace_seller_reinstate('9c000000-cccc-4ccc-8ccc-000000000001', 'not suspended') $$,
  '23514', null, 'C4. only a suspended seller can be reinstated');
select is(public.admin_marketplace_seller_suspend('9c000000-cccc-4ccc-8ccc-000000000001', 'second review'),
  'suspended', 'C5. suspend again');
reset role;
-- the organization stops being an eligible showroom while the seller is suspended
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok($$ select public.admin_marketplace_seller_reinstate('9c000000-cccc-4ccc-8ccc-000000000001', 'org no longer active') $$,
  '23514', null, 'C6. reinstating RE-VALIDATES eligibility (the old approval is not trusted)');
reset role;
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(public.admin_marketplace_seller_reinstate('9c000000-cccc-4ccc-8ccc-000000000001', 'org active again'),
  'approved', 'C7. reinstated once the organization is eligible again');
select is(public.admin_marketplace_seller_revoke('9c000000-cccc-4ccc-8ccc-000000000001', 'policy violation'),
  'revoked', 'C8. an approved seller can be revoked');
select throws_ok($$ select public.admin_marketplace_seller_reinstate('9c000000-cccc-4ccc-8ccc-000000000001', 'try to undo') $$,
  '23514', null, 'C9. a revoked seller cannot be reinstated (terminal in V1)');
select throws_ok($$ select public.admin_marketplace_seller_approve('9c000000-cccc-4ccc-8ccc-000000000001', 'try to re-approve') $$,
  '23514', null, 'C10. ...nor re-approved');
select throws_ok($$ select public.admin_marketplace_seller_revoke('9c000000-cccc-4ccc-8ccc-000000000001', 'already revoked') $$,
  '23514', null, 'C11. ...nor revoked twice');
select is((select array_agg(action order by sequence) from public.admin_marketplace_seller_history('9c000000-cccc-4ccc-8ccc-000000000001')),
  array['approved', 'suspended', 'reinstated', 'suspended', 'reinstated', 'revoked'],
  'C12. the history holds every transition, in order, and nothing for refused attempts');
select is((select count(*)::int from public.admin_marketplace_seller_history('9c000000-cccc-4ccc-8ccc-000000000001')
           where actor_user_id = '55555555-5555-4555-8555-555555555555'
             and org_type_at_event = 'showroom_dealer' and org_status_at_event is not null and char_length(reason) >= 3), 6,
  'C13. each event records actor, reason and the organization''s type / status at the time');
reset role;
select throws_ok($$ update public.marketplace_seller_account_events set reason = 'tampered' $$,
  '23514', null, 'C14. the history cannot be edited');
select throws_ok($$ delete from public.marketplace_seller_account_events $$,
  '23514', null, 'C15. ...or deleted');
select throws_ok($$ update public.marketplace_seller_accounts set status = 'approved' where organization_id = '9c000000-cccc-4ccc-8ccc-000000000001' $$,
  '42501', null, 'C16. a revoked account cannot be flipped back by a direct UPDATE');

-- ===========================================================================
-- D. Authorisation
-- ===========================================================================
-- a fresh pending-capable target: showroom B (active again)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$ select public.admin_marketplace_seller_approve('91000005-1111-4111-8111-000000000005', 'moderator tries') $$,
  '42501', null, 'D1. a Moderator (read-only on sellers) cannot approve');
select is((select count(*)::int from public.admin_marketplace_sellers()), 1,
  'D2. ...but can read the seller list');
select is((select count(*)::int from public.admin_marketplace_seller_history('9c000000-cccc-4ccc-8ccc-000000000001')), 6,
  'D3. ...and the history');
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_ok($$ select public.admin_marketplace_seller_approve('91000005-1111-4111-8111-000000000005', 'support tries') $$,
  '42501', null, 'D4. Support cannot approve');
select throws_ok($$ select * from public.admin_marketplace_sellers() $$,
  '42501', null, 'D5. Support cannot even list sellers');
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ select public.admin_marketplace_seller_approve('91000005-1111-4111-8111-000000000005', 'self approval') $$,
  '42501', null, 'D6. a showroom owner cannot approve their OWN organization');
reset role;
set local role anon;
select throws_ok($$ select public.admin_marketplace_seller_approve('91000005-1111-4111-8111-000000000005', 'anon') $$,
  '42501', null, 'D7. anon cannot call the admin RPCs');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok($$ insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
                    values ('91000005-1111-4111-8111-000000000005', 'approved', now()) $$,
  '42501', null, 'D8. even an Administrator cannot write the table directly (no grant)');
reset role;

-- ===========================================================================
-- E. Publication blockers  (A is revoked here; approve B for the positive path)
-- ===========================================================================
select ok('seller_not_approved' = any(app.marketplace_publication_blockers('a3000000-0000-4000-8000-000000000001')),
  'E1. a revoked seller''s product reports seller_not_approved');
select ok('seller_not_approved' = any(app.marketplace_publication_blockers('b3000000-0000-4000-8000-000000000001')),
  'E2. a never-approved seller''s product reports seller_not_approved');
select ok(not ('seller_organization_not_eligible' = any(app.marketplace_publication_blockers('b3000000-0000-4000-8000-000000000001'))),
  'E3. ...but a live showroom is eligible (eligibility and approval are separate)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_approve('91000005-1111-4111-8111-000000000005', 'verified showroom B');
reset role;

-- fully populate B's product: attributes, an active variant, price, stock, verified primary image
insert into public.marketplace_product_attribute_values (product_id, attribute_id, option_id)
select 'b3000000-0000-4000-8000-000000000001', d.id, o.id
from public.marketplace_attribute_definitions d
join public.marketplace_attribute_options o on o.attribute_id = d.id
where d.key = 'material_wallpaper' order by o.sort_order limit 1;

insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values ('b3100000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', current_setting('t.b')::uuid, 'SEL-B1', 'roll', 480.00);

insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, option_id)
select 'b3100000-0000-4000-8000-000000000001', d.id, o.id
from public.marketplace_attribute_definitions d
join public.marketplace_attribute_options o on o.attribute_id = d.id
where d.key = 'color' order by o.sort_order limit 1;
insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, value_number)
select 'b3100000-0000-4000-8000-000000000001', id, 1000 from public.marketplace_attribute_definitions where key = 'roll_length';
insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, value_number)
select 'b3100000-0000-4000-8000-000000000001', id, 53 from public.marketplace_attribute_definitions where key = 'roll_width';

select ok(
  (select 'no_available_stock' = any(b) and 'no_verified_primary_image' = any(b) and 'media_verification_not_available' = any(b)
          and not ('seller_not_approved' = any(b)) and not ('seller_organization_not_eligible' = any(b))
          and not (exists (select 1 from unnest(b) x where x like 'missing\_%'))
   from (select app.marketplace_publication_blockers('b3000000-0000-4000-8000-000000000001') b) q),
  'E4. an approved seller with complete fields still lacks stock, a verified image and the media flag');

-- stock + verified primary image
insert into public.marketplace_stock_locations (id, organization_id, key, name_ar, name_en)
values ('b3200000-0000-4000-8000-000000000001', current_setting('t.b')::uuid, 'sel_main', 'مخزن', 'main');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, 'b3100000-0000-4000-8000-000000000001',
  'b3200000-0000-4000-8000-000000000001', 'initial', 20, 'sel-b-initial-0001', 'opening balance', 'manual');
insert into public.marketplace_product_images (id, product_id, storage_provider, storage_bucket, object_key, sort_order, is_primary, status)
values ('b3f00000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'supabase_storage',
        'marketplace-products', 'orgs/b/products/b1/main.webp', 0, true, 'verified');

select is(app.marketplace_publication_blockers('b3000000-0000-4000-8000-000000000001'),
  array['media_verification_not_available'],
  'E5. with everything else valid, the ONLY remaining blocker is the media-verification flag (fail closed)');
update public.marketplace_platform_settings set media_verification_ready = true;
select is(cardinality(app.marketplace_publication_blockers('b3000000-0000-4000-8000-000000000001')), 0,
  'E6. once media verification is declared ready and all else is valid, nothing blocks publication');
select ok('missing_product_attribute:material_wallpaper' = any(app.marketplace_publication_blockers('a3000000-0000-4000-8000-000000000002')),
  'E7. a product without its required fields still reports them');
update public.marketplace_product_images set status = 'pending' where id = 'b3f00000-0000-4000-8000-000000000001';
select ok('no_verified_primary_image' = any(app.marketplace_publication_blockers('b3000000-0000-4000-8000-000000000001')),
  'E8. an unverified image does not satisfy the primary-image rule');
update public.marketplace_product_images set status = 'verified' where id = 'b3f00000-0000-4000-8000-000000000001';

-- ===========================================================================
-- F. Publish / unpublish RPC
-- ===========================================================================
update public.marketplace_platform_settings set media_verification_ready = false;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ select public.marketplace_product_publish('b3000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'F1. publication is refused while the media-verification flag is off');
reset role;
update public.marketplace_platform_settings set media_verification_ready = true;

set local role anon;
select throws_ok($$ select public.marketplace_product_publish('b3000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'F2. anon cannot publish');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_ok($$ select public.marketplace_product_publish('b3000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'F3. a user outside the seller organization cannot publish');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.marketplace_product_publish('b3000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'F4. a member of ANOTHER showroom cannot publish this product (cross-tenant)');
select throws_ok($$ select public.marketplace_product_publish('00000000-0000-4000-8000-0000000000ee') $$,
  '42501', null, 'F5. an unknown product gives the same refusal as a foreign one');
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select is(public.marketplace_product_publish('b3000000-0000-4000-8000-000000000001'), 'published',
  'F6. the owning showroom member publishes a valid product');
select is(public.marketplace_product_publish('b3000000-0000-4000-8000-000000000001'), 'published',
  'F7. publishing again is idempotent');
reset role;
select is((select count(*)::int from public.marketplace_product_status_events
           where product_id = 'b3000000-0000-4000-8000-000000000001' and action = 'published'
             and actor_user_id = '71000005-0000-4000-8000-000000000005'), 1,
  'F8. exactly one audited publish event, with the actor');
select ok((select published_at is not null from public.marketplace_products where id = 'b3000000-0000-4000-8000-000000000001'),
  'F9. published_at is set by the trusted path');
select throws_ok($$ update public.marketplace_product_status_events set action = 'archived' $$,
  '23514', null, 'F10. product status history is append-only');

-- ===========================================================================
-- G. Public read
-- ===========================================================================
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'sel-wallpaper-b'), 1,
  'G1. anonymous visitors see the published product');
select is((select count(*)::int from public.marketplace_public_catalog() where slug in ('sel-wallpaper-a', 'sel-wallpaper-a-empty')), 0,
  'G2. draft products and a revoked seller''s products are not listed');
select is(public.marketplace_public_product('sel-wallpaper-a') is null, true,
  'G3. a non-published product has no public detail');
select throws_ok($$ select count(*) from public.marketplace_products $$, '42501', null,
  'G4. anon cannot read the base product table');
select throws_ok($$ select count(*) from public.marketplace_inventory_levels $$, '42501', null,
  'G5. ...nor stock');
select throws_ok($$ select count(*) from public.marketplace_seller_accounts $$, '42501', null,
  'G6. ...nor seller accounts');
reset role;
select is(
  (select p.proargnames[5:] from pg_proc p where p.proname = 'marketplace_public_catalog'),
  array['slug', 'name_ar', 'name_en', 'description_ar', 'description_en', 'brand', 'product_type_key', 'category_key',
        'from_price_egp', 'in_stock', 'primary_image_id', 'published_at'],
  'G7. the catalogue projection is exactly the approved column list');
set local role anon;
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.marketplace_public_product('sel-wallpaper-b')) k),
  -- Migration 09 added the public seller and taxonomy names and the cover image id (still no keys, stock or admin data)
  array['attributes', 'brand', 'category_key', 'category_name_ar', 'category_name_en', 'cover_image_id',
        'description_ar', 'description_en', 'images', 'name_ar', 'name_en', 'product_type_key',
        'product_type_name_ar', 'product_type_name_en', 'published_at', 'seller_name', 'slug', 'variants'],
  'G8. the detail document has exactly the approved top-level keys');
select ok(
  (select position('object_key' in t) = 0 and position('storage_bucket' in t) = 0 and position('seller_organization_id' in t) = 0
          and position('on_hand' in t) = 0 and position('reserved' in t) = 0 and position('approved_by' in t) = 0
          and position('orgs/b/' in t) = 0
   from (select public.marketplace_public_product('sel-wallpaper-b')::text t) q),
  'G9. the document carries no storage key, bucket, seller identity, stock or admin field');
select is((select (public.marketplace_public_product('sel-wallpaper-b')->'variants'->0->>'price_egp')::numeric),
  480.00, 'G10. the price is the stored tax-exclusive value, untouched');
select is((select (public.marketplace_public_product('sel-wallpaper-b')->'variants'->0->>'purchasable')::boolean), true,
  'G11. a variant with stock is purchasable');
select is((select primary_image_id from public.marketplace_public_catalog() where slug = 'sel-wallpaper-b'),
  'b3f00000-0000-4000-8000-000000000001'::uuid, 'G12. with media verification ready the primary image ID is exposed (an ID, not a key)');
reset role;
update public.marketplace_platform_settings set media_verification_ready = false;
set local role anon;
select is((select primary_image_id from public.marketplace_public_catalog() where slug = 'sel-wallpaper-b'), null,
  'G13. while media verification is not ready no image reference leaves the database');
select is(jsonb_array_length(public.marketplace_public_product('sel-wallpaper-b')->'images'), 0,
  'G14. ...in the detail document either');
select ok((select count(*) <= 60 from public.marketplace_public_catalog(null, null, 100000, 0)),
  'G15. the page size is capped');
select is((select count(*)::int from public.marketplace_public_catalog('wallpaper', 'sel-wallpaper-b')), 1,
  'G16. filtering by type and search text works');
select is((select count(*)::int from public.marketplace_public_catalog('wallpaper', 'no-such-product-xyz')), 0,
  'G17. a search with no match returns nothing');
reset role;

-- Public read hardening (every call re-evaluates; bounded; safe filters; no caller-dependent widening)
select is(
  (select array_agg(p.provolatile::text) from pg_proc p
   where p.proname in ('marketplace_public_catalog', 'marketplace_public_product')),
  array['s', 's'], 'K1. both public-read functions are STABLE (no side effects, no writes)');
set local role anon;
select ok((select count(*) <= 1 from public.marketplace_public_catalog(null, null, 0, 0)),
  'K2. a page size of 0 is clamped to 1, never unbounded');
select lives_ok($$ select * from public.marketplace_public_catalog(null, null, -5, -10) $$,
  'K3. negative limit / offset are clamped, not an error');
select is((select count(*)::int from public.marketplace_public_catalog(null, null, 24, 1000000)), 0,
  'K4. an offset past the end returns an empty page');
select is((select count(*)::int from public.marketplace_public_catalog(null, '%')), 0,
  'K5. LIKE wildcards in the search text are matched literally, not as patterns');
select is((select count(*)::int from public.marketplace_public_catalog(null, $q$' or 1=1 --$q$)), 0,
  'K6. an injection-shaped search string is just text and matches nothing');
select is((select count(*)::int from public.marketplace_public_catalog(null, '  SEL-WALLPAPER-B  ')), 1,
  'K7. search is case-insensitive and trims whitespace');
select is((select count(*)::int from public.marketplace_public_catalog('no_such_type')), 0,
  'K8. an unknown product-type filter returns nothing');
select is(public.marketplace_public_product(' sel-wallpaper-b') is null, true,
  'K9. the detail lookup is an exact slug match');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'sel-wallpaper-a'), 0,
  'K10. a seller sees its OWN draft nowhere in the public catalogue (no owner widening)');
select is(public.marketplace_public_product('sel-wallpaper-a') is null, true,
  'K11. ...nor in the public detail');
reset role;

-- stock-out after publication: still listed, no longer purchasable, NOT archived
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, 'b3100000-0000-4000-8000-000000000001',
  'b3200000-0000-4000-8000-000000000001', 'correction', -20, 'sel-b-zero-000001', 'sold elsewhere', 'manual');
set local role anon;
select is((select in_stock from public.marketplace_public_catalog() where slug = 'sel-wallpaper-b'), false,
  'G18. after a stock-out the product stays listed with in_stock = false');
select is((public.marketplace_public_product('sel-wallpaper-b')->'variants'->0->>'purchasable')::boolean, false,
  'G19. ...and its variant is not purchasable');
reset role;
select is((select status from public.marketplace_products where id = 'b3000000-0000-4000-8000-000000000001'), 'published',
  'G20. a stock-out does not archive or unpublish the product');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, 'b3100000-0000-4000-8000-000000000001',
  'b3200000-0000-4000-8000-000000000001', 'replenish', 10, 'sel-b-back-0000001', 'restock', 'manual');

-- seller suspension / organization deactivation hide it on the very next read
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_suspend('91000005-1111-4111-8111-000000000005', 'under review');
reset role;
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'sel-wallpaper-b'), 0,
  'G21. suspending the seller removes its products from the public catalogue immediately');
select is(public.marketplace_public_product('sel-wallpaper-b') is null, true, 'G22. ...and the detail');
reset role;
select ok('seller_not_approved' = any(app.marketplace_publication_blockers('b3000000-0000-4000-8000-000000000001')),
  'G23. the suspended seller''s product now reports seller_not_approved');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_reinstate('91000005-1111-4111-8111-000000000005', 'review closed');
reset role;
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'sel-wallpaper-b'), 1,
  'G24. reinstating restores visibility (the product kept its published state)');
reset role;
update public.organizations set status = 'suspended' where id = current_setting('t.b')::uuid;
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'sel-wallpaper-b'), 0,
  'G25. a deactivated organization''s products disappear even though the seller row is still approved');
reset role;
select ok('seller_organization_not_eligible' = any(app.marketplace_publication_blockers('b3000000-0000-4000-8000-000000000001')),
  'G26. ...and the blocker names the cause');
update public.organizations set status = 'active', deleted_at = now() where id = current_setting('t.b')::uuid;
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'sel-wallpaper-b'), 0,
  'G27. a soft-deleted organization''s products disappear');
reset role;
update public.organizations set deleted_at = null where id = current_setting('t.b')::uuid;

-- unpublish / archive
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select is(public.marketplace_product_unpublish('b3000000-0000-4000-8000-000000000001'), 'unpublished',
  'G28. the seller can unpublish');
reset role;
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'sel-wallpaper-b'), 0,
  'G29. an unpublished product is not public');
reset role;
update public.marketplace_platform_settings set media_verification_ready = true;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select is(public.marketplace_product_publish('b3000000-0000-4000-8000-000000000001'), 'published',
  'G30. an unpublished product can be published again');
select is(public.marketplace_product_unpublish('b3000000-0000-4000-8000-000000000001', true), 'archived',
  'G31. a published product can be archived');
select throws_ok($$ select public.marketplace_product_publish('b3000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'G32. an archived product cannot be published again');
reset role;
set local role anon;
select is((select count(*)::int from public.marketplace_public_catalog() where slug = 'sel-wallpaper-b'), 0,
  'G33. an archived product is not public');
reset role;

-- ===========================================================================
-- H. Seller's own view
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select status from public.marketplace_seller_accounts), 'approved',
  'H1. a member sees the status of their own seller account');
select is((select count(*)::int from public.marketplace_seller_accounts), 1, 'H2. ...and only their own');
select throws_ok($$ select status_reason from public.marketplace_seller_accounts $$, '42501', null,
  'H3. the admin reason column is not readable by the seller');
select throws_ok($$ select approved_by from public.marketplace_seller_accounts $$, '42501', null,
  'H4. ...nor the approving administrator');
select throws_ok($$ select count(*) from public.marketplace_seller_account_events $$, '42501', null,
  'H5. ...nor the history table');
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_seller_accounts), 0,
  'H6. a user in no seller organization sees no account');
reset role;

-- ===========================================================================
-- I. Reservation guard
-- ===========================================================================
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, 'b3100000-0000-4000-8000-000000000001',
  'b3200000-0000-4000-8000-000000000001', 'reserve', 2, 'sel-b-reserve-0001', 'order hold', 'order');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_suspend('91000005-1111-4111-8111-000000000005', 'stop sales');
reset role;
select throws_ok($$ select * from public.marketplace_stock_apply('91000005-1111-4111-8111-000000000005', 'b3100000-0000-4000-8000-000000000001',
  'b3200000-0000-4000-8000-000000000001', 'reserve', 1, 'sel-b-reserve-0002', 'new order', 'order') $$,
  '23514', null, 'I1. a suspended seller cannot take a new reservation');
select is((select applied from public.marketplace_stock_apply(
  '91000005-1111-4111-8111-000000000005', 'b3100000-0000-4000-8000-000000000001',
  'b3200000-0000-4000-8000-000000000001', 'release', 1, 'sel-b-release-0001', 'order cancelled', 'order')), true,
  'I2. ...but existing reservations can still be released (orders can be wound down)');

-- ===========================================================================
-- J. Isolation
-- ===========================================================================
select is(
  (select count(*)::int from pg_constraint c
   where c.contype = 'f' and c.conrelid::regclass::text in ('marketplace_seller_accounts', 'marketplace_seller_account_events',
       'marketplace_product_status_events', 'marketplace_platform_settings')
     and c.confrelid::regclass::text not in ('organizations', 'marketplace_seller_accounts', 'marketplace_products')),
  0, 'J1. the new tables reference only organizations and marketplace tables');
select is(
  (select count(*)::int from pg_constraint c
   where c.contype = 'f'
     and c.confrelid::regclass::text in ('marketplace_seller_accounts', 'marketplace_seller_account_events',
       'marketplace_product_status_events', 'marketplace_platform_settings')
     and c.conrelid::regclass::text not like 'marketplace\_%'),
  0, 'J2. no existing table references the new tables');

select * from finish();
rollback;
