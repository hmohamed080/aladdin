-- Account basics (ADR-0026): location on the canonical catalogue and a specialty
-- list that suits the account type (20261029090002), through
-- public.account_basics_set only.
create extension if not exists pgtap;
begin;
select plan(44);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values
  ('11700000-0000-4000-8000-000000000001', 'p117-installer@example.test'),
  ('11700000-0000-4000-8000-000000000002', 'p117-showroom@example.test'),
  ('11700000-0000-4000-8000-000000000003', 'p117-owner@example.test'),
  ('11700000-0000-4000-8000-000000000004', 'p117-employee@example.test')) v(id, email);

insert into public.consent_receipts (user_id, consent_type, version, locale)
select u.id, t.t, app.current_consent_version(t.t), 'en'
from public.users u
cross join unnest(array['terms','privacy','pilot']::public.consent_type[]) t(t)
where u.id::text like '11700000-0000-4000-8000-00000000000_';

-- Clients reach the new data only through the RPCs.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'governorate_key', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'city_key', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'city_custom_name', 'UPDATE'),
  'clients cannot write a profile location directly');
select ok(
  not has_table_privilege('authenticated', 'public.user_activities', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'public.user_activities', 'SELECT'),
  'clients cannot write specialties directly and anon cannot read them');
select ok(
  not has_function_privilege('anon', 'public.account_basics_set(text, text, text, text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.my_account_basics()', 'EXECUTE'),
  'anon cannot call the account-basics RPCs');

-- ---------------------------------------------------------------------------
-- A showroom: its list is the business activity, answered in business setup,
-- so account basics never asks it for specialties.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('business', 'showroom_dealer') $$, 'showroom: account type recorded');
select is(public.my_account_basics() ->> 'specialtyKind', 'none', 'showroom: no personal specialty list');
select is(public.my_account_basics() -> 'specialties', '[]'::jsonb, 'showroom: no specialties');
select is(public.my_account_basics() ->> 'governorate', null, 'showroom: no location yet');

select throws_ok($$ select public.account_basics_set('cairo', null, null, null) $$, '22023', null,
  'a governorate without a town is refused');
select throws_ok($$ select public.account_basics_set('atlantis', 'x', null, null) $$, '22023', null,
  'an unknown governorate is refused');
select throws_ok($$ select public.account_basics_set(null, 'new-cairo', null, null) $$, '22023', null,
  'a town without a governorate is refused');
select throws_ok($$ select public.account_basics_set(null, null, null, array['wallpaper_installation']) $$, '22023', null,
  'showroom: installer trades are never offered or stored');
select lives_ok($$ select public.account_basics_set('cairo', 'new-cairo', null, null) $$, 'showroom: location saved');
select is(public.my_account_basics() ->> 'city', 'new-cairo', 'showroom: town stored as the catalogue key');
reset role;
select is((select count(*)::int from public.user_trades where user_id = '11700000-0000-4000-8000-000000000002'), 0,
  'showroom: the professional trade signal is untouched');

-- Business setup takes the activity of the business type, for any type that has a list.
select is((select count(*)::int from public.activities where organization_type = 'supplier' and key in ('distributor', 'wholesaler') and is_active), 2,
  'supplier list: Distributor, Wholesaler');
select ok(pg_get_functiondef('public.business_draft_save_v2(uuid,text,text,public.organization_type,text,text,text,text,text,text,text,text,text)'::regprocedure)
            like '%a.organization_type=p_org_type and a.key=p_activity_type%',
  'business setup validates the activity against the business type''s own list');

-- ---------------------------------------------------------------------------
-- An engineer: the owner's list (Civil engineer, Architect) in user_activities.
-- ---------------------------------------------------------------------------
update public.users set primary_account_type = 'engineer' where id = '11700000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.my_account_basics() ->> 'specialtyKind', 'engineer', 'engineer: answers the engineer list');
select is((select array_agg(key order by sort_order) from public.activities where persona_type = 'engineer'),
  array['civil_engineer', 'architect'], 'engineer list: Civil engineer, Architect (the retired placeholder is hidden)');
select throws_ok($$ select public.account_basics_set(null, null, null, array[]::text[]) $$, '22023', null,
  'an empty specialty list is refused');
select throws_ok($$ select public.account_basics_set(null, null, null, array['distributor']) $$, '22023', null,
  'engineer: a business activity is not on the list');
select lives_ok($$ select public.account_basics_set(null, null, null, array['architect', 'civil_engineer', 'architect']) $$,
  'engineer: specialties saved');
select is(public.my_account_basics() -> 'specialties', '["civil_engineer", "architect"]'::jsonb,
  'engineer: specialties de-duplicated');
reset role;
update public.users set primary_account_type = null where id = '11700000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- An installer (professional persona): specialties go through user_trades_set.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'installer_technician') $$, 'installer: account type recorded');
reset role;
-- Another persona's specialty can never be stored for them (app.guard_user_activity).
select throws_ok($$ insert into public.user_activities (user_id, activity_id)
                    select '11700000-0000-4000-8000-000000000001', id from public.activities where persona_type = 'engineer' and key = 'architect' $$,
  '23514', null, 'installer: an Engineer specialty is refused');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.my_account_basics() ->> 'specialtyKind', 'trades', 'installer: answers the trade list');
select is(public.my_account_basics() -> 'specialties', '[]'::jsonb,
  'installer: specialties stored for another persona do not count');
select lives_ok($$ select public.account_basics_set('giza', null, 'Kafr Testtown', array['wallpaper_installation']) $$,
  'installer: a typed town and a specialty saved');
