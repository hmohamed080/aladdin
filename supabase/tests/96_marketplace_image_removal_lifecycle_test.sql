-- pgTAP: Marketplace Migration 07 â€” safe image removal lifecycle
-- (20261014090002_marketplace_image_removal_lifecycle.sql).
--
--   A. SHAPE        â€” new RPCs definer / empty search_path / authenticated-only; policy set unchanged.
--   B. PHASE 1      â€” mark for removal: row kept, hidden everywhere, primary promoted, idempotent.
--   C. AUTHZ        â€” other tenant / anon / member without authority, on every phase.
--   D. DELETE RULE  â€” only the bytes of an awaiting/deleting row, only for a catalogue manager,
--                     malformed / unknown / live / row-less keys refused WITHOUT raising.
--   E. PHASE 3      â€” finalize refuses while bytes exist; succeeds only once they are gone; retries.
--   F. NO COMEBACK  â€” a removed image cannot be re-confirmed or re-arranged.
--   G. VARIANT / NEVER-UPLOADED images.
--   H. ABUSE LIMITS â€” key expiry, pending cap, hourly cap, expiry sweep.
--   I. PUBLICATION  â€” a published product left unpublishable is unpublished; flag stays off.
--   J. ORPHANS      â€” detection query; a row-less object is not deletable by any seller.
--
-- Bytes in storage.objects are simulated exactly as in 95_; the REAL Storage HTTP
-- behaviour (including that the object is truly gone) is proven by
-- marketplace_image_removal_api_test.mjs.
--
-- Fixtures (seed-pilot): showroom A 9c000000-â€¦001 (owner 70000001; 70000002 is a
-- sales-only member), showroom B 91000005-â€¦005 (owner 71000005), outsider 70000009.
create extension if not exists pgtap;

begin;
select plan(73);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002',
               '71000005-0000-4000-8000-000000000005', '70000009-0000-4000-8000-000000000009');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('marketplace_seller_image_remove', 'marketplace_seller_image_remove_finalize',
                       'marketplace_seller_images_pending_removal', 'marketplace_seller_image_confirm_upload',
                       'marketplace_seller_image_request_upload', 'marketplace_seller_images_update')
     and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute')),
  6, 'A1. every image RPC is SECURITY DEFINER, empty search_path, authenticated-only');
select is((select array_agg(policyname::text order by policyname::text collate "C") from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'marketplace\_%'),
  array['marketplace_images_delete_unreferenced', 'marketplace_images_insert_authorized', 'marketplace_images_select_member',
        'marketplace_images_select_moderator', 'marketplace_import_assets_insert'],
  'A2. the Marketplace storage policies are exactly the reviewed five (three from Migration 06, moderator read + import upload from Migration 09); none added or widened by Migration 07 (the whole-table inventory is pinned in 47_)');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname like 'marketplace\_%' and has_function_privilege('authenticated', p.oid, 'execute')),
  array['marketplace_storage_can_delete_image', 'marketplace_storage_can_upload_image', 'marketplace_storage_can_upload_import',
        'marketplace_storage_moderator_can_read', 'marketplace_storage_owns_image'],
  'A3. clients still run only the three storage predicates in app.*');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and p.prosrc like '%storage.objects%'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  array['admin_marketplace_media_record_validation', 'marketplace_seller_image_confirm_upload',
        'marketplace_seller_image_remove_finalize'],
  'A4. of the client-callable functions, only these read storage.objects (confirm: bytes exist; finalize: bytes are gone; Migration 07 added the second reader, the admin media record is Migration 09; the whole-DB inventory is pinned in 47_)');
select is((select public from storage.buckets where id = 'marketplace-product-images'), false, 'A5. the bucket is still private');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
             and table_name like 'marketplace\_%'), 0, 'A6. still no client write grant on any marketplace table');
select is((select media_verification_ready from public.marketplace_platform_settings where singleton), false,
  'A7. media_verification_ready is still false');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'ck_marketplace_images_upload_state')) like '%deleting%',
  'A8. upload_state admits the new deleting state');

