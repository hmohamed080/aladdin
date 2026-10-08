-- pgTAP: "Newest" means published_at DESC, id DESC — and NOTHING ELSE.
--
-- The board's Newest order is the real PUBLICATION time, newest first, with the id as the deterministic tie-break.
-- It must never be "recently edited": editing an old job (which bumps updated_at) must not make it look newly published.
-- The only thing that sets published_at is job_publish (draft -> open); there is no reopen / republish action.
create extension if not exists pgtap;

begin;
select plan(14);

\set org    '9a000000-aaaa-4aaa-8aaa-000000000005'
\set poster '70000006-0000-4000-8000-000000000006'
\set A      '71000006-0000-4000-8000-000000000006'

-- Four open jobs published through the REAL path, then given known publication times (as the owner):
--   old (2027-01-01) · tie1 and tie2 (the SAME instant, 2027-02-01) · fresh (2027-03-01)
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.old',   public.job_create(:'org'::uuid, 'NW old',   'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint)::text, true);
select set_config('t.tie1',  public.job_create(:'org'::uuid, 'NW tie 1', 'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint)::text, true);
select set_config('t.tie2',  public.job_create(:'org'::uuid, 'NW tie 2', 'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint)::text, true);
select set_config('t.fresh', public.job_create(:'org'::uuid, 'NW fresh', 'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint)::text, true);
select public.job_publish(current_setting('t.' || n)::uuid, 1) from unnest(array['old', 'tie1', 'tie2', 'fresh']) n;
reset role;
set local request.jwt.claims = '';

-- published_at is immutable, so the fixture pauses the guard (inside this rolled-back transaction only) to give the
-- jobs known publication times, then restores it.
alter table public.jobs disable trigger jobs_published_at_immutable;
update public.jobs set published_at = timestamptz '2027-01-01 12:00:00+00' where id = current_setting('t.old')::uuid;
update public.jobs set published_at = timestamptz '2027-02-01 12:00:00+00' where id in (current_setting('t.tie1')::uuid, current_setting('t.tie2')::uuid);
update public.jobs set published_at = timestamptz '2027-03-01 12:00:00+00' where id = current_setting('t.fresh')::uuid;
alter table public.jobs enable trigger jobs_published_at_immutable;

create function pg_temp.newest_titles() returns text[] language plpgsql as $$
declare t text[];
begin
  perform set_config('request.jwt.claims', '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}', true);
  select array_agg(r.title order by array_position(array(select x.id from public.job_opportunities_page(p_sort => 'newest', p_search => 'NW ', p_limit => 101) x), r.id))
    into t from public.job_opportunities_page(p_sort => 'newest', p_search => 'NW ', p_limit => 101) r;
  return t;
end $$;

-- 1. the order, and the tie-break
select is((select array_agg(title order by published_at desc, id desc) from public.jobs where title like 'NW %' and status = 'open'),
          pg_temp.newest_titles(),
          'Newest = published_at DESC, id DESC (checked against an independent ORDER BY)');
select is((select array_agg(title order by id desc) from public.jobs where title like 'NW tie%'),
          (select array_agg(t) from unnest(pg_temp.newest_titles()) t where t like 'NW tie%'),
          'two jobs published at the same instant appear id DESC — the deterministic tie-break');
select is((pg_temp.newest_titles())[1], 'NW fresh', 'the genuinely newest publication is first');
select is((pg_temp.newest_titles())[4], 'NW old', 'the oldest publication is last');

-- 2. EDITING AN OLD JOB MUST NOT MAKE IT "NEW": a legitimate edit through the real RPC, as the job's own poster
select set_config('t.old_pub_before', (select published_at::text from public.jobs where id = current_setting('t.old')::uuid), true);
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_update(current_setting('t.old')::uuid, (select version from public.jobs where id = current_setting('t.old')::uuid),
                         'NW old (edited)', 'painting', 5000::numeric, 'edited just now');
reset role;
set local request.jwt.claims = '';

select ok((select updated_at from public.jobs where id = current_setting('t.old')::uuid) > now() - interval '1 minute',
          'the edit really did bump updated_at to now (it is far newer than the 2027-01-01 publication being tested against)');
select is((select published_at::text from public.jobs where id = current_setting('t.old')::uuid), current_setting('t.old_pub_before'),
          'job_update never touches published_at');
select is((pg_temp.newest_titles())[4], 'NW old (edited)',
          'the edited old job is STILL last under Newest, below every genuinely newer publication');
select is((pg_temp.newest_titles())[1], 'NW fresh', 'and the genuinely newest job is still first — Newest never means "recently edited"');
select is((select array_agg(title order by published_at desc, id desc) from public.jobs where title like 'NW %' and status = 'open'),
          pg_temp.newest_titles(), 'the order after the edit still equals published_at DESC, id DESC');
-- and the edited old job cannot be PUSHED to the top by writing a newer publication time either (immutability)
select throws_ok($q$ update public.jobs set published_at = now() where id = current_setting('t.old')::uuid $q$, '23514', null,
          'the edited old job cannot be made Newest by rewriting its published_at');

-- 3. THE CURSOR: a full walk in small pages, over tied timestamps, visits every discoverable job exactly once, in order
reset role;
-- more jobs, several sharing each instant, so a page boundary falls INSIDE a run of ties
insert into public.jobs (poster_org_id, title, description, trade_id, offered_amount, governorate, city, status, published_at, created_by)
select :'org'::uuid, 'NW bulk ' || i, 'x', (select id from public.trades where key = 'painting'), 5000, 'Cairo', 'New Cairo', 'open',
       timestamptz '2027-02-15 12:00:00+00' + ((i / 4) || ' minutes')::interval, :'poster'::uuid
  from generate_series(1, 23) i;

create function pg_temp.walk(p_limit int) returns uuid[] language plpgsql as $$
declare ids uuid[] := '{}'; r record; last_id uuid; last_pub timestamptz; n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}', true);
  loop
    n := 0;
    for r in select * from public.job_opportunities_page(p_sort => 'newest', p_search => 'NW', p_limit => p_limit, p_after_id => last_id, p_after_published_at => last_pub) loop
      ids := ids || r.id; last_id := r.id; last_pub := r.published_at; n := n + 1;
    end loop;
    exit when n < p_limit;
  end loop;
  return ids;
end $$;

select is(pg_temp.walk(3), (select array_agg(j.id order by j.published_at desc, j.id desc) from public.jobs j where j.title like 'NW %' and j.status = 'open'),
  'a full cursor walk in pages of 3 equals published_at DESC, id DESC, across runs of equal timestamps');
select is((select count(distinct x)::int from unnest(pg_temp.walk(5)) x), (select count(*)::int from public.jobs where title like 'NW %' and status = 'open'),
  'and it contains EVERY discoverable job (nothing skipped at a page boundary)');
select is(cardinality(pg_temp.walk(5)), (select count(*)::int from public.jobs where title like 'NW %' and status = 'open'),
  'exactly once each: no duplicates across page boundaries');
select is((select count(*)::int from public.jobs where status in ('open', 'awarded', 'closed', 'completed') and published_at is null), 0,
  'no published (or post-publication) job has a NULL publication time, so no cursor can ever be anchored on one');

select * from finish();
rollback;
