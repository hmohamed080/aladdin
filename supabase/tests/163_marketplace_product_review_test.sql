-- pgTAP: Marketplace product review (plan PR 6; 20261123100001_marketplace_product_review.sql).
--
--   A. SHAPE        new RPCs authenticated-only, internal helpers and preset tables closed, verification always on.
--   B. ACCESS       only a media moderator opens the review; the queue lists a product with its images inside.
--   C. APPROVE      the tick approves every pending image of the product; an unvalidated one is reported, not approved.
--   D. REJECT       a reason + an owner message are required; the owner (only) is notified, in both languages;
--                   approval notifies nobody; excluding one approved image keeps the product on the shelf.
--   E. RECONSIDER   a rejected image can be approved later (no final rejection).
--   F. REPLACEMENT  the old image stays live while the new one is pending or rejected; approval swaps them, the old
--                   image enters the removal lifecycle and is forgotten once the bytes are gone.
--   G. PRESETS      moderators read active presets; only a manager changes them; every change is audited.
--   H. RETENTION    a rejected image is still purged two days later (media policy), reused unchanged.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001 holds org.manage; 70000002 is a sales-only member),
-- showroom B 91000005-…005 (owner 71000005), staff 55555555 (Administrator: moderates media), 11111111 (made Super
-- Admin HERE: manages presets).
create extension if not exists pgtap;

begin;
select plan(71);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002',
               '71000005-0000-4000-8000-000000000005', '55555555-5555-4555-8555-555555555555',
               '11111111-1111-4111-8111-111111111111');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
insert into public.admin_role_assignments (user_id, role_id, scope_type, assigned_by)
select '11111111-1111-4111-8111-111111111111', r.id, 'platform', '55555555-5555-4555-8555-555555555555'
from public.admin_roles r where r.key = 'super_admin';

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

-- the backend's steps for one uploaded key: reserve on R2, then attest the verified bytes
create function pg_temp.backend_upload(p_key text, p_size bigint) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.media_storage_reserve('marketplace', p_key, 'r2', '70000001-0000-4000-8000-000000000001');
  perform public.media_storage_attest('marketplace', p_key, '70000001-0000-4000-8000-000000000001', 'r2', p_size, 'image/png', repeat('e', 64));
end;
$$;
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
create function pg_temp.back() returns void language plpgsql as $$
begin
  reset role;
end;
$$;
-- one uploaded, confirmed, still-pending image for a product (as the seller does), returns its id
create function pg_temp.new_image(p_product uuid, p_size bigint) returns uuid
language plpgsql as $$
declare v_id uuid; v_key text;
begin
  perform pg_temp.act_as('70000001-0000-4000-8000-000000000001');
  v_id := (public.marketplace_seller_image_request_upload(p_product, 'image/png') ->> 'image_id')::uuid;
  perform pg_temp.back();
  select object_key into v_key from public.marketplace_product_images where id = v_id;
  perform pg_temp.backend_upload(v_key, p_size);
  perform pg_temp.act_as('70000001-0000-4000-8000-000000000001');
  perform public.marketplace_seller_image_confirm_upload(v_id);
  perform pg_temp.back();
  return v_id;
end;
$$;
-- the byte-level verdict the admin action records (size must equal the stored object)
create function pg_temp.validate(p_image uuid) returns void
language plpgsql as $$
declare v_size bigint;
begin
  select l.size_bytes into v_size from public.media_storage_locations l join public.marketplace_product_images i
    on i.object_key = l.object_key where i.id = p_image and l.namespace = 'marketplace';
  perform pg_temp.act_as('55555555-5555-4555-8555-555555555555');
  perform public.admin_marketplace_media_record_validation(p_image, true, 'png', 800, 600, v_size, repeat('a', 64));
  perform pg_temp.back();
end;
$$;

-- ===========================================================================
-- Fixture product P of showroom A: three pending images, stock, a seller
-- ===========================================================================
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select set_config('t.p', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper',
  'name_ar', 'ورق مراجعة', 'name_en', 'Review Paper', 'brand', 'ReviewBrand',
  'attributes', jsonb_build_object('material_wallpaper', 'vinyl_coated'),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'REVIEW-1', 'selling_unit', 'roll', 'price_egp', 300,
     'attributes', jsonb_build_object('color', 'beige', 'roll_width', 53, 'roll_length', 1000))))) ->> 'id'), true);
