-- pgTAP: M4a - publisher identity, ownership, approval / revocation, rollout gate
--        (20261015090036 .. 90009).
--
--   P. backfill + organization behaviour preserved
--   A. independent approval (Admin only, never self-granted)
--   W. ownership and write authority (no impersonation, no reassignment)
--   G. the rollout gate (independent content is invisible to others until the flag is on)
--   I. images, private prices, saved products, offers (one publisher per package)
--   S. suspend / revoke / reinstate (content withdrawn, never auto-restored, writes disabled)
--
-- Every call is made as `authenticated` with the caller's own JWT claims.
create extension if not exists pgtap;

begin;
select plan(103);
-- rc2: this fixture activates / approves showrooms directly, bypassing the seller-readiness triggers PR #84 added
-- (showroom_review_complete / showroom_activation_complete / showroom_product_publish_complete). They are disabled for this
-- transaction only (rolled back with it); the readiness rules themselves are asserted in tests 92-94.
alter table public.verifications disable trigger showroom_review_complete;
alter table public.organizations disable trigger showroom_activation_complete;
alter table public.products disable trigger showroom_product_publish_complete;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('79' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000079')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p79-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P79 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 7) n;
update public.users set status = 'active';

-- 1 independent contractor  2 independent engineer  3 consumer  4 supplier founder
-- 5 showroom founder (the buyer-side viewer)  6 contractor who ALSO founded a supplier  7 spare
update public.users set primary_account_type = 'contractor' where id in
  ('79000001-0000-4000-8000-000000000079', '79000006-0000-4000-8000-000000000079');
update public.users set primary_account_type = 'engineer' where id = '79000002-0000-4000-8000-000000000079';
update public.users set primary_account_type = 'end_consumer' where id = '79000003-0000-4000-8000-000000000079';
insert into public.profiles (user_id, display_name)
select u.id, 'Pro ' || right(u.id::text, 3) from public.users u
 where u.id in ('79000001-0000-4000-8000-000000000079', '79000002-0000-4000-8000-000000000079',
                '79000006-0000-4000-8000-000000000079')
on conflict do nothing;

\set u1 '{"sub":"79000001-0000-4000-8000-000000000079","role":"authenticated"}'
\set u2 '{"sub":"79000002-0000-4000-8000-000000000079","role":"authenticated"}'
\set u3 '{"sub":"79000003-0000-4000-8000-000000000079","role":"authenticated"}'
\set u4 '{"sub":"79000004-0000-4000-8000-000000000079","role":"authenticated"}'
\set u5 '{"sub":"79000005-0000-4000-8000-000000000079","role":"authenticated"}'
\set u6 '{"sub":"79000006-0000-4000-8000-000000000079","role":"authenticated"}'
\set adm '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}'

create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated;

-- organizations are created and approved the real way ---------------------------------------------
select set_config('request.jwt.claims', :'u4', true);
insert into _ids select 'sup', app.organization_create_owned('Pub Supplier', 'supplier', 'en', 'HQ');
select set_config('request.jwt.claims', :'u5', true);
insert into _ids select 'shw', app.organization_create_owned('Pub Showroom', 'showroom_dealer', 'en', 'HQ');
select set_config('request.jwt.claims', :'u6', true);
insert into _ids select 'msup', app.organization_create_owned('Multi Supplier', 'supplier', 'en', 'HQ');

set local role authenticated;
set local request.jwt.claims = :'u4';
insert into _ids select 'a_sup', public.organization_application_submit((select id from _ids where k = 'sup'));
set local request.jwt.claims = :'u5';
insert into _ids select 'a_shw', public.organization_application_submit((select id from _ids where k = 'shw'));
set local request.jwt.claims = :'u6';
insert into _ids select 'a_msup', public.organization_application_submit((select id from _ids where k = 'msup'));
set local request.jwt.claims = :'adm';
select public.review_start(id) from _ids where k in ('a_sup', 'a_shw', 'a_msup');
select public.review_approve(id, false) from _ids where k in ('a_sup', 'a_shw', 'a_msup');
reset role;

-- an organization product, published to Showrooms, existing before any independent publisher
set local role authenticated;
set local request.jwt.claims = :'u4';
insert into _ids select 'orgprod', public.own_product_create((select id from _ids where k = 'sup'), 'Org Tile', 'ORG-1', 'wallpaper', 'roll');
select public.product_audiences_set((select id from _ids where k = 'orgprod'), array['showroom_dealer']);
select public.set_product_published((select id from _ids where k = 'orgprod'), true, 1);
reset role;

-- ===========================================================================
-- P. backfill and organization behaviour
-- ===========================================================================
select is((select count(*)::int from public.organizations), (select count(*)::int from public.publishers where kind = 'organization'),
  'P1: every organization has exactly one organization publisher');
select is((select count(*)::int from public.products p join public.publishers pb on pb.id = p.publisher_id
            where pb.organization_id is distinct from p.organization_id), 0,
  'P2: every product is owned by the publisher of its organization');
select is((select count(*)::int from public.product_offers o join public.publishers pb on pb.id = o.publisher_id
            where pb.organization_id is distinct from o.organization_id), 0, 'P3: every offer likewise');
select is((select count(*)::int from public.product_images i join public.products p on p.id = i.product_id where i.publisher_id <> p.publisher_id), 0,
  'P4: image rows agree with their product');
select is(app.org_product_audience((select id from _ids where k = 'sup')), 'supplier', 'P5: organization audience is unchanged');
select is(app.publisher_audience((select id from public.publishers where organization_id = (select id from _ids where k = 'sup'))), 'supplier',
  'P6: an organization publisher carries its organization audience');

insert into _ids select 'suppub', id from public.publishers where organization_id = (select id from _ids where k = 'sup');

-- ===========================================================================
-- A. independent approval
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'u3';
select throws_ok($$ select public.independent_publisher_request('please') $$, '42501', null,
  'A1: a consumer cannot request independent publishing');
set local request.jwt.claims = :'u1';
insert into _ids select 'req1', public.independent_publisher_request('Tile installer');
select isnt((select id from _ids where k = 'req1'), null, 'A2: an independent Contractor requests commercial-publishing approval');
select is(public.independent_publisher_request('again'), (select id from _ids where k = 'req1'), 'A3: a second request returns the open one');
select is((select request_status from public.my_independent_publisher()), 'pending_review', 'A4: the request is pending review');
select is((select publisher_id from public.my_independent_publisher()), null, 'A5: there is no publisher identity before approval');
select throws_ok($$ insert into public.publishers (kind, user_id, status, approval_id) values ('independent_contractor', '79000001-0000-4000-8000-000000000079', 'active', null) $$,
  '42501', null, 'A6: a client cannot create a publisher');
select throws_ok($$ insert into public.verifications (subject_type, user_id, verification_type, requested_account_type, status)
                    values ('user', '79000001-0000-4000-8000-000000000079', 'independent_publisher', 'contractor', 'approved') $$,
  '42501', null, 'A7: a client cannot write a review record');
select throws_ok($$ select enabled from public.platform_flags $$, '42501', null, 'A8: the rollout flag is not readable by clients');
select throws_ok($$ update public.platform_flags set enabled = true $$, '42501', null, 'A9: nor writable');
select throws_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'req1')),
  '42501', null, 'A10: nobody approves their own request');
