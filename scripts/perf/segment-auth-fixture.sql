-- Fixture rows for the media_edge_video load test (LOCAL stack only).
-- Every id starts with 0e7fa000 so cleanup is exact. Remove with segment-auth-cleanup.sql.
begin;
-- A live auth session for the seeded consumer, so the signed-in path passes app.jwt_session_is_live().
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values ('0e7fa000-0000-4000-8000-00000000005e', '44444444-4444-4444-8444-444444444444', now(), now(), 'aal1')
on conflict (id) do nothing;
-- 1. Public portfolio video (owner listed in profile_public_directory): anonymous viewer path.
insert into public.media_videos (id, owner_user_id, scope, title, visibility, state, content_type, declared_bytes,
  size_bytes, duration_seconds, width, height, renditions, has_poster, revision, sort_order, ready_at)
values ('0e7fa000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'portfolio', 'perf public',
  'public', 'ready', 'video/mp4', 1000000, 1000000, 120, 1280, 720, array['360p','720p'], true,
  '0e7fa000-0000-4000-8000-0000000000a1', 9001, now())
on conflict (id) do nothing;
-- 2. Private portfolio video owned by the consumer: signed-in owner path.
insert into public.media_videos (id, owner_user_id, scope, title, visibility, state, content_type, declared_bytes,
  size_bytes, duration_seconds, width, height, renditions, has_poster, revision, sort_order, ready_at)
values ('0e7fa000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'portfolio', 'perf private',
  'private', 'ready', 'video/mp4', 1000000, 1000000, 120, 1280, 720, array['360p','720p'], true,
  '0e7fa000-0000-4000-8000-0000000000a2', 9002, now())
on conflict (id) do nothing;
-- 3. Product video on a public seeded product, viewed by a signed-in NON-member (heaviest rule path).
insert into public.media_videos (id, owner_user_id, scope, product_id, publisher_id, title, visibility, state,
  content_type, declared_bytes, size_bytes, duration_seconds, width, height, renditions, has_poster, revision, slot, ready_at)
select '0e7fa000-0000-4000-8000-000000000003', '70000001-0000-4000-8000-000000000001', 'product', p.id, p.publisher_id,
  'perf product', 'private', 'ready', 'video/mp4', 1000000, 1000000, 120, 1280, 720, array['360p','720p'], true,
  '0e7fa000-0000-4000-8000-0000000000a3', 6, now()
from public.products p where p.id = 'd7000002-0000-4000-8000-000000000002'
on conflict (id) do nothing;
commit;
-- Sanity: every case must return a grant (non-null), as the media_edge role.
set role media_edge;
select 'anon_public' as k, public.media_edge_video('0e7fa000-0000-4000-8000-000000000001', null, null, null, null) is not null as ok
union all select 'owner_private', public.media_edge_video('0e7fa000-0000-4000-8000-000000000002',
  '44444444-4444-4444-8444-444444444444', '0e7fa000-0000-4000-8000-00000000005e', null, now() + interval '1 hour') is not null
union all select 'product_viewer', public.media_edge_video('0e7fa000-0000-4000-8000-000000000003',
  '44444444-4444-4444-8444-444444444444', '0e7fa000-0000-4000-8000-00000000005e', null, now() + interval '1 hour') is not null;
reset role;
