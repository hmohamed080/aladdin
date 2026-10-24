-- Video (ADR-0020): authoring rules, worker state machine and the media Worker's
-- per-request authority. Every revocation case is a SUBSEQUENT request after a
-- state change, with the same viewer, session and ticket expiry that was allowed.
create extension if not exists pgtap;
begin;
select no_plan();
\ir helpers/organization_media_receipt.inc

create function pg_temp.edge(vid uuid, viewer uuid, sess uuid, ws uuid, exp timestamptz) returns jsonb
language plpgsql as $$ declare v jsonb; begin
  set local role media_edge; v := public.media_edge_video(vid, viewer, sess, ws, exp); reset role; return v;
end $$;

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
update public.organizations set status = 'active', is_verified = true where id = '9d000000-dddd-4ddd-8ddd-000000000002';
\set pro '70000009-0000-4000-8000-000000000009'
\set other '70000003-0000-4000-8000-000000000003'
\set hana '70000001-0000-4000-8000-000000000001'
\set sara '70000002-0000-4000-8000-000000000002'
\set org '9c000000-cccc-4ccc-8ccc-000000000001'
\set ws_other '9d000000-dddd-4ddd-8ddd-000000000002'
\set s_pro 'ea000000-0000-4000-8000-000000000001'
\set s_other 'ea000000-0000-4000-8000-000000000002'
\set s_hana 'ea000000-0000-4000-8000-000000000003'
\set s_sara 'ea000000-0000-4000-8000-000000000004'
\set c_pro '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}'
\set c_other '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}'
\set c_hana '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set c_sara '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set exp 'now()+interval ''90 seconds'''
\set rev 'ea100000-0000-4000-8000-000000000001'
insert into auth.sessions(id, user_id, created_at, aal) values
 (:'s_pro', :'pro', now(), 'aal1'), (:'s_other', :'other', now(), 'aal1'),
 (:'s_hana', :'hana', now(), 'aal1'), (:'s_sara', :'sara', now(), 'aal1');
select id as profile from public.profiles where user_id = :'pro' \gset