select set_config('t.v', (select id::text from public.marketplace_product_variants where sku = 'REVIEW-1' and seller_organization_id = current_setting('t.a')::uuid), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select public.marketplace_seller_stock_adjust(current_setting('t.v')::uuid, current_setting('t.loc')::uuid, 20, 'review-stock-0001');
select pg_temp.back();
select set_config('t.a1', pg_temp.new_image(current_setting('t.p')::uuid, 2048)::text, true);
select set_config('t.a2', pg_temp.new_image(current_setting('t.p')::uuid, 1024)::text, true);
select set_config('t.a3', pg_temp.new_image(current_setting('t.p')::uuid, 1536)::text, true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'admin\_marketplace\_product\_review\_%' or p.proname like 'admin\_marketplace\_review\_%'
         or p.proname = 'marketplace_seller_image_replace_request_upload') and has_function_privilege('anon', p.oid, 'execute')),
  null, 'A1. anon runs none of the product review RPCs');
select ok(has_function_privilege('authenticated', 'public.admin_marketplace_product_review_queue(text,integer,integer)', 'execute')
      and has_function_privilege('authenticated', 'public.admin_marketplace_product_review_reject(uuid,uuid[],text,text,uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.marketplace_seller_image_replace_request_upload(uuid,text)', 'execute'),
  'A2. the review and replacement RPCs are for signed-in users (each re-checks its own authority)');
select ok(not has_function_privilege('authenticated', 'app.marketplace_review_approve_image(uuid,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'app.marketplace_review_products(text)', 'execute')
      and not has_function_privilege('service_role', 'app.marketplace_review_approve_image(uuid,uuid)', 'execute'),
  'A3. the internal approval step and tab helper are closed to every client role');
select is((select count(*)::int from information_schema.role_table_grants
           where table_name in ('marketplace_seller_message_presets', 'marketplace_seller_preset_events')
             and grantee in ('anon', 'authenticated', 'service_role')), 0,
  'A4. the shared preset tables (PR 5) still have no client grant');
select is((select count(*)::int from public.marketplace_seller_message_presets where action = 'product_reject' and is_active), 5,
  'A5. product review adds five rejection presets to the ONE preset system (no table of its own)');
select is(app.marketplace_media_verification_ready(), true, 'A6. image verification is always mandatory');
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_like($$ select public.admin_marketplace_set_media_verification_ready(false, 'turn it off') $$, 'mp:media_verification_mandatory%',
  'A7. nobody can switch the verification off any more');
select pg_temp.back();
select ok('media_verification_not_available' <> all(app.marketplace_publication_blockers(current_setting('t.p')::uuid)),
  'A8. publication no longer waits for a media switch');

-- ===========================================================================
-- B. Access and the queue
-- ===========================================================================
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select throws_like($$ select public.admin_marketplace_product_review_queue() $$, 'mp:not_permitted%',
  'B1. a seller cannot open the review');
select throws_like($$ select public.admin_marketplace_product_review_approve(current_setting('t.p')::uuid) $$, 'mp:not_permitted%',
  'B2. a seller cannot approve its own product');
select throws_like($$ select public.admin_marketplace_product_review_reject(current_setting('t.p')::uuid, null, 'because', 'because', null) $$, 'mp:not_permitted%',
  'B3. a seller cannot reject');
select pg_temp.back();
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_like($$ select public.admin_marketplace_product_review_queue('nonsense') $$, 'mp:invalid_status%', 'B4. an unknown tab is refused');
select is((select jsonb_array_length(i -> 'images') from jsonb_array_elements(public.admin_marketplace_product_review_queue('pending', 50, 0) -> 'items') i
           where i ->> 'id' = current_setting('t.p')),
  3, 'B5. the pending tab lists the product with its three images inside');
select is((select (i ->> 'pending')::int from jsonb_array_elements(public.admin_marketplace_product_review_queue('pending', 50, 0) -> 'items') i
           where i ->> 'id' = current_setting('t.p')),
  3, 'B6. ...with its pending count');
select ok((public.admin_marketplace_product_review_summary() ->> 'pending')::int >= 1, 'B7. the summary counts the product as pending');
select is((select count(*)::int from jsonb_array_elements(public.admin_marketplace_product_review_queue('approved', 50, 0) -> 'items') i
           where i ->> 'id' = current_setting('t.p')), 0, 'B8. it is not in the approved tab yet');
select pg_temp.back();

-- ===========================================================================
-- C. The tick: approve the whole product
-- ===========================================================================
select pg_temp.validate(current_setting('t.a1')::uuid);
select pg_temp.validate(current_setting('t.a2')::uuid);
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is((select array_agg(e ->> 'result' order by e ->> 'id') from jsonb_array_elements(public.admin_marketplace_product_review_approve(current_setting('t.p')::uuid)) e),
  (select array_agg(r order by id) from (select id::text as id, case when id = current_setting('t.a3')::uuid then 'validation_required' else 'approved' end as r
     from public.marketplace_product_images where product_id = current_setting('t.p')::uuid) q),
  'C1. the two validated images are approved; the unvalidated one is reported, not approved');
select pg_temp.back();
select is((select count(*)::int from public.marketplace_product_images where product_id = current_setting('t.p')::uuid and status = 'verified'), 2,
  'C2. exactly two images are verified');
select is((select id::text from public.marketplace_product_images where product_id = current_setting('t.p')::uuid and is_primary), current_setting('t.a1'),
  'C3. the first confirmed image stays the primary one');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.product.rejected'
             and recipient_user_id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002')
             and subject_id = current_setting('t.p')::uuid), 0,
  'C4. approving notifies nobody');
