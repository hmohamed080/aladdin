-- pgTAP: Admin View-As Stage 4 — database authority for delivering a viewed craftsman's PRIVATE media
-- (20261101090004_admin_view_as_media_authorization.sql). Every case is a SUBSEQUENT request after a lifecycle change: the same ticket
-- claims that were allowed are refused once the database state changes (revocation bound: the next request).
--   A. Privileges: only the Worker role can call it; no PUBLIC grant
--   B. No view session => null (even for an authorized admin with a valid Auth session)
--   C. With a live view session: the subject's own ready R2 record is granted; the grant maps record -> owner -> location
--   D. Denials: other accounts' records, wrong subject, borrowed session, wrong kind, pending/legacy/unlocated, bad claims
--   E. Lifecycle: Exit, sign-out, permission revocation, admin suspension, expiry all end delivery on the next request
--   F. Owner delivery is untouched; claims are restored
create extension if not exists pgtap;

begin;
select no_plan();

\set adminA '55555555-5555-4555-8555-555555555555'
\set adminB '22222222-2222-4222-8222-222222222222'
\set supp   '44444444-4444-4444-8444-444444444444'
\set craft  '71000006-0000-4000-8000-000000000006'
\set other  '71000007-0000-4000-8000-000000000007'
\set sA     'e9a00000-0000-4000-8000-000000000001'
\set sB     'e9a00000-0000-4000-8000-000000000002'
\set sOld   'e9a00000-0000-4000-8000-000000000003'
\set sCraft 'e9a00000-0000-4000-8000-000000000004'
\set itemC  'e9a10000-0000-4000-8000-000000000001'
\set keyC   'e9a10000-0000-4000-8000-0000000000a1.jpg'
\set itemP  'e9a10000-0000-4000-8000-000000000002'
\set keyP   'e9a10000-0000-4000-8000-0000000000a2.jpg'
\set itemL  'e9a10000-0000-4000-8000-000000000003'
\set keyL   'e9a10000-0000-4000-8000-0000000000a3.jpg'
\set itemN  'e9a10000-0000-4000-8000-000000000004'
\set keyN   'e9a10000-0000-4000-8000-0000000000a4.jpg'
\set itemO  'e9a10000-0000-4000-8000-000000000005'
\set keyO   'e9a10000-0000-4000-8000-0000000000a5.jpg'
\set cert   'e9a10000-0000-4000-8000-000000000006'
\set avat   'e9a10000-0000-4000-8000-000000000007'
\set akey   'e9a10000-0000-4000-8000-0000000000a7.jpg'
\set exp    'now()+interval ''90 seconds'''

create function pg_temp.act_as(p_user uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
  execute 'set local role authenticated';
end; $$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end; $$;
grant execute on function pg_temp.act_as(uuid, uuid), pg_temp.as_dba() to authenticated, anon;
-- Each Worker call runs as media_edge, like the real Worker.
create function pg_temp.va(kind text, rec uuid, var text, adm uuid, sess uuid, subj uuid, ex timestamptz) returns jsonb
language plpgsql as $$ declare v jsonb; begin
  set local role media_edge; v := public.media_edge_view_as_authorize(kind, rec, var, adm, sess, subj, ex); reset role; return v;
end $$;

-- ---------------------------------------------------------------- fixtures
insert into public.platform_role_grants (user_id, role, granted_by) values (:'adminB', 'administrator', :'adminA');
insert into public.platform_role_grants (user_id, role, granted_by) values (:'supp', 'support', :'adminA');
insert into auth.sessions (id, user_id, created_at, aal) values
  (:'sA', :'adminA', now(), 'aal1'), (:'sB', :'adminB', now(), 'aal1'), (:'sOld', :'adminA', now() - interval '2 days', 'aal1'),
  (:'sCraft', :'craft', now(), 'aal1');
update auth.sessions set not_after = now() - interval '1 hour' where id = :'sOld';

insert into public.portfolio_items (id, owner_user_id, object_key, content_type, title, state) values
  (:'itemC', :'craft', :'keyC', 'image/jpeg', 'Craftsman ready', 'ready'),
  (:'itemP', :'craft', :'keyP', 'image/jpeg', 'Craftsman pending', 'pending'),
  (:'itemL', :'craft', :'keyL', 'image/jpeg', 'Craftsman legacy', 'ready'),
  (:'itemN', :'craft', :'keyN', 'image/jpeg', 'Craftsman unlocated', 'ready'),
  (:'itemO', :'other', :'keyO', 'image/jpeg', 'Other craftsman', 'ready');
insert into public.professional_certificates (id, owner_user_id, object_path, content_type, title, issuer, issued_on, original_filename, state)
  values (:'cert', :'craft', :'craft' || '/e9a10000-0000-4000-8000-0000000000a6.pdf', 'application/pdf', 'Electrical safety', 'Egypt Board', '2025-01-01', 'secret-name.pdf', 'ready');
insert into public.avatar_uploads (id, owner_user_id, object_key, content_type, state) values (:'avat', :'craft', :'akey', 'image/jpeg', 'ready');
insert into public.media_storage_locations (namespace, object_key, owner_user_id, provider, content_type, size_bytes, sha256, verified_at) values
  ('portfolio', :'keyC', :'craft', 'r2', 'image/jpeg', 100, repeat('a', 64), now()),
  ('portfolio', :'keyP', :'craft', 'r2', 'image/jpeg', 100, repeat('b', 64), now()),
  ('portfolio', :'keyL', :'craft', 'supabase', 'image/jpeg', 100, repeat('c', 64), now()),
  ('portfolio', :'keyO', :'other', 'r2', 'image/jpeg', 100, repeat('d', 64), now()),
  ('certificate', :'craft' || '/e9a10000-0000-4000-8000-0000000000a6.pdf', :'craft', 'r2', 'application/pdf', 200, repeat('e', 64), now()),
  ('avatar', :'akey', :'craft', 'r2', 'image/jpeg', 300, repeat('f', 64), now());

-- ---------------------------------------------------------------- A. privileges
select ok(has_function_privilege('media_edge', 'public.media_edge_view_as_authorize(text,uuid,text,uuid,uuid,uuid,timestamptz)', 'EXECUTE'),
  'A: the Worker role can execute it');
select ok(not has_function_privilege(r, 'public.media_edge_view_as_authorize(text,uuid,text,uuid,uuid,uuid,timestamptz)', 'EXECUTE'),
  format('A: %s cannot call it', r)) from unnest(array['anon', 'authenticated', 'service_role', 'authenticator']) r;
select is((select proacl::text from pg_proc where oid = 'public.media_edge_view_as_authorize(text,uuid,text,uuid,uuid,uuid,timestamptz)'::regprocedure),
  '{postgres=X/postgres,media_edge=X/postgres}', 'A: no PUBLIC grant');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.media_edge_view_as_authorize(text,uuid,text,uuid,uuid,uuid,timestamptz)'::regprocedure),
  'A: SECURITY DEFINER with a fixed empty search_path');
