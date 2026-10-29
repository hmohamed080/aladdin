-- Account basics (ADR-0026): location on the canonical catalogue and specialties
-- for every account type, through public.account_basics_set only.
create extension if not exists pgtap;
begin;
select plan(30);

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
  not has_table_privilege('authenticated', 'public.user_specialties', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'public.user_specialties', 'SELECT'),
  'clients cannot write specialties directly and anon cannot read them');
select ok(
  not has_function_privilege('anon', 'public.account_basics_set(text, text, text, text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.my_account_basics()', 'EXECUTE'),
  'anon cannot call the account-basics RPCs');

-- ---------------------------------------------------------------------------
-- A showroom (not a professional persona): specialties go to user_specialties.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('business', 'showroom_dealer') $$, 'showroom: account type recorded');
select is(public.my_account_basics() -> 'specialties', '[]'::jsonb, 'showroom: no specialties yet');
select is(public.my_account_basics() ->> 'governorate', null, 'showroom: no location yet');

select throws_ok($$ select public.account_basics_set('cairo', null, null, null) $$, '22023', null,
  'a governorate without a town is refused');
select throws_ok($$ select public.account_basics_set('atlantis', 'x', null, null) $$, '22023', null,
  'an unknown governorate is refused');
select throws_ok($$ select public.account_basics_set(null, 'new-cairo', null, null) $$, '22023', null,
  'a town without a governorate is refused');
select throws_ok($$ select public.account_basics_set(null, null, null, array[]::text[]) $$, '22023', null,
  'an empty specialty list is refused');
select throws_ok($$ select public.account_basics_set(null, null, null, array['not_a_trade']) $$, '22023', null,
  'an unknown specialty is refused');

select lives_ok(
  $$ select public.account_basics_set('cairo', 'new-cairo', null, array['gypsum_board_installation', 'wallpaper_installation', 'gypsum_board_installation']) $$,
  'showroom: location and specialties saved');
select is(public.my_account_basics() ->> 'city', 'new-cairo', 'showroom: town stored as the catalogue key');
select is(public.my_account_basics() -> 'specialties', '["gypsum_board_installation", "wallpaper_installation"]'::jsonb,
  'showroom: specialties de-duplicated, the first one is primary');
reset role;
select is((select count(*)::int from public.user_trades where user_id = '11700000-0000-4000-8000-000000000002'), 0,
  'showroom: the professional trade signal is untouched');
select is((select t.key from public.user_specialties s join public.trades t on t.id = s.trade_id
           where s.user_id = '11700000-0000-4000-8000-000000000002' and s.is_primary), 'gypsum_board_installation',
  'showroom: exactly the first specialty is primary');

-- ---------------------------------------------------------------------------
-- An installer (professional persona): specialties go through user_trades_set.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'installer_technician') $$, 'installer: account type recorded');
reset role;
-- A row left in user_specialties from an earlier, non-professional persona.
insert into public.user_specialties (user_id, trade_id, is_primary)
select '11700000-0000-4000-8000-000000000001', id, true from public.trades where key = 'door_installation';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000001","role":"authenticated"}';
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

-- ---------------------------------------------------------------------------
-- A professional's declared service area counts as their location once it
-- names a town; a governorate alone does not.
-- ---------------------------------------------------------------------------
insert into public.user_service_areas (user_id, governorate_key, city_key, is_primary) values
  ('11700000-0000-4000-8000-000000000004', 'alexandria', null, true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(public.my_account_basics() ->> 'city', null, 'service area without a town: location still missing a town');
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
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(public.my_account_basics() ->> 'governorate', null,
  'employee: the employer''s branch is never treated as their own location');
reset role;
select is((select governorate_key from public.profiles where user_id = '11700000-0000-4000-8000-000000000003'), null,
  'owner: the branch location is read, never copied onto the profile');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11700000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.user_specialties where user_id = '11700000-0000-4000-8000-000000000001'), 0,
  'RLS: a user cannot read another user''s specialties');
reset role;

select * from finish();
rollback;
