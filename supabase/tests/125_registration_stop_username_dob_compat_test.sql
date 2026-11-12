-- pgTAP: P1 / M1 - registration stops requiring a username (20261110090002_registration_stop_username_dob_compat.sql).
--
-- The NEW app sends no username and never calls username_available / profile_set_username; the OLD app still does.
-- Both must work against this one schema. Proves, against the real schema:
--   A. pending_registrations accepts a NULL username (NULL/NULL lease shape) and still rejects a half-set lease;
--   B. NEW-style pending_registration_save (p_username => null, positional and named-argument calls) stores only the
--      audience, takes no lease and reserves nothing; consume returns the audience with a NULL username;
--   C. OLD-style save/consume with a username keeps its lease behavior;
--   D. my_registration_state never returns username_pending and keeps the order
--      unverified -> manually_blocked -> active_personal -> consent_pending -> account_type_pending -> access_ready,
--      and a legacy user with a username is still access_ready;
--   E. app.profile_completion no longer has a username criterion (rebalanced denominator), my_profile_completion agrees;
--   F. the Admin directory search no longer matches by username, still matches the rest, and its shape is unchanged;
--   G. the grant surface is unchanged (anon reaches only username_available) and search_path = '' is held.
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
create function pg_temp.st(p_user uuid) returns text language sql as $$
  select pg_temp.q(p_user, 'public.my_registration_state()') $$;

-- ---------------------------------------------------------------------------
-- Fixtures
--   n1..n3  just-created unconfirmed registrants (n1 new style, n2 old style, n3 old style colliding with n2)
--   m1..m7  registration-state fixtures
--   pc1/pc2 profile-completion fixtures
--   ad1     an admin-directory target that holds a legacy username
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, confirmed, now(), now()
from (values
  ('91250000-0000-4000-8000-0000000000a1', 'm1-n1@example.test', null::timestamptz),
  ('91250000-0000-4000-8000-0000000000a2', 'm1-n2@example.test', null::timestamptz),
  ('91250000-0000-4000-8000-0000000000a3', 'm1-n3@example.test', null::timestamptz),
  ('91250000-0000-4000-8000-0000000000a4', 'm1-n4@example.test', null::timestamptz),
  ('91250000-0000-4000-8000-0000000000b1', 'm1-s1@example.test', now()),
  ('91250000-0000-4000-8000-0000000000b2', 'm1-s2@example.test', now()),
  ('91250000-0000-4000-8000-0000000000b3', 'm1-s3@example.test', now()),
  ('91250000-0000-4000-8000-0000000000b4', 'm1-s4@example.test', now()),
  ('91250000-0000-4000-8000-0000000000b5', 'm1-s5@example.test', null),
  ('91250000-0000-4000-8000-0000000000b6', 'm1-s6@example.test', now()),
  ('91250000-0000-4000-8000-0000000000b7', 'm1-s7@example.test', now()),
  ('91250000-0000-4000-8000-0000000000c1', 'm1-pc1@example.test', now()),
  ('91250000-0000-4000-8000-0000000000c2', 'm1-pc2@example.test', now()),
  ('91250000-0000-4000-8000-0000000000d1', 'quasar-ad1@probe.test', now())) v(id, email, confirmed);

insert into public.consent_receipts (user_id, consent_type, version, locale)
select u.id, t.t, app.current_consent_version(t.t), 'en'
from (values ('91250000-0000-4000-8000-0000000000b2'::uuid), ('91250000-0000-4000-8000-0000000000b3'::uuid),
             ('91250000-0000-4000-8000-0000000000b4'::uuid), ('91250000-0000-4000-8000-0000000000b5'::uuid),
             ('91250000-0000-4000-8000-0000000000b6'::uuid)) u(id)
cross join unnest(array['terms','privacy','pilot']::public.consent_type[]) t(t);

-- ===========================================================================
-- A. The staging table admits a NULL username
-- ===========================================================================
select is((select attnotnull from pg_attribute where attrelid = 'app.pending_registrations'::regclass and attname = 'username'),
  false, 'pending_registrations.username is nullable');
select is((select attnotnull from pg_attribute where attrelid = 'app.pending_registrations'::regclass and attname = 'audience_value'),
  true, 'the audience columns stay NOT NULL (the new app still sends the account type)');
select throws_ok($$ insert into app.pending_registrations (user_id, username, username_reserved_at, audience_kind, audience_value, expires_at)
                    values ('91250000-0000-4000-8000-0000000000a4', 'halfset', null, 'persona_type', 'engineer', now() + interval '30 minutes') $$,
  '23514', null, 'a username without a lease start is still rejected (old shape validated when a username is present)');