select throws_ok($$set local role anon; select public.media_edge_view_as_authorize('portfolio_item', gen_random_uuid(), 'original', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now())$$,
  '42501', null, 'A: anon is refused at the privilege level');
reset role;

-- ---------------------------------------------------------------- B. no view session
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb,
  'B: an authorized admin with a valid Auth session but NO view session gets nothing');

-- ---------------------------------------------------------------- C. live view session
select pg_temp.act_as(:'adminA', :'sA');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), 'C: the admin opens an audited view session');
select pg_temp.as_dba();
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp)->>'object', 'portfolio/' || :'keyC',
  'C: portfolio original is granted once the view is live');
select is(pg_temp.va('certificate', :'cert', 'original', :'adminA', :'sA', :'craft', :exp)->>'contentType', 'application/pdf',
  'C: the certificate is granted with the authoritative content type');
select ok(pg_temp.va('avatar', :'avat', 'original', :'adminA', :'sA', :'craft', :exp) is not null, 'C: the avatar is granted');

-- ---------------------------------------------------------------- D. denials
select is(pg_temp.va('portfolio_item', :'itemO', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb,
  'D: another craftsman''s item cannot be read through this subject');
select is(pg_temp.va('portfolio_item', :'itemO', 'original', :'adminA', :'sA', :'other', :exp), null::jsonb,
  'D: and not through its own owner either (no live view of that account)');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'other', :exp), null::jsonb,
  'D: the subject must be the record''s owner (item of craft, subject other)');
