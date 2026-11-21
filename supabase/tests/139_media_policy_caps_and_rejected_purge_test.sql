-- pgTAP: site-wide media policy (20261121090001_media_policy_caps_and_rejected_purge.sql).
--
--   A. IMAGE CAP    — the verification receipt accepts up to 10 MiB for site content (the old 5 MiB
--                     limit is gone) and refuses one byte more; avatars keep their 3 MiB ceiling.
--   B. VIDEO CAP    — a new media_videos row over 100 MiB is refused, exactly 100 MiB is accepted.
--   C. PURGE        — rejected Marketplace images enter the removal lifecycle after two days, not
--                     before; non-rejected images are never touched; central cleanup picks them up;
--                     the row is forgotten only after the deletion is confirmed; privileges.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001).
create extension if not exists pgtap;

begin;
select plan(18);

update auth.users set email_confirmed_at = now() where id = '70000001-0000-4000-8000-000000000001';
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.owner', '70000001-0000-4000-8000-000000000001', true);
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

create function pg_temp.backend_reserve(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.media_storage_reserve('marketplace', p_key, 'r2', current_setting('t.owner')::uuid);
end;
$$;
create function pg_temp.backend_attest(p_key text, p_type text, p_size bigint) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.media_storage_attest('marketplace', p_key, current_setting('t.owner')::uuid, 'r2', p_size, p_type, repeat('c', 64));
end;
$$;
create function pg_temp.backend_cleaned(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.media_cleanup_complete('marketplace', p_key, current_setting('t.owner')::uuid);
end;
$$;

-- a product with three uploaded images
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.p', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper',
  'name_ar', 'س', 'name_en', 'Media policy product',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'MP-1', 'selling_unit', 'roll', 'price_egp', 10,
      'attributes', jsonb_build_object('color', 'beige')))))->>'id'), true);
