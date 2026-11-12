-- pgTAP: P1 / M3a - the database stops reading the application username
-- (20261112090001_pending_registration_stop_reading_username.sql). Function-only expand step; nothing is dropped.
--
-- Proves, against the real schema:
--   A. pending_registration_consume(): same signature and RETURNS TABLE shape, username ALWAYS NULL, audience intact,
--      single use, expired rows restore nothing, unauthenticated refused, grants unchanged (authenticated only);
--   B. pending_registration_save: the username-less overload exists next to the old one (exactly two overloads);
--      named-argument calls resolve to the right one; the new one stages the audience only (no lease, no profile read),
--      keeps first-write-wins, honours the unconfirmed/just-created guard and the TTL, and is service_role only;
--      an untyped 4-argument positional call is ambiguous (42725), which is why every caller uses named arguments;
--   C. the OLD overload still works for an old caller (named p_username => null, and a real username takes a lease);
--   D. neither new function body reads username / username_reserved_at / reserved_usernames / profiles, and the
--      username columns, the lease index and the check constraint can be dropped without breaking them (M3b rehearsal,
--      rolled back to a savepoint);
--   E. admin_users_directory, admin_users_list and admin_user_detail no longer emit a username key, keep the rest of the
--      shape, still refuse a non-admin and keep their grants.
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(56);

\set padmin '55555555-5555-4555-8555-555555555555'

create function pg_temp.q(p_user uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select (' || p_sql || ')::text' into r;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return 'ERR:' || sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: s1..s6 just-created unconfirmed registrants, c1 confirmed, o1 created 20 minutes ago, ad1 an admin target
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, confirmed, created, now()
from (values
  ('91270000-0000-4000-8000-0000000000a1', 'm3a-s1@example.test', null::timestamptz, now()),
  ('91270000-0000-4000-8000-0000000000a2', 'm3a-s2@example.test', null::timestamptz, now()),
  ('91270000-0000-4000-8000-0000000000a3', 'm3a-s3@example.test', null::timestamptz, now()),
  ('91270000-0000-4000-8000-0000000000a4', 'm3a-s4@example.test', null::timestamptz, now()),
  ('91270000-0000-4000-8000-0000000000a5', 'm3a-s5@example.test', null::timestamptz, now()),
  ('91270000-0000-4000-8000-0000000000a6', 'm3a-s6@example.test', null::timestamptz, now()),
  ('91270000-0000-4000-8000-0000000000b1', 'm3a-c1@example.test', now(), now()),
  ('91270000-0000-4000-8000-0000000000c1', 'm3a-o1@example.test', null::timestamptz, now() - interval '20 minutes'),
  ('91270000-0000-4000-8000-0000000000d1', 'quasar-m3a@probe.test', now(), now())) v(id, email, confirmed, created);

-- ===========================================================================
-- A. consume(): same shape, username always NULL
-- ===========================================================================
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'pending_registration_consume'),
  1, 'consume has exactly one definition (a zero-argument function cannot be overloaded)');
select is(pg_get_function_result('public.pending_registration_consume()'::regprocedure),
  'TABLE(username text, audience_kind activity_audience_kind, audience_value text)',
  'consume keeps its RETURNS TABLE(username, audience_kind, audience_value) so an old and a new caller both bind');
select ok(not has_function_privilege('anon', 'public.pending_registration_consume()', 'execute')
      and has_function_privilege('authenticated', 'public.pending_registration_consume()', 'execute')
      and not has_function_privilege('service_role', 'public.pending_registration_consume()', 'execute'),
  'consume grants are unchanged: authenticated only');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.pending_registration_consume()'::regprocedure),
  'consume stays SECURITY DEFINER with search_path = ""');

-- A row staged by the OLD function WITH a live username lease: consume must not hand the username back any more.
set local role service_role;
select is(public.pending_registration_save('91270000-0000-4000-8000-0000000000a1'::uuid, 'M3aLeased'::text, 'persona_type'::public.activity_audience_kind, 'engineer'::text, 30),
  true, 'old overload (typed): a username still takes a lease for an old caller');
reset role;
select is(pg_temp.q('91270000-0000-4000-8000-0000000000a1',
  $$ (select coalesce(username, '<null>') || '/' || audience_kind::text || '/' || audience_value from public.pending_registration_consume()) $$),
  '<null>/persona_type/engineer', 'consume returns the audience with a NULL username even when the row still holds an active lease');
select is((select count(*)::int from app.pending_registrations where user_id = '91270000-0000-4000-8000-0000000000a1'),
  0, 'consume deleted the row (single use)');
select is(pg_temp.q('91270000-0000-4000-8000-0000000000a1', $$ (select count(*)::int from public.pending_registration_consume()) $$),
  '0', 'a second consume returns nothing');

