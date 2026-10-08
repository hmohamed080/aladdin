-- pgTAP: Installer Jobs — the authorities Overall Match reads, and the canonical job location.
--
--   A. trade specialties  (public.trade_specialties / user_trade_specialties / jobs.required_specialty_id)
--   B. service areas      (public.user_service_areas + user_service_areas_set + the onboarding mirror)
--   C. availability       (public.user_availability_windows)
--   D. canonical location (jobs.governorate_key / city_key, job_create / job_update, the derive trigger)
--
-- The specialty rows below are TEST FIXTURES, inserted and rolled back here. The migration seeds none.
create extension if not exists pgtap;

begin;
select plan(76);

\set poster '70000006-0000-4000-8000-000000000006'
\set org    '9a000000-aaaa-4aaa-8aaa-000000000005'
\set A '71000006-0000-4000-8000-000000000006'
\set B '71000007-0000-4000-8000-000000000007'
\set CONSUMER '44444444-4444-4444-8444-444444444444'

-- ===========================================================================
-- A. Specialties
-- ===========================================================================
select is((select count(*)::int from public.trade_specialties), 0, 'the migration seeds NO specialty names — the catalogue is empty until a product-approved migration');

insert into public.trade_specialties (id, trade_id, key, is_active) values
  ('e7600000-0000-4000-8000-0000000000a1', (select id from public.trades where key = 'painting'),       'fx_one', true),
  ('e7600000-0000-4000-8000-0000000000a2', (select id from public.trades where key = 'painting'),       'fx_two', true),
  ('e7600000-0000-4000-8000-0000000000a3', (select id from public.trades where key = 'painting'),       'fx_old', false),
  ('e7600000-0000-4000-8000-0000000000e1', (select id from public.trades where key = 'epoxy_flooring'), 'fx_one', true);

select is((select count(*)::int from public.trade_specialties where key = 'fx_one'), 2, 'a key is unique INSIDE its trade, not globally');
select throws_ok(
  $$insert into public.trade_specialties (trade_id, key) values ((select id from public.trades where key = 'painting'), 'fx_one')$$,
  '23505', null, 'the same key twice in one trade is refused');
select throws_ok(
  $$insert into public.trade_specialties (trade_id, key) values ((select id from public.trades where key = 'painting'), 'Bad Key')$$,
  '23514', null, 'a key must be lower snake case');

delete from public.user_trades where user_id in (:'A'::uuid, :'B'::uuid);
insert into public.user_trades (user_id, trade_id, is_primary)
select :'A'::uuid, id, true from public.trades where key = 'painting';
insert into public.user_trades (user_id, trade_id) select :'B'::uuid, id from public.trades where key = 'epoxy_flooring';

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.trade_specialties), 3, 'an ordinary reader sees ACTIVE specialties only (the retired one is withheld)');
select throws_ok($$insert into public.trade_specialties (trade_id, key) values ((select id from public.trades where key = 'tiling'), 'nope')$$, '42501', null, 'no client write grant on the specialty catalogue');
select lives_ok($$select public.user_trade_specialties_set(array['e7600000-0000-4000-8000-0000000000a1'::uuid])$$, 'a professional declares a specialty inside a trade they hold');
select is((select count(*)::int from public.user_trade_specialties), 1, 'and exactly that one is stored');
select throws_ok($$select public.user_trade_specialties_set(array['e7600000-0000-4000-8000-0000000000e1'::uuid])$$, '22023', null, 'a specialty of a trade the caller does NOT hold is refused (declare the trade first)');
select throws_ok($$select public.user_trade_specialties_set(array['e7600000-0000-4000-8000-0000000000a3'::uuid])$$, '22023', null, 'a RETIRED specialty cannot be newly chosen');
select throws_ok($$select public.user_trade_specialties_set(array[gen_random_uuid()])$$, '22023', null, 'an unknown specialty id is refused wholesale');
select lives_ok($$select public.user_trade_specialties_set(array['e7600000-0000-4000-8000-0000000000a1'::uuid, 'e7600000-0000-4000-8000-0000000000a1'::uuid, 'e7600000-0000-4000-8000-0000000000a2'::uuid])$$, 'duplicates converge');
select is((select count(*)::int from public.user_trade_specialties), 2, 'the submitted set REPLACES what was held');
select lives_ok($$select public.user_trade_specialties_set(null)$$, 'an empty set clears every specialty (legal)');
select is((select count(*)::int from public.user_trade_specialties), 0, 'and nothing is left');
select throws_ok($$insert into public.user_trade_specialties (user_id, trade_id, specialty_id) values ('71000006-0000-4000-8000-000000000006', (select id from public.trades where key = 'painting'), 'e7600000-0000-4000-8000-0000000000a1')$$, '42501', null, 'no direct client write on a person''s specialties either — only the writer');
select is((select pg_get_function_arguments('public.user_trade_specialties_set(uuid[])'::regprocedure)), 'p_specialty_ids uuid[]', 'the writer takes only the specialty ids — identity is auth.uid()');
reset role;
set local request.jwt.claims = '';

