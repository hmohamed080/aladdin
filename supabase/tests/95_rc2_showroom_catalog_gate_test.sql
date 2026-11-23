-- pgTAP (rc2 release gate): a Showroom that is pending, rejected, incomplete or suspended can NEVER be seen, saved or published through
-- any read or write path - the table (direct API), the catalog functions, save_product and set_product_published - while its owner can
-- still prepare DRAFT products, and an approved non-showroom supplier stays fully visible (so the gate is not a blanket block).
create extension if not exists pgtap;
begin;
select no_plan();

alter table public.products disable trigger showroom_product_publish_complete;
alter table public.organizations disable trigger showroom_activation_complete;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('95' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000095')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p95-' || n || '@example.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', 'P95 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 6) n;

-- orgs: A active+verified showroom with NO address (incomplete); B pending showroom; R pending showroom with a REJECTED review;
--       S suspended showroom; D approved supplier (control); V approved supplier (the viewer)
insert into public.organizations (id, name, org_type, status, is_verified, created_by) values
 ('95a00001-0000-4000-8000-000000000095','A incomplete showroom','showroom_dealer','active',true,'95000001-0000-4000-8000-000000000095'),
 ('95a00002-0000-4000-8000-000000000095','B pending showroom','showroom_dealer','pending_verification',false,'95000002-0000-4000-8000-000000000095'),
 ('95a00003-0000-4000-8000-000000000095','R rejected showroom','showroom_dealer','pending_verification',false,'95000003-0000-4000-8000-000000000095'),
 ('95a00004-0000-4000-8000-000000000095','S suspended showroom','showroom_dealer','suspended',true,'95000004-0000-4000-8000-000000000095'),
 ('95a00005-0000-4000-8000-000000000095','D approved supplier','supplier','active',true,'95000005-0000-4000-8000-000000000095'),
 ('95a00006-0000-4000-8000-000000000095','V viewer supplier','supplier','active',true,'95000006-0000-4000-8000-000000000095');
insert into public.branches (id, organization_id, name)
select ('95b0000' || n || '-0000-4000-8000-000000000095')::uuid, ('95a0000' || n || '-0000-4000-8000-000000000095')::uuid, 'main' from generate_series(1, 6) n;
insert into public.memberships (id, user_id, organization_id, primary_branch_id, status)
select ('95c0000' || n || '-0000-4000-8000-000000000095')::uuid, ('9500000' || n || '-0000-4000-8000-000000000095')::uuid,
       ('95a0000' || n || '-0000-4000-8000-000000000095')::uuid, ('95b0000' || n || '-0000-4000-8000-000000000095')::uuid, 'active' from generate_series(1, 6) n;
insert into public.membership_capabilities (membership_id, capability_key)
select ('95c0000' || n || '-0000-4000-8000-000000000095')::uuid, k from generate_series(1, 6) n, unnest(array['org.manage','catalog.read','catalog.write','catalog.publish']) k;
insert into public.verifications (id, subject_type, organization_id, verification_type, status, submitted_at, decided_at, reason)
values ('95d00003-0000-4000-8000-000000000095','organization','95a00003-0000-4000-8000-000000000095','organization','rejected', now(), now(), 'Licence missing.');

insert into public.products (id, organization_id, name, category, unit, status, published_at, created_by)
select ('95e0000' || n || '-0000-4000-8000-000000000095')::uuid, ('95a0000' || n || '-0000-4000-8000-000000000095')::uuid, 'P95 product ' || n, 'finishing', 'piece', 'published', now(),
       ('9500000' || n || '-0000-4000-8000-000000000095')::uuid from generate_series(1, 5) n;
insert into public.product_audiences (product_id, audience)
select ('95e0000' || n || '-0000-4000-8000-000000000095')::uuid, 'supplier' from generate_series(1, 5) n;
insert into public.products (id, organization_id, name, category, unit, status, created_by)
values ('95e000b1-0000-4000-8000-000000000095','95a00002-0000-4000-8000-000000000095','B draft','finishing','piece','draft','95000002-0000-4000-8000-000000000095');
alter table public.products enable trigger showroom_product_publish_complete;   -- the real second layer is ON for the assertions below

-- ---- the viewer (an approved supplier) ------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"95000006-0000-4000-8000-000000000095","role":"authenticated"}',true);
create temp table _v as select id from public.catalog_products('95a00006-0000-4000-8000-000000000095'::uuid);
select is((select count(*)::int from _v where id='95e00005-0000-4000-8000-000000000095'), 1, 'CONTROL: an approved supplier product is listed to another approved organization');
select is((select count(*)::int from _v where id='95e00001-0000-4000-8000-000000000095'), 0, 'active+verified showroom with an incomplete profile/address is NOT listed');
select is((select count(*)::int from _v where id='95e00002-0000-4000-8000-000000000095'), 0, 'a PENDING showroom is NOT listed');
select is((select count(*)::int from _v where id='95e00003-0000-4000-8000-000000000095'), 0, 'a showroom with a REJECTED review is NOT listed');
select is((select count(*)::int from _v where id='95e00004-0000-4000-8000-000000000095'), 0, 'a SUSPENDED showroom is NOT listed');
select is((select count(*)::int from public.products where id in ('95e00001-0000-4000-8000-000000000095','95e00002-0000-4000-8000-000000000095','95e00003-0000-4000-8000-000000000095','95e00004-0000-4000-8000-000000000095')), 0,
  'direct table access (the public API) returns none of their products');