select throws_ok($$ insert into app.pending_registrations (user_id, username, username_reserved_at, audience_kind, audience_value, expires_at)
                    values ('91250000-0000-4000-8000-0000000000a4', null, now(), 'persona_type', 'engineer', now() + interval '30 minutes') $$,
  '23514', null, 'a lease start without a username is rejected');
select lives_ok($$ insert into app.pending_registrations (user_id, username, username_reserved_at, audience_kind, audience_value, expires_at)
                   values ('91250000-0000-4000-8000-0000000000a4', null, null, 'persona_type', 'engineer', now() + interval '30 minutes') $$,
  'a NULL/NULL row (no username, no lease) is accepted');
delete from app.pending_registrations where user_id = '91250000-0000-4000-8000-0000000000a4';

-- ===========================================================================
-- B. NEW-style: no username, no lease, no reservation
-- ===========================================================================
set local role service_role;
select is(public.pending_registration_save('91250000-0000-4000-8000-0000000000a1', null, 'persona_type', 'engineer', 30),
  false, 'new app (positional NULL username): saves, and reports that no username lease is held');
reset role;
select results_eq($$ select username, username_reserved_at, audience_kind::text, audience_value
                       from app.pending_registrations where user_id = '91250000-0000-4000-8000-0000000000a1' $$,
  $$ values (null::text, null::timestamptz, 'persona_type'::text, 'engineer'::text) $$,
  'only the audience is stored: no username, no lease start');
select is((select count(*)::int from app.pending_registrations where username is not null
            and user_id = '91250000-0000-4000-8000-0000000000a1'),
  0, 'no lease row exists for the new-style registration');

-- PostgREST binds supabase.rpc(fn, {p_user_id, p_username: null, ...}) by NAME with a null argument.
set local role service_role;
select is(public.pending_registration_save(p_user_id => '91250000-0000-4000-8000-0000000000a4', p_username => null,
            p_audience_kind => 'organization_type', p_audience_value => 'showroom_dealer', p_ttl_minutes => 30),
  false, 'named-argument call with p_username => null (how supabase.rpc binds) is valid with the unchanged signature');
reset role;
select is((select audience_value from app.pending_registrations where user_id = '91250000-0000-4000-8000-0000000000a4'),
  'showroom_dealer', 'the named-argument call stored the audience');

-- A NULL username reserves nothing: another registration can still take any name.
select is(public.username_available('freshname1'), true, 'a name is still free after NULL-username saves');

-- consume: returns the audience, NULL username, and deletes the row exactly once.
select is(pg_temp.q('91250000-0000-4000-8000-0000000000a1',
  $$ (select coalesce(username, '<null>') || '/' || audience_kind::text || '/' || audience_value from public.pending_registration_consume()) $$),
  '<null>/persona_type/engineer', 'consume returns the audience with a NULL username and does not require or claim one');
select is((select count(*)::int from app.pending_registrations where user_id = '91250000-0000-4000-8000-0000000000a1'),
  0, 'consume deleted the row');
select is(pg_temp.q('91250000-0000-4000-8000-0000000000a1',
  $$ (select count(*)::int from public.pending_registration_consume()) $$),
  '0', 'a second consume returns nothing');

-- ===========================================================================
-- C. OLD-style: username + lease still behave exactly as before
-- ===========================================================================
set local role service_role;
select is(public.pending_registration_save('91250000-0000-4000-8000-0000000000a2', 'OldStyle', 'persona_type', 'engineer', 30),
  true, 'old app: a username takes a lease');
select is(public.pending_registration_save('91250000-0000-4000-8000-0000000000a3', 'oldstyle', 'organization_type', 'supplier', 30),
  false, 'old app: a second registration cannot lease a name already leased');
reset role;
select results_eq($$ select username, (username_reserved_at is not null) from app.pending_registrations where user_id = '91250000-0000-4000-8000-0000000000a2' $$,
  $$ values ('OldStyle'::text, true) $$, 'old app: the lease row holds the username and its start');
select is((select audience_value from app.pending_registrations where user_id = '91250000-0000-4000-8000-0000000000a3'),
  'supplier', 'old app: the loser keeps its account type');
select is(pg_temp.q('91250000-0000-4000-8000-0000000000b1', $$ public.username_available('OLDSTYLE') $$),
  'false', 'old app: username_available (untouched) reads a leased name as unavailable');
select is(pg_temp.q('91250000-0000-4000-8000-0000000000a2',
  $$ (select username from public.pending_registration_consume()) $$),
  null, 'old app: consume no longer returns the username even while the lease is active (P1 M3a; the shape keeps the column, the value is NULL)');