-- Another person's specialties are invisible (RLS), and losing a trade drops its specialties with it.
insert into public.user_trade_specialties (user_id, trade_id, specialty_id) values
  (:'A', (select id from public.trades where key = 'painting'), 'e7600000-0000-4000-8000-0000000000a1');
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select count(*)::int from public.user_trade_specialties), 0, 'another person cannot read A''s specialties');
reset role;
set local request.jwt.claims = '';
select throws_ok($$insert into public.user_trade_specialties (user_id, trade_id, specialty_id) values ('71000006-0000-4000-8000-000000000006', (select id from public.trades where key = 'painting'), 'e7600000-0000-4000-8000-0000000000e1')$$, '23503', null, 'the composite FK refuses a specialty that does not belong to the stated trade');
delete from public.user_trades where user_id = :'A'::uuid;
select is((select count(*)::int from public.user_trade_specialties where user_id = :'A'::uuid), 0, 'removing a trade CASCADES its specialties');
insert into public.user_trades (user_id, trade_id, is_primary) select :'A'::uuid, id, true from public.trades where key = 'painting';

-- A job's required specialty must belong to the job's trade.
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok($$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'S ok', 'painting', 5000::numeric, 'x', 'Cairo', 'Maadi', null, 3::smallint, p_required_specialty_id => 'e7600000-0000-4000-8000-0000000000a1')$$, 'a job may require a specialty of ITS trade');
select throws_ok($$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'S bad', 'painting', 5000::numeric, 'x', 'Cairo', 'Maadi', null, 3::smallint, p_required_specialty_id => 'e7600000-0000-4000-8000-0000000000e1')$$, '22023', null, 'a specialty of ANOTHER trade is refused');
select throws_ok($$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'S old', 'painting', 5000::numeric, 'x', 'Cairo', 'Maadi', null, 3::smallint, p_required_specialty_id => 'e7600000-0000-4000-8000-0000000000a3')$$, '22023', null, 'a RETIRED specialty cannot be newly required');
select set_config('t.s_job', public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'S edit', 'painting', 5000::numeric, 'x', 'Cairo', 'Maadi', null, 3::smallint, p_required_specialty_id => 'e7600000-0000-4000-8000-0000000000a1')::text, true);
select is((select public.job_update(current_setting('t.s_job')::uuid, 1, 'S edit', 'epoxy_flooring', 5000::numeric, 'x', 'Cairo', 'Maadi', null, 3::smallint)), 2, 'editing a job''s trade WITHOUT re-sending the specialty clears it (never a stale cross-trade pair)');
reset role;
set local request.jwt.claims = '';
select is((select required_specialty_id from public.jobs where id = current_setting('t.s_job')::uuid), null::uuid, 'and the stored requirement is gone');
select throws_ok($$update public.jobs set required_specialty_id = 'e7600000-0000-4000-8000-0000000000e1' where id = (select id from public.jobs where title = 'S ok')$$, '23503', null, 'the data itself refuses a specialty from another trade (composite FK), whoever writes it');

