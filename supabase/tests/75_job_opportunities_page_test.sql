-- pgTAP: Installer Jobs — the SCALABLE keyset board (public.job_opportunities_page / _total).
--
-- The board pages by CURSOR with the filter, the sort, the cursor predicate and the LIMIT all INSIDE one
-- statement. This file proves, against an independent oracle (a plain ORDER BY over the real tables), that:
--   * walking the pages reproduces the oracle order EXACTLY, for every sort, at several page sizes, over a
--     set with repeated timestamps, repeated pay and every location / skill tier;
--   * rows inserted AHEAD of the cursor, inserted BEHIND it, or removed after being shown neither duplicate
--     nor skip an original row;
--   * every filter equals the oracle's filter, and the total equals the filtered count;
--   * discoverability is separate from, and never widened by, the cursor (draft / closed / unverified-poster
--     jobs never appear, whatever cursor is supplied);
--   * Near me orders by LOCATION only and Best match by TRADE + SPECIALTY only — and both agree with the
--     canonical Overall Match authority;
--   * a malformed cursor is refused.
create extension if not exists pgtap;

begin;
select plan(54);

\set org   '9a000000-aaaa-4aaa-8aaa-000000000005'
\set org2  '91000001-1111-4111-8111-000000000001'
\set poster '70000006-0000-4000-8000-000000000006'
\set A '71000006-0000-4000-8000-000000000006'

insert into public.trade_specialties (id, trade_id, key) values
  ('e7500000-0000-4000-8000-0000000000a1', (select id from public.trades where key = 'painting'), 'fx_sp_a'),
  ('e7500000-0000-4000-8000-0000000000a2', (select id from public.trades where key = 'painting'), 'fx_sp_b');

-- 240 open jobs. 24 distinct timestamps (ten share each), repeated pay, mixed trades / specialties, and every
-- location kind: city, governorate-only, another area, unrelated, and an unresolvable legacy text.
insert into public.jobs (id, poster_org_id, title, description, trade_id, required_specialty_id, offered_amount,
                         governorate, city, expected_duration_days, status, published_at, created_by)