-- Old profile_set_username (untouched) still works for a legacy caller (returns void -> empty text).
select is(pg_temp.q('91250000-0000-4000-8000-0000000000b4', $$ public.profile_set_username('legacyname') $$),
  '', 'old app: profile_set_username still claims a name');

-- ===========================================================================
-- D. my_registration_state: no username_pending, precedence intact
-- ===========================================================================
-- b1: nothing.  b2: consent only (no account type).  b3: consent + business type, NO username.
-- b4: consent + type + username.  b5: UNCONFIRMED with consent.  b6: suspended with consent + type.
-- b7: users.status = active, no consent.
select is(pg_temp.q('91250000-0000-4000-8000-0000000000b3', $$ public.onboarding_select_account_type('business'::public.onboarding_track, 'supplier') $$),
  '', 'fixture b3: business account type recorded, no username');
select is(pg_temp.q('91250000-0000-4000-8000-0000000000b4', $$ public.onboarding_select_account_type('professional'::public.onboarding_track, 'installer_technician') $$),
  '', 'fixture b4: professional account type recorded (username claimed above)');
select is(pg_temp.q('91250000-0000-4000-8000-0000000000b6', $$ public.onboarding_select_account_type('business'::public.onboarding_track, 'supplier') $$),
  '', 'fixture b6: account type recorded');
update public.users set status = 'suspended' where id = '91250000-0000-4000-8000-0000000000b6';
update public.users set status = 'active' where id = '91250000-0000-4000-8000-0000000000b7';

select is((select username from public.profiles where user_id = '91250000-0000-4000-8000-0000000000b3'), null,
  'sanity: b3 has no username');
select is(pg_temp.st('91250000-0000-4000-8000-0000000000b1'), 'consent_pending', 'confirmed, no consent -> consent_pending (no username either)');
select is(pg_temp.st('91250000-0000-4000-8000-0000000000b2'), 'account_type_pending', 'consent, no account type, no username -> account_type_pending, not access_ready');
select is(pg_temp.st('91250000-0000-4000-8000-0000000000b3'), 'access_ready', 'consent + account type, NULL username -> access_ready (not username_pending)');
select is(pg_temp.st('91250000-0000-4000-8000-0000000000b4'), 'access_ready', 'legacy user with a username and an account type is still access_ready');
select is(pg_temp.st('91250000-0000-4000-8000-0000000000b5'), 'unverified', 'unconfirmed email -> unverified regardless of consent');
select is(pg_temp.st('91250000-0000-4000-8000-0000000000b6'), 'manually_blocked', 'suspended -> manually_blocked');
select is(pg_temp.st('91250000-0000-4000-8000-0000000000b7'), 'active_personal', 'users.status = active keeps its active_personal early return');
select isnt(pg_temp.st('91250000-0000-4000-8000-0000000000b3'), 'active_personal', 'a business-track account with zero memberships is never active_personal');
select is(pg_temp.st(null), 'unverified', 'no session -> unverified');
select is(pg_get_functiondef('public.my_registration_state()'::regprocedure) ~ 'public\.profiles', false,
  'the function body no longer reads public.profiles (no username lookup)');

-- ===========================================================================
-- E. profile_completion without the username criterion
-- ===========================================================================
update public.profiles set display_name_confirmed_at = now() where user_id = '91250000-0000-4000-8000-0000000000c1';
update public.profiles set username = 'pcname' where user_id = '91250000-0000-4000-8000-0000000000c2';
select is(app.profile_completion('91250000-0000-4000-8000-0000000000c1') -> 'missing', '["avatar","phone"]'::jsonb,
  'NULL username: never listed as missing');
select is((app.profile_completion('91250000-0000-4000-8000-0000000000c1') ->> 'percent')::int, 33,
  'rebalanced denominator: 1 of 3 all-audience items = 33');
select is(app.profile_completion('91250000-0000-4000-8000-0000000000c2') -> 'missing', '["avatar","phone","display_name"]'::jsonb,
  'a legacy username earns nothing: missing is exactly avatar, phone, display_name');
select is((app.profile_completion('91250000-0000-4000-8000-0000000000c2') ->> 'percent')::int, 0, 'and 0 of 3 is 0');
select is((select array_agg(k order by k) from jsonb_object_keys(app.profile_completion('91250000-0000-4000-8000-0000000000c1')) k),
  array['audience','has_org','missing','percent'], 'the result shape is unchanged');
select is(pg_temp.q('91250000-0000-4000-8000-0000000000c1', $$ public.my_profile_completion() -> 'percent' $$), '33',
  'my_profile_completion (the caller wrapper) agrees');