select throws_ok($$ select public.publisher_suspend(gen_random_uuid(), 'x') $$, '42501', null, 'A11: only a platform administrator suspends a publisher');
select throws_ok(format($q$select public.publisher_product_create(%L, 'Sneak', 'S-1', 'wallpaper', 'roll')$q$, gen_random_uuid()),
  '42501', null, 'A12: without an approved publisher identity there is nothing to publish as');
select throws_ok(format($q$select public.publisher_product_create(%L, 'Sneak', 'S-1', 'wallpaper', 'roll')$q$,
                        (select id from _ids where k = 'suppub')),
  '22023', null, 'A13: the independent writer refuses an organization publisher');

set local request.jwt.claims = :'u2';
insert into _ids select 'req2', public.independent_publisher_request(null);
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'req1'));
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'req1')), 'A14: Admin approves the Contractor');
select public.review_start((select id from _ids where k = 'req2'));
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'req2')), 'A15: and the Engineer');
reset role;
insert into _ids select 'pc', id from public.publishers where user_id = '79000001-0000-4000-8000-000000000079';
insert into _ids select 'pe', id from public.publishers where user_id = '79000002-0000-4000-8000-000000000079';
select is((select kind::text from public.publishers where id = (select id from _ids where k = 'pc')), 'independent_contractor', 'A16: the kind comes from the persona, not the client');
select is((select kind::text from public.publishers where id = (select id from _ids where k = 'pe')), 'independent_engineer', 'A17: Engineer kind');
select is(app.publisher_audience((select id from _ids where k = 'pc')), 'contractor', 'A18: independent Contractor audience');
select is(app.publisher_audience((select id from _ids where k = 'pe')), 'engineer', 'A19: independent Engineer audience');
select is((select count(*)::int from public.audit_log where action = 'publisher.approved'), 2, 'A20: approvals are audited');
select is((select organization_id from public.publishers where id = (select id from _ids where k = 'pc')), null, 'A21: no organization is created for an independent professional');
select ok(app.coming_soon_account_types() @> array['contractor', 'engineer']::text[], 'A22: Contractor / Engineer registration stays Coming Soon');

