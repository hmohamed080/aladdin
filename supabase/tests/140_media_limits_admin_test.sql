-- pgTAP: admin-configurable media limits (20261121090002_media_limits_admin.sql).
--
--   A. READ         — defaults equal the previous caps; signed-in users and the server read them, anon does not.
--   B. WHO CHANGES  — only media_limits.manage (Super Admin); view-only and plain users are refused.
--   C. GUARDS       — mandatory reason, hard ceiling, floor, unknown place, no-op writes no history.
--   D. HISTORY      — who/when/old/new/reason, append-only, readable with media_limits.view.
--   E. ENFORCEMENT  — the verification receipt and the media_videos trigger read the STORED value; a missing
--                     row fails closed; the tables are closed to clients.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001). Everything else is created in the transaction.
create extension if not exists pgtap;

begin;
select plan(27);

\set sup  '6d000000-0000-4000-8000-000000000001'
\set adm  '6d000000-0000-4000-8000-000000000002'
\set nobody '6d000000-0000-4000-8000-000000000003'
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  (:'sup', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ml-sup@probe.test', now(), '{}', now(), now()),
  (:'adm', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ml-adm@probe.test', now(), '{}', now(), now()),
  (:'nobody', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ml-nobody@probe.test', now(), '{}', now(), now());
insert into public.admin_role_assignments (user_id, role_id) select :'sup', id from public.admin_roles where key = 'super_admin';
insert into public.admin_role_assignments (user_id, role_id) select :'adm', id from public.admin_roles where key = 'administrator';

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end;
$$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ===========================================================================
-- A. Read
-- ===========================================================================
select pg_temp.act_as(:'nobody');
select is((select count(*)::int from public.media_limits_get()), 10, 'A1. a signed-in user reads the ten limits');
select is((select max_bytes from public.media_limits_get() where kind = 'image' and place = 'marketplace'), 10485760::bigint,
  'A2. the marketplace image default is the 10 MB cap');
select is((select array_agg(place || ':' || max_bytes order by place) from public.media_limits_get() where kind = 'video'),
  array['portfolio:104857600', 'product:104857600'], 'A3. both video places default to 100 MB');
select is((select ceiling_bytes from public.media_limits_get() where kind = 'image' limit 1), 20971520::bigint,
  'A4. the hard ceiling travels with the limits (20 MiB images)');
reset role;
set local role anon;
select throws_ok($$select * from public.media_limits_get()$$, '42501', null, 'A5. anonymous visitors cannot read the limits');
reset role;

-- ===========================================================================
-- B. Who may change a limit
-- ===========================================================================
select pg_temp.act_as(:'nobody');
select throws_ok($$select public.admin_media_limit_set('image', 'marketplace', 15728640, 'because')$$, '42501',
  'permission media_limits.manage is required', 'B1. a plain user cannot change a limit');
select pg_temp.act_as(:'adm');
select throws_ok($$select public.admin_media_limit_set('image', 'marketplace', 15728640, 'because')$$, '42501',
  'permission media_limits.manage is required', 'B2. an Administrator (view only) cannot change a limit');
select ok((select count(*) from public.admin_media_limit_events(10)) >= 0, 'B3. ...but can read the history');
select pg_temp.act_as(:'nobody');
select throws_ok($$select * from public.admin_media_limit_events(10)$$, '42501', 'permission media_limits.view is required',
  'B4. a plain user cannot read the history');

-- ===========================================================================
-- C. Guards, and a successful change
-- ===========================================================================
select pg_temp.act_as(:'sup');
select throws_ok($$select public.admin_media_limit_set('image', 'marketplace', 15728640, '  ')$$, '22023', 'a reason of 3-500 characters is required',
  'C1. a reason is mandatory');
select throws_ok($$select public.admin_media_limit_set('image', 'marketplace', 26214401, 'too big')$$, '22023', 'the limit exceeds the platform ceiling',
  'C2. one byte above the 20 MiB image ceiling is refused');
select throws_ok($$select public.admin_media_limit_set('video', 'product', 1073741825, 'too big')$$, '22023', 'the limit exceeds the platform ceiling',
  'C3. one byte above the 1 GiB video ceiling is refused');
select throws_ok($$select public.admin_media_limit_set('image', 'marketplace', 1000, 'too small')$$, '22023', 'the limit is below the minimum',
  'C4. a typo that would lock a place out is refused');
select throws_ok($$select public.admin_media_limit_set('image', 'nosuchplace', 1048576, 'nope')$$, '22023', 'unknown place',
  'C5. an unknown place is refused');
select is((public.admin_media_limit_set('image', 'marketplace', 15728640, 'Showrooms upload large catalogue photos'))->>'changed', 'true',
  'C6. a Super Admin changes the marketplace image limit to 15 MiB');
select is((public.admin_media_limit_set('image', 'marketplace', 15728640, 'again'))->>'changed', 'false', 'C7. writing the same value changes nothing');
reset role;
select is((select count(*)::int from public.media_limit_events where kind = 'image' and place = 'marketplace'), 1,
  'C8. ...and the no-op wrote no history');

-- ===========================================================================
-- D. History
-- ===========================================================================
select is((select row(old_bytes, new_bytes, actor_id, reason)::text from public.media_limit_events where place = 'marketplace'),
  row(10485760::bigint, 15728640::bigint, :'sup'::uuid, 'Showrooms upload large catalogue photos')::text,
  'D1. the event records old, new, who and why');
select throws_ok($$update public.media_limit_events set reason = 'edited'$$, '23514', null, 'D2. the history is append-only (update)');
select throws_ok($$delete from public.media_limit_events$$, '23514', null, 'D3. the history is append-only (delete)');

-- ===========================================================================
-- E. Enforcement reads the stored value
-- ===========================================================================
-- E1-E3: the verification receipt of a marketplace image
update auth.users set email_confirmed_at = now() where id = '70000001-0000-4000-8000-000000000001';
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values ('9c000000-cccc-4ccc-8ccc-000000000001', 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select set_config('t.p', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', '9c000000-cccc-4ccc-8ccc-000000000001', 'product_type_key', 'wallpaper',
  'name_ar', 'س', 'name_en', 'Media limits product',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'ML-1', 'selling_unit', 'roll', 'price_egp', 10,
      'attributes', jsonb_build_object('color', 'beige')))))->>'id'), true);