-- ---------------------------------------------------------------------------
-- fixtures: product with two confirmed images (A owner), one more with a variant
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.p', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper',
  'name_ar', 'Ø³', 'name_en', 'Removal lifecycle product',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'RL-1', 'selling_unit', 'roll', 'price_egp', 10,
      'attributes', jsonb_build_object('color', 'beige')))))->>'id'), true);
select set_config('t.v', (select id::text from public.marketplace_product_variants where sku = 'RL-1'
                          and seller_organization_id = current_setting('t.a')::uuid), true);
select set_config('t.i1', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') ->> 'image_id'), true);
select set_config('t.i2', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') ->> 'image_id'), true);
select set_config('t.k1', (select object_key from public.marketplace_product_images where id = current_setting('t.i1')::uuid), true);
select set_config('t.k2', (select object_key from public.marketplace_product_images where id = current_setting('t.i2')::uuid), true);
insert into storage.objects (bucket_id, name, metadata)
  values ('marketplace-product-images', current_setting('t.k1'), '{"size": 100, "mimetype": "image/png"}'),
         ('marketplace-product-images', current_setting('t.k2'), '{"size": 200, "mimetype": "image/png"}');
select public.marketplace_seller_image_confirm_upload(current_setting('t.i1')::uuid);
select public.marketplace_seller_image_confirm_upload(current_setting('t.i2')::uuid);
select set_config('t.iv', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/webp', current_setting('t.v')::uuid) ->> 'image_id'), true);
select set_config('t.kv', (select object_key from public.marketplace_product_images where id = current_setting('t.iv')::uuid), true);
insert into storage.objects (bucket_id, name, metadata)
  values ('marketplace-product-images', current_setting('t.kv'), '{"size": 300, "mimetype": "image/webp"}');
select public.marketplace_seller_image_confirm_upload(current_setting('t.iv')::uuid);
reset role;
select is((select is_primary from public.marketplace_product_images where id = current_setting('t.i1')::uuid), true,
  'B0. fixture: the first confirmed image is primary');

-- ===========================================================================
-- B. Phase 1 â€” mark
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.marketplace_seller_image_remove(current_setting('t.i1')::uuid), current_setting('t.k1'),
  'B1. removing the primary image returns its key');
reset role;
select is((select upload_state || '/' || status || '/' || is_primary::text from public.marketplace_product_images where id = current_setting('t.i1')::uuid),
  'deleting/rejected/false', 'B2. the row is KEPT (so Storage can still authorise) but withdrawn: deleting / rejected / not primary');
select is((select count(*)::int from public.marketplace_product_images where id = current_setting('t.i1')::uuid), 1,
  'B3. ...the authorising row still exists after phase 1');
select is((select is_primary from public.marketplace_product_images where id = current_setting('t.i2')::uuid), true,
  'B4. the next confirmed product image is promoted to primary');
select is((select count(*)::int from public.marketplace_product_images where product_id = current_setting('t.p')::uuid
            and variant_id is null and is_primary and status <> 'rejected'), 1,
  'B5. exactly one primary product image remains');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select jsonb_array_length(public.marketplace_seller_product_get(current_setting('t.p')::uuid) -> 'images')), 2,
  'B6. the edit read no longer lists the withdrawn image (2 left: i2 + variant image)');
select is(public.marketplace_seller_images_pending_removal(current_setting('t.p')::uuid) -> 0 ->> 'image_id', current_setting('t.i1'),
  'B7. ...but the unfinished removal is visible so it can be retried');
select is(public.marketplace_seller_image_remove(current_setting('t.i1')::uuid), current_setting('t.k1'),
  'B8. repeating phase 1 is safe and returns the same key');
reset role;
select is((select is_primary from public.marketplace_product_images where id = current_setting('t.i2')::uuid), true,
  'B9. ...and changes nothing else (primary unchanged)');

-- ===========================================================================
-- C. Authorisation on every phase
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_image_remove(%L::uuid) $$, current_setting('t.i2')),
  'mp:not_permitted%', 'C1. another showroom cannot mark A''s image for removal');
select throws_like(format($$ select public.marketplace_seller_image_remove_finalize(%L::uuid) $$, current_setting('t.i1')),
  'mp:not_permitted%', 'C2. ...nor finalize A''s removal');
