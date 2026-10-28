-- Account basics (ADR-0026): location on the canonical catalogue and specialties
-- for every account type, through public.account_basics_set only.
create extension if not exists pgtap;
begin;
select plan(20);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values
  ('11700000-0000-4000-8000-000000000001', 'p117-installer@example.test'),
  ('11700000-0000-4000-8000-000000000002', 'p117-showroom@example.test')) v(id, email);

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
select lives_ok($$ select public.account_basics_set('giza', null, 'Kafr Testtown', array['wallpaper_installation']) $$,
  'installer: a typed town and a specialty saved');
select is(public.my_account_basics() ->> 'cityCustom', 'Kafr Testtown', 'installer: the typed town is kept');
reset role;
select is((select count(*)::int from public.user_trades where user_id = '11700000-0000-4000-8000-000000000001' and is_primary), 1,
  'installer: specialties land in user_trades with one primary');

select * from finish();
rollback;