-- ===========================================================================
-- W. ownership and write authority
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'u1';
insert into _ids select 'iprod', public.publisher_product_create((select id from _ids where k = 'pc'), 'Ind Tile', 'IND-1', 'wallpaper', 'roll',
  '[]'::jsonb, null, null, null, null, 120.50);
select isnt((select id from _ids where k = 'iprod'), null, 'W1: an approved independent Contractor creates a product');
select is((select publisher_id from public.products where id = (select id from _ids where k = 'iprod')), (select id from _ids where k = 'pc'),
  'W2: it is owned by their publisher');
select is((select organization_id from public.products where id = (select id from _ids where k = 'iprod')), null, 'W3: with no organization');
select is((select count(*)::int from public.product_prices where product_id = (select id from _ids where k = 'iprod') and publisher_id = (select id from _ids where k = 'pc')), 1,
  'W4: its private price is owned by the same publisher');
select lives_ok(format($q$select public.own_product_update(%L, 1, 'Ind Tile 2', 'IND-1', 'wallpaper', 'roll', '[]'::jsonb, null, null, null, null, 130)$q$, (select id from _ids where k = 'iprod')),
  'W5: the owner edits it');
select throws_ok(format($q$select public.publisher_product_create(%L, 'Dup', 'ind-1', 'wallpaper', 'roll')$q$, (select id from _ids where k = 'pc')),
  '23505', null, 'W6: product codes are unique per publisher');

set local request.jwt.claims = :'u2';
select throws_ok(format($q$select public.publisher_product_create(%L, 'Imposter', 'X-1', 'wallpaper', 'roll')$q$, (select id from _ids where k = 'pc')),
  '42501', null, 'W7: another approved professional cannot publish as them');
select throws_ok(format($q$select public.own_product_update(%L, 2, 'Hijack', 'IND-1', 'wallpaper', 'roll')$q$, (select id from _ids where k = 'iprod')),
  '42501', null, 'W8: nor edit their product');
select throws_ok(format($q$select public.set_product_published(%L, true, (select version from public.products where id = %L))$q$, (select id from _ids where k = 'iprod'), (select id from _ids where k = 'iprod')),
  '42501', null, 'W9: nor publish it');
