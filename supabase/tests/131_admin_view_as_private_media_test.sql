-- pgTAP: Admin View-As, stage 4 - private media (20261114090004_admin_view_as_private_media.sql).
--
-- Called as a hostile client would: `authenticated` / `anon` roles with a forged-but-valid JWT (incl. the Auth `session_id` a
-- view is bound to), invoking the open function DIRECTLY.
--   A. Without a live view session nothing is reachable, for every kind of caller
--   B. With a live session: ready avatar / portfolio / certificate of THE SUBJECT only, with a verified R2 location
--   C. One audit row per session + media id; the audit row never holds the object key
--   D. Exit, another login session, another admin, another subject, wrong namespace, pending, non-R2: all refuse
--   E. The shared resolvers are NOT widened: an admin with a live view session still cannot read through them
create extension if not exists pgtap;

begin;
select plan(23);

\set adminA '55555555-5555-4555-8555-555555555555'
\set adminB '22222222-2222-4222-8222-222222222222'
\set supp   '44444444-4444-4444-8444-444444444444'
\set craft  '71000006-0000-4000-8000-000000000006'
\set other  '71000007-0000-4000-8000-000000000007'
\set certkey  '71000006-0000-4000-8000-000000000006/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf'
\set otherkey '71000007-0000-4000-8000-000000000007/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf'
\set avkey    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg'
\set pfkey    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'
\set pendkey  'ffffffff-ffff-4fff-8fff-ffffffffffff.jpg'
\set sbkey    '99999999-9999-4999-8999-999999999999.jpg'

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
insert into public.platform_role_grants (user_id, role, granted_by) values (:'supp', 'support', :'adminA');

-- Fixture: the viewed craftsman (certificate, ready avatar, ready + pending + Supabase-provider portfolio items) and another craftsman.
insert into public.professional_certificates (id, owner_user_id, object_path, content_type, title, issuer, issued_on, original_filename, state) values
  ('c1000000-0000-4000-8000-000000000001', :'craft', :'certkey', 'application/pdf', 'Electrical safety', 'Egypt Board', '2025-01-01', 'private.pdf', 'ready'),
  ('c2000000-0000-4000-8000-000000000002', :'other', :'otherkey', 'application/pdf', 'Other cert', 'Egypt Board', '2025-01-01', 'other.pdf', 'ready');
insert into public.avatar_uploads (id, owner_user_id, object_key, content_type, state)
  values ('a1000000-0000-4000-8000-000000000001', :'craft', :'avkey', 'image/jpeg', 'ready');
insert into public.portfolio_projects (id, owner_user_id, title) values ('b1000000-0000-4000-8000-000000000001', :'craft', 'Villa kitchen');
insert into public.portfolio_items (id, owner_user_id, object_key, content_type, title, project_id, state) values
  ('d1000000-0000-4000-8000-000000000001', :'craft', :'pfkey',   'image/jpeg', 'Ready',    'b1000000-0000-4000-8000-000000000001', 'ready'),
  ('d2000000-0000-4000-8000-000000000002', :'craft', :'pendkey', 'image/jpeg', 'Pending',  'b1000000-0000-4000-8000-000000000001', 'pending'),
  ('d3000000-0000-4000-8000-000000000003', :'craft', :'sbkey',   'image/jpeg', 'Legacy',   'b1000000-0000-4000-8000-000000000001', 'ready');
insert into public.media_storage_locations (namespace, object_key, owner_user_id, provider, content_type, size_bytes, sha256, verified_at) values
  ('certificate', :'certkey',  :'craft', 'r2',       'application/pdf', 100, repeat('a', 64), now()),
  ('certificate', :'otherkey', :'other', 'r2',       'application/pdf', 100, repeat('b', 64), now()),
  ('avatar',      :'avkey',    :'craft', 'r2',       'image/jpeg',      100, repeat('c', 64), now()),
  ('portfolio',   :'pfkey',    :'craft', 'r2',       'image/jpeg',      100, repeat('d', 64), now()),
  ('portfolio',   :'pendkey',  :'craft', 'r2',       'image/jpeg',      100, repeat('e', 64), now()),
  ('portfolio',   :'sbkey',    :'craft', 'supabase', 'image/jpeg',      100, repeat('f', 64), now());

