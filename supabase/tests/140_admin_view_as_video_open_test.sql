-- pgTAP: Admin View-As private video door (20261115090001_admin_view_as_video_open.sql).
-- Hostile-client calls of the open function, as in 131 for images.
create extension if not exists pgtap;

begin;
select plan(16);

\set adminA '55555555-5555-4555-8555-555555555555'
\set adminB '22222222-2222-4222-8222-222222222222'
\set craft  '71000006-0000-4000-8000-000000000006'
\set other  '71000007-0000-4000-8000-000000000007'
\set vready '91000000-0000-4000-8000-000000000001'
\set vproc  '91000000-0000-4000-8000-000000000002'
\set vother '91000000-0000-4000-8000-000000000003'
\set vstream '91000000-0000-4000-8000-000000000004'
\set rev    '92000000-0000-4000-8000-000000000001'

create function pg_temp.act_as(p_user uuid, p_session uuid default 'a0000000-0000-4000-8000-000000000001') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
grant execute on function pg_temp.act_as(uuid, uuid), pg_temp.as_dba() to authenticated, anon;

insert into public.platform_role_grants (user_id, role, granted_by) values (:'adminB', 'administrator', :'adminA');

insert into public.media_videos (id, owner_user_id, scope, title, visibility, state, content_type, declared_bytes, size_bytes,
  duration_seconds, renditions, has_poster, revision, provider, sort_order) values
  (:'vready',  :'craft', 'portfolio', 'Ready',      'private', 'ready',      'video/mp4', 1000, 1000, 10, array['360p','720p'], true,  :'rev', 'r2_hls', 0),
  (:'vproc',   :'craft', 'portfolio', 'Processing', 'private', 'processing', 'video/mp4', 1000, null, null, '{}',             false, null,   'r2_hls', 1),
  (:'vother',  :'other', 'portfolio', 'Other',      'private', 'ready',      'video/mp4', 1000, 1000, 10, array['360p'],        false, :'rev', 'r2_hls', 0),
  (:'vstream', :'craft', 'portfolio', 'Stream',     'private', 'ready',      'video/mp4', 1000, 1000, 10, array['360p'],        false, :'rev', 'cloudflare_stream', 2);

select pg_temp.act_as(:'adminA');
select throws_ok(format($$select public.admin_view_as_video_open(%L,%L)$$, :'craft', :'vready'), '42501', 'not permitted', 'A: no live view session is refused');
select pg_temp.act_as(:'craft');
select throws_ok(format($$select public.admin_view_as_video_open(%L,%L)$$, :'craft', :'vready'), '42501', 'not permitted', 'A: the owner cannot use the admin function');
select pg_temp.as_dba(); set local role anon; set local request.jwt.claims = '';
select throws_ok(format($$select public.admin_view_as_video_open(%L,%L)$$, :'craft', :'vready'), '42501', null, 'A: anon cannot execute it');
select pg_temp.as_dba();

select pg_temp.act_as(:'adminA');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), 'B: open a view session');
select is(public.admin_view_as_video_open(:'craft', :'vready'),
  jsonb_build_object('prefix', 'video/' || :'vready' || '/' || :'rev' || '/', 'revision', :'rev'::uuid, 'renditions', jsonb_build_array('360p','720p'), 'poster', true),
  'B: the subject''s ready R2+HLS video: prefix, revision, renditions, poster');

select public.admin_view_as_video_open(:'craft', :'vready');
select public.admin_view_as_video_open(:'craft', :'vready');
select pg_temp.as_dba();
select is((select count(*)::int from public.audit_log where action = 'admin.view_as.media_read' and metadata ->> 'namespace' = 'video'), 1, 'C: many opens (one per segment) write ONE audit row per session and video');
select ok(not exists (select 1 from public.audit_log where action = 'admin.view_as.media_read' and metadata::text like '%video/%'), 'C: the audit row holds no object prefix or key');
select is((select subject_id from public.audit_log where action = 'admin.view_as.media_read' and metadata ->> 'namespace' = 'video'), :'craft'::uuid, 'C: the audit row names the viewed account');

select pg_temp.act_as(:'adminA');
select throws_ok(format($$select public.admin_view_as_video_open(%L,%L)$$, :'craft', :'vproc'), '42501', 'not permitted', 'D: a processing video is refused');
select throws_ok(format($$select public.admin_view_as_video_open(%L,%L)$$, :'craft', :'vother'), '42501', 'not permitted', 'D: another account''s video is refused for this subject');
select throws_ok(format($$select public.admin_view_as_video_open(%L,%L)$$, :'craft', :'vstream'), '42501', 'not permitted', 'D: a non-R2 provider is refused');
select throws_ok(format($$select public.admin_view_as_video_open(%L,gen_random_uuid())$$, :'craft'), '42501', 'not permitted', 'D: an unknown id gets the same error');
select pg_temp.act_as(:'adminA', 'a0000000-0000-4000-8000-0000000000ff');
select throws_ok(format($$select public.admin_view_as_video_open(%L,%L)$$, :'craft', :'vready'), '42501', 'not permitted', 'D: the same admin in another login session cannot use the view');
select pg_temp.act_as(:'adminB');
select throws_ok(format($$select public.admin_view_as_video_open(%L,%L)$$, :'craft', :'vready'), '42501', 'not permitted', 'D: another admin cannot ride the view');

select pg_temp.act_as(:'adminA');
select is(public.admin_view_as_end(:'craft'), true, 'E: Exit');
select throws_ok(format($$select public.admin_view_as_video_open(%L,%L)$$, :'craft', :'vready'), '42501', 'not permitted', 'E: after Exit the video is unreachable');

select * from finish();
rollback;