-- A caller who is not a professional cannot hold specialties.
set local role authenticated;
set local request.jwt.claims to '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok($$select public.user_trade_specialties_set('{}')$$, '42501', null, 'a non-professional identity cannot declare specialties');
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- B. Service areas
-- ===========================================================================
-- An onboarding save (the legacy writer) is mirrored into the canonical rows by a trigger.
insert into public.individual_onboarding (user_id, prof_governorate, prof_city, prof_service_areas) values (:'A', 'cairo', 'new-cairo', array['nasr-city']);
select is((select count(*)::int from public.user_service_areas where user_id = :'A'::uuid and is_primary and governorate_key = 'cairo'), 1, 'SYNC: an onboarding location that resolves has a canonical primary area');
select is((select array_agg(city_key order by city_key) from public.user_service_areas where user_id = :'A'::uuid and city_key is not null), array['nasr-city', 'new-cairo'], 'and its declared cities');

-- Legacy onboarding save -> canonical (the primary group only; other governorates survive).
insert into public.user_service_areas (user_id, governorate_key, city_key) values (:'A', 'alexandria', null);
update public.individual_onboarding set prof_governorate = 'giza', prof_city = 'dokki', prof_service_areas = array['haram'] where user_id = :'A'::uuid;
select is(
  (select array_agg(governorate_key || '/' || coalesce(city_key, '*') || case when is_primary then '!' else '' end order by governorate_key, city_key nulls first)
     from public.user_service_areas where user_id = :'A'::uuid),
  array['alexandria/*', 'giza/*!', 'giza/dokki', 'giza/haram'],
  'a legacy onboarding save rebuilds ONLY the primary-governorate group; an area in another governorate is untouched');