-- ---------------------------------------------------------------- privileges
select ok(not has_table_privilege('authenticated', 'public.media_videos', 'INSERT')
  and not has_table_privilege('authenticated', 'public.media_videos', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.media_videos', 'DELETE'), 'clients never write media_videos directly');
select ok(not has_table_privilege('anon', 'public.media_videos', 'SELECT'), 'anon cannot read media_videos');
select ok(not has_column_privilege('authenticated', 'public.media_videos', 'upload_id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.media_videos', 'revision', 'SELECT')
  and not has_column_privilege('authenticated', 'public.media_videos', 'lease_until', 'SELECT'), 'internal columns are not readable by clients');
select ok(not has_function_privilege(r, f, 'EXECUTE'), format('%s cannot call %s', r, f))
  from unnest(array['anon', 'authenticated']) r,
       unnest(array['public.video_upload_attach(uuid,text)', 'public.video_upload_complete(uuid,bigint)',
         'public.video_job_claim(integer)', 'public.video_job_finish(uuid,uuid,numeric,integer,integer,text[],boolean)',
         'public.video_job_fail(uuid,text,boolean)', 'public.video_purge_candidates(integer)', 'public.video_mark_purged(uuid)',
         'public.video_job_expire()', 'public.media_edge_video(uuid,uuid,uuid,uuid,timestamptz)']) f;
select ok(not has_function_privilege('service_role', 'public.media_edge_video(uuid,uuid,uuid,uuid,timestamptz)', 'EXECUTE'),
  'only the Worker role decides delivery');
select ok(not has_function_privilege('anon', 'public.video_upload_begin(text,uuid,text,text,bigint)', 'EXECUTE'), 'anon cannot start uploads');

-- ---------------------------------------------------------------- authoring
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select throws_ok($$select public.video_upload_begin('portfolio', null, 'Tour', 'video/x-msvideo', 1000)$$, '22023', 'unsupported video type', 'unknown types are refused');
select throws_ok($$select public.video_upload_begin('portfolio', null, 'Tour', 'video/mp4', 5497558138881)$$, '22023', 'video size is outside what storage accepts', 'only R2''s own 5 TiB object limit applies');
select lives_ok($$select public.video_delete(public.video_upload_begin('portfolio', null, 'Long take', 'video/mp4', 53687091200))$$, 'a 50 GB video is accepted: no product size cap');
select throws_ok($$select public.video_upload_begin('portfolio', null, '   ', 'video/mp4', 1000)$$, '23514', null, 'blank titles are refused');
select public.video_upload_begin('portfolio', null, 'Kitchen tour', 'video/mp4', 4096) as vid \gset
select is((select state::text from public.media_videos where id = :'vid'), 'uploading', 'owner sees the new upload');
select is((public.video_upload_resolve(:'vid'))->>'state', 'uploading', 'owner resolves the upload');
select throws_ok(format('select public.video_set_visibility(%L, true)', :'vid'), '22023', 'an unfinished video cannot be published', 'unfinished videos cannot be published');
select public.video_upload_begin('portfolio', null, 'Second', 'video/webm', 2048) as vid2 \gset
select public.video_upload_begin('portfolio', null, 'Third', 'video/quicktime', 2048) as vid3 \gset
select array_agg(public.video_upload_begin('portfolio', null, 'Bulk ' || g, 'video/mp4', 2048)) as bulk from generate_series(4, 10) g \gset
select throws_ok($$select public.video_upload_begin('portfolio', null, 'Eleventh', 'video/mp4', 2048)$$, '23514', 'too many unfinished uploads', 'ten unfinished uploads at a time, as for images');
select is((select count(*)::int from unnest(:'bulk'::uuid[]) x, lateral (select public.video_delete(x)) d), 7, 'the extra uploads delete cleanly');
select is((select count(*)::int from public.media_videos where owner_user_id = :'pro' and scope = 'portfolio' and state <> 'deleted'), 3,
  'no portfolio video count limit applies beyond in-flight uploads');
select is(public.video_delete(:'vid3'), null::text, 'an unattached upload deletes cleanly');
set local request.jwt.claims = :'c_other';
select throws_ok(format('select public.video_upload_resolve(%L)', :'vid'), '42501', 'video not found', 'another user cannot resolve the upload');
select throws_ok(format('select public.video_delete(%L)', :'vid'), '42501', 'video not found', 'another user cannot delete it');
select is((select count(*)::int from public.media_videos where id = :'vid'), 0, 'another user cannot see it');
select throws_ok(format('select public.video_upload_complete(%L, 4096)', :'vid'), '42501', null, 'clients cannot complete uploads themselves');
reset role;

-- ---------------------------------------------------------------- server and worker
set local role service_role;
select lives_ok(format('select public.video_upload_attach(%L, %L)', :'vid', 'mp-upload-1'), 'server attaches the multipart id');
select throws_ok(format('select public.video_upload_attach(%L, %L)', :'vid', 'mp-upload-2'), 'P0002', null, 'the multipart id is attached once');
select throws_ok(format('select public.video_upload_complete(%L, 4095)', :'vid'), '22023', null, 'a stored size different from the declaration is refused');
select lives_ok(format('select public.video_upload_complete(%L, 4096)', :'vid'), 'verified upload moves to processing');
select is((select upload_id from public.media_videos where id = :'vid'), null, 'the multipart id is cleared');
select is((select id from public.video_job_claim(600)), :'vid'::uuid, 'a worker claims the job');
select is((select count(*)::int from public.video_job_claim(600)), 0, 'a leased job is not claimed twice');
select lives_ok(format('select public.video_job_fail(%L, %L, true)', :'vid', 'transcode_failed'), 'a retryable failure returns the job');
select is((select attempts from public.video_job_claim(600)), 2::smallint, 'the retry is claimed again with the attempt counted');
select lives_ok(format($$select public.video_job_finish(%L, %L, 12.5, 1280, 720, array['360p','720p'], true)$$, :'vid', :'rev'), 'worker finishes the job');
select is((select state::text from public.media_videos where id = :'vid'), 'ready', 'video is ready');
reset role;

-- ---------------------------------------------------------------- edge: private portfolio video
select is(pg_temp.edge(:'vid', null, null, null, null), null::jsonb, 'a private video is not anonymous');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp)->>'prefix', 'video/' || :'vid' || '/' || :'rev' || '/', 'owner plays a private video');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp)->'renditions', '["360p", "720p"]'::jsonb, 'grant names the renditions');
select is(pg_temp.edge(:'vid', :'other', :'s_other', null, :exp), null::jsonb, 'another user cannot play it');
select is(pg_temp.edge(:'vid', :'pro', :'s_other', null, :exp), null::jsonb, 'a borrowed session is refused');
select ok(pg_temp.edge(:'vid', :'pro', :'s_pro', null, now() + interval '4 hours') is not null, 'a four-hour play ticket is accepted');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, now() + interval '5 hours'), null::jsonb, 'a longer ticket is refused');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, now() - interval '1 minute'), null::jsonb, 'an expired ticket is refused');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, null), null::jsonb, 'a ticket without expiry is refused');

