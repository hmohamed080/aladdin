-- pgTAP: Marketplace product video (20261123120001 / 20261123120002).
--
--   A. SHAPE      - new scope, columns, privileges (internal reason, events, helpers, admin RPCs).
--   B. AUTHZ      - org.manage of the seller organization decides; sales-only member, outsider and anon cannot.
--   C. LIMITS     - three slots per product, type, the admin-configurable 'product' video cap.
--   D. REVIEW     - pending -> approved / rejected by marketplace_media.moderate only, reasons, trail.
--   E. EDGE       - media_edge_video: seller managers and reviewers yes, sales-only member / outsider / anonymous no.
--   F. LIFECYCLE  - rename sends an approved video back to review; delete revokes at once; suspended seller can only delete.
--
-- Fixtures (seed-pilot): showroom A 9c000000-...001 (owner 70000001; 70000002 is a sales-only member),
-- outsider 70000009, staff 55555555 (administrator).
create extension if not exists pgtap;
begin;
select no_plan();

create function pg_temp.edge(vid uuid, viewer uuid, sess uuid, ws uuid, exp timestamptz) returns jsonb
language plpgsql as $$ declare v jsonb; begin
  set local role media_edge; v := public.media_edge_video(vid, viewer, sess, ws, exp); reset role; return v;
end $$;

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
\set hana '70000001-0000-4000-8000-000000000001'
\set sara '70000002-0000-4000-8000-000000000002'
\set pro '70000009-0000-4000-8000-000000000009'
\set staff '55555555-5555-4555-8555-555555555555'
\set org '9c000000-cccc-4ccc-8ccc-000000000001'
\set s_hana 'ea000000-0000-4000-8000-000000000003'
\set s_sara 'ea000000-0000-4000-8000-000000000004'
\set s_pro 'ea000000-0000-4000-8000-000000000001'
\set s_staff 'ea000000-0000-4000-8000-000000000005'
\set c_hana '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set c_sara '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set c_pro '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}'
\set c_staff '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}'
\set exp 'now()+interval ''90 seconds'''
\set rev 'ea100000-0000-4000-8000-0000000000a1'
insert into auth.sessions(id, user_id, created_at, aal) values
 (:'s_hana', :'hana', now(), 'aal1'), (:'s_sara', :'sara', now(), 'aal1'),
 (:'s_pro', :'pro', now(), 'aal1'), (:'s_staff', :'staff', now(), 'aal1');

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (:'org', 'approved', now());
select set_config('app.marketplace_seller_write', 'off', true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select ok(exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                   where t.typname = 'media_video_scope' and e.enumlabel = 'marketplace'), 'A1. the marketplace scope exists');
select ok(not has_column_privilege('authenticated', 'public.media_videos', 'review_reason', 'SELECT')
  and not has_column_privilege('authenticated', 'public.media_videos', 'review_status', 'SELECT')
  and has_function_privilege('authenticated', 'public.marketplace_product_video_list(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.marketplace_product_video_list(uuid)', 'EXECUTE'),
  'A2. clients read marketplace videos only through the list RPC (no review column grant)');
select ok(not has_table_privilege('authenticated', 'public.marketplace_video_events', 'SELECT')
  and not has_table_privilege('anon', 'public.marketplace_video_events', 'SELECT')
  and not has_table_privilege('service_role', 'public.marketplace_video_events', 'INSERT'),
  'A3. the trail has no client or service grant');
select ok(not has_function_privilege(r, f, 'EXECUTE'), format('A4. %s cannot call %s', r, f))
  from unnest(array['anon', 'service_role']) r,
       unnest(array['public.admin_marketplace_video_review(uuid,text,text,text,text)',
                    'public.admin_marketplace_pending_videos(integer)',
                    'public.admin_marketplace_product_videos(uuid)']) f;
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname like 'marketplace\_video\_%'
              and has_function_privilege('authenticated', p.oid, 'execute')), 0,
  'A5. no app.marketplace_video_* helper is executable by a client');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'admin\_marketplace\_%video%' and p.prosecdef
              and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')), 3,
  'A6. the three admin video RPCs are SECURITY DEFINER with an empty search_path');