select ('e7500000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       :'org'::uuid,
       'PG ' || lpad(i::text, 3, '0') || case when i % 11 = 0 then ' needle' else '' end,
       'x',
       (select id from public.trades where key = (array['painting', 'epoxy_flooring', 'tiling'])[1 + i % 3]),
       case when i % 3 = 0 and i % 6 = 0 then 'e7500000-0000-4000-8000-0000000000a1'::uuid
            when i % 3 = 0 and i % 6 = 3 and i % 4 = 1 then 'e7500000-0000-4000-8000-0000000000a2'::uuid end,
       case i % 7 when 0 then 12000 when 1 then 3000 when 2 then 3000 when 3 then 5000 when 4 then 5000 else 8000 end,
       (array['Cairo', 'Cairo', 'Giza', 'Giza', 'Alexandria', 'Cairo', 'Atlantis', 'Giza'])[1 + i % 8],
       (array['New Cairo', 'Maadi', 'Dokki', 'Haram', 'Alexandria City', null, 'Nowhere', null])[1 + i % 8],
       ((i % 5) * 10)::smallint,
       'open',
       timestamptz '2027-03-01 12:00:00+00' - (((i / 10) * 30) || ' minutes')::interval,
       :'poster'::uuid
from generate_series(0, 239) i;

-- Never discoverable: a draft, a closed job and one whose poster is not verified.
insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, governorate, city, status, published_at, created_by)
select ('e7500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, o, 'PG hidden ' || n, 'x',
       (select id from public.trades where key = 'painting'), 5000, 'Cairo', 'New Cairo', s::public.job_status,
       timestamptz '2027-03-01 12:00:00+00', :'poster'::uuid
from (values (900, :'org'::uuid, 'draft'), (901, :'org'::uuid, 'closed'), (902, :'org2'::uuid, 'open')) v(n, o, s);
update public.organizations set is_verified = false where id = :'org2'::uuid;

-- The caller: paints, holds fx_sp_a, based in Cairo (+ New Cairo) with Giza as another area, available.
insert into public.user_trades (user_id, trade_id) select :'A'::uuid, id from public.trades where key = 'painting';
insert into public.user_trade_specialties (user_id, trade_id, specialty_id)
values (:'A', (select id from public.trades where key = 'painting'), 'e7500000-0000-4000-8000-0000000000a1');
insert into public.user_service_areas (user_id, governorate_key, city_key, is_primary) values
  (:'A', 'cairo', null, true), (:'A', 'cairo', 'new-cairo', false), (:'A', 'giza', null, false);
update public.profiles set available_for_work = true where user_id = :'A'::uuid;
insert into public.saved_jobs (user_id, job_id)
select :'A'::uuid, ('e7500000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid from generate_series(0, 239) i where i % 9 = 0;
insert into public.job_applications (job_id, applicant_user_id, status)
select ('e7500000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, :'A'::uuid, 'submitted' from generate_series(0, 239) i where i % 40 = 3;

-- ---------------------------------------------------------------------------
-- Test-only helpers: mutate as the owner while a caller is paging, walk the board by cursor, build the oracle.
-- ---------------------------------------------------------------------------
create function public.zz_exec(q text) returns void language plpgsql security definer set search_path = '' as $$
begin execute q; end; $$;
grant execute on function public.zz_exec(text) to authenticated;

create function public.zz_walk(
  p_sort text, p_size int, p_mutate_after int default null, p_mutation text default null,
  p_saved boolean default false, p_search text default null, p_trades text[] default null,
  p_gov text default null, p_city text default null, p_min numeric default null, p_max numeric default null,
  p_applied boolean default null, p_dmin smallint default null, p_dmax smallint default null)
returns uuid[] language plpgsql as $$
declare
  ids uuid[] := '{}'; r record; pages int := 0; got int;
  lp timestamptz; lid uuid; la numeric; lt smallint;
begin
  loop
    got := 0;
    for r in select * from public.job_opportunities_page(
        p_sort => p_sort, p_search => p_search, p_trade_keys => p_trades, p_governorate_key => p_gov, p_city_key => p_city,
        p_min_amount => p_min, p_max_amount => p_max, p_min_duration => p_dmin, p_max_duration => p_dmax,
        p_applied => p_applied, p_saved => p_saved, p_limit => p_size,
        p_after_id => lid, p_after_published_at => lp, p_after_amount => la, p_after_tier => lt)
    loop
      ids := ids || r.id; got := got + 1;
      lid := r.id; lp := r.published_at; la := r.offered_amount;
      lt := case p_sort when 'nearest' then r.proximity_tier when 'best' then r.skill_rank end;
    end loop;
    pages := pages + 1;
    exit when got < p_size or pages > 600;
    if p_mutate_after is not null and pages = p_mutate_after then perform public.zz_exec(p_mutation); end if;
  end loop;
  return ids;
end; $$;
grant execute on function public.zz_walk(text, int, int, text, boolean, text, text[], text, text, numeric, numeric, boolean, smallint, smallint) to authenticated;

-- The oracle: every open job of a verified poster, in the sort's TOTAL order, from the tables directly.
create function public.zz_oracle(p_sort text, p_uid uuid, p_where text default 'true') returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare r uuid[]; o text;
begin
  o := case p_sort
    when 'oldest'  then 'j.published_at asc, j.id asc'
    when 'highest' then 'j.offered_amount desc, j.published_at desc, j.id desc'
    when 'nearest' then '(case m.location_reason when ''same_city'' then 0 when ''primary_governorate'' then 1 when ''other_service_area'' then 2 else 3 end), j.published_at desc, j.id desc'
    when 'best'    then '(case m.trade_points + m.specialty_points when 70 then 0 when 50 then 1 else 2 end), j.published_at desc, j.id desc'
    else 'j.published_at desc, j.id desc' end;
  execute 'select coalesce(array_agg(j.id order by ' || o || '), ''{}'') from public.jobs j'
       || ' join public.trades t on t.id = j.trade_id'
       || ' join public.organizations org on org.id = j.poster_org_id and org.is_verified and org.deleted_at is null and org.status = ''active'''
       || ' cross join lateral app.job_match_for($1, j.id) m'
       || ' where j.status = ''open'' and (' || p_where || ')'
    into r using p_uid;
  return r;
end $$;
grant execute on function public.zz_oracle(text, uuid, text) to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

-- ===========================================================================
-- A. Walking the pages reproduces the oracle — every sort, several page sizes
-- ===========================================================================
select set_config('t.n_open', (select count(*) from public.open_job_opportunities)::text, true);
select cmp_ok(current_setting('t.n_open')::int, '>', 240, 'the board holds every fixture job plus the seeded ones');
select is(public.job_opportunities_total(), current_setting('t.n_open')::bigint, 'the exact total equals the discoverable count');
select is(public.zz_walk('newest', 7),  public.zz_oracle('newest',  :'A'::uuid), 'NEWEST (pages of 7) = the oracle order, exactly');
select is(public.zz_walk('newest', 100), public.zz_oracle('newest', :'A'::uuid), 'NEWEST (pages of 100) = the oracle order');
select is(public.zz_walk('oldest', 13), public.zz_oracle('oldest',  :'A'::uuid), 'OLDEST (pages of 13) = the oracle order');
select is(public.zz_walk('highest', 9), public.zz_oracle('highest', :'A'::uuid), 'HIGHEST PAY (pages of 9) = the oracle order — equal pay breaks on published_at then id');
select is(public.zz_walk('nearest', 11), public.zz_oracle('nearest', :'A'::uuid), 'NEAREST (pages of 11) = the oracle order — location tiers 0,1,2,3 then published_at, id');
select is(public.zz_walk('nearest', 1) = public.zz_oracle('nearest', :'A'::uuid), true, 'NEAREST one row per page also reproduces the order (a cursor on every tier boundary)');
select is(public.zz_walk('best', 8),    public.zz_oracle('best',    :'A'::uuid), 'BEST MATCH (pages of 8) = the oracle order — trade + specialty rank, then published_at, id');
select is(
  (select count(*)::int from (select unnest(public.zz_walk('highest', 9)) i) x),
  (select count(distinct i)::int from (select unnest(public.zz_walk('highest', 9)) i) x),
  'no duplicates across the whole walk');

-- ===========================================================================
-- B. The board changes between two pages
-- ===========================================================================
reset role; set local request.jwt.claims = '';
select set_config('t.o_new', public.zz_oracle('newest', :'A'::uuid)::text, true);
select set_config('t.o_hi',  public.zz_oracle('highest', :'A'::uuid)::text, true);
select set_config('t.o_nr',  public.zz_oracle('nearest', :'A'::uuid)::text, true);
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

-- insert AHEAD of the cursor after page 3: never duplicated, never skipped.
select is(
  public.zz_walk('newest', 7, 3, $$insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, governorate, city, status, published_at, created_by)
     values ('e7500000-0000-4000-8000-0000000000b1', '9a000000-aaaa-4aaa-8aaa-000000000005', 'PG ahead', 'x', (select id from public.trades where key = 'painting'), 99999, 'Cairo', 'New Cairo', 'open', timestamptz '2030-01-01', '70000006-0000-4000-8000-000000000006')$$)::text,
  current_setting('t.o_new'), 'NEWEST: a job published AHEAD of the cursor mid-walk neither duplicates nor skips an original row');
select public.zz_exec($$delete from public.jobs where id = 'e7500000-0000-4000-8000-0000000000b1'$$);
select is(
  public.zz_walk('highest', 9, 3, $$insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, governorate, city, status, published_at, created_by)
     values ('e7500000-0000-4000-8000-0000000000b2', '9a000000-aaaa-4aaa-8aaa-000000000005', 'PG ahead hi', 'x', (select id from public.trades where key = 'painting'), 99999, 'Cairo', 'New Cairo', 'open', timestamptz '2030-01-01', '70000006-0000-4000-8000-000000000006')$$)::text,
  current_setting('t.o_hi'), 'HIGHEST: a higher-paid job inserted mid-walk changes nothing already ahead');
select public.zz_exec($$delete from public.jobs where id = 'e7500000-0000-4000-8000-0000000000b2'$$);
select is(
  public.zz_walk('nearest', 11, 3, $$insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, governorate, city, status, published_at, created_by)
     values ('e7500000-0000-4000-8000-0000000000b3', '9a000000-aaaa-4aaa-8aaa-000000000005', 'PG ahead nr', 'x', (select id from public.trades where key = 'painting'), 5000, 'Cairo', 'New Cairo', 'open', timestamptz '2030-01-01', '70000006-0000-4000-8000-000000000006')$$)::text,
  current_setting('t.o_nr'), 'NEAREST: a same-city job inserted mid-walk does not disturb the pages already ahead');