select pg_temp.validate(current_setting('t.a3')::uuid);
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is((public.admin_marketplace_product_review_approve(current_setting('t.p')::uuid) -> 0 ->> 'result'), 'approved',
  'C5. once validated, the last image is approved by the tick');
select throws_like($$ select public.admin_marketplace_product_review_approve(current_setting('t.p')::uuid) $$, 'mp:no_pending_images%',
  'C6. a product with nothing pending has nothing to approve');
select is((select count(*)::int from jsonb_array_elements(public.admin_marketplace_product_review_queue('approved', 50, 0) -> 'items') i
           where i ->> 'id' = current_setting('t.p')), 1, 'C7. the product moved to the approved tab');
select pg_temp.back();
-- publish it so a rejection has a shelf to leave
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select public.marketplace_product_publish(current_setting('t.p')::uuid);
select pg_temp.back();
select is((select status from public.marketplace_products where id = current_setting('t.p')::uuid), 'published', 'C8. the approved product publishes');

-- ===========================================================================
-- D. The cross: reject with a reason and an owner message
-- ===========================================================================
-- exclude ONE approved image (the primary); another approved image keeps the product publishable
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_like($$ select public.admin_marketplace_product_review_reject(current_setting('t.p')::uuid, array[current_setting('t.a1')::uuid], '', 'visible to the owner', null) $$,
  'mp:reason_required%', 'D1. a reason is required');
select throws_like($$ select public.admin_marketplace_product_review_reject(current_setting('t.p')::uuid, array[current_setting('t.a1')::uuid], 'internal note', '', null) $$,
  'mp:owner_message_required%', 'D2. an owner message (custom text or a preset) is required');
select throws_like($$ select public.admin_marketplace_product_review_reject(current_setting('t.p')::uuid, array[current_setting('t.a1')::uuid], 'internal note', 'x', gen_random_uuid()) $$,
  'mp:preset_not_found%', 'D3. an unknown preset is refused');
select is((select count(*)::int from public.marketplace_product_images where product_id = current_setting('t.p')::uuid and status = 'rejected'), 0,
  'D4. refused calls rejected nothing');
select is((public.admin_marketplace_product_review_reject(current_setting('t.p')::uuid, array[current_setting('t.a1')::uuid],
    'the primary photo is a stock picture', 'Please use your own photo of the product.', null) -> 0 ->> 'result'), 'rejected',
  'D5. one approved image can be excluded from publication');
select pg_temp.back();
select is((select id::text from public.marketplace_product_images where product_id = current_setting('t.p')::uuid and is_primary), current_setting('t.a2'),
  'D6. the primary slot passes to the next approved image');