select is(app.profile_completion('91250000-0000-4000-8000-0000000000b3') -> 'missing',
  '["avatar","phone","display_name","organization_setup"]'::jsonb, 'business-track items are unchanged (4 items, 0 done)');

-- ===========================================================================
-- F. Admin directory: search no longer matches the username
-- ===========================================================================
update public.profiles set display_name = 'Quasar Zed', username = 'zxqwuniq' where user_id = '91250000-0000-4000-8000-0000000000d1';
select is(pg_temp.q(:'padmin', $$ public.admin_users_directory(p_search => 'zxqwuniq') -> 'total' $$), '0',
  'searching a username no longer finds the account');
select is(pg_temp.q(:'padmin', $$ public.admin_users_directory(p_search => 'Quasar Zed') -> 'total' $$), '1', 'display-name search still works');
select is(pg_temp.q(:'padmin', $$ public.admin_users_directory(p_search => 'quasar-ad1') -> 'total' $$), '1', 'email search still works');
select is(pg_temp.q(:'padmin', $$ (public.admin_users_directory(p_search => 'Quasar Zed') -> 'rows' -> 0) ? 'username' $$), 'false',
  'rows no longer carry a username key (P1 M3a)');
select is(pg_temp.q(:'padmin', $$ (select array_agg(k order by k) from jsonb_object_keys(public.admin_users_directory(p_search => 'Quasar Zed') -> 'rows' -> 0) k) $$),
  '{account_type,city,completion,created_at,display_name,display_name_ar,display_name_en,email,flags,governorate,id,is_verified,latest_verification_status,organization,organization_count,phone,profile_id,public_profile_available,registered_account,status,verification_state}',
  'the row shape is unchanged except for the removed username key (P1 M3a)');
select is(pg_temp.q('91250000-0000-4000-8000-0000000000d1', $$ public.admin_users_directory() $$), 'ERR:42501',
  'a non-admin is still refused by the permission check');

-- ===========================================================================
-- G. Grants and search_path
-- ===========================================================================
select ok(not has_function_privilege('anon', 'public.pending_registration_consume()', 'execute')
      and has_function_privilege('authenticated', 'public.pending_registration_consume()', 'execute')
      and not has_function_privilege('service_role', 'public.pending_registration_consume()', 'execute'),
  'consume: authenticated only');
select ok(not has_function_privilege('anon', 'public.pending_registration_save(uuid,text,public.activity_audience_kind,text,integer)', 'execute')
      and not has_function_privilege('authenticated', 'public.pending_registration_save(uuid,text,public.activity_audience_kind,text,integer)', 'execute')
      and has_function_privilege('service_role', 'public.pending_registration_save(uuid,text,public.activity_audience_kind,text,integer)', 'execute'),
  'save: service_role only');
select ok(not has_function_privilege('anon', 'public.my_registration_state()', 'execute')
      and has_function_privilege('authenticated', 'public.my_registration_state()', 'execute')
      and not has_function_privilege('service_role', 'public.my_registration_state()', 'execute'),
  'my_registration_state: authenticated only');
select ok(not has_function_privilege('anon', 'public.admin_users_directory(text,text,text,text,text,text,integer,integer)', 'execute')
      and has_function_privilege('authenticated', 'public.admin_users_directory(text,text,text,text,text,text,integer,integer)', 'execute'),
  'admin_users_directory: authenticated only');
select ok(not has_function_privilege('anon', 'app.profile_completion(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'app.profile_completion(uuid)', 'execute'),
  'app.profile_completion stays callable by no API role');
select ok(has_function_privilege('anon', 'public.username_available(text)', 'execute')
      and has_function_privilege('authenticated', 'public.profile_set_username(text)', 'execute')
      and not has_function_privilege('anon', 'public.profile_set_username(text)', 'execute'),
  'old-app functions untouched: username_available stays anon, profile_set_username stays authenticated');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
              and p.proname in ('pending_registration_save','pending_registration_consume','my_registration_state',
                                'admin_users_directory','admin_user_detail','profile_set_username','my_profile_completion')),
  0, 'anon reaches none of the registration/admin functions');
select is((select count(*)::int from pg_proc p where p.oid in (
    'public.my_registration_state()'::regprocedure, 'app.profile_completion(uuid)'::regprocedure,
    'public.admin_users_directory(text,text,text,text,text,text,integer,integer)'::regprocedure,
    'public.pending_registration_save(uuid,text,public.activity_audience_kind,text,integer)'::regprocedure,
    'public.pending_registration_consume()'::regprocedure)
  and p.prosecdef and p.proconfig @> array['search_path=""']), 5,
  'all five are SECURITY DEFINER with search_path empty');

select * from finish();
rollback;