select throws_ok($$select public.save_product('95a00006-0000-4000-8000-000000000095','95e00002-0000-4000-8000-000000000095',null)$$, null, null, 'a pending showroom product cannot be saved by another organization');
select throws_ok($$select public.save_product('95a00006-0000-4000-8000-000000000095','95e00001-0000-4000-8000-000000000095',null)$$, null, null, 'an incomplete showroom product cannot be saved by another organization');
select lives_ok($$select public.save_product('95a00006-0000-4000-8000-000000000095','95e00005-0000-4000-8000-000000000095',null)$$, 'CONTROL: the approved supplier product can be saved');

-- ---- the predicates themselves (as the database owner) --------------------------------------------------------------------------
reset role;
select is(app.product_visible_to('95e00002-0000-4000-8000-000000000095','95a00006-0000-4000-8000-000000000095','supplier'), false, 'product_visible_to: pending showroom -> false');
select is(app.product_visible_to('95e00001-0000-4000-8000-000000000095','95a00006-0000-4000-8000-000000000095','supplier'), false, 'product_visible_to: incomplete showroom -> false');
select is(app.product_visible_to('95e00005-0000-4000-8000-000000000095','95a00006-0000-4000-8000-000000000095','supplier'), true, 'product_visible_to: CONTROL approved supplier -> true');
select is(app.product_is_public('95e00002-0000-4000-8000-000000000095'), false, 'product_is_public (public image door): pending showroom -> false');
select is(app.product_is_public('95e00005-0000-4000-8000-000000000095'), true, 'product_is_public: CONTROL approved supplier -> true');

-- ---- the owner of a PENDING showroom: may prepare drafts, may NOT publish ---------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"95000002-0000-4000-8000-000000000095","role":"authenticated"}',true);
select is((select count(*)::int from public.products where id='95e00002-0000-4000-8000-000000000095'), 1, 'the owner still sees its own product');
select lives_ok($$select public.own_product_create('95a00002-0000-4000-8000-000000000095','Draft prepared before approval','P95-DRAFT','wallpaper','roll')$$,
  'a PENDING showroom owner can create a DRAFT product (preparing data before approval)');
select throws_ok($$select public.set_product_published('95e000b1-0000-4000-8000-000000000095', true, 1)$$, '42501', null, 'a PENDING showroom cannot publish');
select is((select status::text from public.products where id='95e000b1-0000-4000-8000-000000000095'), 'draft', 'the draft stayed a draft');
select throws_ok($$update public.products set status = 'published' where id = '95e000b1-0000-4000-8000-000000000095'$$, null, null, 'nor by writing the status directly');
reset role;
select * from finish();
rollback;