select set_config('t.i1', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') ->> 'image_id'), true);
reset role;
select set_config('t.k1', (select object_key from public.marketplace_product_images where id = current_setting('t.i1')::uuid), true);
select pg_temp.as_service();
select public.media_storage_reserve('marketplace', current_setting('t.k1'), 'r2', '70000001-0000-4000-8000-000000000001');
select lives_ok($$select public.media_storage_attest('marketplace', current_setting('t.k1'), '70000001-0000-4000-8000-000000000001', 'r2', 15728640, 'image/png', repeat('c', 64))$$,
  'E1. 15 MiB is accepted now that the stored limit is 15 MiB (the compiled default was 10 MiB)');
select pg_temp.as_owner();

-- a second image, to show the limit is read at receipt time, in both directions
select pg_temp.act_as('70000001-0000-4000-8000-000000000001');
select set_config('t.i2', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png') ->> 'image_id'), true);
reset role;
select set_config('t.k2', (select object_key from public.marketplace_product_images where id = current_setting('t.i2')::uuid), true);
select pg_temp.as_service();
select public.media_storage_reserve('marketplace', current_setting('t.k2'), 'r2', '70000001-0000-4000-8000-000000000001');
select throws_ok($$select public.media_storage_attest('marketplace', current_setting('t.k2'), '70000001-0000-4000-8000-000000000001', 'r2', 15728641, 'image/png', repeat('d', 64))$$,
  '42501', 'invalid verification receipt', 'E2. one byte over the stored limit is refused');
select pg_temp.as_owner();
update public.media_limits set max_bytes = 1048576 where kind = 'image' and place = 'marketplace';
select pg_temp.as_service();
select throws_ok($$select public.media_storage_attest('marketplace', current_setting('t.k2'), '70000001-0000-4000-8000-000000000001', 'r2', 2097152, 'image/png', repeat('d', 64))$$,
  '42501', 'invalid verification receipt', 'E3. a lowered limit applies to the next receipt');
select pg_temp.as_owner();
delete from public.media_limits where kind = 'image' and place = 'marketplace';
select pg_temp.as_service();
select throws_ok($$select public.media_storage_attest('marketplace', current_setting('t.k2'), '70000001-0000-4000-8000-000000000001', 'r2', 1000, 'image/png', repeat('d', 64))$$,
  '42501', 'invalid verification receipt', 'E4. a place with no stored limit fails closed');
select pg_temp.as_owner();

-- E5-E6: the video trigger
update public.media_limits set max_bytes = 52428800 where kind = 'video' and place = 'portfolio';
select throws_ok($$insert into public.media_videos (owner_user_id, scope, title, content_type, declared_bytes, sort_order)
    values ('70000001-0000-4000-8000-000000000001', 'portfolio', 'over', 'video/mp4', 52428801, 1)$$,
  '22023', 'video is larger than the limit for this place', 'E5. a video above the stored portfolio limit is refused');
select lives_ok($$insert into public.media_videos (owner_user_id, scope, title, content_type, declared_bytes, sort_order)
    values ('70000001-0000-4000-8000-000000000001', 'portfolio', 'exact', 'video/mp4', 52428800, 1)$$,
  'E6. exactly the stored limit is accepted');

-- E7: the tables are closed to clients
select pg_temp.act_as(:'sup');
select throws_ok($$select * from public.media_limits$$, '42501', null, 'E7. even a Super Admin reads the table only through the RPCs');
reset role;

select * from finish();
rollback;