insert into app.pending_registrations (user_id, audience_kind, audience_value, expires_at)
values ('91270000-0000-4000-8000-0000000000a2', 'persona_type', 'engineer', now() - interval '1 minute');
select is(pg_temp.q('91270000-0000-4000-8000-0000000000a2', $$ (select count(*)::int from public.pending_registration_consume()) $$),
  '0', 'an expired row restores nothing');
select is((select count(*)::int from app.pending_registrations where user_id = '91270000-0000-4000-8000-0000000000a2'),
  0, 'and the expired row is swept');

set local role authenticated;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from public.pending_registration_consume() $$, '42501', 'authentication required', 'consume refuses an unauthenticated caller');
reset role;

-- ===========================================================================
-- B. the username-less save overload
-- ===========================================================================
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'pending_registration_save'),
  2, 'exactly two save overloads exist during the transition');
select ok(exists (select 1 from pg_proc where oid = 'public.pending_registration_save(uuid,public.activity_audience_kind,text,integer)'::regprocedure)
      and exists (select 1 from pg_proc where oid = 'public.pending_registration_save(uuid,text,public.activity_audience_kind,text,integer)'::regprocedure),
  'the username-less overload and the old five-argument function both exist');
select ok((select prosecdef and proconfig = array['search_path=""'] and format_type(prorettype, null) = 'boolean'
             from pg_proc where oid = 'public.pending_registration_save(uuid,public.activity_audience_kind,text,integer)'::regprocedure),
  'the new overload is SECURITY DEFINER, search_path = "", returns boolean');
select ok(not has_function_privilege('anon', 'public.pending_registration_save(uuid,public.activity_audience_kind,text,integer)', 'execute')
      and not has_function_privilege('authenticated', 'public.pending_registration_save(uuid,public.activity_audience_kind,text,integer)', 'execute')
      and has_function_privilege('service_role', 'public.pending_registration_save(uuid,public.activity_audience_kind,text,integer)', 'execute'),
  'the new overload is service_role only (same as the old one)');
select is((select proacl::text from pg_proc where oid = 'public.pending_registration_save(uuid,public.activity_audience_kind,text,integer)'::regprocedure),
  (select proacl::text from pg_proc where oid = 'public.pending_registration_save(uuid,text,public.activity_audience_kind,text,integer)'::regprocedure),
  'the new overload has exactly the old function''s ACL');

-- PostgreSQL resolves an untyped positional 4-argument call to neither: callers must use named arguments.
select throws_ok($$ select public.pending_registration_save('91270000-0000-4000-8000-0000000000a3', null, 'persona_type', 'engineer') $$,
  '42725', null, 'an untyped positional four-argument call is ambiguous between the overloads (callers use named arguments)');

-- NEW caller (named arguments, no p_username - exactly what supabase.rpc sends after PR-B).
set local role service_role;
select is(public.pending_registration_save(p_user_id => '91270000-0000-4000-8000-0000000000a3',
            p_audience_kind => 'organization_type', p_audience_value => 'showroom_dealer'),
  true, 'new caller: a named call without p_username resolves to the new overload and stages the audience');
reset role;
select results_eq($$ select username, username_reserved_at, audience_kind::text, audience_value
                       from app.pending_registrations where user_id = '91270000-0000-4000-8000-0000000000a3' $$,
  $$ values (null::text, null::timestamptz, 'organization_type'::text, 'showroom_dealer'::text) $$,
  'only the audience is stored: no username, no lease start');
select ok((select expires_at between now() + interval '29 minutes' and now() + interval '31 minutes'
             from app.pending_registrations where user_id = '91270000-0000-4000-8000-0000000000a3'),
  'the default TTL is 30 minutes');
set local role service_role;
select is(public.pending_registration_save(p_user_id => '91270000-0000-4000-8000-0000000000a3',
            p_audience_kind => 'persona_type', p_audience_value => 'engineer'),
  false, 'a repeat call stages nothing (first write wins)');
reset role;
select is((select audience_value from app.pending_registrations where user_id = '91270000-0000-4000-8000-0000000000a3'),
  'showroom_dealer', 'and never overwrites the staged audience');

set local role service_role;
select is(public.pending_registration_save(p_user_id => '91270000-0000-4000-8000-0000000000a4',
            p_audience_kind => 'persona_type', p_audience_value => 'engineer', p_ttl_minutes => 5),
  true, 'p_ttl_minutes is honoured (named)');
reset role;
select ok((select expires_at between now() + interval '4 minutes' and now() + interval '6 minutes'
             from app.pending_registrations where user_id = '91270000-0000-4000-8000-0000000000a4'),
  'the row expires after the requested five minutes');