update public.individual_onboarding set prof_governorate = 'Atlantis' where user_id = :'A'::uuid;
select is((select count(*)::int from public.user_service_areas where user_id = :'A'::uuid and is_primary), 1, 'an unresolvable legacy value never wipes the canonical area (nothing is guessed)');

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok($$select public.user_service_areas_set('cairo', '[{"governorate_key":"cairo","city_key":"new-cairo"},{"governorate_key":"giza","city_key":null},{"governorate_key":"giza","city_key":"dokki"},{"governorate_key":"cairo","city_key":"new-cairo"}]'::jsonb)$$, 'a professional declares a primary governorate with cities and ANOTHER governorate');
select is((select count(*)::int from public.user_service_areas), 4, 'duplicates converge: primary cairo, cairo/new-cairo, giza (whole), giza/dokki');
select is((select count(*)::int from public.user_service_areas where is_primary), 1, 'exactly one primary');
select is((select governorate_key from public.user_service_areas where is_primary), 'cairo', 'it is the one that was named');
select throws_ok($$select public.user_service_areas_set('atlantis', '[]')$$, '22023', null, 'an unknown governorate is refused');
select throws_ok($$select public.user_service_areas_set('cairo', '[{"governorate_key":"giza","city_key":"maadi"}]')$$, '22023', null, 'a city outside its governorate is refused');
select throws_ok($$select public.user_service_areas_set(null, '[{"governorate_key":"giza","city_key":null}]')$$, '22023', null, 'areas without a primary governorate are refused');
select is((select count(*)::int from public.user_service_areas), 4, 'a refused call changes nothing');
select throws_ok($$insert into public.user_service_areas (user_id, governorate_key) values ('71000006-0000-4000-8000-000000000006', 'suez')$$, '42501', null, 'no direct client write on service areas — only the writer');
select is((select pg_get_function_arguments('public.user_service_areas_set(text,jsonb)'::regprocedure)), 'p_primary_governorate_key text, p_areas jsonb DEFAULT ''[]''::jsonb', 'the writer takes no user argument — identity is auth.uid()');
reset role;
set local request.jwt.claims = '';
select is((select prof_governorate from public.individual_onboarding where user_id = :'A'::uuid), 'cairo', 'COMPATIBILITY: the canonical writer mirrors the primary governorate back to onboarding');
select is((select prof_service_areas from public.individual_onboarding where user_id = :'A'::uuid), array['new-cairo'], 'and the primary governorate''s cities');

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select count(*)::int from public.user_service_areas where user_id = '71000006-0000-4000-8000-000000000006'), 0, 'another person cannot read A''s areas');
select lives_ok($$select public.user_service_areas_set(null, '[]')$$, 'an empty set clears the caller''s own areas');
reset role;
set local request.jwt.claims = '';
select is((select count(*)::int from public.user_service_areas where user_id = :'A'::uuid), 4, 'and only the caller''s — A''s rows are untouched by B');
set local role authenticated;
set local request.jwt.claims to '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok($$select public.user_service_areas_set('cairo', '[]')$$, '42501', null, 'a non-professional identity cannot declare service areas');
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- C. Availability windows
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok($$insert into public.user_availability_windows (user_id, available_from, available_to) values ('71000006-0000-4000-8000-000000000006', '2027-05-01', '2027-05-31')$$, 'a professional adds their own window');
select lives_ok($$insert into public.user_availability_windows (user_id, available_from, available_to) values ('71000006-0000-4000-8000-000000000006', '2027-07-01', null)$$, 'an open-ended window is legal');
select throws_ok($$insert into public.user_availability_windows (user_id, available_from, available_to) values ('71000006-0000-4000-8000-000000000006', '2027-05-10', '2027-05-01')$$, '23514', null, 'a window cannot end before it starts');
select throws_ok($$insert into public.user_availability_windows (user_id, available_from, available_to) values ('71000007-0000-4000-8000-000000000007', '2027-05-01', '2027-05-31')$$, '42501', null, 'RLS: a caller cannot create a window FOR someone else');
select lives_ok($$update public.user_availability_windows set available_to = '2027-06-02' where available_from = '2027-05-01'$$, 'a person edits their own window');
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select count(*)::int from public.user_availability_windows), 0, 'another person cannot read A''s windows');
update public.user_availability_windows set available_to = '2030-01-01' where user_id = '71000006-0000-4000-8000-000000000006';
delete from public.user_availability_windows where user_id = '71000006-0000-4000-8000-000000000006';
reset role;
set local request.jwt.claims = '';
select is((select count(*)::int from public.user_availability_windows where user_id = :'A'::uuid), 2, 'and cannot update or delete them: both statements touched no row');
select is((select available_to from public.user_availability_windows where user_id = :'A'::uuid and available_from = '2027-05-01'), date '2027-06-02', 'A''s edit stands');
set local role authenticated;
set local request.jwt.claims to '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok($$insert into public.user_availability_windows (user_id, available_from) values ('44444444-4444-4444-8444-444444444444', '2027-05-01')$$, '42501', null, 'only a professional identity may declare availability');
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- D. Canonical job location
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.l1', public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'L keys', 'painting', 5000::numeric, 'x', null, null, null, 3::smallint, p_governorate_key => 'giza', p_city_key => 'dokki')::text, true);
select set_config('t.l2', public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'L text', 'painting', 5000::numeric, 'x', 'القاهرة', 'مدينة نصر', null, 3::smallint)::text, true);
select set_config('t.l3', public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'L other', 'painting', 5000::numeric, 'x', null, null, null, 3::smallint, p_governorate_key => 'cairo', p_city_key => 'other')::text, true);
select throws_ok($$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'L bad gov', 'painting', 5000::numeric, 'x', 'Atlantis', null, null, 3::smallint)$$, '22023', null, 'free-text governorate that is not in the catalogue is REFUSED');
select throws_ok($$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'L bad city', 'painting', 5000::numeric, 'x', 'Cairo', 'Narnia', null, 3::smallint)$$, '22023', null, 'free-text city that is not in the catalogue is REFUSED');
select throws_ok($$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'L city only', 'painting', 5000::numeric, 'x', null, null, null, 3::smallint, p_city_key => 'maadi')$$, '22023', null, 'a city without its governorate is refused');
select throws_ok($$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'L wrong pair', 'painting', 5000::numeric, 'x', null, null, null, 3::smallint, p_governorate_key => 'giza', p_city_key => 'maadi')$$, '22023', null, 'a city outside the chosen governorate is refused');
select throws_ok($$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'L mismatch', 'painting', 5000::numeric, 'x', 'Alexandria', null, null, 3::smallint, p_governorate_key => 'cairo')$$, '22023', null, 'wording that disagrees with its key is refused');
select lives_ok($$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'L none', 'painting', 5000::numeric, 'x', null, null, null, 3::smallint)$$, 'a job with no location at all is still a legal draft');
reset role;
set local request.jwt.claims = '';
select is((select governorate_key || '/' || city_key from public.jobs where id = current_setting('t.l1')::uuid), 'giza/dokki', 'keys chosen in the form are stored');
select is((select governorate || ' / ' || city from public.jobs where id = current_setting('t.l1')::uuid), 'Giza / Dokki', 'and the readable wording is derived from the catalogue (English)');
select is((select governorate_key || '/' || city_key from public.jobs where id = current_setting('t.l2')::uuid), 'cairo/nasr-city', 'Arabic text that resolves EXACTLY is canonicalised');
select is((select governorate || ' / ' || city from public.jobs where id = current_setting('t.l2')::uuid), 'القاهرة / مدينة نصر', 'the poster''s own words are kept as typed');
select is((select city_key from public.jobs where id = current_setting('t.l3')::uuid), 'other', '"Other" is the catalogue''s own entry, not a free-text escape');