select public.zz_exec($$delete from public.jobs where id = 'e7500000-0000-4000-8000-0000000000b3'$$);

-- insert BEHIND the cursor: it simply arrives later in the walk, once.
select is(
  public.zz_walk('newest', 7, 3, $$insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, governorate, city, status, published_at, created_by)
     values ('e7500000-0000-4000-8000-0000000000b4', '9a000000-aaaa-4aaa-8aaa-000000000005', 'PG behind', 'x', (select id from public.trades where key = 'painting'), 1000, 'Cairo', 'New Cairo', 'open', timestamptz '2020-01-01', '70000006-0000-4000-8000-000000000006')$$)::text,
  (current_setting('t.o_new')::uuid[] || 'e7500000-0000-4000-8000-0000000000b4'::uuid)::text,
  'NEWEST: a job inserted BEHIND the cursor mid-walk appears exactly once, at the end');
select public.zz_exec($$delete from public.jobs where id = 'e7500000-0000-4000-8000-0000000000b4'$$);

-- remove a row that was already shown: the rest of the walk is unaffected.
select is(
  public.zz_walk('newest', 7, 2, format($$delete from public.jobs where id = %L$$, (current_setting('t.o_new')::uuid[])[1]))::text,
  current_setting('t.o_new'), 'NEWEST: deleting an already-shown row mid-walk skips nothing and duplicates nothing');