select is(public.my_account_basics() ->> 'cityCustom', 'Kafr Testtown', 'installer: the typed town is kept');
reset role;
select is((select count(*)::int from public.user_trades where user_id = '11700000-0000-4000-8000-000000000001' and is_primary), 1,
  'installer: specialties land in user_trades with one primary');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.my_account_basics() -> 'specialties', '["wallpaper_installation"]'::jsonb,
  'installer: only the current persona''s specialties are listed');
reset role;
select is((select array_agg(governorate_key || ':' || coalesce(city_key, '-') || ':' || is_primary::text order by city_key nulls first)
             from public.user_service_areas where user_id = '11700000-0000-4000-8000-000000000001'),
  array['giza:-:true'], 'installer: the location given becomes the primary service area');
delete from public.user_service_areas where user_id = '11700000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.account_basics_set('cairo', 'maadi', null, null);
select public.account_basics_set('alexandria', 'smouha', null, null);
reset role;
select is((select array_agg(governorate_key || ':' || coalesce(city_key, '-') || ':' || is_primary::text order by city_key nulls first)
             from public.user_service_areas where user_id = '11700000-0000-4000-8000-000000000001'),
  array['cairo:-:true', 'cairo:maadi:false'], 'installer: a catalogue town is added inside the primary governorate');
select ok(not exists (select 1 from public.user_service_areas where user_id = '11700000-0000-4000-8000-000000000001' and governorate_key = 'alexandria'),
  'installer: service areas already declared are never replaced');

-- ---------------------------------------------------------------------------
-- A professional's declared service area counts as their location once it
-- names a town; a governorate alone does not.
-- ---------------------------------------------------------------------------
insert into public.user_service_areas (user_id, governorate_key, city_key, is_primary) values
  ('11700000-0000-4000-8000-000000000004', 'alexandria', null, true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(public.my_account_basics() ->> 'city', null, 'service area without a town: location still missing a town');
select is(public.my_account_basics() ->> 'specialtyKind', 'none', 'no business or professional persona: no specialties question');
select throws_ok($$ select public.account_basics_set(null, null, null, array['architect']) $$, '22023', null,
  'no specialty list: specialties are refused');
reset role;
insert into public.user_service_areas (user_id, governorate_key, city_key, is_primary) values
  ('11700000-0000-4000-8000-000000000004', 'cairo', 'maadi', false),
  ('11700000-0000-4000-8000-000000000004', 'alexandria', 'smouha', false);
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(public.my_account_basics() ->> 'governorate', 'alexandria', 'service area: the primary governorate is the base');
select is(public.my_account_basics() ->> 'city', 'smouha', 'service area: only a town inside the primary governorate counts');
reset role;
delete from public.user_service_areas where user_id = '11700000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- Location fallback to a branch: owners (org.manage) only, oldest ownership.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, org_type, status, created_by) values
  ('11700000-0000-4000-8000-0000000000a1', 'P117 Showroom', 'showroom_dealer', 'active', '11700000-0000-4000-8000-000000000003'),
  ('11700000-0000-4000-8000-0000000000a2', 'P117 Second', 'showroom_dealer', 'active', '11700000-0000-4000-8000-000000000003');
insert into public.branches (id, organization_id, name, governorate_key, city_key) values
  ('11700000-0000-4000-8000-0000000000b1', '11700000-0000-4000-8000-0000000000a1', 'P117 New Cairo', 'cairo', 'new-cairo'),
  ('11700000-0000-4000-8000-0000000000b2', '11700000-0000-4000-8000-0000000000a2', 'P117 Giza', 'giza', 'dokki');
insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, created_at) values
  ('11700000-0000-4000-8000-0000000000c1', '11700000-0000-4000-8000-000000000003', '11700000-0000-4000-8000-0000000000a1', '11700000-0000-4000-8000-0000000000b1', 'active', now() - interval '2 days'),
  ('11700000-0000-4000-8000-0000000000c2', '11700000-0000-4000-8000-000000000003', '11700000-0000-4000-8000-0000000000a2', '11700000-0000-4000-8000-0000000000b2', 'active', now() - interval '1 day'),
  ('11700000-0000-4000-8000-0000000000c3', '11700000-0000-4000-8000-000000000004', '11700000-0000-4000-8000-0000000000a1', '11700000-0000-4000-8000-0000000000b1', 'active', now() - interval '3 days');
insert into public.membership_capabilities (membership_id, capability_key) values
  ('11700000-0000-4000-8000-0000000000c1', 'org.manage'),
  ('11700000-0000-4000-8000-0000000000c2', 'org.manage');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(public.my_account_basics() ->> 'governorate', 'cairo',
  'owner: the business location given in business onboarding counts');
select is(public.my_account_basics() ->> 'city', 'new-cairo',
  'owner with two organizations: the oldest ownership wins');
select is(public.my_account_basics() ->> 'specialtyKind', 'none',
  'owner: answers the business activity in business setup, not in account basics');
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(public.my_account_basics() ->> 'governorate', null,
  'employee: the employer''s branch is never treated as their own location');
reset role;
select is((select governorate_key from public.profiles where user_id = '11700000-0000-4000-8000-000000000003'), null,
  'owner: the branch location is read, never copied onto the profile');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.user_activities where user_id = '11700000-0000-4000-8000-000000000001'), 0,
  'RLS: a user cannot read another user''s specialties');
reset role;

select * from finish();
rollback;