select throws_ok(format($q$select public.product_audiences_set(%L, array['engineer'])$q$, (select id from _ids where k = 'iprod')),
  '42501', null, 'W10: nor change its audiences');
select is((select count(*)::int from public.products where id = (select id from _ids where k = 'iprod')), 0, 'W11: nor even read it');
set local request.jwt.claims = :'u4';
select throws_ok(format($q$select public.own_product_update(%L, 2, 'Org hijack', 'IND-1', 'wallpaper', 'roll')$q$, (select id from _ids where k = 'iprod')),
  '42501', null, 'W12: an organization member cannot edit an independent product through the organization path');
reset role;
select throws_ok(format($q$update public.products set publisher_id = %L where id = %L$q$, (select id from _ids where k = 'pe'), (select id from _ids where k = 'iprod')),
  '42501', null, 'W13: the publisher of a product cannot be reassigned');
select throws_ok(format($q$update public.products set organization_id = %L where id = %L$q$, (select id from _ids where k = 'sup'), (select id from _ids where k = 'iprod')),
  '42501', null, 'W14: nor can an organization be attached to it');
select throws_ok(format($q$insert into public.products (publisher_id, organization_id, name, category, unit, created_by)
                           values (%L, %L, 'Both', 'other', 'roll', '79000001-0000-4000-8000-000000000079')$q$,
                        (select id from _ids where k = 'pc'), (select id from _ids where k = 'sup')),
  '23514', null, 'W15: an item cannot have two owners');