-- ===========================================================================
-- C. Every filter = the oracle's filter, and the total = its count
-- ===========================================================================
reset role; set local request.jwt.claims = '';
select set_config('t.f_search', public.zz_oracle('newest', :'A'::uuid, $$j.title ilike '%needle%'$$)::text, true);
select set_config('t.f_trade',  public.zz_oracle('highest', :'A'::uuid, $$t.key = 'painting'$$)::text, true);
select set_config('t.f_gov',    public.zz_oracle('newest', :'A'::uuid, $$j.governorate_key = 'cairo'$$)::text, true);
select set_config('t.f_city',   public.zz_oracle('newest', :'A'::uuid, $$j.governorate_key = 'cairo' and j.city_key = 'maadi'$$)::text, true);
select set_config('t.f_amt',    public.zz_oracle('newest', :'A'::uuid, $$j.offered_amount >= 5000 and j.offered_amount <= 8000$$)::text, true);
select set_config('t.f_dur',    public.zz_oracle('newest', :'A'::uuid, $$j.expected_duration_days >= 20 and j.expected_duration_days <= 30$$)::text, true);
select set_config('t.f_app',    public.zz_oracle('newest', :'A'::uuid, $q$exists (select 1 from public.job_applications ap where ap.job_id = j.id and ap.applicant_user_id = '71000006-0000-4000-8000-000000000006')$q$)::text, true);
select set_config('t.f_napp',   public.zz_oracle('newest', :'A'::uuid, $q$not exists (select 1 from public.job_applications ap where ap.job_id = j.id and ap.applicant_user_id = '71000006-0000-4000-8000-000000000006')$q$)::text, true);
select set_config('t.f_saved',  public.zz_oracle('newest', :'A'::uuid, $q$exists (select 1 from public.saved_jobs sj where sj.job_id = j.id and sj.user_id = '71000006-0000-4000-8000-000000000006')$q$)::text, true);
select set_config('t.f_combo',  public.zz_oracle('newest', :'A'::uuid, $$t.key = 'painting' and j.governorate_key = 'giza' and j.offered_amount >= 3000$$)::text, true);
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(public.zz_walk('newest', 5, p_search => 'needle')::text, current_setting('t.f_search'), 'search (title / description / org name) matches the oracle');
select is(public.zz_walk('highest', 6, p_trades => array['painting'])::text, current_setting('t.f_trade'), 'trade filter, in HIGHEST order');
select is(public.zz_walk('newest', 8, p_gov => 'cairo')::text, current_setting('t.f_gov'), 'governorate key filter');
select is(public.zz_walk('newest', 4, p_gov => 'cairo', p_city => 'maadi')::text, current_setting('t.f_city'), 'governorate + city key filter');
select is(public.zz_walk('newest', 9, p_min => 5000, p_max => 8000)::text, current_setting('t.f_amt'), 'budget range filter');
select is(public.zz_walk('newest', 9, p_dmin => 20::smallint, p_dmax => 30::smallint)::text, current_setting('t.f_dur'), 'duration bucket filter');
select is(public.zz_walk('newest', 3, p_applied => true)::text, current_setting('t.f_app'), 'applied = yes');
select is(public.zz_walk('newest', 25, p_applied => false)::text, current_setting('t.f_napp'), 'applied = no');
select is(public.zz_walk('newest', 5, p_saved => true)::text, current_setting('t.f_saved'), 'SAVED opportunities use the same paged path and equal the oracle');
select is(public.zz_walk('newest', 6, p_trades => array['painting'], p_gov => 'giza', p_min => 3000)::text, current_setting('t.f_combo'), 'several filters together');
select is(public.job_opportunities_total(p_search => 'needle'), cardinality(current_setting('t.f_search')::uuid[])::bigint, 'total: search');
select is(public.job_opportunities_total(p_governorate_key => 'cairo', p_city_key => 'maadi'), cardinality(current_setting('t.f_city')::uuid[])::bigint, 'total: governorate + city');
select is(public.job_opportunities_total(p_saved => true), cardinality(current_setting('t.f_saved')::uuid[])::bigint, 'total: saved');
select is(public.job_opportunities_total(p_trade_keys => array['painting'], p_governorate_key => 'giza', p_min_amount => 3000), cardinality(current_setting('t.f_combo')::uuid[])::bigint, 'total: several filters');
select is(public.job_opportunities_total(p_trade_keys => array['no_such_trade']), 0::bigint, 'an unknown trade key matches nothing (never everything)');
select is(
  (select pg_get_function_arguments('public.job_opportunities_total(text,text[],text,text,numeric,numeric,smallint,smallint,boolean,boolean)'::regprocedure) not like '%after%'),
  true, 'COUNT STRATEGY: the total takes no cursor — it is one exact count per question, independent of the page being read');