-- ---------------------------------------------------------------- edge: publication and revocation
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select lives_ok(format('select public.video_set_visibility(%L, true)', :'vid'), 'owner publishes');
reset role;
select is(pg_temp.edge(:'vid', null, null, null, null)->>'public', 'true', 'a published video of a listed profile is anonymous');
select is(pg_temp.edge(:'vid', :'other', :'s_other', null, :exp)->>'public', 'true', 'signed-in viewers see it too');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from public.public_portfolio_videos(:'profile'::uuid)), 1, 'the public profile lists it');
select throws_ok(format('select public.media_edge_video(%L, null, null, null, null)', :'vid'), '42501', null, 'anon cannot call the Worker function');
reset role;
update public.profiles set public_profile_status = 'hidden' where user_id = :'pro';
select is(pg_temp.edge(:'vid', null, null, null, null), null::jsonb, 'delisting withdraws it on the next request');
select ok(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp) is not null, 'the owner still plays it');
update public.profiles set public_profile_status = 'listed' where user_id = :'pro';
update public.users set status = 'suspended' where id = :'pro';
select is(pg_temp.edge(:'vid', null, null, null, null), null::jsonb, 'suspension withdraws it');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp), null::jsonb, 'a suspended owner cannot play it');
update public.users set status = 'active' where id = :'pro';
delete from auth.sessions where id = :'s_pro';
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp), null::jsonb, 'a signed-out session ticket is refused, even for a public video');
select ok(pg_temp.edge(:'vid', null, null, null, null) is not null, 'the anonymous public URL still plays');
insert into auth.sessions(id, user_id, created_at, aal) values (:'s_pro', :'pro', now(), 'aal1');
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select lives_ok(format('select public.video_set_visibility(%L, false)', :'vid'), 'owner unpublishes');
reset role;
select is(pg_temp.edge(:'vid', null, null, null, null), null::jsonb, 'unpublish withdraws it on the next request');
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select is(public.video_delete(:'vid'), null::text, 'owner deletes');
reset role;
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp), null::jsonb, 'delete denies the owner on the next request');
set local role service_role;
select ok(exists(select 1 from public.video_purge_candidates(50) where id = :'vid'), 'the deleted video is queued for purge');
select lives_ok(format('select public.video_mark_purged(%L)', :'vid'), 'purge is recorded');
select ok(not exists(select 1 from public.video_purge_candidates(50) where id = :'vid'), 'a purged video is not queued again');
reset role;

-- ---------------------------------------------------------------- product videos
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select public.own_product_create(:'org', 'Video product', 'VID-103', 'paints', 'pail', p_base_price => 100) as product \gset
select public.video_upload_begin('product', :'product', 'Application demo', 'video/mp4', 8192) as pvid \gset
set local request.jwt.claims = :'c_sara';
select throws_ok(format($$select public.video_upload_begin('product', %L, 'x', 'video/mp4', 10)$$, :'product'), '42501', 'catalog.write required', 'a member without catalog.write cannot add product video');
set local request.jwt.claims = :'c_other';
select throws_ok(format($$select public.video_upload_begin('product', %L, 'x', 'video/mp4', 10)$$, :'product'), '42501', 'catalog.write required', 'a foreign writer cannot add product video');
select throws_ok(format('select public.video_set_visibility(%L, true)', :'pvid'), '42501', 'video not found', 'a foreign writer cannot touch it');
reset role;
set local role service_role;
select public.video_upload_attach(:'pvid', 'mp-upload-3');
select public.video_upload_complete(:'pvid', 8192);
select id from public.video_job_claim(600);
select public.video_job_finish(:'pvid', :'rev', 30, 1920, 1080, array['360p','720p','1080p'], true);
reset role;
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select throws_ok(format('select public.video_set_visibility(%L, true)', :'pvid'), '22023', 'product videos follow the product audience', 'product videos are never made public directly');
reset role;
select is(pg_temp.edge(:'pvid', null, null, null, null), null::jsonb, 'product video is never anonymous');
select ok(pg_temp.edge(:'pvid', :'sara', :'s_sara', null, :exp) is not null, 'a publisher member plays the draft product video');
select is(pg_temp.edge(:'pvid', :'other', :'s_other', :'ws_other', :exp), null::jsonb, 'a draft product video is private to its publisher');
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select public.product_audiences_set(:'product', array['manufacturer']);
select public.set_product_published(:'product', true, (select version from public.products where id = :'product'));
reset role;
select ok(pg_temp.edge(:'pvid', :'other', :'s_other', :'ws_other', :exp) is not null, 'the targeted audience plays the published product video');
select is(pg_temp.edge(:'pvid', :'other', :'s_other', null, :exp), null::jsonb, 'a personal context cannot borrow the workspace audience');
select is(pg_temp.edge(:'pvid', :'other', :'s_other', :'org', :exp), null::jsonb, 'a forged foreign workspace is refused');
set local role authenticated;
set local request.jwt.claims = :'c_other';
select is((select count(*)::int from public.product_videos(:'product'::uuid, :'ws_other'::uuid)), 1, 'the audience lists the product video');
select is((select count(*)::int from public.product_videos(:'product'::uuid, null)), 0, 'not without the workspace');
set local request.jwt.claims = :'c_hana';
select public.set_product_published(:'product', false, (select version from public.products where id = :'product'));
reset role;
select is(pg_temp.edge(:'pvid', :'other', :'s_other', :'ws_other', :exp), null::jsonb, 'unpublishing the product withdraws its video on the next request');