select throws_ok(format($q$insert into public.product_images (product_id, publisher_id, object_key, content_type, slot, created_by)
                           values (%L, %L, %L, 'image/png', 3, '79000001-0000-4000-8000-000000000079')$q$,
                        (select id from _ids where k = 'iprod'), (select id from _ids where k = 'pe'),
                        gen_random_uuid() || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.png'),
  '23503', null, 'W16: an image cannot name a different publisher than its product');

-- ===========================================================================
-- G. the rollout gate
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'u1';
select public.product_audiences_set((select id from _ids where k = 'iprod'), array['showroom_dealer']);
select lives_ok(format($q$select public.set_product_published(%L, true, (select version from public.products where id = %L))$q$, (select id from _ids where k = 'iprod'), (select id from _ids where k = 'iprod')), 'G1: the owner publishes (the gate only governs who else can see it)');
select is((select count(*)::int from public.catalog_products(null) where id = (select id from _ids where k = 'iprod')), 1, 'G2: the owner still sees their own active product');
set local request.jwt.claims = :'u5';
select is((select count(*)::int from public.catalog_products((select id from _ids where k = 'shw')) where id = (select id from _ids where k = 'iprod')), 0,
  'G3: with the gate off a buyer does not see the independent product');
select is((select count(*)::int from public.catalog_products((select id from _ids where k = 'shw')) where id = (select id from _ids where k = 'orgprod')), 1,
  'G4: while the organization product is visible exactly as before');
reset role;
select is(app.product_visible_to((select id from _ids where k = 'iprod'), (select id from _ids where k = 'shw'), 'showroom_dealer'), false,
  'G5: the direct visibility check is closed');
select is(app.product_is_public((select id from _ids where k = 'iprod')), false, 'G6: and the product is not public');
select is(app.product_is_public((select id from _ids where k = 'orgprod')), true, 'G7: an organization product is');

update public.platform_flags set enabled = true where key = 'independent_commerce';
select is(app.product_visible_to((select id from _ids where k = 'iprod'), (select id from _ids where k = 'shw'), 'showroom_dealer'), true,
  'G8: with the gate on (isolated test) an eligible buyer sees it');
set local role authenticated;
set local request.jwt.claims = :'u5';
select is((select supplier_name from public.catalog_products((select id from _ids where k = 'shw')) where id = (select id from _ids where k = 'iprod')),
  'P79 1'::text, 'G9: the seller identity is the professional, not an organization');
select is((select organization_id from public.catalog_products((select id from _ids where k = 'shw')) where id = (select id from _ids where k = 'iprod')), null,
  'G10: it names no organization');
select is((select count(*)::int from public.product_prices where product_id = (select id from _ids where k = 'iprod')), 0, 'G11: the private base price is not readable by a buyer');
select is((select count(*)::int from public.products where id = (select id from _ids where k = 'iprod')), 0, 'G12: nor the seller-side product row');

-- exact audiences: not targeted at a viewer -> not visible, gate or not
set local request.jwt.claims = :'u1';
select public.product_audiences_set((select id from _ids where k = 'iprod'), array['engineer']);
set local request.jwt.claims = :'u5';
select is((select count(*)::int from public.catalog_products((select id from _ids where k = 'shw')) where id = (select id from _ids where k = 'iprod')), 0,
  'G13: audiences stay exact-only for independent content');
set local request.jwt.claims = :'u1';
select public.product_audiences_set((select id from _ids where k = 'iprod'), array['showroom_dealer']);

-- Direct RFQ is not available for an independent seller (M4b)
set local request.jwt.claims = :'u5';
insert into _ids select 'rfq', public.create_rfq((select id from _ids where k = 'shw'), (select id from _ids where k = 'sup'), 'Test RFQ', null, null, null);
select throws_ok(format($q$select public.add_rfq_item(%L, %L, 1)$q$, (select id from _ids where k = 'rfq'), (select id from _ids where k = 'iprod')),
  '22023', null, 'G14: an independent product cannot enter a Direct RFQ');

-- ===========================================================================
-- I. images, saved products, offers
-- ===========================================================================
set local request.jwt.claims = :'u1';
select is(left(public.product_image_request_upload((select id from _ids where k = 'iprod'), 'image/png'), 36),
  (select id::text from _ids where k = 'pc'), 'I1: an independent image key is prefixed by the publisher id');
select is((select count(*)::int from public.product_images where product_id = (select id from _ids where k = 'iprod') and publisher_id = (select id from _ids where k = 'pc')), 1,
  'I2: the image row is owned by the publisher');
set local request.jwt.claims = :'u2';
select throws_ok(format($q$select public.product_image_request_upload(%L, 'image/png')$q$, (select id from _ids where k = 'iprod')), '42501', null,
  'I3: another professional cannot upload to it');
reset role;
-- R2 (20261021090005): an image becomes ready only after its stored bytes were attested; record that attestation first.
insert into public.media_storage_locations (namespace, object_key, owner_user_id, provider, content_type, size_bytes, sha256, verified_at)
select 'product', pi.object_key, pi.created_by, 'supabase', pi.content_type, 1, repeat('0', 64), now()
  from public.product_images pi where pi.product_id = (select id from _ids where k = 'iprod')
on conflict (namespace, object_key) do update set verified_at = now(), size_bytes = 1, sha256 = repeat('0', 64);
update public.product_images set state = 'ready' where product_id = (select id from _ids where k = 'iprod');
set local role authenticated;
set local request.jwt.claims = :'u5';
reset role;
select is((select array_length(array(select object_key from public.product_images where product_id = (select id from _ids where k = 'iprod')), 1)), 1, 'I4: one ready image');
set local role authenticated;
set local request.jwt.claims = :'u5';
reset role;
select ok(app.has_product_image_grant((select object_key from public.product_images where product_id = (select id from _ids where k = 'iprod'))) is not true,
  'I5: no grant exists for a buyer');

-- save: only while visible
set local role authenticated;
set local request.jwt.claims = :'u5';
select lives_ok(format($q$select public.save_product(%L, %L)$q$, (select id from _ids where k = 'shw'), (select id from _ids where k = 'iprod')),
  'I6: a buyer who can see it may save it');
select is((select supplier_org_id from public.saved_products_for((select id from _ids where k = 'shw')) where product_id = (select id from _ids where k = 'iprod')), null,
  'I7: the saved list shows the professional, not an organization');
reset role;
update public.platform_flags set enabled = false where key = 'independent_commerce';
set local role authenticated;
set local request.jwt.claims = :'u5';
select is((select count(*)::int from public.saved_products_for((select id from _ids where k = 'shw')) where product_id = (select id from _ids where k = 'iprod')), 0,
  'I8: closing the gate removes it from saved lists immediately');
reset role;
update public.platform_flags set enabled = true where key = 'independent_commerce';

-- offers: one publisher per package
set local role authenticated;
set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.publisher_offer_save(%L, null, null, 'Mixed', null, 100, 150, now(), now() + interval '2 days',
                          jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1), jsonb_build_object('product_id', %L, 'quantity', 1)),
                          array['showroom_dealer'])$q$,
        (select id from _ids where k = 'pc'), (select id from _ids where k = 'iprod'), (select id from _ids where k = 'orgprod')),
  '22023', null, 'I9: a package cannot mix an independent and an organization product');