-- ===========================================================================
-- A. No live session
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'certificate','c1000000-0000-4000-8000-000000000001')$$, :'craft'), '42501', 'not permitted', 'A: an authorized admin WITHOUT a live view session is refused');
select pg_temp.act_as(:'supp');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'certificate','c1000000-0000-4000-8000-000000000001')$$, :'craft'), '42501', 'not permitted', 'A: Support is refused');
select pg_temp.act_as(:'craft');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'certificate','c1000000-0000-4000-8000-000000000001')$$, :'craft'), '42501', 'not permitted', 'A: the craftsman cannot use the admin function on themselves');
select pg_temp.as_dba(); set local role anon; set local request.jwt.claims = '';
select throws_ok(format($$select public.admin_view_as_media_open(%L,'certificate','c1000000-0000-4000-8000-000000000001')$$, :'craft'), '42501', null, 'A: anon cannot execute the open function');
select pg_temp.as_dba();

-- ===========================================================================
-- B. With a live session
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), 'B: the admin opens an audited view session');
select is(public.admin_view_as_media_open(:'craft', 'certificate', 'c1000000-0000-4000-8000-000000000001'),
  jsonb_build_object('object', 'certificate/' || :'certkey', 'contentType', 'application/pdf'), 'B: the subject''s ready certificate: physical key + verified content type');
select is(public.admin_view_as_media_open(:'craft', 'avatar', 'a1000000-0000-4000-8000-000000000001'),
  jsonb_build_object('object', 'avatar/' || :'avkey', 'contentType', 'image/jpeg'), 'B: ... the avatar');
select is(public.admin_view_as_media_open(:'craft', 'portfolio', 'd1000000-0000-4000-8000-000000000001'),
  jsonb_build_object('object', 'portfolio/' || :'pfkey', 'contentType', 'image/jpeg'), 'B: ... a portfolio item');

-- ===========================================================================
-- C. Audit: one row per session + media id, never the key
-- ===========================================================================
select public.admin_view_as_media_open(:'craft', 'certificate', 'c1000000-0000-4000-8000-000000000001');
select public.admin_view_as_media_open(:'craft', 'certificate', 'c1000000-0000-4000-8000-000000000001');
select pg_temp.as_dba();
select is((select count(*)::int from public.audit_log where action = 'admin.view_as.media_read' and metadata ->> 'media_id' = 'c1000000-0000-4000-8000-000000000001'), 1, 'C: repeated opens of the same media in one session write ONE audit row');
select is((select count(*)::int from public.audit_log where action = 'admin.view_as.media_read'), 3, 'C: one audit row per distinct media (certificate, avatar, portfolio)');
select ok(not exists (select 1 from public.audit_log where action = 'admin.view_as.media_read' and (metadata::text like '%' || :'certkey' || '%' or metadata::text like '%' || :'avkey' || '%' or metadata::text like '%' || :'pfkey' || '%')), 'C: no audit row contains an object key');
select is((select subject_id from public.audit_log where action = 'admin.view_as.media_read' limit 1), :'craft'::uuid, 'C: the audit row names the viewed account');

-- ===========================================================================
-- D. Refusals
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'certificate','c2000000-0000-4000-8000-000000000002')$$, :'craft'), '42501', 'not permitted', 'D: another craftsman''s media id is refused for this subject');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'portfolio','c1000000-0000-4000-8000-000000000001')$$, :'craft'), '42501', 'not permitted', 'D: a media id in the wrong namespace is refused (same generic error)');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'portfolio','d2000000-0000-4000-8000-000000000002')$$, :'craft'), '42501', 'not permitted', 'D: a pending object is refused');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'portfolio','d3000000-0000-4000-8000-000000000003')$$, :'craft'), '42501', 'not permitted', 'D: an object that is not on a verified R2 location is refused');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'cover','a1000000-0000-4000-8000-000000000001')$$, :'craft'), '42501', 'not permitted', 'D: a namespace outside the allow-list is refused');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'avatar',gen_random_uuid())$$, :'craft'), '42501', 'not permitted', 'D: an unknown media id gets the same error (no existence oracle)');
select pg_temp.act_as(:'adminA', 'a0000000-0000-4000-8000-0000000000ff');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'certificate','c1000000-0000-4000-8000-000000000001')$$, :'craft'), '42501', 'not permitted', 'D: the SAME admin in ANOTHER login session cannot use that view');
select pg_temp.act_as(:'adminB');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'certificate','c1000000-0000-4000-8000-000000000001')$$, :'craft'), '42501', 'not permitted', 'D: another admin cannot ride the first admin''s view');

-- ===========================================================================
-- E. The shared resolvers are not widened; Exit ends access
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select is(public.media_storage_resolve('certificate', :'certkey', 'read'), null, 'E: with a LIVE view session the shared resolver still refuses the admin (view media has its own door)');
select is(public.admin_view_as_end(:'craft'), true, 'E: Exit');
select throws_ok(format($$select public.admin_view_as_media_open(%L,'certificate','c1000000-0000-4000-8000-000000000001')$$, :'craft'), '42501', 'not permitted', 'E: after Exit the media is unreachable again');

select * from finish();
rollback;