-- ===========================================================================
-- D. Discoverability is separate from the cursor and never widened by it
-- ===========================================================================
select is(
  (select count(*)::int from unnest(public.zz_walk('newest', 50)) i where i in
    ('e7500000-0000-4000-8000-000000000900', 'e7500000-0000-4000-8000-000000000901', 'e7500000-0000-4000-8000-000000000902')),
  0, 'a draft, a closed job and an unverified poster''s job NEVER appear in any walk');
select is(
  (select count(*)::int from public.job_opportunities_page(p_sort => 'newest', p_limit => 100,
      p_after_id => 'e7500000-0000-4000-8000-000000000900', p_after_published_at => timestamptz '2027-03-01 12:00:01+00')
    where title like 'PG hidden%'),
  0, 'a FORGED cursor positioned on a hidden job cannot surface it — the cursor narrows position, never discoverability');
select is(
  (select count(*)::int from public.job_opportunities_page(p_sort => 'newest', p_limit => 100,
      p_after_id => gen_random_uuid(), p_after_published_at => timestamptz '2100-01-01')),
  least(100, current_setting('t.n_open')::int), 'a cursor from the far future simply starts from the top of what is discoverable');
select is(
  (select array_agg(i order by i) from unnest(public.zz_walk('newest', 100)) i),
  (select array_agg(id order by id) from public.open_job_opportunities),
  'the paged board returns EXACTLY the set the discovery view returns — the two authorities agree');

-- ===========================================================================
-- E. Tiers: Near me = location only, Best match = trade + specialty only; match parity per row
-- ===========================================================================
select is(
  (select count(*)::int from public.job_opportunities_page(p_sort => 'nearest', p_limit => 100) r
     cross join lateral (select * from public.job_matches(array[r.id])) m
    where r.proximity_tier is distinct from (case m.location_reason when 'same_city' then 0 when 'primary_governorate' then 1 when 'other_service_area' then 2 else 3 end)::smallint),
  0, 'every row''s Near me tier equals the tier of the canonical match location reason (one meaning of "near")');
select is(
  (select count(*)::int from public.job_opportunities_page(p_sort => 'best', p_limit => 100) r
     cross join lateral (select * from public.job_matches(array[r.id])) m
    where r.skill_rank is distinct from (case m.trade_points + m.specialty_points when 70 then 0 when 50 then 1 else 2 end)::smallint),
  0, 'every row''s Best match rank equals trade + specialty points of the canonical match — and ignores location and availability');