select is((select status from public.marketplace_products where id = current_setting('t.p')::uuid), 'published',
  'D7. the product stays on the shelf: another approved image remains');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.product.rejected'
             and recipient_user_id = '70000001-0000-4000-8000-000000000001' and subject_id = current_setting('t.p')::uuid), 1,
  'D8. the owner got exactly one in-app notification');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.product.rejected'
             and recipient_user_id <> '70000001-0000-4000-8000-000000000001' and subject_id = current_setting('t.p')::uuid), 0,
  'D9. nobody else (a sales-only member, another showroom) was notified');
select is((select organization_id::text from public.notifications where event_type = 'marketplace.product.rejected'
             and subject_id = current_setting('t.p')::uuid limit 1), current_setting('t.a'),
  'D10. the notification carries the organization id');
select ok((select content #>> '{ar,body}' like '%ورق مراجعة%' and content #>> '{en,body}' like '%Review Paper%'
             and content #>> '{en,body}' like '%Please use your own photo of the product.%'
             and content #>> '{ar,body}' like '%Please use your own photo of the product.%'
           from public.notifications where event_type = 'marketplace.product.rejected' and subject_id = current_setting('t.p')::uuid limit 1),
  'D11. both languages name the product; a custom message is carried as typed');
select is((select detail ->> 'reason' from public.marketplace_image_moderation_events
           where image_id = current_setting('t.a1')::uuid and action = 'rejected'), 'the primary photo is a stock picture',
  'D12. the internal reason is in the audit trail');
select is((select detail ->> 'owner_message_en' from public.marketplace_image_moderation_events
           where image_id = current_setting('t.a1')::uuid and action = 'rejected'), 'Please use your own photo of the product.',
  'D13. ...with the message the owner was told');

-- reject ALL pending of another product with a PRESET: bilingual message
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select set_config('t.q', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper',
  'name_ar', 'ورق ثان', 'name_en', 'Second Paper', 'brand', 'ReviewBrand',
  'attributes', jsonb_build_object('material_wallpaper', 'vinyl_coated'),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'REVIEW-2', 'selling_unit', 'roll', 'price_egp', 250,
     'attributes', jsonb_build_object('color', 'beige', 'roll_width', 53, 'roll_length', 1000))))) ->> 'id'), true);
select pg_temp.back();
select set_config('t.q1', pg_temp.new_image(current_setting('t.q')::uuid, 700)::text, true);
select set_config('t.q2', pg_temp.new_image(current_setting('t.q')::uuid, 800)::text, true);
select set_config('t.preset', (select id::text from public.marketplace_seller_message_presets where action = 'product_reject' and label_en = 'Blurry or low quality'), true);
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is((select array_agg(e ->> 'result') from jsonb_array_elements(
    public.admin_marketplace_product_review_reject(current_setting('t.q')::uuid, null, 'both photos blurry', null, current_setting('t.preset')::uuid)) e),
  array['rejected', 'rejected'], 'D14. the cross rejects every pending image of the product at once');
select pg_temp.back();
select is((select count(*)::int from public.notifications where event_type = 'marketplace.product.rejected'
             and subject_id = current_setting('t.q')::uuid), 1, 'D15. ONE notification for the whole product, not one per image');
select ok((select content #>> '{ar,body}' like '%غير واضحة%' and content #>> '{en,body}' like '%blurry or low quality%'
           from public.notifications where subject_id = current_setting('t.q')::uuid limit 1),
  'D16. a preset reaches the owner in Arabic AND English, each in its own language');
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from jsonb_array_elements(public.admin_marketplace_product_review_queue('rejected', 50, 0) -> 'items') i
           where i ->> 'id' = current_setting('t.q')), 1, 'D17. the fully rejected product is in the rejected tab');
select pg_temp.back();

-- ===========================================================================
-- E. No final rejection
-- ===========================================================================
select pg_temp.validate(current_setting('t.q1')::uuid);
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is((public.admin_marketplace_media_approve(array[current_setting('t.q1')::uuid]) -> 0 ->> 'result'), 'approved',
  'E1. a rejected image can be approved later');
select pg_temp.back();
select is((select (detail ->> 'reconsidered')::boolean from public.marketplace_image_moderation_events
           where image_id = current_setting('t.q1')::uuid and action = 'approved'), true, 'E2. the trail marks it as reconsidered');
