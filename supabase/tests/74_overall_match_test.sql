-- pgTAP: Installer Jobs — the OVERALL MATCH (app.job_match_for / public.job_matches).
--
--   TRADE 50  ·  SPECIALTY 20 (only when the trade matches)  ·  LOCATION 15  ·  AVAILABILITY 15  =  100
--   Availability is THREE-state: a caller who never declared it is NOT DECLARED (no points, honest reason), never
--   scored as unavailable.
--
-- It replaces Match V1 (0/80/90/100). One authority; presentation only.
--
-- Fixtures: a verified poster publishes jobs in different places / trades / date windows; five installers hold
-- different trades, specialties, service areas, availability and windows. The specialty rows are TEST FIXTURES
-- ONLY (the product catalogue is empty and approved separately).
create extension if not exists pgtap;

begin;
select plan(71);

\set poster '70000006-0000-4000-8000-000000000006'
\set org    '9a000000-aaaa-4aaa-8aaa-000000000005'
\set A '71000006-0000-4000-8000-000000000006'
\set B '71000007-0000-4000-8000-000000000007'
\set C '71000008-0000-4000-8000-000000000008'
\set D '71000009-0000-4000-8000-000000000009'
\set E '70000009-0000-4000-8000-000000000009'

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into public.trade_specialties (id, trade_id, key) values
  ('e7400000-0000-4000-8000-0000000000a1', (select id from public.trades where key = 'painting'),        'fx_sp_a'),
  ('e7400000-0000-4000-8000-0000000000a2', (select id from public.trades where key = 'painting'),        'fx_sp_b'),
  ('e7400000-0000-4000-8000-0000000000e1', (select id from public.trades where key = 'epoxy_flooring'),  'fx_sp_e');

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.j1',  public.job_create(:'org'::uuid, 'M plain New Cairo', 'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint)::text, true);
select set_config('t.j2',  public.job_create(:'org'::uuid, 'M needs sp_a', 'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint, p_required_specialty_id => 'e7400000-0000-4000-8000-0000000000a1')::text, true);
select set_config('t.j4',  public.job_create(:'org'::uuid, 'M Giza Dokki', 'painting', 5000::numeric, 'x', 'Giza', 'Dokki', null, 3::smallint)::text, true);
select set_config('t.j5',  public.job_create(:'org'::uuid, 'M Alexandria', 'painting', 5000::numeric, 'x', 'Alexandria', 'Alexandria City', null, 3::smallint)::text, true);
select set_config('t.j6',  public.job_create(:'org'::uuid, 'M Maadi', 'painting', 5000::numeric, 'x', 'Cairo', 'Maadi', null, 3::smallint)::text, true);
select set_config('t.j7',  public.job_create(:'org'::uuid, 'M dated May 10-20', 'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint, '2027-05-10', '2027-05-20')::text, true);
select set_config('t.j8',  public.job_create(:'org'::uuid, 'M start-only May 12', 'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint, '2027-05-12', null)::text, true);
select set_config('t.j9',  public.job_create(:'org'::uuid, 'M Giza Haram', 'painting', 5000::numeric, 'x', 'Giza', 'Haram', null, 3::smallint)::text, true);
select set_config('t.j10', public.job_create(:'org'::uuid, 'M dated Jun 10-20', 'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint, '2027-06-10', '2027-06-20')::text, true);
select set_config('t.jd',  public.job_create(:'org'::uuid, 'M draft', 'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint)::text, true);
select public.job_publish(current_setting('t.j' || n)::uuid, 1) from unnest(array['1','2','4','5','6','7','8','9','10']) n;
reset role;
set local request.jwt.claims = '';

-- A legacy job whose free text never resolved: raw text kept, canonical keys NULL, and still open.
insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, governorate, city, status, published_at, created_by)
values ('e7400000-0000-4000-8000-0000000000f1', :'org'::uuid, 'M legacy unresolved', 'x', (select id from public.trades where key = 'painting'),
        5000, 'Atlantis', 'Nowhere', 'open', now(), :'poster'::uuid);
select set_config('t.jl', 'e7400000-0000-4000-8000-0000000000f1', true);

-- Trades: everyone paints except C (epoxy only).
insert into public.user_trades (user_id, trade_id)
select u, t.id from (values (:'A'::uuid), (:'B'::uuid), (:'D'::uuid), (:'E'::uuid)) v(u) cross join public.trades t where t.key = 'painting';
insert into public.user_trades (user_id, trade_id) select :'C'::uuid, id from public.trades where key = 'epoxy_flooring';
-- A holds painting specialty sp_a; B holds none; C holds the epoxy one (irrelevant to painting jobs).
insert into public.user_trade_specialties (user_id, trade_id, specialty_id) values
  (:'A', (select id from public.trades where key = 'painting'),       'e7400000-0000-4000-8000-0000000000a1'),
  (:'C', (select id from public.trades where key = 'epoxy_flooring'), 'e7400000-0000-4000-8000-0000000000e1');

-- Service areas (canonical keys). A: based in Cairo (+ New Cairo), and Dokki (Giza) as another area.
-- B: based in Giza, all of Cairo as another area. C: Cairo. D: Cairo + Maadi. E: none.
insert into public.user_service_areas (user_id, governorate_key, city_key, is_primary) values
  (:'A', 'cairo', null, true), (:'A', 'cairo', 'new-cairo', false), (:'A', 'giza', 'dokki', false),
  (:'B', 'giza',  null, true), (:'B', 'cairo', null, false),
  (:'C', 'cairo', null, true), (:'C', 'cairo', 'new-cairo', false),
  (:'D', 'cairo', null, true), (:'D', 'cairo', 'maadi', false);

-- Availability. A and B are available for work; E is available with no windows. C EXPLICITLY declared unavailable.
-- D never declared anything (the default false, no declaration marker) = NOT DECLARED.
update public.profiles set available_for_work = true where user_id in (:'A'::uuid, :'B'::uuid, :'E'::uuid);
update public.profiles set available_for_work = false where user_id = :'C'::uuid;
insert into public.user_availability_windows (user_id, available_from, available_to) values
  (:'A', '2027-05-01', '2027-05-31'),
  (:'B', '2027-01-01', null);

create function pg_temp.mv(u text, j text, col text) returns text language sql as $$
  select to_jsonb(m) ->> col from app.job_match_for(u::uuid, current_setting('t.' || j)::uuid) m
$$;

-- ===========================================================================
-- A. TRADE — 50 / 0
-- ===========================================================================
select is(pg_temp.mv(:'A', 'j1', 'trade_points'), '50', 'exact trade -> 50');
select is(pg_temp.mv(:'A', 'j1', 'trade_reason'), 'trade_matches', 'reason: trade_matches');
select is(pg_temp.mv(:'C', 'j1', 'trade_points'), '0', 'trade mismatch -> 0 (no related trades are inferred)');
select is(pg_temp.mv(:'C', 'j1', 'trade_reason'), 'trade_mismatch', 'reason: trade_mismatch');
delete from public.user_trades where user_id = :'E'::uuid;
select is(pg_temp.mv(:'E', 'j1', 'trade_reason'), 'no_declared_trade', 'a caller with no declared trade: reason no_declared_trade, 0 points');
insert into public.user_trades (user_id, trade_id) select :'E'::uuid, id from public.trades where key = 'painting';

-- ===========================================================================
-- B. SPECIALTY — 20, only when the trade matches
-- ===========================================================================
select is(pg_temp.mv(:'C', 'j2', 'specialty_points'), '0', 'TRADE MISMATCH => specialty 0 (an unrelated trade never earns specialty points)');
select is(pg_temp.mv(:'C', 'j2', 'specialty_reason'), 'trade_mismatch', 'reason: trade_mismatch');
select is(pg_temp.mv(:'C', 'j1', 'specialty_points'), '0', 'trade mismatch and NO specialty required => still 0, not a free 20');
select is(pg_temp.mv(:'A', 'j2', 'specialty_points'), '20', 'trade matches + required specialty held -> 20');
select is(pg_temp.mv(:'A', 'j2', 'specialty_reason'), 'specialty_matches', 'reason: specialty_matches');
select is(pg_temp.mv(:'B', 'j2', 'specialty_points'), '0', 'trade matches + required specialty NOT held -> 0');
select is(pg_temp.mv(:'B', 'j2', 'specialty_reason'), 'specialty_missing', 'reason: specialty_missing');
select is(pg_temp.mv(:'B', 'j1', 'specialty_points'), '20', 'trade matches + NO specialty required -> 20 (not penalised for what the job does not ask)');
select is(pg_temp.mv(:'B', 'j1', 'specialty_reason'), 'no_specialty_required', 'reason: no_specialty_required');

-- ===========================================================================
-- C. LOCATION — 15 / 10 / 5 / 0
-- ===========================================================================
select is(pg_temp.mv(:'A', 'j1', 'location_points'), '15', 'same declared city -> 15');
select is(pg_temp.mv(:'A', 'j1', 'location_reason'), 'same_city', 'reason: same_city');
select is(pg_temp.mv(:'A', 'j6', 'location_points'), '10', 'primary governorate, a city A did not declare -> 10');
select is(pg_temp.mv(:'A', 'j6', 'location_reason'), 'primary_governorate', 'reason: primary_governorate');
select is(pg_temp.mv(:'D', 'j6', 'location_points'), '15', 'D declared Maadi -> 15');
select is(pg_temp.mv(:'A', 'j4', 'location_points'), '5', 'another declared service area (Giza / Dokki) -> 5');
select is(pg_temp.mv(:'A', 'j4', 'location_reason'), 'other_service_area', 'reason: other_service_area');
select is(pg_temp.mv(:'B', 'j1', 'location_points'), '5', 'a whole-governorate other area (Cairo) covers a Cairo job -> 5');
select is(pg_temp.mv(:'B', 'j4', 'location_points'), '10', 'B''s primary governorate is Giza -> 10');
select is(pg_temp.mv(:'A', 'j9', 'location_points'), '0', 'Giza / Haram: A declared only Dokki in Giza -> outside -> 0');
select is(pg_temp.mv(:'A', 'j9', 'location_reason'), 'outside_service_area', 'reason: outside_service_area');
select is(pg_temp.mv(:'A', 'j5', 'location_points'), '0', 'Alexandria is outside every declared area -> 0');
select is(pg_temp.mv(:'E', 'j1', 'location_reason'), 'no_service_area', 'no declared area at all: reason no_service_area, 0 points');
select is(pg_temp.mv(:'A', 'jl', 'location_reason'), 'job_location_unknown', 'a legacy job with no canonical keys: job_location_unknown, 0 points — nothing is guessed');

-- ===========================================================================
-- D. AVAILABILITY — binary once declared; NOT DECLARED is its own state
-- ===========================================================================
select is(pg_temp.mv(:'C', 'j1', 'availability_points'), '0', 'EXPLICITLY declared unavailable -> 0');
select is(pg_temp.mv(:'C', 'j1', 'availability_reason'), 'not_available_for_work', 'reason: not_available_for_work');
select is(pg_temp.mv(:'D', 'j1', 'availability_points'), null, 'NOT DECLARED (default false, never set) -> NULL points, not a silent 0');
select is(pg_temp.mv(:'D', 'j1', 'availability_reason'), 'availability_not_declared', 'reason: availability_not_declared — never reported as not_available_for_work');
select is(pg_temp.mv(:'D', 'j6', 'overall_percent'), '85', 'NOT DECLARED earns no availability points and invents none: 50 + 20 + 15 = 85, the most an undeclared caller can reach');
update public.profiles set available_for_work = false where user_id = :'D'::uuid;
select isnt((select availability_updated_at from public.profiles where user_id = :'D'::uuid), null, 'the FIRST explicit "unavailable" (false -> false) is recorded by the declaration marker');
select is(pg_temp.mv(:'D', 'j1', 'availability_reason'), 'not_available_for_work', 'once explicitly declared, D is UNAVAILABLE (0 points) — declared, not inferred');
select is(pg_temp.mv(:'A', 'j1', 'availability_points'), '15', 'undated job + available for work -> 15');
select is(pg_temp.mv(:'A', 'j1', 'availability_reason'), 'available_no_dates', 'reason: available_no_dates');
select is(pg_temp.mv(:'A', 'j7', 'availability_points'), '15', 'job window fully inside a declared window -> 15');
select is(pg_temp.mv(:'A', 'j7', 'availability_reason'), 'window_covers', 'reason: window_covers');
select is(pg_temp.mv(:'A', 'j8', 'availability_points'), '15', 'ONE date boundary is a single-day window (same semantics as My Work), covered -> 15');
select is(pg_temp.mv(:'A', 'j10', 'availability_points'), '0', 'job window NOT covered by any declared window -> 0');
select is(pg_temp.mv(:'A', 'j10', 'availability_reason'), 'window_not_covering', 'reason: window_not_covering');
select is(pg_temp.mv(:'E', 'j7', 'availability_reason'), 'no_window_declared', 'available but NO window declared and the job is dated -> 0, no_window_declared');
select is(pg_temp.mv(:'B', 'j10', 'availability_points'), '15', 'an OPEN-ENDED window covers any later job window -> 15');
insert into public.user_availability_windows (user_id, available_from, available_to) values (:'A', '2027-06-01', '2027-06-15'), (:'A', '2027-06-16', '2027-06-30');
select is(pg_temp.mv(:'A', 'j10', 'availability_points'), '15', 'touching windows merge: a job spanning two adjacent declared windows is covered');
delete from public.user_availability_windows where user_id = :'A'::uuid and available_from >= '2027-06-01';

-- ===========================================================================
-- E. TOTAL — exact, deterministic, 0..100, breakdown sums
-- ===========================================================================
select is(pg_temp.mv(:'A', 'j2', 'overall_percent'), '100', 'trade 50 + specialty 20 + city 15 + availability 15 = 100');
select is(pg_temp.mv(:'A', 'j6', 'overall_percent'), '95', 'A on Maadi (primary gov) = 50 + 20 + 10 + 15');
select is(pg_temp.mv(:'C', 'j5', 'overall_percent'), '0', 'nothing matches -> 0');
select is(
  (select count(*)::int
     from (values (:'A'), (:'B'), (:'C'), (:'D'), (:'E')) u(uid)
     cross join unnest(array['j1','j2','j4','j5','j6','j7','j8','j9','j10','jl']) j(jk)
     cross join lateral app.job_match_for(u.uid::uuid, current_setting('t.' || j.jk)::uuid) m
    where m.overall_percent <> m.trade_points + m.specialty_points + m.location_points + coalesce(m.availability_points, 0)),
  0, 'the percentage ALWAYS equals the sum of its four parts');
select is(
  (select count(*)::int
     from (values (:'A'), (:'B'), (:'C'), (:'D'), (:'E')) u(uid)
     cross join unnest(array['j1','j2','j4','j5','j6','j7','j8','j9','j10','jl']) j(jk)
     cross join lateral app.job_match_for(u.uid::uuid, current_setting('t.' || j.jk)::uuid) m
    where m.overall_percent not between 0 and 100
       or m.trade_points not in (0, 50) or m.specialty_points not in (0, 20)
       or m.location_points not in (0, 5, 10, 15) or m.availability_points not in (0, 15)),
  0, 'every component and the total are always inside their approved sets, and the total inside 0..100');
select is(
  (select count(*)::int
     from (values (:'A'), (:'B'), (:'C'), (:'D'), (:'E')) u(uid)
     cross join unnest(array['j1','j2','j4','j5','j6','j7','j8','j9','j10','jl']) j(jk)
     cross join lateral app.job_match_for(u.uid::uuid, current_setting('t.' || j.jk)::uuid) m
    where (m.availability_points is null) <> (m.availability_reason = 'availability_not_declared')),
  0, 'availability points are NULL exactly when the reason is availability_not_declared — never a 0 standing in for "unknown"');
select is(
  (select count(*)::int from (values (:'A'), (:'B'), (:'C'), (:'D'), (:'E')) u(uid)
     cross join unnest(array['j1','j2','j4','j5','j6','j7','j8','j9','j10','jl']) j(jk)
     cross join lateral app.job_match_for(u.uid::uuid, current_setting('t.' || j.jk)::uuid) m
    where m.trade_reason is null or m.specialty_reason is null or m.location_reason is null or m.availability_reason is null),
  0, 'every row carries all four stable reason codes');
select is(
  (select to_jsonb(m) from app.job_match_for(:'A'::uuid, current_setting('t.j7')::uuid) m),
  (select to_jsonb(m) from app.job_match_for(:'A'::uuid, current_setting('t.j7')::uuid) m),
  'deterministic: the same user and job always return the same result');

-- ===========================================================================
-- F. THE PUBLIC READ: caller-scoped, no user argument, discoverable (or applied-to) jobs only
-- ===========================================================================
select is(
  (select pg_get_function_arguments('public.job_matches(uuid[])'::regprocedure)),
  'p_job_ids uuid[]', 'public.job_matches takes ONLY job ids — nothing to spoof');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('job_match_for', 'job_match_rows')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  0, 'the internal authority and its single-job wrapper (they take a user id) are executable by NO client role');

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select overall_percent from public.job_matches(array[current_setting('t.j2')::uuid])),
  100::smallint, 'as A: 100 — derived from A''s OWN rows via auth.uid()');
select is(
  (select count(*)::int from public.job_matches(array[current_setting('t.jd')::uuid])),
  0, 'an unpublished (undiscoverable) job returns no match at all');
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is(
  (select overall_percent from public.job_matches(array[current_setting('t.j2')::uuid])),
  70::smallint, 'as B: the SAME job is 70 (50 trade + 0 missing specialty + 5 other area + 15) — a caller cannot read, borrow or spoof another user''s trades, specialties, areas or availability');
select throws_ok($$select * from public.job_matches((select array_agg(gen_random_uuid()) from generate_series(1, 201)))$$, '22023', null, 'more than 200 ids is refused');
reset role;
set local request.jwt.claims = '';
set local role anon;
select throws_ok(format($$select * from public.job_matches(array[%L::uuid])$$, current_setting('t.j1')), '42501', null, 'anon cannot read a match');
reset role;

-- ===========================================================================
-- G. THE SCORE IS PRESENTATION ONLY — never authorization
-- ===========================================================================
-- C (epoxy only, unavailable, based in Cairo) scores 0 on the Alexandria painting job j5.
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000008-0000-4000-8000-000000000008","role":"authenticated"}';
select is((select overall_percent from public.job_matches(array[current_setting('t.j5')::uuid])), 0::smallint, 'precondition: a 0 % job for this caller');
select is((select count(*)::int from public.open_job_opportunities where id = current_setting('t.j5')::uuid), 1, 'a 0 % job is STILL DISCOVERABLE');
select is((select count(*)::int from public.job_opportunities_page(p_limit => 100) where id = current_setting('t.j5')::uuid), 1, 'and still on the paged board');
select is((select count(*)::int from public.job_opportunities_page(p_limit => 100) where title like 'M %'), (select count(*)::int from public.open_job_opportunities where title like 'M %'), 'the board shows every open job the caller may see — match removes nothing');
select lives_ok(format($$select public.job_application_submit(%L, 'Happy to learn.')$$, current_setting('t.j5')), 'a 0 % caller CAN apply — application authority never consults the score');
select is((select has_applied from public.open_job_opportunities where id = current_setting('t.j5')::uuid), true, 'and the application is real');
select is((select count(*)::int from public.job_matches(array[current_setting('t.j5')::uuid])), 1, 'and the applicant still sees their own match for a job they applied to');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and p.prokind = 'f'
      and p.proname not in ('job_match_rows', 'job_match_for', 'job_matches', 'job_opportunities_page')
      and pg_get_functiondef(p.oid) like '%job_match_rows%'),
  0, 'only the two public readers (and the single-job wrapper) reference the authority — it is never a predicate in any write path, gate or policy function');
select is((select count(*)::int from pg_policies where coalesce(qual, '') || coalesce(with_check, '') like '%job_match%'), 0, 'NO RLS policy references the match');
select is((select count(*)::int from pg_views where schemaname in ('public', 'app') and definition like '%job_match%'), 0, 'NO view is built on the match');
select is((select count(*)::int from pg_proc where proname = 'job_match_scores'), 0, 'Match V1 (job_match_scores) is gone — one authority only');

select * from finish();
rollback;