set local role service_role;
select is(public.pending_registration_save(p_user_id => '91270000-0000-4000-8000-0000000000b1',
            p_audience_kind => 'persona_type', p_audience_value => 'engineer'),
  false, 'a confirmed user cannot stage anything (guard kept)');
select is(public.pending_registration_save(p_user_id => '91270000-0000-4000-8000-0000000000c1',
            p_audience_kind => 'persona_type', p_audience_value => 'engineer'),
  false, 'a user created more than ten minutes ago cannot stage anything (guard kept)');
select is(public.pending_registration_save(p_user_id => '91270000-0000-4000-8000-00000000ffff',
            p_audience_kind => 'persona_type', p_audience_value => 'engineer'),
  false, 'an unknown user id stages nothing');
select throws_ok($$ select public.pending_registration_save(p_user_id => null, p_audience_kind => 'persona_type', p_audience_value => 'engineer') $$,
  '22023', 'user id is required', 'a null user id is refused');
reset role;
select is((select count(*)::int from app.pending_registrations
            where user_id in ('91270000-0000-4000-8000-0000000000b1', '91270000-0000-4000-8000-0000000000c1', '91270000-0000-4000-8000-00000000ffff')),
  0, 'none of the refused calls left a row');
select throws_ok($$ set local role authenticated; select public.pending_registration_save(p_user_id => '91270000-0000-4000-8000-0000000000a5',
                      p_audience_kind => 'persona_type', p_audience_value => 'engineer') $$,
  '42501', null, 'a signed-in client cannot call the new overload');
reset role;

-- The new overload does not take a lease and does not look at names: a name stays free after it.
select is(public.username_available('m3afreshname'), true, 'no name was reserved by the new overload');
select is((select count(*)::int from app.pending_registrations where username is not null
            and user_id in ('91270000-0000-4000-8000-0000000000a3', '91270000-0000-4000-8000-0000000000a4')),
  0, 'no lease row exists for the new-style registrations');

-- consume returns what the new overload staged.
select is(pg_temp.q('91270000-0000-4000-8000-0000000000a3',
  $$ (select coalesce(username, '<null>') || '/' || audience_kind::text || '/' || audience_value from public.pending_registration_consume()) $$),
  '<null>/organization_type/showroom_dealer', 'consume returns the audience staged by the new overload');

-- ===========================================================================
-- C. the OLD overload still serves an old caller
-- ===========================================================================
set local role service_role;
select is(public.pending_registration_save(p_user_id => '91270000-0000-4000-8000-0000000000a5', p_username => null,
            p_audience_kind => 'persona_type', p_audience_value => 'engineer', p_ttl_minutes => 30),
  false, 'old caller (named, p_username => null, as the deployed app before PR-B) resolves to the old overload and stages the audience');
select is(public.pending_registration_save(p_user_id => '91270000-0000-4000-8000-0000000000a6', p_username => 'M3aOld',
            p_audience_kind => 'persona_type', p_audience_value => 'engineer'),
  true, 'old caller with a username still takes a lease');
reset role;
select results_eq($$ select audience_value, username is null from app.pending_registrations where user_id = '91270000-0000-4000-8000-0000000000a5' $$,
  $$ values ('engineer'::text, true) $$, 'the old overload with NULL stored the audience and no username');
select results_eq($$ select username, username_reserved_at is not null from app.pending_registrations where user_id = '91270000-0000-4000-8000-0000000000a6' $$,
  $$ values ('M3aOld'::text, true) $$, 'the old overload with a username keeps its lease (until M3b)');
select is(pg_temp.q('91270000-0000-4000-8000-0000000000a5', $$ (select count(*)::int from public.pending_registration_consume()) $$),
  '1', 'consume serves a row staged by the old overload');

-- ===========================================================================
-- D. nothing the new app calls reads the username any more; the columns can go
-- ===========================================================================
select ok((select prosrc !~* 'username_reserved_at|v_row\.username|reserved_usernames|public\.profiles'
             from pg_proc where oid = 'public.pending_registration_consume()'::regprocedure),
  'consume no longer references username_reserved_at, v_row.username, reserved_usernames or profiles');
select ok((select prosrc !~* 'username|profiles'
             from pg_proc where oid = 'public.pending_registration_save(uuid,public.activity_audience_kind,text,integer)'::regprocedure),
  'the new save overload does not mention username or profiles at all');
select ok((select position('username' in lower(pg_get_functiondef('public.admin_users_directory(text,text,text,text,text,text,integer,integer)'::regprocedure))) = 0
             and position('username' in lower(pg_get_functiondef('public.admin_user_detail(uuid)'::regprocedure))) = 0),
  'the Admin directory and detail functions do not mention username at all');