select is((select is_primary from public.marketplace_product_images where id = current_setting('t.q1')::uuid), true,
  'E3. a product without a primary image gets the reconsidered one');

-- ===========================================================================
-- F. Replacing an approved image
-- ===========================================================================
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select throws_like($$ select public.marketplace_seller_image_replace_request_upload(current_setting('t.a1')::uuid, 'image/png') $$, 'mp:image_not_replaceable%',
  'F1. only an approved image can be replaced (this one was rejected)');
select pg_temp.back();
select pg_temp.act_as('71000005-0000-4000-8000-000000000005');
select throws_like($$ select public.marketplace_seller_image_replace_request_upload(current_setting('t.a2')::uuid, 'image/png') $$, 'mp:%',
  'F2. another showroom cannot replace it');
select pg_temp.back();
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select set_config('t.r1', (public.marketplace_seller_image_replace_request_upload(current_setting('t.a2')::uuid, 'image/png') ->> 'image_id'), true);
select pg_temp.back();
select is((select replaces_image_id::text from public.marketplace_product_images where id = current_setting('t.r1')::uuid), current_setting('t.a2'),
  'F3. the replacement points at the image it will replace');
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select throws_like($$ select public.marketplace_seller_image_replace_request_upload(current_setting('t.a2')::uuid, 'image/png') $$, 'mp:replacement_pending%',
  'F4. one open replacement per image');
select pg_temp.back();
select pg_temp.backend_upload((select object_key from public.marketplace_product_images where id = current_setting('t.r1')::uuid), 900);
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select public.marketplace_seller_image_confirm_upload(current_setting('t.r1')::uuid);
select pg_temp.back();
select is((select status || '/' || is_primary::text from public.marketplace_product_images where id = current_setting('t.r1')::uuid), 'pending/false',
  'F5. the replacement waits as a normal pending image, not primary');
select is((select status || '/' || upload_state from public.marketplace_product_images where id = current_setting('t.a2')::uuid), 'verified/confirmed',
  'F6. the old image stays live while the new one is pending');

-- rejected replacement: the old one stays
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.admin_marketplace_product_review_reject(current_setting('t.p')::uuid, array[current_setting('t.r1')::uuid], 'not sharp', 'The new photo is not sharp enough.', null);
select pg_temp.back();
select is((select status || '/' || upload_state from public.marketplace_product_images where id = current_setting('t.a2')::uuid), 'verified/confirmed',
  'F7. a rejected replacement leaves the old image live');
select is((select is_primary from public.marketplace_product_images where id = current_setting('t.a2')::uuid), true, 'F8. ...and primary');

-- the seller tries again; this time it is approved
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select set_config('t.r2', (public.marketplace_seller_image_replace_request_upload(current_setting('t.a2')::uuid, 'image/png') ->> 'image_id'), true);
select pg_temp.back();
select pg_temp.backend_upload((select object_key from public.marketplace_product_images where id = current_setting('t.r2')::uuid), 950);
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select public.marketplace_seller_image_confirm_upload(current_setting('t.r2')::uuid);
select pg_temp.back();
select pg_temp.validate(current_setting('t.r2')::uuid);
select set_config('t.old_sort', (select sort_order::text from public.marketplace_product_images where id = current_setting('t.a2')::uuid), true);
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is((public.admin_marketplace_product_review_approve(current_setting('t.p')::uuid) -> 0 ->> 'result'), 'approved', 'F9. the second replacement is approved');
select pg_temp.back();
select is((select status || '/' || is_primary::text || '/' || sort_order::text from public.marketplace_product_images where id = current_setting('t.r2')::uuid),
  'verified/true/' || current_setting('t.old_sort'), 'F10. it takes over the old image''s primary slot and place in the order');
select is((select status || '/' || upload_state || '/' || is_primary::text from public.marketplace_product_images where id = current_setting('t.a2')::uuid),
  'rejected/deleting/false', 'F11. the old image entered the removal lifecycle');
select is((select action from public.marketplace_image_moderation_events where image_id = current_setting('t.a2')::uuid order by sequence desc limit 1),
  'replaced', 'F12. the trail records the replacement');