select is(pg_temp.va('certificate', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'D: a record id of the wrong kind resolves nothing');
select is(pg_temp.va('portfolio_item', :'itemP', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'D: a pending record is not deliverable');
select is(pg_temp.va('portfolio_item', :'itemL', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'D: a legacy Supabase-provider row is never served here (no fallback)');
select is(pg_temp.va('portfolio_item', :'itemN', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'D: a ready record with no storage location resolves nothing');
select is(pg_temp.va('portfolio_item', :'itemC', 'thumb', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'D: an unrecorded variant is denied');
select is(pg_temp.va('portfolio_item', :'itemC', '../x', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'D: an unknown variant name is denied');
select is(pg_temp.va('product', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'D: products/organization images are not reachable through View-As');
select is(pg_temp.va('portfolio_item', gen_random_uuid(), 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'D: an unknown record id');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'adminA', :exp), null::jsonb, 'D: an admin cannot name themselves as the subject');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sB', :'craft', :exp), null::jsonb, 'D: another admin''s Auth session cannot be borrowed');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sOld', :'craft', :exp), null::jsonb, 'D: an expired Auth session is denied');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', gen_random_uuid(), :'craft', :exp), null::jsonb, 'D: an unknown session id is denied');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminB', :'sB', :'craft', :exp), null::jsonb, 'D: a second admin with no view of their own is denied');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'supp', gen_random_uuid(), :'craft', :exp), null::jsonb, 'D: Support is denied');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'craft', :'sCraft', :'craft', :exp), null::jsonb, 'D: the craftsman cannot use the admin path on themselves');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', now() - interval '10 seconds'), null::jsonb, 'D: an expired ticket is rejected by claims');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', now() + interval '10 minutes'), null::jsonb, 'D: a ticket longer than 120 s is rejected');
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', null), null::jsonb, 'D: a ticket without expiry is rejected');
select is(pg_temp.va(null, :'itemC', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'D: null kind');
select is(pg_temp.va('portfolio_item', null, 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'D: null record');

-- ---------------------------------------------------------------- F (part). claims are restored, caller cannot impersonate
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminB', :'sB', :'craft', :exp), null::jsonb, 'F: pre-set connection claims cannot impersonate an authorized admin');
select is(current_setting('request.jwt.claims'), '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}', 'F: caller claims are restored after the call');
set local request.jwt.claims = '';

-- ---------------------------------------------------------------- E. lifecycle: each change applies on the NEXT request
-- E1. a suspended craftsman is still viewable (approved decision)
update public.users set status = 'suspended' where id = :'craft';
select ok(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp) is not null, 'E: a suspended account''s media is still viewable read-only');
update public.users set status = 'active' where id = :'craft';
-- E2. the craftsman deletes the record: gone at once
update public.portfolio_items set state = 'deleted' where id = :'itemC';
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'E: a record deleted by its owner stops being served immediately');
update public.portfolio_items set state = 'ready' where id = :'itemC';
-- E3. the location is cleaned up (media removed from R2)
update public.media_storage_locations set cleaned_at = now() where namespace = 'portfolio' and object_key = :'keyC';
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'E: a cleaned-up object is not served');
update public.media_storage_locations set cleaned_at = null where namespace = 'portfolio' and object_key = :'keyC';
select ok(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp) is not null, 'E: restored -> served again (proves the denials above were the cause)');
-- E4. location owned by someone else (authoritative owner link broken)
update public.media_storage_locations set owner_user_id = :'other' where namespace = 'portfolio' and object_key = :'keyC';
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'E: a location owned by another account is refused');
update public.media_storage_locations set owner_user_id = :'craft' where namespace = 'portfolio' and object_key = :'keyC';
-- E5. admin account suspended
update public.users set status = 'suspended' where id = :'adminA';
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'E: a suspended admin gets nothing');
update public.users set status = 'active' where id = :'adminA';
-- E6. Exit
select pg_temp.act_as(:'adminA', :'sA');
select is(public.admin_view_as_end(:'craft'), true, 'E: Exit ends the view');
select pg_temp.as_dba();
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'E: after Exit the same ticket claims are refused');
-- E7. a new view session works again; sign-out (session row deleted) ends it
select pg_temp.act_as(:'adminA', :'sA');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), 'E: a new view can be opened');
select pg_temp.as_dba();
select ok(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp) is not null, 'E: served in the new view');
delete from auth.sessions where id = :'sA';
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminA', :'sA', :'craft', :exp), null::jsonb, 'E: after sign-out (Auth session gone) nothing is served');
-- E8. permission revocation for a second admin
select pg_temp.act_as(:'adminB', :'sB');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), 'E: the Administrator opens a view');
select pg_temp.as_dba();
select ok(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminB', :'sB', :'craft', :exp) is not null, 'E: the Administrator is served');
delete from public.platform_role_grants where user_id = :'adminB';
select is(pg_temp.va('portfolio_item', :'itemC', 'original', :'adminB', :'sB', :'craft', :exp), null::jsonb, 'E: revoking the role stops delivery on the next request');

-- ---------------------------------------------------------------- F. owner delivery untouched
insert into auth.sessions (id, user_id, created_at, aal) values ('e9a00000-0000-4000-8000-000000000009', :'craft', now(), 'aal1')
  on conflict do nothing;
create function pg_temp.own(ns text, k text, var text, viewer uuid, sess uuid, ex timestamptz) returns jsonb
language plpgsql as $$ declare v jsonb; begin
  set local role media_edge; v := public.media_edge_authorize(ns, k, var, viewer, sess, null, ex); reset role; return v;
end $$;
select is(pg_temp.own('portfolio', :'keyC', 'original', :'craft', 'e9a00000-0000-4000-8000-000000000009', :exp)->>'object', 'portfolio/' || :'keyC',
  'F: the owner still reads their own media through the unchanged owner path');
select is(pg_temp.own('portfolio', :'keyC', 'original', :'adminA', :'sOld', :exp), null::jsonb, 'F: the owner path still refuses a non-owner (admin)');

select * from finish();
rollback;