select is(
  (select count(*)::int from public.job_opportunities_page(p_sort => 'newest', p_limit => 100) r
     cross join lateral (select * from public.job_matches(array[r.id])) m
    where (r.overall_percent, r.trade_points, r.specialty_points, r.location_points, r.availability_points, r.trade_reason, r.specialty_reason, r.location_reason, r.availability_reason)
          is distinct from (m.overall_percent, m.trade_points, m.specialty_points, m.location_points, m.availability_points, m.trade_reason, m.specialty_reason, m.location_reason, m.availability_reason)),
  0, 'ROUTE PARITY: every row on the board carries EXACTLY the breakdown the detail read returns for that job');
select ok(
  (select array_agg(proximity_tier order by ord) = array_agg(proximity_tier order by proximity_tier, ord)
     from (select proximity_tier, row_number() over () ord from public.job_opportunities_page(p_sort => 'nearest', p_limit => 101)) x),
  'Near me never lets a farther tier appear before a nearer one');
select ok(
  (select array_agg(skill_rank order by ord) = array_agg(skill_rank order by skill_rank, ord)
     from (select skill_rank, row_number() over () ord from public.job_opportunities_page(p_sort => 'best', p_limit => 101)) x),
  'Best match never lets a lower skill rank appear before a higher one');

-- ===========================================================================
-- F. A malformed cursor, a bad request and anonymous callers are refused
-- ===========================================================================
select throws_ok($$select * from public.job_opportunities_page(p_after_published_at => now())$$, '22023', null, 'a cursor without its id is refused');
select throws_ok($$select * from public.job_opportunities_page(p_sort => 'highest', p_after_id => gen_random_uuid(), p_after_published_at => now())$$, '22023', null, 'HIGHEST needs the amount in its cursor');
select throws_ok($$select * from public.job_opportunities_page(p_sort => 'nearest', p_after_id => gen_random_uuid(), p_after_published_at => now(), p_after_tier => 4::smallint)$$, '22023', null, 'a Near me tier outside 0..3 is refused');
select throws_ok($$select * from public.job_opportunities_page(p_sort => 'best', p_after_id => gen_random_uuid(), p_after_published_at => now(), p_after_tier => 3::smallint)$$, '22023', null, 'a Best match rank outside 0..2 is refused');
select throws_ok($$select * from public.job_opportunities_page(p_sort => 'bogus')$$, '22023', null, 'an unknown sort is refused');
select throws_ok($$select * from public.job_opportunities_page(p_limit => 0)$$, '22023', null, 'page size 0 is refused');
select throws_ok($$select * from public.job_opportunities_page(p_limit => 102)$$, '22023', null, 'page size above 101 is refused');
reset role;
set local request.jwt.claims = '';
set local role anon;
select throws_ok($$select * from public.job_opportunities_page()$$, '42501', null, 'anon cannot read the board');
select throws_ok($$select public.job_opportunities_total()$$, '42501', null, 'anon cannot count it');
reset role;
select is(
  (select pg_get_function_arguments('public.job_opportunities_page(text,text,text[],text,text,numeric,numeric,smallint,smallint,boolean,boolean,integer,uuid,timestamptz,numeric,smallint)'::regprocedure) not ilike '%user%'),
  true, 'no user argument exists: identity is auth.uid() and nothing else');

-- ===========================================================================
-- G. The shape that makes it scale (guards against regressing to the full-set read)
-- ===========================================================================
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('job_opportunities_page', 'job_opportunities_total')
      and (p.prosrc like '%open_job_opportunities%' or p.prosrc like '%_open_job_opportunities%')),
  0, 'neither function reads the open_job_opportunities view / opaque definer reader — the full-set read is gone');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'job_opportunities_page' and p.prosrc like '%public.jobs j%' and p.prosrc like '% limit %'),
  1, 'the page is built over public.jobs with its LIMIT inside the statement');
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'jobs'
     and indexname in ('ix_jobs_open_published', 'ix_jobs_open_amount', 'ix_jobs_open_gov', 'ix_jobs_open_gov_city')),
  4, 'the four partial keyset indexes exist');
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'jobs'
     and indexname in ('ix_jobs_open_published', 'ix_jobs_open_amount', 'ix_jobs_open_gov', 'ix_jobs_open_gov_city') and indexdef like '%WHERE (status = ''open''::job_status)%'),
  4, 'and every one is PARTIAL on open jobs');

select * from finish();
rollback;