select throws_like(format($$ select public.marketplace_seller_images_pending_removal(%L::uuid) $$, current_setting('t.p')),
  'mp:not_found%', 'C3. ...nor list A''s pending removals');
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_image_remove(%L::uuid) $$, current_setting('t.i2')),
  'mp:not_permitted%', 'C4. a member WITHOUT catalogue authority cannot remove');
select lives_ok(format($$ select public.marketplace_seller_images_pending_removal(%L::uuid) $$, current_setting('t.p')),
  'C5. ...but, as a member, can see pending removals');
reset role;
set local role anon;
select throws_ok(format($$ select public.marketplace_seller_image_remove(%L::uuid) $$, current_setting('t.i2')), '42501', null,
  'C6. anon cannot call phase 1');
select throws_ok(format($$ select public.marketplace_seller_image_remove_finalize(%L::uuid) $$, current_setting('t.i1')), '42501', null,
  'C7. anon cannot call phase 3');
reset role;
select is((select count(*)::int from public.marketplace_product_images where id in (current_setting('t.i1')::uuid, current_setting('t.i2')::uuid)), 2,
  'C8. none of the refused calls removed a row');

-- ===========================================================================
-- D. The delete rule (storage predicate)
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(app.marketplace_storage_can_delete_image(current_setting('t.k1')), true,
  'D1. the catalogue manager may delete the bytes of a row marked for removal');
select is(app.marketplace_storage_can_delete_image(current_setting('t.k2')), false,
  'D2. ...but never the bytes of a LIVE (confirmed) image');
select is(app.marketplace_storage_owns_image(current_setting('t.k1')), true,
  'D3. Storage can still READ the object (the select policy finds the kept row) â€” the root cause, fixed');
select is(app.marketplace_storage_can_delete_image(current_setting('t.a') || '/' || current_setting('t.p') || '/not-issued.png'), false,
  'D4. a key the server never issued is refused (even under A''s own prefix)');
select lives_ok($$ select app.marketplace_storage_can_delete_image('------------------------------------/a.png') $$,
  'D5. a malformed UUID-shaped prefix does not raise');
select is(app.marketplace_storage_can_delete_image('------------------------------------/a.png'), false,
  'D6. ...it is simply refused');
select is(app.marketplace_storage_can_delete_image('zzzz'), false, 'D7. garbage is refused');
select is(app.marketplace_storage_can_delete_image(''), false, 'D8. the empty key is refused');
select is(app.marketplace_storage_can_delete_image(null), false, 'D9. NULL is refused');
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select is(app.marketplace_storage_can_delete_image(current_setting('t.k1')), false, 'D10. another showroom cannot delete A''s bytes');
select is(app.marketplace_storage_owns_image(current_setting('t.k1')), false, 'D11. ...nor read them');
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select is(app.marketplace_storage_can_delete_image(current_setting('t.k1')), false, 'D12. a sales-only member cannot delete');
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select is(app.marketplace_storage_can_delete_image(current_setting('t.k1')), false, 'D13. an outsider cannot delete');
reset role;

-- ===========================================================================
-- E. Phase 3 â€” finalize only when the bytes are really gone
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_image_remove_finalize(%L::uuid) $$, current_setting('t.i1')),
  'mp:object_still_present%', 'E1. finalize REFUSES while the object is still in storage (a failed delete is never forgotten)');
select throws_like(format($$ select public.marketplace_seller_image_remove_finalize(%L::uuid) $$, current_setting('t.i2')),
  'mp:image_not_marked_for_removal%', 'E2. finalize cannot drop a LIVE image');
reset role;
select is((select count(*)::int from public.marketplace_product_images where id = current_setting('t.i1')::uuid), 1,
  'E3. after the refused finalize the row is still there (retry possible)');
-- the Storage service deletes the object (the real call is proven in the HTTP test)
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'marketplace-product-images' and name = current_setting('t.k1');
select set_config('storage.allow_delete_query', 'false', true);
select is((select count(*)::int from storage.objects where bucket_id = 'marketplace-product-images' and name = current_setting('t.k1')), 0,
  'E4. the object is gone from storage');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.marketplace_seller_image_remove_finalize(current_setting('t.i1')::uuid) ->> 'removed')::boolean, true,
  'E5. NOW finalize succeeds');