select is((select status from public.marketplace_products where id = current_setting('t.p')::uuid), 'published',
  'F13. the product stayed on the shelf through the swap');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::int from public.media_cleanup_candidates(100) c
           where c.namespace = 'marketplace' and c.object_key = (select object_key from public.marketplace_product_images where id = current_setting('t.a2')::uuid)),
  1, 'F14. the old bytes are a central cleanup candidate (no useless file stays in R2)');
select public.media_cleanup_complete('marketplace', (select object_key from public.marketplace_product_images where id = current_setting('t.a2')::uuid),
  '70000001-0000-4000-8000-000000000001');
select is((public.marketplace_rejected_images_purge() ->> 'forgotten')::int >= 1, true, 'F15. once the bytes are gone, the old row is forgotten');
select is((select count(*)::int from public.marketplace_product_images where id = current_setting('t.a2')::uuid), 0, 'F16. ...it no longer exists');
reset role;
select set_config('request.jwt.claims', '', true);

-- ===========================================================================
-- G. Presets (the PR 5 system, kind 'product_reject')
-- ===========================================================================
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from jsonb_array_elements(public.admin_marketplace_review_presets())), 5,
  'G1. a moderator reads the five active product-review presets');
select throws_like($$ select public.admin_marketplace_seller_preset_save(null, 'product_reject', 'تسمية', 'Label', 'رسالة المالك', 'Owner message', true, 60, 'because') $$,
  '%notification_templates.manage%', 'G2. only a notification-template manager can create one (same permission as PR 5)');
select pg_temp.back();
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select throws_like($$ select public.admin_marketplace_review_presets() $$, 'mp:not_permitted%', 'G3. a seller cannot read them');
select pg_temp.back();
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select set_config('t.np', public.admin_marketplace_seller_preset_save(null, 'product_reject', 'تسمية', 'Label', 'رسالة المالك', 'Owner message', true, 60, 'new preset')::text, true);
select pg_temp.back();
select is((select action from public.marketplace_seller_preset_events where preset_id = current_setting('t.np')::uuid), 'created',
  'G4. a manager creates a product-review preset and it is audited by the PR 5 trail');
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from jsonb_array_elements(public.admin_marketplace_review_presets())), 6, 'G5. the moderator sees it at once');
select pg_temp.back();
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select public.admin_marketplace_seller_preset_save(current_setting('t.np')::uuid, 'product_reject', 'تسمية', 'Label', 'رسالة المالك', 'Owner message', false, 60, 'switch off');
select pg_temp.back();
select set_config('t.approve_preset', (select id::text from public.marketplace_seller_message_presets where action = 'approve' limit 1), true);
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from jsonb_array_elements(public.admin_marketplace_review_presets()) i where i ->> 'id' = current_setting('t.np')), 0,
  'G6. a switched-off preset disappears for the moderator');
select throws_like($$ select public.admin_marketplace_product_review_reject(current_setting('t.q')::uuid, array[current_setting('t.q1')::uuid], 'x reason', null, current_setting('t.np')::uuid) $$,
  'mp:preset_not_found%', 'G7. ...and cannot be used');
select throws_like($$ select public.admin_marketplace_product_review_reject(current_setting('t.q')::uuid, array[current_setting('t.q1')::uuid], 'x reason', null,
    current_setting('t.approve_preset')::uuid) $$,
  'mp:preset_not_found%', 'G8. a seller-transition preset (kind approve) cannot be used for a product rejection');
select pg_temp.back();

-- ===========================================================================
-- H. Retention of a rejected image (media policy, unchanged)
-- ===========================================================================
update public.marketplace_product_images set moderated_at = now() - interval '3 days' where id = current_setting('t.q2')::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((public.marketplace_rejected_images_purge() ->> 'expired')::int >= 1, true, 'H1. a rejected image older than two days enters the removal lifecycle');
reset role;
select is((select upload_state from public.marketplace_product_images where id = current_setting('t.q2')::uuid), 'deleting', 'H2. ...and its bytes are scheduled for deletion');
select is((select status || '/' || upload_state from public.marketplace_product_images where id = current_setting('t.q1')::uuid), 'verified/confirmed',
  'H3. an image that was reconsidered and approved is untouched by the purge');

select * from finish();
rollback;