-- The safety net for writers that are not the RPCs (seed files, psql, imports).
insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, governorate, city, status, created_by)
values ('e7600000-0000-4000-8000-0000000000c1', :'org'::uuid, 'L raw ok', 'x', (select id from public.trades where key = 'painting'), 5000, 'Alexandria', 'Alexandria City', 'draft', :'poster'::uuid),
       ('e7600000-0000-4000-8000-0000000000c2', :'org'::uuid, 'L raw legacy', 'x', (select id from public.trades where key = 'painting'), 5000, 'Atlantis', 'Nowhere', 'draft', :'poster'::uuid);
select is((select governorate_key || '/' || city_key from public.jobs where id = 'e7600000-0000-4000-8000-0000000000c1'), 'alexandria/alexandria-city', 'a raw insert whose text resolves gets its keys');
select is((select governorate_key from public.jobs where id = 'e7600000-0000-4000-8000-0000000000c2'), null::text, 'LEGACY: unresolvable text keeps its raw words and gets NO key — nothing is guessed');
select is((select governorate from public.jobs where id = 'e7600000-0000-4000-8000-0000000000c2'), 'Atlantis', 'the raw text is preserved untouched');
update public.jobs set governorate = 'Giza', city = 'Haram' where id = 'e7600000-0000-4000-8000-0000000000c1';
select is((select governorate_key || '/' || city_key from public.jobs where id = 'e7600000-0000-4000-8000-0000000000c1'), 'giza/haram', 'changing the wording re-derives the keys — they never go stale');
select throws_ok($$update public.jobs set governorate = null, governorate_key = null, city_key = 'maadi' where id = 'e7600000-0000-4000-8000-0000000000c1'$$, '23514', null, 'a city key without a governorate key violates the table check');

-- Editing WITHOUT sending a location keeps the location as it is — a legacy job is never erased by a title edit.
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select public.job_update(current_setting('t.l1')::uuid, 1, 'L keys renamed', 'painting', 5000::numeric, 'x')), 2, 'a job can be edited without re-sending its place');
select is((select public.job_update('e7600000-0000-4000-8000-0000000000c2', 1, 'L legacy edited', 'painting', 5000::numeric, 'x')), 2, 'including a legacy job whose text never resolved');
reset role;
set local request.jwt.claims = '';
select is((select governorate_key || '/' || city_key from public.jobs where id = current_setting('t.l1')::uuid), 'giza/dokki', 'the canonical keys survive an edit that did not touch the place');
select is((select governorate || '|' || coalesce(governorate_key, '-') from public.jobs where id = 'e7600000-0000-4000-8000-0000000000c2'), 'Atlantis|-', 'the legacy raw text survives, with no key invented');

select * from finish();
rollback;