reset role;
select is((select count(*)::int from public.marketplace_product_images where id = current_setting('t.i1')::uuid), 0,
  'E6. ...and only now is the row forgotten');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_image_remove_finalize(%L::uuid) $$, current_setting('t.i1')),
  'mp:not_found%', 'E7. repeating finalize is a clean not_found (the server action treats it as already done)');
select throws_like(format($$ select public.marketplace_seller_image_remove(%L::uuid) $$, current_setting('t.i1')),
  'mp:not_found%', 'E8. repeating phase 1 after completion is also a clean not_found');
select is(public.marketplace_seller_images_pending_removal(current_setting('t.p')::uuid), '[]'::jsonb,
  'E9. nothing is pending any more');
reset role;

-- ===========================================================================
-- F. A removed image never comes back
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.i3', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') ->> 'image_id'), true);
select set_config('t.k3', (select object_key from public.marketplace_product_images where id = current_setting('t.i3')::uuid), true);
insert into storage.objects (bucket_id, name, metadata)
  values ('marketplace-product-images', current_setting('t.k3'), '{"size": 50, "mimetype": "image/png"}');
select public.marketplace_seller_image_remove(current_setting('t.i3')::uuid);
select throws_like(format($$ select public.marketplace_seller_image_confirm_upload(%L::uuid) $$, current_setting('t.i3')),
  'mp:image_removed%', 'F1. a removed image cannot be re-confirmed (no resurrection)');
select throws_like(format($$ select public.marketplace_seller_images_update(%L::uuid, %L::jsonb) $$, current_setting('t.p'),
  jsonb_build_array(jsonb_build_object('id', current_setting('t.i3'), 'sort_order', 0, 'is_primary', true))),
  'mp:image_removed%', 'F2. ...nor re-arranged or made primary');
select is(app.marketplace_storage_can_upload_image(current_setting('t.k3')), false,
  'F3. ...and its key no longer accepts uploads');
reset role;
select is((select status from public.marketplace_product_images where id = current_setting('t.i3')::uuid), 'rejected',
  'F4. it stays withdrawn');

-- ===========================================================================
-- G. Variant image, and an image that was never uploaded
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.marketplace_seller_image_remove(current_setting('t.iv')::uuid), current_setting('t.kv'),
  'G1. a variant image is removed through the same lifecycle');
reset role;
select is((select is_primary from public.marketplace_product_images where id = current_setting('t.i2')::uuid), true,
  'G2. removing a variant image never disturbs the product primary');
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'marketplace-product-images' and name in (current_setting('t.kv'), current_setting('t.k3'));
select set_config('storage.allow_delete_query', 'false', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.marketplace_seller_image_remove_finalize(current_setting('t.iv')::uuid) ->> 'removed')::boolean, true,
  'G3. the variant image row is forgotten once its bytes are gone');
select is((public.marketplace_seller_image_remove_finalize(current_setting('t.i3')::uuid) ->> 'removed')::boolean, true,
  'G4. ...and so is the one removed before its confirm');
select set_config('t.i4', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/jpeg') ->> 'image_id'), true);
select public.marketplace_seller_image_remove(current_setting('t.i4')::uuid);
select is((public.marketplace_seller_image_remove_finalize(current_setting('t.i4')::uuid) ->> 'removed')::boolean, true,
  'G5. a key that was issued but never uploaded to can be cancelled (nothing to delete, finalize succeeds)');
reset role;

-- ===========================================================================
-- H. Abuse limits
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.stale', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') ->> 'image_id'), true);
reset role;
update public.marketplace_product_images set created_at = now() - interval '2 hours' where id = current_setting('t.stale')::uuid;
select is(app.marketplace_storage_can_upload_image((select object_key from public.marketplace_product_images where id = current_setting('t.stale')::uuid)), false,
  'H1. an expired key never authorises an upload');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(app.marketplace_storage_can_upload_image((select object_key from public.marketplace_product_images where id = current_setting('t.stale')::uuid)), false,
  'H2. an upload key expires after one hour (the owner cannot use it either)');