-- A marketplace product (draft) of showroom A.
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select set_config('t.p', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', :'org', 'product_type_key', 'wallpaper',
  'name_ar', 'ورق حائط', 'name_en', 'Video Wallpaper',
  'attributes', jsonb_build_object('material_wallpaper', 'vinyl_coated', 'washable', true),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'VID-1', 'selling_unit', 'roll', 'price_egp', '450.00',
    'attributes', jsonb_build_object('color', 'beige', 'roll_width', 53, 'roll_length', 1000))))) ->> 'id'), true);
reset role;

-- ===========================================================================
-- B. Authorization
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'c_sara';
select throws_ok(format($q$select public.video_upload_begin('marketplace', %L, 'Tour', 'video/mp4', 1000)$q$, current_setting('t.p')),
  '42501', 'mp:not_permitted', 'B1. a sales-only member (no org.manage) cannot add a video');
set local request.jwt.claims = :'c_pro';
select throws_ok(format($q$select public.video_upload_begin('marketplace', %L, 'Tour', 'video/mp4', 1000)$q$, current_setting('t.p')),
  '42501', 'mp:not_permitted', 'B2. an outsider cannot add a video');
set local role anon;
set local request.jwt.claims = '';
select throws_ok(format($q$select public.video_upload_begin('marketplace', %L, 'Tour', 'video/mp4', 1000)$q$, current_setting('t.p')),
  '42501', null, 'B3. anonymous callers cannot add a video (no EXECUTE)');
reset role;

set local role authenticated;
set local request.jwt.claims = :'c_hana';
select throws_ok($q$select public.video_upload_begin('marketplace', '00000000-0000-4000-8000-0000000000ff', 'Tour', 'video/mp4', 1000)$q$,
  '42501', 'mp:not_permitted', 'B4. an unknown product is refused like a foreign one');
select throws_ok($q$select public.video_upload_begin('marketplace', null, 'Tour', 'video/mp4', 1000)$q$,
  '42501', 'mp:not_permitted', 'B5. a marketplace video needs a product');
select lives_ok(format($q$select set_config('t.v1', public.video_upload_begin('marketplace', %L, 'Front view', 'video/mp4', 1000)::text, true)$q$, current_setting('t.p')),
  'B6. the owner (org.manage) of the seller adds a video');
reset role;
select is((select scope::text || '/' || slot || '/' || review_status || '/' || (seller_organization_id = :'org'::uuid)
             from public.media_videos where id = current_setting('t.v1')::uuid),
  'marketplace/1/pending/true', 'B7. it takes slot 1, starts pending, and belongs to the seller organization');
select is((select count(*)::int from public.marketplace_video_events where video_id = current_setting('t.v1')::uuid and action = 'added'),
  1, 'B8. the trail records it');

-- ===========================================================================
-- C. Limits
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select throws_ok(format($q$select public.video_upload_begin('marketplace', %L, 'Tour', 'video/x-msvideo', 1000)$q$, current_setting('t.p')),
  '22023', 'unsupported video type', 'C1. only mp4, mov and webm');
select throws_ok(format($q$select public.video_upload_begin('marketplace', %L, 'Tour', 'video/mp4', 104857601)$q$, current_setting('t.p')),
  '22023', 'video is larger than the limit for this place', 'C2. the site-wide 100 MB cap applies (the product place)');
select lives_ok(format($q$select public.video_upload_begin('marketplace', %L, 'Exactly 100 MB', 'video/mp4', 104857600)$q$, current_setting('t.p')),
  'C3. exactly 100 MB is accepted (slot 2)');
select lives_ok(format($q$select set_config('t.v3', public.video_upload_begin('marketplace', %L, 'Third', 'video/webm', 2000)::text, true)$q$, current_setting('t.p')),
  'C4. the third video is accepted');
select throws_ok(format($q$select public.video_upload_begin('marketplace', %L, 'Fourth', 'video/mp4', 1000)$q$, current_setting('t.p')),
  '23514', 'mp:too_many_videos', 'C5. a product has at most three videos');
reset role;
-- The administrator lowers the product video limit: marketplace videos follow it.
select set_config('t.lim', (select max_bytes::text from public.media_limits where kind = 'video' and place = 'product'), true);
update public.media_limits set max_bytes = 1048576 where kind = 'video' and place = 'product';
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select lives_ok(format($q$select public.video_delete(%L)$q$, current_setting('t.v3')), 'C6. deleting frees the slot');
select throws_ok(format($q$select public.video_upload_begin('marketplace', %L, 'Big', 'video/mp4', 2097152)$q$, current_setting('t.p')),
  '22023', 'video is larger than the limit for this place', 'C7. the lowered admin limit is enforced');