insert into _ids select 'ioffer', (public.publisher_offer_save((select id from _ids where k = 'pc'), null, null, 'Ind bundle', null, 100, 150,
  now() - interval '1 minute', now() + interval '2 days',
  jsonb_build_array(jsonb_build_object('product_id', (select id from _ids where k = 'iprod'), 'quantity', 2)), array['showroom_dealer']) ->> 'id')::uuid;
select isnt((select id from _ids where k = 'ioffer'), null, 'I10: an approved independent creates an offer');
select is((select publisher_id from public.product_offers where id = (select id from _ids where k = 'ioffer')), (select id from _ids where k = 'pc'), 'I11: owned by the publisher');
select is((select organization_id from public.product_offer_items where offer_id = (select id from _ids where k = 'ioffer') limit 1), null, 'I12: its items name no organization');
select lives_ok(format($q$select public.own_offer_set_status(%L, 'publish', 1)$q$, (select id from _ids where k = 'ioffer')), 'I13: the owner publishes the offer');
set local request.jwt.claims = :'u4';
select throws_ok(format($q$select public.own_offer_save(%L, %L, 2, 'Org hijack', null, 100, 150, now(), now() + interval '3 days',
                          jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)), array['showroom_dealer'])$q$,
        (select id from _ids where k = 'sup'), (select id from _ids where k = 'ioffer'), (select id from _ids where k = 'orgprod')),
  'P0002', null, 'I14: the organization offer path cannot touch an independent offer');
set local request.jwt.claims = :'u5';
select is((select jsonb_array_length(public.offers_feed((select id from _ids where k = 'shw')))), 1, 'I15: with the gate on the targeted buyer sees the offer');
select is(public.offers_feed((select id from _ids where k = 'shw')) -> 0 -> 'seller' ->> 'org_type', 'independent_contractor', 'I16: sold by an independent Contractor');
reset role;
update public.platform_flags set enabled = false where key = 'independent_commerce';
set local role authenticated;
set local request.jwt.claims = :'u5';
select is((select jsonb_array_length(public.offers_feed((select id from _ids where k = 'shw')))), 0, 'I17: with the gate off the offer is invisible');
select is((public.offers_feed_page((select id from _ids where k = 'shw')) ->> 'total')::int, 0, 'I18: in the paged feed too');
reset role;
update public.platform_flags set enabled = true where key = 'independent_commerce';

