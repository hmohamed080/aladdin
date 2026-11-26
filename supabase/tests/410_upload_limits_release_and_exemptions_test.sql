-- pgTAP: a failed upload holds nothing; admin limits and exemptions (20261126110001, ADR-0032).
--
--   G. GUARD        every upload place is covered by the release function. A new upload place MUST extend it, or this fails.
--   A. SETTINGS     defaults 50 / 150 / 1024 MB.
--   B. HOURLY       successful and in-flight uploads count to the allowance; failed or released ones only to the ceiling.
--   C. ABANDONED    an unfinished upload stops counting after an hour (pending limit and storage), and confirming it late
--                   checks the storage quota again.
--   D. EXEMPTIONS   a chosen user or organization passes the limits until the exemption is removed.
--   E. ADMIN        view reads, manage (Super Admin) changes, guards, history, search.
create extension if not exists pgtap;

begin;
select no_plan();

\set sup '6e000000-0000-4000-8000-000000000001'
\set adm '6e000000-0000-4000-8000-000000000002'
\set u1  '6e000000-0000-4000-8000-000000000003'
\set u2  '6e000000-0000-4000-8000-000000000004'
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  (:'sup', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ul-sup@probe.test', now(), '{"display_name":"UL Super"}', now(), now()),
  (:'adm', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ul-adm@probe.test', now(), '{"display_name":"UL Admin"}', now(), now()),
  (:'u1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ul-one@probe.test', now(), '{"display_name":"UL Uploader 100%"}', now(), now()),
  (:'u2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ul-two@probe.test', now(), '{"display_name":"UL Other"}', now(), now());
update public.users set status = 'active' where id in (:'sup', :'adm', :'u1', :'u2');
insert into public.admin_role_assignments (user_id, role_id) select :'sup', id from public.admin_roles where key = 'super_admin';
insert into public.admin_role_assignments (user_id, role_id) select :'adm', id from public.admin_roles where key = 'administrator';

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
-- one upload as the browser does it: the pending row, then the central reservation
create function pg_temp.upload() returns text language plpgsql as $$
declare k text;
begin
  k := public.avatar_request_upload('image/png');
  perform public.media_storage_reserve('avatar', k, 'supabase');
  perform set_config('t.last', k, true);
  return k;
end;
$$;

-- ===========================================================================
-- G. Guard for every present and future upload place
-- ===========================================================================
select is(
  (select array_agg(distinct m[1] order by m[1]) from pg_proc p,
     regexp_matches(p.prosrc, 'p_namespace=''([a-z_]+)''', 'g') m where p.oid = 'app.media_metadata(text,text)'::regprocedure),
  (select array_agg(place order by place) from public.media_limits where kind = 'image'),
  'G1. the upload places are the namespaces the media system knows');
select is(
  (select coalesce(array_agg(l.place order by l.place), '{}') from public.media_limits l, pg_proc p
    where l.kind = 'image' and p.oid = 'public.media_upload_abandon(text,text)'::regprocedure
      and strpos(p.prosrc, 'when ''' || l.place || '''') = 0),
  '{}'::text[], 'G2. every upload place can release a failed upload (ADR-0032: extend media_upload_abandon)');
select is(has_function_privilege('anon', 'public.media_upload_abandon(text,text)', 'execute'), false, 'G3. never anonymous');

-- ===========================================================================
-- A. Settings
-- ===========================================================================
select is((select array[hourly_uploads, hourly_attempts, storage_quota_mb] from public.upload_limit_settings),
  array[50, 150, 1024], 'A1. defaults: 50 uploads, 150 attempts, 1024 MB');

-- ===========================================================================
-- B. The hourly allowance and the attempts ceiling
-- ===========================================================================
update public.upload_limit_settings set hourly_uploads = 3, hourly_attempts = 5;
select pg_temp.act_as(:'u1');
select set_config('t.k1', pg_temp.upload(), true);
select set_config('t.k2', pg_temp.upload(), true);
select set_config('t.k3', pg_temp.upload(), true);
select throws_ok($$select pg_temp.upload()$$, '54000', 'upload rate limit', 'B1. the allowance counts in-flight uploads');
select pg_temp.act_as(:'u2');
select is(public.media_upload_abandon('avatar', current_setting('t.k1')), false, 'B2. another user cannot release it');
select pg_temp.act_as(:'u1');
select is(public.media_upload_abandon('avatar', current_setting('t.k1')), true, 'B3. the uploader releases a failed upload');
select is(public.media_upload_abandon('avatar', current_setting('t.k1')), false, 'B4. releasing twice changes nothing');
select lives_ok($$select pg_temp.upload()$$, 'B5. ...and the allowance is free again');
select public.media_upload_abandon('avatar', current_setting('t.last'));
select lives_ok($$select pg_temp.upload()$$, 'B6. a fifth attempt passes');
select public.media_upload_abandon('avatar', current_setting('t.last'));
select throws_ok($$select pg_temp.upload()$$, '54000', 'upload rate limit', 'B7. the attempts ceiling counts released uploads');

-- ===========================================================================
-- C. Abandoned uploads
-- ===========================================================================
select pg_temp.as_owner();
delete from public.media_storage_locations where owner_user_id = :'u1';
update public.avatar_uploads set state = 'deleted' where owner_user_id = :'u1';
update public.upload_limit_settings set hourly_uploads = 100, hourly_attempts = 100, storage_quota_mb = 100;
select pg_temp.act_as(:'u1');
do $$ begin for i in 1..10 loop perform pg_temp.upload(); end loop; end $$;
select throws_ok($$select pg_temp.upload()$$, '54000', 'too many pending uploads', 'C1. ten unfinished uploads at once');
select pg_temp.as_owner();
update public.avatar_uploads set created_at = now() - interval '2 hours' where owner_user_id = :'u1' and state = 'pending';
update public.media_storage_locations set created_at = now() - interval '2 hours' where owner_user_id = :'u1';
select set_config('t.stale', (select object_key from public.avatar_uploads where owner_user_id = :'u1' and state = 'pending' limit 1), true);
select is(app.upload_used_bytes(:'u1', null), 0::bigint, 'C2. abandoned uploads use no storage');
select pg_temp.act_as(:'u1');
select lives_ok($x$do $d$ begin for i in 1..10 loop perform pg_temp.upload(); end loop; end $d$$x$,
  'C3. after an hour they block neither the ten pending places nor the quota');
select pg_temp.as_owner();
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(format($q$select public.media_storage_attest('avatar', %L, %L, 'supabase', 1000, 'image/png', repeat('a', 64))$q$,
  current_setting('t.stale'), :'u1'), '54000', 'upload quota exceeded', 'C4. confirming an abandoned upload late checks the quota again');

-- ===========================================================================
-- D. Exemptions
-- ===========================================================================
select pg_temp.as_owner();
update public.upload_limit_settings set hourly_uploads = 1, hourly_attempts = 1;
select pg_temp.act_as(:'u2');
select pg_temp.upload();
select throws_ok($$select pg_temp.upload()$$, '54000', 'upload rate limit', 'D1. a normal account stops at the limit');
select pg_temp.act_as(:'sup');
select is(public.admin_upload_exemption_add('user', :'u2', 'trusted photographer') ->> 'changed', 'true', 'D2. the Super Admin exempts it');
select is(public.admin_upload_exemption_add('user', :'u2', 'again') ->> 'changed', 'false', 'D3. adding twice changes nothing');
select pg_temp.act_as(:'u2');
select lives_ok($x$do $d$ begin for i in 1..12 loop perform pg_temp.upload(); end loop; end $d$$x$,
  'D4. the exempt account passes the hourly and pending limits');
select is(public.my_upload_exempt('avatar', current_setting('t.last')), true, 'D5. the server brake sees the exemption');
select pg_temp.act_as(:'u1');
select is(public.my_upload_exempt('avatar', current_setting('t.last')), false, 'D6. nothing is told about another user''s upload');
select pg_temp.act_as(:'sup');
select is(public.admin_upload_exemption_remove(
  (select (e ->> 'id')::uuid from jsonb_array_elements(public.admin_upload_limits_get() -> 'exemptions') e
    where e ->> 'subject_id' = :'u2'), 'no longer needed') ->> 'changed', 'true', 'D7. the exemption is removed');
select pg_temp.act_as(:'u2');
select throws_ok($$select pg_temp.upload()$$, '54000', null, 'D8. and the limits apply again');
select pg_temp.act_as(:'sup');
select public.admin_upload_exemption_add('organization', '9c000000-cccc-4ccc-8ccc-000000000001', 'bulk catalogue');
select pg_temp.as_owner();
select is(app.upload_exempt(:'u1', '9c000000-cccc-4ccc-8ccc-000000000001'), true, 'D9. an exempt organization covers its uploads');
select is(app.upload_exempt(:'u1', null), false, 'D10. not the member''s personal uploads');

-- ===========================================================================
-- E. Admin
-- ===========================================================================
select pg_temp.act_as(:'u1');
select throws_ok($$select public.admin_upload_limits_get()$$, '42501', 'permission media_limits is required', 'E1. a plain user reads nothing');
select throws_ok($$select * from public.admin_upload_subject_search('UL')$$, '42501', 'permission media_limits is required', 'E2. nor searches accounts');
select throws_ok($$select * from public.upload_limit_exemptions$$, '42501', null, 'E3. the tables are closed to clients');
select pg_temp.act_as(:'adm');
select ok(public.admin_upload_limits_get() -> 'settings' ? 'hourly_attempts', 'E4. an Administrator reads');
select throws_ok($$select public.admin_upload_limits_set(60, 180, 2048, 'because')$$, '42501', 'permission media_limits is required', 'E5. but cannot change');
select pg_temp.act_as(:'sup');
select throws_ok($$select public.admin_upload_limits_set(60, 50, 2048, 'because')$$, '22023', 'the limits are outside the allowed range', 'E6. attempts below uploads');
select throws_ok($$select public.admin_upload_limits_set(60, 180, 2048, ' ')$$, '22023', 'a reason of 3-500 characters is required', 'E7. a reason is mandatory');
select is(public.admin_upload_limits_set(60, 180, 2048, 'busy season') ->> 'changed', 'true', 'E8. the Super Admin changes the limits');
select is(public.admin_upload_limits_set(60, 180, 2048, 'busy season') ->> 'changed', 'false', 'E9. no change writes no history');
select is((select count(*)::int from jsonb_array_elements(public.admin_upload_limits_get() -> 'events') e
  where e ->> 'action' = 'limits_changed'), 1, 'E10. one history entry');
select is((select subject_id from public.admin_upload_subject_search('ul-one@probe.test')), :'u1'::uuid, 'E11. found by exact email');
select is((select count(*)::int from public.admin_upload_subject_search('r 100%') ), 1, 'E12. a percent sign is searched literally');
select is((select count(*)::int from public.admin_upload_subject_search('ul-one@')), 0, 'E13. part of an email finds nothing');
select throws_ok($$select public.admin_upload_exemption_add('user', gen_random_uuid(), 'because')$$, '22023', 'unknown account', 'E14. unknown account');
select pg_temp.as_owner();
select throws_ok($$delete from public.upload_limit_events$$, '23514', null, 'E15. the history is append-only');

select * from finish();
rollback;