select set_config('t.i1', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') ->> 'image_id'), true);
select set_config('t.i2', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') ->> 'image_id'), true);
select set_config('t.i3', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') ->> 'image_id'), true);
reset role;
select set_config('t.k1', (select object_key from public.marketplace_product_images where id = current_setting('t.i1')::uuid), true);
select set_config('t.k2', (select object_key from public.marketplace_product_images where id = current_setting('t.i2')::uuid), true);
select set_config('t.k3', (select object_key from public.marketplace_product_images where id = current_setting('t.i3')::uuid), true);
select pg_temp.backend_reserve(current_setting('t.k1'));
select pg_temp.backend_reserve(current_setting('t.k2'));
select pg_temp.backend_reserve(current_setting('t.k3'));

-- ===========================================================================
-- A. Image cap on the verification receipt
-- ===========================================================================
select lives_ok($$select pg_temp.backend_attest(current_setting('t.k1'), 'image/png', 8 * 1024 * 1024)$$,
  'A1. an 8 MiB image receives its verification receipt (the old 5 MiB limit is gone)');
select lives_ok($$select pg_temp.backend_attest(current_setting('t.k2'), 'image/png', 10 * 1024 * 1024)$$,
  'A2. exactly 10 MiB is accepted');
select throws_ok($$select pg_temp.backend_attest(current_setting('t.k3'), 'image/png', 10 * 1024 * 1024 + 1)$$,
  '42501', 'invalid verification receipt', 'A3. one byte over 10 MiB is refused');
select lives_ok($$select pg_temp.backend_attest(current_setting('t.k3'), 'image/png', 1000)$$,
  'A4. the refusal did not poison the key: a valid receipt is still accepted');
select ok(pg_get_functiondef('public.media_storage_attest(text,text,uuid,text,bigint,text,text)'::regprocedure) like '%''avatar'' then 3145728%',
  'A5. avatars keep their 3 MiB ceiling');

-- ===========================================================================
-- B. Video cap on new uploads
-- ===========================================================================
select throws_ok($$insert into public.media_videos (owner_user_id, scope, title, content_type, declared_bytes, sort_order)
    values ('70000001-0000-4000-8000-000000000001', 'portfolio', 'too big', 'video/mp4', 104857601, 1)$$,
  '22023', 'video is larger than 100 MB', 'B1. a new video row over 100 MiB is refused');
select lives_ok($$insert into public.media_videos (owner_user_id, scope, title, content_type, declared_bytes, sort_order)
    values ('70000001-0000-4000-8000-000000000001', 'portfolio', 'just fits', 'video/mp4', 104857600, 1)$$,
  'B2. exactly 100 MiB is accepted');

-- ===========================================================================
-- C. Rejected-image purge after two days
-- ===========================================================================
-- confirm the three images, then record the admin decisions the moderation RPC writes
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.marketplace_seller_image_confirm_upload(current_setting('t.i1')::uuid);
select public.marketplace_seller_image_confirm_upload(current_setting('t.i2')::uuid);
select public.marketplace_seller_image_confirm_upload(current_setting('t.i3')::uuid);
reset role;
update public.marketplace_product_images set status = 'rejected', is_primary = false,
  moderated_at = now() - interval '3 days', moderation_reason = 'blurry' where id = current_setting('t.i1')::uuid;
update public.marketplace_product_images set status = 'rejected', is_primary = false,
  moderated_at = now() - interval '1 day', moderation_reason = 'blurry' where id = current_setting('t.i2')::uuid;

select ok(not has_function_privilege('authenticated', 'public.marketplace_rejected_images_purge(interval,integer)', 'execute')
  and not has_function_privilege('anon', 'public.marketplace_rejected_images_purge(interval,integer)', 'execute')
  and has_function_privilege('service_role', 'public.marketplace_rejected_images_purge(interval,integer)', 'execute'),
  'C1. only the service role may run the purge');
select throws_ok($$select public.marketplace_rejected_images_purge(interval '1 hour')$$, '22023', 'retention below one day',
  'C2. the retention cannot be shortened below a day');

select is((select public.marketplace_rejected_images_purge()), '{"expired": 1, "forgotten": 0}'::jsonb,
  'C3. only the image rejected three days ago expires');
select is((select upload_state from public.marketplace_product_images where id = current_setting('t.i1')::uuid), 'deleting',
  'C4. it enters the removal lifecycle');
select is((select upload_state from public.marketplace_product_images where id = current_setting('t.i2')::uuid), 'confirmed',
  'C5. an image rejected one day ago is kept for now');
select is((select upload_state || '/' || status from public.marketplace_product_images where id = current_setting('t.i3')::uuid), 'confirmed/pending',
  'C6. an image that was not rejected is never touched');
select ok(exists (select 1 from public.media_cleanup_candidates(50) c where c.namespace = 'marketplace' and c.object_key = current_setting('t.k1')),
  'C7. central cleanup now lists it so its bytes are deleted');
select is((select public.marketplace_rejected_images_purge()), '{"expired": 0, "forgotten": 0}'::jsonb,
  'C8. a second run does nothing, and the row is not forgotten before the bytes are confirmed gone');
select pg_temp.backend_cleaned(current_setting('t.k1'));
select is((select public.marketplace_rejected_images_purge()), '{"expired": 0, "forgotten": 1}'::jsonb,
  'C9. once cleanup recorded the deletion, the row is forgotten');
select is((select count(*)::int from public.marketplace_product_images where id = current_setting('t.i1')::uuid), 0,
  'C10. ...and it is gone');

select is((select array_agg(id order by id) from storage.buckets where file_size_limit = 10485760 and id in ('professional-portfolio', 'product-images', 'purchase-request-images')),
  array['product-images', 'professional-portfolio', 'purchase-request-images']::text[],
  'D1. the legacy site-content buckets accept the 10 MiB image cap, not the old 5 MiB');

select * from finish();
rollback;