reset role;
update public.media_limits set max_bytes = current_setting('t.lim')::bigint where kind = 'video' and place = 'product';
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select lives_ok(format($q$select set_config('t.v3', public.video_upload_begin('marketplace', %L, 'Third again', 'video/mp4', 3000)::text, true)$q$, current_setting('t.p')),
  'C8. the freed slot is reused');
reset role;
select is((select slot::int from public.media_videos where id = current_setting('t.v3')::uuid), 3, 'C9. ...it is slot 3 again (slot 2 holds the 100 MB video)');

-- ===========================================================================
-- D. Review
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'c_staff';
select throws_ok(format($q$select public.admin_marketplace_video_review(%L, 'approve', null, null, null)$q$, current_setting('t.v1')),
  '22023', 'mp:video_not_ready', 'D1. a video still uploading cannot be judged');
reset role;
-- The worker finishes the first video.
update public.media_videos set state = 'ready', revision = :'rev', renditions = '{360p,720p}', duration_seconds = 12.5,
  width = 1280, height = 720, has_poster = true, uploaded_at = now(), ready_at = now()
 where id = current_setting('t.v1')::uuid;

set local role authenticated;
set local request.jwt.claims = :'c_hana';
select throws_ok(format($q$select public.admin_marketplace_video_review(%L, 'approve', null, null, null)$q$, current_setting('t.v1')),
  '42501', 'mp:not_permitted', 'D2. the seller cannot approve its own video');
select throws_ok($q$select public.admin_marketplace_pending_videos(10)$q$, '42501', 'mp:not_permitted', 'D3. nor read the review queue');
select is((select review_status from public.marketplace_product_video_list(current_setting('t.p')::uuid) where id = current_setting('t.v1')::uuid), 'pending',
  'D4. the seller sees the video as pending');
select throws_ok($q$select review_reason from public.media_videos limit 1$q$, '42501', null,
  'D5. the internal reason column is refused to the seller');
set local request.jwt.claims = :'c_sara';
select throws_ok(format($q$select * from public.marketplace_product_video_list(%L)$q$, current_setting('t.p')), '42501', 'mp:not_permitted',
  'D5b. a sales-only member cannot list the videos');
set local request.jwt.claims = :'c_hana';
set local request.jwt.claims = :'c_staff';
select is((select pending_count::int from public.admin_marketplace_pending_videos(10) where product_id = current_setting('t.p')::uuid),
  1, 'D6. the reviewer queue lists the product with one finished video waiting');
select throws_ok(format($q$select public.admin_marketplace_video_review(%L, 'maybe', null, null, null)$q$, current_setting('t.v1')),
  '22023', 'mp:decision_invalid', 'D7. unknown decisions are refused');
select throws_ok(format($q$select public.admin_marketplace_video_review(%L, 'reject', '  ', 'م', 'm')$q$, current_setting('t.v1')),
  '22023', 'mp:reason_required', 'D8. a rejection needs the internal reason');
select throws_ok(format($q$select public.admin_marketplace_video_review(%L, 'reject', 'blurry', 'م', null)$q$, current_setting('t.v1')),
  '22023', 'mp:message_required', 'D9. ...and the message in both languages');
select lives_ok(format($q$select public.admin_marketplace_video_review(%L, 'reject', 'blurry footage', 'الفيديو غير واضح', 'The video is blurry')$q$, current_setting('t.v1')),
  'D10. the reviewer rejects with reason and AR/EN message');
select is((select review_status || '/' || review_reason from public.admin_marketplace_product_videos(current_setting('t.p')::uuid) where id = current_setting('t.v1')::uuid),
  'rejected/blurry footage', 'D11. the reviewer sees the internal reason');
reset role;
select is((select count(*)::int from public.notifications where event_type = 'marketplace.product.rejected'
             and subject_id = current_setting('t.p')::uuid and recipient_user_id = :'hana'::uuid), 1,
  'D11b. the seller manager is notified of the rejection, in-app');
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select is((select review_status || '/' || review_message_en || '/' || review_message_ar from public.marketplace_product_video_list(current_setting('t.p')::uuid) where id = current_setting('t.v1')::uuid),
  'rejected/The video is blurry/الفيديو غير واضح', 'D12. the seller sees the status and both messages');