-- ---------------------------------------------------------------- one order for photos and videos
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select item_id as img1 from public.portfolio_item_create('Kitchen', null, 'image/jpeg') \gset
select public.video_upload_begin('portfolio', null, 'Walkthrough', 'video/mp4', 4096) as ovid \gset
select item_id as img2 from public.portfolio_item_create('Bathroom', null, 'image/png') \gset
select ok((select sort_order from public.portfolio_items where id = :'img1') < (select sort_order from public.media_videos where id = :'ovid')
  and (select sort_order from public.media_videos where id = :'ovid') < (select sort_order from public.portfolio_items where id = :'img2'),
  'new photos and videos join the end of one shared order');
select lives_ok(format($$select public.portfolio_media_move('video', %L, 'up')$$, :'ovid'), 'the owner moves a video earlier');
select ok((select sort_order from public.media_videos where id = :'ovid') < (select sort_order from public.portfolio_items where id = :'img1'),
  'a video can come before every photo');
select lives_ok(format($$select public.portfolio_item_move(%L, 'up')$$, :'img2'), 'the photo-only mover still works');
select ok((select sort_order from public.portfolio_items where id = :'img2') < (select sort_order from public.portfolio_items where id = :'img1'),
  'and moves within the shared order');
select throws_ok($$select public.portfolio_media_move('audio', gen_random_uuid(), 'up')$$, '22023', 'unknown media kind', 'unknown kinds are refused');
select throws_ok($$select public.portfolio_media_move('video', gen_random_uuid(), 'sideways')$$, '22023', 'unknown direction', 'unknown directions are refused');
set local request.jwt.claims = :'c_other';
select throws_ok(format($$select public.portfolio_media_move('video', %L, 'down')$$, :'ovid'), '42501', 'portfolio item not found', 'another user cannot reorder it');
set local request.jwt.claims = :'c_pro';
select is(public.video_delete(:'ovid'), null::text, 'cleanup');

set local request.jwt.claims = :'c_hana';
select public.own_product_create(:'org', 'Gallery product', 'VID-104', 'paints', 'pail', p_base_price => 100) as gproduct \gset
select public.product_image_request_upload(:'gproduct', 'image/jpeg') as gkey1 \gset
select public.video_upload_begin('product', :'gproduct', 'Demo', 'video/mp4', 8192) as gvid \gset
select public.product_image_request_upload(:'gproduct', 'image/png') as gkey2 \gset
select pg_temp.attest_organization_fixture('product', :'gkey1');
select pg_temp.attest_organization_fixture('product', :'gkey2');
select is((select array_agg(x order by x) from (select slot from public.product_images where product_id = :'gproduct' and state <> 'deleted'
  union all select slot from public.media_videos where product_id = :'gproduct' and state <> 'deleted') s(x)), array[1,2,3]::smallint[],
  'photos and videos take distinct gallery slots');
select is((select slot from public.media_videos where id = :'gvid'), 2::smallint, 'the video holds the slot it was given');
select throws_ok(format($$select public.video_upload_begin('product', %L, 'Fourth', 'video/mp4', 10)$$, :'gproduct'), '23514', null,
  'a fourth item is refused when it is a video');
select throws_ok(format($$select public.product_image_request_upload(%L, 'image/jpeg')$$, :'gproduct'), '23514', null,
  'and when it is a photo: three items in all');
