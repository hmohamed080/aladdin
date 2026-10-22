-- pgTAP: profile cover image on the avatar pipeline (20261021090008).
create extension if not exists pgtap;

begin;
select plan(16);

\set u1 '73000000-0000-4000-8000-000000000001'
\set u2 '73000000-0000-4000-8000-000000000002'

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  (:'u1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cov1@probe.test', now(), '{"full_name":"Cov One"}', now(), now()),
  (:'u2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cov2@probe.test', now(), '{"full_name":"Cov Two"}', now(), now());

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pg_temp.as_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
select pg_temp.as_user(:'u1');
select ok((select public.cover_request_upload('image/webp')) ~ '^[0-9a-f-]{36}\.webp$', 'u1 starts a cover upload');
reset role;
select is((select purpose from public.avatar_uploads where owner_user_id = :'u1' order by created_at desc limit 1), 'cover', 'the pending row is a cover');
select set_config('t.k1', (select object_key from public.avatar_uploads where owner_user_id = :'u1' and purpose = 'cover' order by created_at desc limit 1), true);

select pg_temp.as_user(:'u1');
select throws_ok(format('select public.avatar_confirm_upload(%L)', current_setting('t.k1')), '42501', 'avatar not found',
  'a cover upload can never be confirmed as the avatar');
reset role;

-- Confirm the cover (bypassing the byte-verification trigger only for the fixture: it is proven by the media suites).
alter table public.avatar_uploads disable trigger avatar_verified_before_ready;
select pg_temp.as_user(:'u1');
select lives_ok(format('select public.cover_confirm_upload(%L)', current_setting('t.k1')), 'u1 confirms its cover');
reset role;
select is((select au.object_key from public.profiles p join public.avatar_uploads au on au.id = p.cover_media_id where p.user_id = :'u1'),
  current_setting('t.k1'), 'profiles.cover_media_id points at it');
select ok(app.is_current_avatar_object(current_setting('t.k1')), 'the current cover counts as a current profile image (published read)');
select is((select count(*)::int from public.audit_log where action = 'profile.cover_set' and subject_id = :'u1'), 1, 'audited');

-- Replace it: the previous cover is retired and no longer current.
select pg_temp.as_user(:'u1');
select set_config('t.k2', (select public.cover_request_upload('image/jpeg')), true);
select is((select public.cover_confirm_upload(current_setting('t.k2'))), current_setting('t.k1'), 'confirming a new cover returns the previous key for cleanup');
reset role;
select is((select state::text from public.avatar_uploads where object_key = current_setting('t.k1')), 'deleted', 'the previous cover is deleted');
select ok(not app.is_current_avatar_object(current_setting('t.k1')), 'and is no longer served');

-- Another user cannot confirm u1's upload; an avatar upload cannot become a cover.
select pg_temp.as_user(:'u1');
select set_config('t.k3', (select public.cover_request_upload('image/png')), true);
reset role;
select pg_temp.as_user(:'u2');
select throws_ok(format('select public.cover_confirm_upload(%L)', current_setting('t.k3')), '42501', 'cover not found', 'another user cannot confirm it');
select set_config('t.a2', (select public.avatar_request_upload('image/png')), true);
select throws_ok(format('select public.cover_confirm_upload(%L)', current_setting('t.a2')), '42501', 'cover not found', 'an avatar upload cannot become a cover');
reset role;

-- Delete.
select pg_temp.as_user(:'u1');
select is((select public.cover_delete_current()), current_setting('t.k2'), 'deleting returns the key for cleanup');
reset role;
select is((select cover_media_id from public.profiles where user_id = :'u1'), null::uuid, 'no cover remains');
alter table public.avatar_uploads enable trigger avatar_verified_before_ready;

-- Grants.
select ok(not has_function_privilege('anon', 'public.cover_request_upload(text)', 'execute')
      and has_function_privilege('authenticated', 'public.cover_confirm_upload(text)', 'execute'), 'owner RPCs are authenticated-only');
select ok(has_function_privilege('anon', 'public.public_profile_cover_key(uuid)', 'execute')
      and (select public.public_profile_cover_key(gen_random_uuid())) is null, 'the public key read answers NULL for an unknown profile');

select * from finish();
rollback;