set local request.jwt.claims = :'c_staff';
select lives_ok(format($q$select public.admin_marketplace_video_review(%L, 'approve', null, null, null)$q$, current_setting('t.v1')),
  'D13. a rejected video can be approved later');
reset role;
select is((select review_status || '/' || coalesce(review_reason, '-') || '/' || coalesce(review_message_en, '-') from public.media_videos where id = current_setting('t.v1')::uuid),
  'approved/-/-', 'D14. approval clears the rejection texts');
select is((select string_agg(action, ',' order by sequence) from public.marketplace_video_events where video_id = current_setting('t.v1')::uuid),
  'added,rejected,approved', 'D15. every decision is in the trail, in order');
select is((select detail ->> 'reason' from public.marketplace_video_events where video_id = current_setting('t.v1')::uuid and action = 'rejected'),
  'blurry footage', 'D16. the trail keeps the internal reason');

-- ===========================================================================
-- E. Edge decision
-- ===========================================================================
select ok(pg_temp.edge(current_setting('t.v1')::uuid, :'hana', :'s_hana', null, :exp) is not null,
  'E1. the seller manager may play it');
select ok(pg_temp.edge(current_setting('t.v1')::uuid, :'staff', :'s_staff', null, :exp) is not null,
  'E2. a product reviewer may play it');
select ok(pg_temp.edge(current_setting('t.v1')::uuid, :'sara', :'s_sara', null, :exp) is null,
  'E3. a sales-only member of the seller may not');
select ok(pg_temp.edge(current_setting('t.v1')::uuid, :'pro', :'s_pro', null, :exp) is null,
  'E4. an outsider may not');
select ok(pg_temp.edge(current_setting('t.v1')::uuid, null, null, null, null) is null,
  'E5. anonymous delivery is refused (no buyer rule yet)');
select ok(pg_temp.edge(current_setting('t.v3')::uuid, :'hana', :'s_hana', null, :exp) is null,
  'E6. a video that is not ready is never delivered');

-- ===========================================================================
-- F. Lifecycle
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'c_sara';
select throws_ok(format($q$select public.video_update(%L, 'Hacked')$q$, current_setting('t.v1')),
  '42501', 'video not found', 'F1. a sales-only member cannot rename');
set local request.jwt.claims = :'c_hana';
select lives_ok(format($q$select public.video_update(%L, 'Front view v2')$q$, current_setting('t.v1')), 'F2. the manager renames an approved video');
reset role;
select is((select title || '/' || review_status || '/' || (reviewed_at is null) from public.media_videos where id = current_setting('t.v1')::uuid),
  'Front view v2/pending/true', 'F3. the new title sends it back to review');
select is((select count(*)::int from public.marketplace_video_events where video_id = current_setting('t.v1')::uuid and action = 'renamed'), 1,
  'F4. the rename is in the trail');

-- A suspended seller can no longer add, but can still remove its own video.
select set_config('app.marketplace_seller_write', 'on', true);
update public.marketplace_seller_accounts set status = 'suspended' where organization_id = :'org';
select set_config('app.marketplace_seller_write', 'off', true);
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select throws_ok(format($q$select public.video_upload_begin('marketplace', %L, 'Late', 'video/mp4', 1000)$q$, current_setting('t.p')),
  '42501', 'mp:seller_not_enabled', 'F6. a suspended seller cannot add a video');
select lives_ok(format($q$select public.video_delete(%L)$q$, current_setting('t.v1')), 'F7. ...but can delete one');
reset role;
select is((select state::text from public.media_videos where id = current_setting('t.v1')::uuid), 'deleted', 'F8. the video is deleted');
select ok(pg_temp.edge(current_setting('t.v1')::uuid, :'hana', :'s_hana', null, :exp) is null, 'F9. delivery stops at once');
select is((select count(*)::int from public.marketplace_video_events where video_id = current_setting('t.v1')::uuid and action = 'deleted'), 1,
  'F10. the deletion is in the trail');
select throws_ok($q$update public.marketplace_video_events set action = 'added'$q$, null, null, 'F11. the trail is append-only');

select * from finish();
rollback;