select set_config('t.fresh1', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') ->> 'image_id'), true);
reset role;
select is((select upload_state from public.marketplace_product_images where id = current_setting('t.stale')::uuid), 'deleting',
  'H3. the next request sweeps the expired un-uploaded key into the removal lifecycle');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(app.marketplace_storage_can_upload_image((select object_key from public.marketplace_product_images where id = current_setting('t.fresh1')::uuid)), true,
  'H5. a fresh key is usable by the catalogue manager');
-- fill to the pending cap of 10 (fresh1 is #1)
select public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') from generate_series(1, 9);
select throws_like($$ select public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') $$,
  'mp:too_many_pending_uploads%', 'H6. at most 10 un-uploaded keys per product at once');
reset role;
-- hourly cap per organization: 200 withdrawn rows created in the last hour
insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, sort_order, is_primary, status, upload_state)
select current_setting('t.p')::uuid, 'supabase_storage', 'marketplace-product-images',
       current_setting('t.a') || '/bulk/' || g || '.png', 5000 + g, false, 'rejected', 'deleting'
from generate_series(1, 200) g;
update public.marketplace_product_images set upload_state = 'deleting', status = 'rejected'
  where product_id = current_setting('t.p')::uuid and upload_state = 'awaiting_upload';
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') $$,
  'mp:upload_rate_limited%', 'H7. at most 200 new keys per organization per hour');
select throws_ok($$ select public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') $$, 'P0001', null,
  'H8. ...refused with a non-retryable SQLSTATE (PostgREST would retry 40001)');
reset role;
delete from public.marketplace_product_images where product_id = current_setting('t.p')::uuid and upload_state = 'deleting' and object_key like '%/bulk/%';

-- ===========================================================================
-- I. Publication invariants
-- ===========================================================================
-- the publication trigger (rightly) refuses this even for the platform, so it is disabled for the fixture only
set local session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now() where id = current_setting('t.p')::uuid;
set local session_replication_role = origin;
select is((select status from public.marketplace_products where id = current_setting('t.p')::uuid), 'published',
  'I0. fixture: the product is forced to published (as the platform, bypassing the blockers)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.marketplace_seller_image_remove(current_setting('t.i2')::uuid);
reset role;
select is((select status from public.marketplace_products where id = current_setting('t.p')::uuid), 'unpublished',
  'I1. removing the primary image of a published product that is no longer publishable UNPUBLISHES it');
select is((select count(*)::int from public.marketplace_product_status_events
           where product_id = current_setting('t.p')::uuid and action = 'unpublished' and actor_user_id = '70000001-0000-4000-8000-000000000001'), 1,
  'I2. ...with an audit event naming the actor');
select is((select count(*)::int from public.marketplace_public_catalog() where slug like 'removal-lifecycle-product-%'), 0,
  'I3. and it is not in the public catalogue');
select is((select media_verification_ready from public.marketplace_platform_settings where singleton), false,
  'I4. media_verification_ready is still false at the end');

-- ===========================================================================
-- J. Orphan detection
-- ===========================================================================
select is(
  (select count(*)::int from storage.objects o where o.bucket_id = 'marketplace-product-images'
     and not exists (select 1 from public.marketplace_product_images i where i.storage_bucket = o.bucket_id and i.object_key = o.name)),
  0, 'J1. the lifecycle left NO orphan object (every object has its image row)');
insert into storage.objects (bucket_id, name, metadata)
  values ('marketplace-product-images', current_setting('t.a') || '/' || current_setting('t.p') || '/legacy-orphan.png', '{"size": 1}');
select is(
  (select array_agg(o.name) from storage.objects o where o.bucket_id = 'marketplace-product-images'
     and not exists (select 1 from public.marketplace_product_images i where i.storage_bucket = o.bucket_id and i.object_key = o.name)),
  array[current_setting('t.a') || '/' || current_setting('t.p') || '/legacy-orphan.png'],
  'J2. the detection query finds a row-less object');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(app.marketplace_storage_can_delete_image(current_setting('t.a') || '/' || current_setting('t.p') || '/legacy-orphan.png'), false,
  'J3. a row-less object is NOT deletable by any seller (cleanup is a trusted maintenance task, not a client right)');
select is(app.marketplace_storage_owns_image(current_setting('t.a') || '/' || current_setting('t.p') || '/legacy-orphan.png'), false,
  'J4. ...nor readable by one');
reset role;

select * from finish();
rollback;