-- ===========================================================================
-- S. suspend / revoke / reinstate
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.publisher_suspend(%L, 'self')$q$, (select id from _ids where k = 'pc')), '42501', null, 'S1: a publisher cannot suspend itself');
set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.publisher_suspend(%L, 'Under investigation')$q$, (select id from _ids where k = 'pc')), 'S2: an administrator suspends the publisher');
reset role;
select is((select status::text from public.products where id = (select id from _ids where k = 'iprod')), 'draft', 'S3: published products are withdrawn');
select is((select status::text from public.product_offers where id = (select id from _ids where k = 'ioffer')), 'paused', 'S4: live offers are paused');
select is((select count(*)::int from public.products where id = (select id from _ids where k = 'iprod') and deleted_at is null), 1, 'S5: nothing is deleted');
select is((select count(*)::int from public.product_images where product_id = (select id from _ids where k = 'iprod')), 1, 'S6: images are kept');
select is((select count(*)::int from public.audit_log where action = 'publisher.suspended'), 1, 'S7: the suspension is audited');
set local role authenticated;
set local request.jwt.claims = :'u5';
select is((select jsonb_array_length(public.offers_feed((select id from _ids where k = 'shw')))), 0, 'S8: buyers no longer see the offer');
select is((select count(*)::int from public.catalog_products((select id from _ids where k = 'shw')) where id = (select id from _ids where k = 'iprod')), 0, 'S9: nor the product');
set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.publisher_product_create(%L, 'More', 'M-1', 'wallpaper', 'roll')$q$, (select id from _ids where k = 'pc')), '42501', null, 'S10: new products are disabled');
select throws_ok(format($q$select public.own_product_update(%L, 5, 'Edit', 'IND-1', 'wallpaper', 'roll')$q$, (select id from _ids where k = 'iprod')), '42501', null, 'S11: edits are disabled');
select throws_ok(format($q$select public.set_product_published(%L, true, (select version from public.products where id = %L))$q$, (select id from _ids where k = 'iprod'), (select id from _ids where k = 'iprod')), '42501', null, 'S12: publishing is disabled');
select throws_ok(format($q$select public.own_offer_set_status(%L, 'resume', 2)$q$, (select id from _ids where k = 'ioffer')), '42501', null, 'S13: resuming an offer is disabled');
select throws_ok(format($q$select public.product_image_request_upload(%L, 'image/png')$q$, (select id from _ids where k = 'iprod')), '42501', null, 'S14: image changes are disabled');
select is((select count(*)::int from public.products where id = (select id from _ids where k = 'iprod')), 1, 'S15: the owner can still read their own history');
select is((select status from public.my_independent_publisher()), 'suspended', 'S16: and sees the status');
select is((select can_request from public.my_independent_publisher()), false, 'S17: a suspended publisher cannot request a new approval');
set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.publisher_reinstate(%L, 'Cleared')$q$, (select id from _ids where k = 'pc')), 'S18: an administrator reinstates it');
reset role;
select is((select status::text from public.products where id = (select id from _ids where k = 'iprod')), 'draft', 'S19: reinstatement does NOT restore public commerce');
set local role authenticated;
set local request.jwt.claims = :'u1';
select lives_ok(format($q$select public.set_product_published(%L, true, (select version from public.products where id = %L))$q$, (select id from _ids where k = 'iprod'), (select id from _ids where k = 'iprod')), 'S20: the owner republishes explicitly');
set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.publisher_revoke(%L, 'Fraud')$q$, (select id from _ids where k = 'pc')), 'S21: an administrator revokes it');
set local request.jwt.claims = :'u5';
select is((select count(*)::int from public.catalog_products((select id from _ids where k = 'shw')) where id = (select id from _ids where k = 'iprod')), 0, 'S22: revocation removes public visibility');
set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.set_product_published(%L, true, (select version from public.products where id = %L))$q$, (select id from _ids where k = 'iprod'), (select id from _ids where k = 'iprod')), '42501', null, 'S23: a revoked publisher cannot publish');
select is((select can_request from public.my_independent_publisher()), true, 'S24: but may apply for a fresh approval');
reset role;
select is((select count(*)::int from public.products where publisher_id = (select id from _ids where k = 'pc')), 1, 'S25: historical commercial records are intact');

-- identities are not merged
select is(app.org_product_audience((select id from _ids where k = 'msup')), 'supplier', 'S26: a person who also owns an organization keeps the organization audience there');
select is(app.effective_persona('79000006-0000-4000-8000-000000000079')::text, 'contractor', 'S27: and the independent identity audience elsewhere');

select * from finish();
rollback;