reset role;
update public.product_images set state = 'ready' where product_id = :'gproduct';
set local role service_role;
select public.video_upload_attach(:'gvid', 'mp-upload-9');
select public.video_upload_complete(:'gvid', 8192);
update public.media_videos set lease_until = null where id = :'gvid';
select public.video_job_finish(:'gvid', :'rev', 10, 1280, 720, array['360p','720p'], true);
reset role;
select id as gimg1 from public.product_images where object_key = :'gkey1' \gset
select id as gimg2 from public.product_images where object_key = :'gkey2' \gset
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select throws_ok(format($$select public.product_media_reorder(%L, %L::jsonb)$$, :'gproduct',
  jsonb_build_array(jsonb_build_object('kind','image','id',:'gimg1'), jsonb_build_object('kind','image','id',:'gimg2'))), '22023', null,
  'a reorder must list the videos too');
select lives_ok(format($$select public.product_media_reorder(%L, %L::jsonb)$$, :'gproduct',
  jsonb_build_array(jsonb_build_object('kind','video','id',:'gvid'), jsonb_build_object('kind','image','id',:'gimg2'),
    jsonb_build_object('kind','image','id',:'gimg1'))), 'a writer puts the video first');
select is((select slot from public.media_videos where id = :'gvid'), 1::smallint, 'the video is first in the gallery');
select is((select array_agg(id order by slot) from public.product_images where product_id = :'gproduct' and state = 'ready'),
  array[:'gimg2', :'gimg1']::uuid[], 'the photos follow in the chosen order');
select lives_ok(format('select public.product_image_reorder(%L, %L::uuid[])', :'gproduct', array[:'gimg1', :'gimg2']),
  'the photo-only reorder still works and leaves the video in place');
select is((select slot from public.media_videos where id = :'gvid'), 1::smallint, 'the video keeps its slot');
set local request.jwt.claims = :'c_other';
select throws_ok(format($$select public.product_media_reorder(%L, '[]'::jsonb)$$, :'gproduct'), '42501', null, 'a foreign writer cannot reorder');
set local request.jwt.claims = :'c_hana';
select is(public.video_delete(:'gvid'), null::text, 'deleting the video frees its slot');
select lives_ok(format($$select public.product_image_request_upload(%L, 'image/webp')$$, :'gproduct'), 'so a photo can take it');
reset role;
select is((select provider from public.media_videos where id = :'gvid'), 'r2_hls', 'videos default to the R2 + HLS provider');
update public.media_videos set provider = 'cloudflare_stream', provider_ref = 'stream-uid', state = 'ready' where id = :'pvid';
select is(pg_temp.edge(:'pvid', :'sara', :'s_sara', null, :exp), null::jsonb, 'the Worker never serves another provider''s video');
update public.media_videos set provider = 'r2_hls', provider_ref = null where id = :'pvid';

set local role service_role;
select ok(not public.video_job_renew(:'gvid', 600), 'a lease cannot be renewed for a job that is gone');
reset role;

-- ---------------------------------------------------------------- stale uploads and worker limits
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select public.video_upload_begin('portfolio', null, 'Stale', 'video/mp4', 100) as stale \gset
reset role;
select public.video_upload_begin('portfolio', null, 'Slow', 'video/mp4', 100) as slow \gset
reset role;
update public.media_videos set created_at = now() - interval '5 days', upload_touched_at = now() - interval '2 hours' where id = :'slow';
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select is((public.video_upload_resolve(:'slow'))->>'expired', 'false', 'a slow upload still in use stays open for days');
reset role;
select ok((select upload_touched_at > now() - interval '1 minute' from public.media_videos where id = :'slow'), 'continuing an upload records the activity');
update public.media_videos set created_at = now() - interval '7 days', upload_touched_at = now() where id = :'slow';
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select is((public.video_upload_resolve(:'slow'))->>'expired', 'true', 'after six days the upload expires before R2 aborts it');
reset role;
update public.media_videos set upload_touched_at = now() - interval '25 hours' where id = :'stale';
set local role service_role;
select throws_ok(format('select public.video_upload_complete(%L, 100)', :'stale'), '22023', null, 'an upload idle for a day cannot complete');
select ok(exists(select 1 from public.video_purge_candidates(50) where id = :'stale'), 'stale uploads are expired and queued for purge');
select is((select failure_code from public.media_videos where id = :'stale'), 'expired', 'and say why');
reset role;

select * from finish();
rollback;