savepoint m3b_rehearsal;
drop function public.pending_registration_save(uuid, text, public.activity_audience_kind, text, integer);
alter table app.pending_registrations drop column username, drop column username_reserved_at;
select lives_ok($$ select public.pending_registration_save(p_user_id => '91270000-0000-4000-8000-0000000000a5',
                      p_audience_kind => 'persona_type', p_audience_value => 'engineer') $$,
  'the new save overload still runs after the username columns, the lease index and the check constraint are dropped');
select is(pg_temp.q('91270000-0000-4000-8000-0000000000a5', $$ (select count(*)::int from public.pending_registration_consume()) $$),
  '1', 'consume still runs and returns the staged row after the username columns are dropped (its body no longer references them)');
rollback to savepoint m3b_rehearsal;
select ok(exists (select 1 from information_schema.columns where table_schema = 'app' and table_name = 'pending_registrations' and column_name = 'username'),
  'the rehearsal was rolled back (the username column is still present)');

-- ===========================================================================
-- E. Admin read models carry no username key
-- ===========================================================================
update public.profiles set display_name = 'Quasar M3a', username = 'zxqwm3a' where user_id = '91270000-0000-4000-8000-0000000000d1';
select is(pg_temp.q(:'padmin', $$ (public.admin_users_directory(p_search => 'Quasar M3a') -> 'rows' -> 0) ? 'username' $$), 'false',
  'directory rows carry no username key although the profile still holds one');
select is(pg_temp.q(:'padmin', $$ public.admin_users_directory(p_search => 'Quasar M3a') -> 'total' $$), '1', 'display-name search still finds the account');
select is(pg_temp.q(:'padmin', $$ public.admin_users_directory(p_search => 'zxqwm3a') -> 'total' $$), '0', 'a username is not searchable');
select is(pg_temp.q(:'padmin', $$ (select array_agg(k order by k) from jsonb_object_keys(public.admin_users_directory(p_search => 'Quasar M3a') -> 'rows' -> 0) k) $$),
  '{account_type,city,completion,created_at,display_name,display_name_ar,display_name_en,email,flags,governorate,id,is_verified,latest_verification_status,organization,organization_count,phone,profile_id,public_profile_available,registered_account,status,verification_state}',
  'the directory row shape is unchanged except for the removed username key');
select is(pg_temp.q(:'padmin', $$ (public.admin_users_list(p_search => 'Quasar M3a') -> 'rows' -> 0) ? 'username' $$), 'false',
  'the deprecated admin_users_list (delegates to the directory) carries no username key either');
select is(pg_temp.q(:'padmin', $$ public.admin_user_detail('91270000-0000-4000-8000-0000000000d1') ? 'username' $$), 'false',
  'admin_user_detail carries no username key');
select is(pg_temp.q(:'padmin', $$ public.admin_user_detail('91270000-0000-4000-8000-0000000000d1') ->> 'display_name' $$), 'Quasar M3a',
  'admin_user_detail still returns the display name');
select is(pg_temp.q(:'padmin', $$ (select array_agg(k order by k) from jsonb_object_keys(public.admin_user_detail('91270000-0000-4000-8000-0000000000d1')) k) $$),
  '{account_type,bio,city,completion,created_at,display_name,display_name_ar,display_name_en,email,governorate,headline,id,is_verified,last_sign_in_at,locale,memberships,phone,profile_id,public_profile_available,registered_account,status,verification_state,verifications}',
  'the detail shape is unchanged except for the removed username key');
select is(pg_temp.q('91270000-0000-4000-8000-0000000000d1', $$ public.admin_users_directory() $$), 'ERR:42501', 'a non-admin is still refused by the directory');
select is(pg_temp.q('91270000-0000-4000-8000-0000000000d1', $$ public.admin_user_detail('91270000-0000-4000-8000-0000000000d1') $$), 'ERR:42501', 'a non-admin is still refused by the detail');
select ok(not has_function_privilege('anon', 'public.admin_user_detail(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.admin_user_detail(uuid)', 'execute')
      and not has_function_privilege('service_role', 'public.admin_user_detail(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.admin_users_directory(text,text,text,text,text,text,integer,integer)', 'execute')
      and has_function_privilege('authenticated', 'public.admin_users_directory(text,text,text,text,text,text,integer,integer)', 'execute'),
  'Admin read-model grants are unchanged (authenticated only)');
select is(pg_temp.q('91270000-0000-4000-8000-0000000000d1', $$ public.my_profile_completion() -> 'missing' ? 'username' $$), 'false',
  'my_profile_completion still has no username criterion (M1)');

select * from finish();
rollback;
