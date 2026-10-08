-- pgTAP: My Work — REAL pagination (public.my_work_page / my_work_counts /
-- my_work_companies).
--
-- The page used to read the newest 100 assignments and filter, count and "reveal"
-- them in application code. These assertions pin down the replacement:
--   * more than 100 assignments are reachable and counted EXACTLY;
--   * every filter (state, search, company, planned range, contact) and every sort
--     is applied by the database, and the filtered total always matches an
--     independent count over the base tables;
--   * ranges are deterministic — walking the pages repeats nothing and skips nothing;
--   * "All your work" means in_progress + completed, nothing else, unless asked;
--   * the work contact is released only for in_progress / completed, and the page is
--     scoped to the caller with no way to point it at someone else.
--
-- Fixtures are inserted as the superuser (the lifecycle RPCs are covered by their own
-- files): 240 assignments for installer 71000006 across two organizations, a few for
-- installer 71000007. Every fixture title carries the token PGWORK, so each assertion
-- isolates its own rows from whatever the seed holds.
create extension if not exists pgtap;

begin;
select plan(75);

\set org  '9a000000-aaaa-4aaa-8aaa-000000000005'
\set A    '71000006-0000-4000-8000-000000000006'
\set B    '71000007-0000-4000-8000-000000000007'
\set poster '70000006-0000-4000-8000-000000000006'

-- ===========================================================================
-- Fixtures
-- ===========================================================================
select set_config('t.org2', (select id::text from public.organizations where id <> :'org'::uuid order by id limit 1), true);
update public.organizations set name = 'PGWORK Second Org' where id = current_setting('t.org2')::uuid;

-- 240 jobs, newest first by i. Planned windows: most have both dates; every 11th
-- has a start only, every 13th has neither (so a date filter excludes it).
insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, governorate, city,
                         starts_on, ends_by, status, published_at, created_by)
select ('c1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       case when i % 2 = 0 then :'org'::uuid else current_setting('t.org2')::uuid end,
       'PGWORK ' || lpad(i::text, 3, '0') || ' painting',
       'x',
       (select id from public.trades where key = 'painting'),
       5000 + i,
       case when i % 7 = 0 then 'Giza' else 'Cairo' end,
       case when i % 7 = 0 then 'Dokki' else 'New Cairo' end,
       case when i % 13 = 0 then null else date '2027-01-01' + i end,
       case when i % 13 = 0 or i % 11 = 0 then null else date '2027-01-01' + i + 3 end,
       'awarded',
       now() - (i || ' minutes')::interval,
       :'poster'::uuid
from generate_series(0, 239) i;

insert into public.job_applications (id, job_id, applicant_user_id, status, decided_by, decided_at)
select ('c2000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       ('c1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       :'A'::uuid, 'accepted', :'poster'::uuid, now()
from generate_series(0, 239) i;

-- i % 6: 0,1,2 completed (120) / 3,4 in_progress (80) / 5 scheduled (40);
-- every 25th is cancelled instead (so 'cancelled' is reachable and excluded by default).
insert into public.job_assignments (id, job_id, application_id, installer_user_id, poster_org_id, agreed_amount, status,
                                    latest_progress_percent, last_progress_at, cancellation_reason, created_at)
select ('c3000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       ('c1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       ('c2000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       :'A'::uuid,
       case when i % 2 = 0 then :'org'::uuid else current_setting('t.org2')::uuid end,
       5000 + i,
       (case when i % 25 = 0 then 'cancelled'
             when i % 6 in (0, 1, 2) then 'completed'
             when i % 6 in (3, 4) then 'in_progress'
             else 'scheduled' end)::public.job_assignment_status,
       case when i % 6 in (3, 4) then 40 else 0 end,
       case when i % 6 in (3, 4) and i % 25 <> 0 then now() - ((i * 7) || ' minutes')::interval end,
       case when i % 25 = 0 then 'fixture' end,
       now() - (i || ' minutes')::interval
from generate_series(0, 239) i;

-- Work contacts: every 4th assignment has a snapshot — including scheduled / cancelled ones,
-- which must STILL not be released.
select app.assignment_contact_snapshot(
         ('c3000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         'Coord ' || i, '+2010555' || lpad(i::text, 5, '0'), case when i % 8 = 0 then 'c' || i || '@pgwork.example.test' end, 'job_contact')
from generate_series(0, 239) i where i % 4 = 0;

-- A second installer with two assignments of their own.
insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, status, published_at, created_by) values
  ('c1000000-0000-4000-8000-0000000b0001', :'org'::uuid, 'PGWORK B1', 'x', (select id from public.trades where key = 'painting'), 7000, 'awarded', now(), :'poster'::uuid),
  ('c1000000-0000-4000-8000-0000000b0002', :'org'::uuid, 'PGWORK B2', 'x', (select id from public.trades where key = 'painting'), 7000, 'awarded', now(), :'poster'::uuid);
insert into public.job_applications (id, job_id, applicant_user_id, status, decided_by, decided_at) values
  ('c2000000-0000-4000-8000-0000000b0001', 'c1000000-0000-4000-8000-0000000b0001', :'B'::uuid, 'accepted', :'poster'::uuid, now()),
  ('c2000000-0000-4000-8000-0000000b0002', 'c1000000-0000-4000-8000-0000000b0002', :'B'::uuid, 'accepted', :'poster'::uuid, now());
insert into public.job_assignments (id, job_id, application_id, installer_user_id, poster_org_id, agreed_amount, status) values
  ('c3000000-0000-4000-8000-0000000b0001', 'c1000000-0000-4000-8000-0000000b0001', 'c2000000-0000-4000-8000-0000000b0001', :'B'::uuid, :'org'::uuid, 7000, 'in_progress'),
  ('c3000000-0000-4000-8000-0000000b0002', 'c1000000-0000-4000-8000-0000000b0002', 'c2000000-0000-4000-8000-0000000b0002', :'B'::uuid, :'org'::uuid, 7000, 'completed');

-- Oracle: counts the expected figures straight from the base tables as the OWNER, so the
-- assertions made as `authenticated` have an independent source of truth to compare with.
create function public.zz_oracle(q text) returns int
language plpgsql security definer set search_path = '' as $$
declare r int;
begin
  execute q into r;
  return r;
end;
$$;
grant execute on function public.zz_oracle(text) to authenticated;

-- Test-only helpers: run SQL as the owner (to arrive / leave / re-rank rows while a caller is paging),
-- and WALK the pages of my_work_page by cursor exactly as the application does.
create function public.zz_exec(q text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  execute q;
end;
$$;
grant execute on function public.zz_exec(text) to authenticated;

create function public.zz_add(n int, created timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare j uuid := ('c1000000-0000-4000-8000-0000000d' || lpad(n::text, 4, '0'))::uuid;
begin
  insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, status, published_at, created_by)
  values (j, '9a000000-aaaa-4aaa-8aaa-000000000005', 'PGWORK D' || n, 'x', (select id from public.trades where key = 'painting'), 7000, 'awarded', now(), '70000006-0000-4000-8000-000000000006');
  insert into public.job_applications (id, job_id, applicant_user_id, status, decided_by, decided_at)
  values (('c2000000-0000-4000-8000-0000000d' || lpad(n::text, 4, '0'))::uuid, j, '71000006-0000-4000-8000-000000000006', 'accepted', '70000006-0000-4000-8000-000000000006', now());
  insert into public.job_assignments (id, job_id, application_id, installer_user_id, poster_org_id, agreed_amount, status, created_at)
  values (('c3000000-0000-4000-8000-0000000d' || lpad(n::text, 4, '0'))::uuid, j, ('c2000000-0000-4000-8000-0000000d' || lpad(n::text, 4, '0'))::uuid,
          '71000006-0000-4000-8000-000000000006', '9a000000-aaaa-4aaa-8aaa-000000000005', 7000, 'in_progress', created);
end;
$$;
grant execute on function public.zz_add(int, timestamptz) to authenticated;

create function public.zz_walk(p_sort text, p_size int, p_mutate_after int default null, p_mutation text default null,
                               p_states text[] default null, p_company text default null, p_contact text default 'all')
returns uuid[]
language plpgsql as $$
declare ids uuid[] := '{}'; r record; pages int := 0; got int; k1 timestamptz; k2 timestamptz; lid uuid;
begin
  loop
    got := 0;
    for r in select * from public.my_work_page(p_states, 'pgwork', p_company, null, null, p_contact, p_sort, p_size, k1, k2, lid) loop
      ids := ids || r.id;
      got := got + 1;
      lid := r.id;
      if p_sort = 'last-action' then k1 := r.last_progress_at; k2 := r.created_at; else k1 := r.created_at; k2 := null; end if;
    end loop;
    pages := pages + 1;
    exit when got < p_size;
    if p_mutation is not null and pages = p_mutate_after then
      perform public.zz_exec(p_mutation);
    end if;
  end loop;
  return ids;
end;
$$;
grant execute on function public.zz_walk(text, int, int, text, text[], text, text) to authenticated;

-- ===========================================================================
-- A. Shape and grants
-- ===========================================================================
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('my_work_page', 'my_work_counts', 'my_work_companies')
      and p.prosecdef and p.provolatile = 's'),
  3, 'the three readers are stable SECURITY DEFINER functions');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('my_work_page', 'my_work_counts', 'my_work_companies')
      and pg_get_function_arguments(p.oid) ilike '%user%'),
  0, 'none takes a user argument — they cannot be pointed at another professional''s work');
select is(has_function_privilege('anon', 'public.my_work_page(text[],text,text,date,date,text,text,integer,timestamptz,timestamptz,uuid)', 'execute'), false, 'anon cannot page work');
select is(has_function_privilege('authenticated', 'public.my_work_page(text[],text,text,date,date,text,text,integer,timestamptz,timestamptz,uuid)', 'execute'), true, 'authenticated can');
select is(has_function_privilege('anon', 'public.my_work_counts()', 'execute'), false, 'anon cannot count work');
select is(
  (select count(*)::int from pg_proc where proname = 'my_work_page' and prosrc ilike '%profiles%'),
  0, 'the page never reads a personal profile');

-- ===========================================================================
-- B. Oracles, computed from the base tables as the superuser
-- ===========================================================================
select set_config('t.def_total', (select count(*)::text from public.job_assignments a join public.jobs j on j.id = a.job_id
  where a.installer_user_id = :'A'::uuid and a.status in ('in_progress', 'completed') and j.title like 'PGWORK %'), true);
select cmp_ok(current_setting('t.def_total')::int, '>', 100, 'fixture: more than 100 in_progress + completed assignments exist (the old cap was 100)');

-- ===========================================================================
-- C. The caller
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is((select max(total_count)::int from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 6)),
  current_setting('t.def_total')::int, 'the exact total is the database''s count, not the size of the page');
select is((select count(*)::int from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 6)),
  6, 'a page holds exactly the requested rows');
select is((select count(distinct total_count)::int from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 50)),
  1, 'every row of a page carries the same exact total');
select is((select count(*)::int from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 6) where status not in ('in_progress', 'completed')),
  0, 'with no states given, ONLY in_progress + completed — "All your work"');
select is((select max(total_count)::int from public.my_work_page('{}', 'pgwork', null, null, null, 'all', 'default', 6)),
  current_setting('t.def_total')::int, 'an empty state list means the same default');

-- ---- KEYSET paging: walk the pages by cursor — nothing repeated, nothing skipped ----
select is(
  cardinality(public.zz_walk('default', 50)),
  current_setting('t.def_total')::int, 'walking the pages by cursor returns EXACTLY the filtered total — nothing skipped');
select is(
  (select count(distinct x)::int from unnest(public.zz_walk('default', 50)) x),
  current_setting('t.def_total')::int, 'and no row appears on two pages — nothing repeated');
select is(public.zz_walk('default', 7), (select array_agg(id) from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 300)),
  'default: paging by 7 yields the same rows in the same order as one 300-row read');
select is(public.zz_walk('recent-added', 7), (select array_agg(id) from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'recent-added', 300)),
  'recent-added: the cursor chain equals the single read');
select is(public.zz_walk('last-added', 7), (select array_agg(id) from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'last-added', 300)),
  'last-added: the cursor chain equals the single read');
select is(public.zz_walk('oldest-first', 7), (select array_agg(id) from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'oldest-first', 300)),
  'oldest-first: the cursor chain equals the single read');
select is(public.zz_walk('last-action', 7), (select array_agg(id) from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'last-action', 300)),
  'last-action (nullable key, then created_at, then id): the cursor chain equals the single read, including the never-reported rows');
select is(
  (select count(*)::int
     from (select id, created_at from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 300) order by created_at asc limit 1) l,
          lateral public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 6, l.created_at, null, l.id)),
  0, 'a cursor at the last row returns an empty page, not an error — and no exact total is needed to know it is the end');
select is(
  (select array_agg(job_title order by rn) from (select job_title, row_number() over () rn from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 100)) s where rn <= 3),
  array['PGWORK 001 painting', 'PGWORK 002 painting', 'PGWORK 003 painting'], 'the default order is newest first (000 is cancelled, so it is not in the default set)');
select is(
  (select count(*)::int from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 300)),
  current_setting('t.def_total')::int, 'a 300-row page returns everything this caller has — there is no 100-row ceiling');
select throws_ok($$select * from public.my_work_page(null, null, null, null, null, 'all', 'default', 302)$$, '22023', null, 'a page over 301 (300 rows + the look-ahead row) is refused');
select throws_ok($$select * from public.my_work_page(null, null, null, null, null, 'all', 'default', 0)$$, '22023', null, 'a page of zero is refused');
select throws_ok($$select * from public.my_work_page(null, null, null, null, null, 'all', 'default', 6, now(), null, null)$$, '22023', null, 'a cursor key with no id is refused');

-- ---- State ----
select is((select max(total_count)::int from public.my_work_page('{scheduled}', 'pgwork', null, null, null, 'all', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.job_assignments where installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and status = 'scheduled' and job_id::text like 'c1000000-%'$q$),
  'the scheduled view is reachable explicitly and counted exactly');
select is((select max(total_count)::int from public.my_work_page('{cancelled}', 'pgwork', null, null, null, 'all', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.job_assignments where installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and status = 'cancelled' and job_id::text like 'c1000000-%'$q$),
  'and so is cancelled');
select is((select max(total_count)::int from public.my_work_page('{scheduled,in_progress}', 'pgwork', null, null, null, 'all', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.job_assignments where installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and status in ('scheduled', 'in_progress') and job_id::text like 'c1000000-%'$q$),
  'the composite "current" view (scheduled + in progress) matches the base table');
select is((select max(total_count)::int from public.my_work_page('{in_progress}', 'pgwork', null, null, null, 'all', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.job_assignments where installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and status = 'in_progress' and job_id::text like 'c1000000-%'$q$),
  'a single state is exact');
select throws_ok($$select * from public.my_work_page('{done}', null, null, null, null, 'all', 'default', 6)$$, '22023', null, 'an unknown status is refused');

-- ---- Search ----
select is((select max(total_count)::int from public.my_work_page(null, 'pgwork 07', null, null, null, 'all', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.job_assignments a join public.jobs j on j.id = a.job_id
    where a.installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and a.status in ('in_progress', 'completed') and lower(j.title) like '%pgwork 07%'$q$),
  'search by title counts exactly');
select is((select max(total_count)::int from public.my_work_page(null, 'PGWORK 07', null, null, null, 'all', 'default', 6)),
  (select max(total_count)::int from public.my_work_page(null, 'pgwork 07', null, null, null, 'all', 'default', 6)),
  'search is case-insensitive');
select is((select count(*)::int from public.my_work_page(null, 'dokki', null, null, null, 'all', 'default', 300) where city = 'Dokki'),
  (select count(*)::int from public.my_work_page(null, 'dokki', null, null, null, 'all', 'default', 300)),
  'search reaches the job''s city');
select is((select max(total_count)::int from public.my_work_page(null, 'pgwork second org', null, null, null, 'all', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.job_assignments a where a.installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and a.status in ('in_progress', 'completed')
     and a.poster_org_id = current_setting('t.org2')::uuid and a.job_id::text like 'c1000000-%'$q$),
  'search reaches the organization name');
select is((select count(*)::int from public.my_work_page(null, '+201055500', null, null, null, 'all', 'default', 300)),
  public.zz_oracle($q$select count(*)::int from public.assignment_contacts c join public.job_assignments a on a.id = c.assignment_id
    where a.installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and a.status in ('in_progress', 'completed') and c.phone_e164 like '+201055500%'$q$),
  'search reaches the released contact phone — and only released contacts (scheduled / cancelled ones are not searchable)');
select is((select count(*)::int from public.my_work_page(null, '%', null, null, null, 'all', 'default', 300)), 0,
  'a "%" typed into the box is a literal character, not a wildcard');
select is((select count(*)::int from public.my_work_page(null, '_', null, null, null, 'all', 'default', 300)), 0,
  'and so is "_"');
select is((select count(*)::int from public.my_work_page(null, 'no-such-work-anywhere', null, null, null, 'all', 'default', 6)), 0, 'a search that matches nothing returns nothing');

-- ---- Company ----
select is((select max(total_count)::int from public.my_work_page(null, 'pgwork', 'PGWORK Second Org', null, null, 'all', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.job_assignments a where a.installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and a.status in ('in_progress', 'completed')
     and a.poster_org_id = current_setting('t.org2')::uuid and a.job_id::text like 'c1000000-%'$q$),
  'the company filter is an exact organization and counts exactly');
select is((select count(*)::int from public.my_work_page(null, 'pgwork', 'No Such Company', null, null, 'all', 'default', 6)), 0, 'an unknown company matches nothing');

-- ---- Planned range ----
select is(
  (select max(total_count)::int from public.my_work_page(null, 'pgwork', null, date '2027-02-01', date '2027-02-20', 'all', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.job_assignments a join public.jobs j on j.id = a.job_id
    where a.installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and a.status in ('in_progress', 'completed') and j.title like 'PGWORK %'
      and (j.starts_on is not null or j.ends_by is not null)
      and least(coalesce(j.starts_on, j.ends_by), coalesce(j.ends_by, j.starts_on)) <= date '2027-02-20'
      and greatest(coalesce(j.starts_on, j.ends_by), coalesce(j.ends_by, j.starts_on)) >= date '2027-02-01'$q$),
  'the planned-window range counts exactly (overlap, not containment)');
select is((select count(*)::int from public.my_work_page(null, 'pgwork', null, date '2027-02-01', date '2027-02-20', 'all', 'default', 300) where starts_on is null and ends_by is null),
  0, 'a job with NO planned dates is excluded while a date filter is active');
select is((select max(total_count)::int from public.my_work_page(null, 'pgwork', null, date '2027-03-01', null, 'all', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.job_assignments a join public.jobs j on j.id = a.job_id
    where a.installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and a.status in ('in_progress', 'completed') and j.title like 'PGWORK %'
      and (j.starts_on is not null or j.ends_by is not null)
      and greatest(coalesce(j.starts_on, j.ends_by), coalesce(j.ends_by, j.starts_on)) >= date '2027-03-01'$q$),
  'an open-ended range (from only) is honoured');
select is((select max(total_count)::int from public.my_work_page(null, 'pgwork', null, null, date '2027-01-10', 'all', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.job_assignments a join public.jobs j on j.id = a.job_id
    where a.installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and a.status in ('in_progress', 'completed') and j.title like 'PGWORK %'
      and (j.starts_on is not null or j.ends_by is not null)
      and least(coalesce(j.starts_on, j.ends_by), coalesce(j.ends_by, j.starts_on)) <= date '2027-01-10'$q$),
  'and so is "to" only');
select is((select max(total_count)::int from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 6)),
  current_setting('t.def_total')::int, 'with no range, rows without dates ARE included');

-- ---- Contact ----
select is((select max(total_count)::int from public.my_work_page(null, 'pgwork', null, null, null, 'available', 'default', 6)),
  public.zz_oracle($q$select count(*)::int from public.assignment_contacts c join public.job_assignments a on a.id = c.assignment_id
    where a.installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and a.status in ('in_progress', 'completed') and a.job_id::text like 'c1000000-%'$q$),
  'contact "available" counts exactly the released snapshots');
select is((select max(total_count)::int from public.my_work_page(null, 'pgwork', null, null, null, 'none', 'default', 6)),
  current_setting('t.def_total')::int - (select max(total_count)::int from public.my_work_page(null, 'pgwork', null, null, null, 'available', 'default', 6)),
  'contact "none" is the rest, so the two always add up to the whole');
select is((select count(*)::int from public.my_work_page('{scheduled,cancelled}', 'pgwork', null, null, null, 'all', 'default', 300) where contact_phone is not null or contact_email is not null),
  0, 'a scheduled / cancelled assignment NEVER carries a contact, even when a snapshot exists for it');
select is((select contact_phone from public.my_work_page(null, 'pgwork 004', null, null, null, 'all', 'default', 6) where job_title = 'PGWORK 004 painting'),
  '+201055500004'::text, 'a released contact carries its snapshotted phone');
select throws_ok($$select * from public.my_work_page(null, null, null, null, null, 'maybe', 'default', 6)$$, '22023', null, 'an unknown contact filter is refused');

-- ---- Sorting ----
select is((select job_title from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'oldest-first', 1)), 'PGWORK 238 painting', 'oldest-first starts with the oldest assignment in the default states');
select is((select job_title from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'last-added', 1)), 'PGWORK 238 painting', 'last-added is the same ascending order');
select is((select job_title from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'recent-added', 1)), 'PGWORK 001 painting', 'recent-added starts with the newest');
select is((select job_title from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'last-action', 1)), 'PGWORK 003 painting', 'last-action starts with the most recent progress report');
select is((select last_progress_at is null from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'last-action', 300) order by 1 desc limit 1),
  true, 'and assignments never reported on come last');
select throws_ok($$select * from public.my_work_page(null, null, null, null, null, 'all', 'random', 6)$$, '22023', null, 'an unknown sort is refused');

-- ---- Filters together, and paged ----
select is(
  cardinality(public.zz_walk('recent-added', 20, null, null, '{completed}', 'PGWORK Second Org', 'none')),
  (select max(total_count)::int from public.my_work_page('{completed}', 'pgwork', 'PGWORK Second Org', null, null, 'none', 'recent-added', 20)),
  'with several filters combined, the cursor chain still adds up to the exact total');

-- ---- Counts and companies ----
select is((select assignment_count::int from public.my_work_counts() where status = 'completed'),
  public.zz_oracle($q$select count(*)::int from public.job_assignments where installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and status = 'completed'$q$),
  'my_work_counts is an exact count per status (completed)');
select is((select sum(assignment_count)::int from public.my_work_counts()),
  public.zz_oracle($q$select count(*)::int from public.job_assignments where installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid$q$),
  'and the statuses add up to every assignment this caller has');
select ok((select count(*) from public.my_work_companies() where company in ('PGWORK Second Org')) = 1, 'the company options include the organizations this caller works with');
select is((select count(*)::int from public.my_work_companies() where company is null), 0, 'and never a blank');

-- ---- Rows arriving, leaving and moving BETWEEN pages (why this is a cursor, not an offset) ----
select set_config('t.orig', array_to_string(public.zz_walk('default', 300), ','), true);
select set_config('t.walk', array_to_string(public.zz_walk('default', 10, 2,
  $m$select public.zz_add(1, now() + interval '1 day'); select public.zz_add(2, now() - interval '100000 minutes'); delete from public.job_assignments where id = 'c3000000-0000-4000-8000-000000000001'$m$), ','), true);
select is((select count(distinct x)::int from unnest(string_to_array(current_setting('t.walk'), ',')) x), cardinality(string_to_array(current_setting('t.walk'), ',')),
  'default: with a row inserted ahead, one inserted behind and one shown row deleted between pages, no row is repeated');
select is((select count(*)::int from unnest(string_to_array(current_setting('t.orig'), ',')) o
            where o <> 'c3000000-0000-4000-8000-000000000001' and not (o = any (string_to_array(current_setting('t.walk'), ',')))), 0,
  'and no original row is skipped (an offset would have swallowed the neighbour of the deleted / inserted rows)');
select ok(not ('c3000000-0000-4000-8000-0000000d0001' = any (string_to_array(current_setting('t.walk'), ','))),
  'a row inserted AHEAD of the cursor is not shown by the walk already under way');
select is((select count(*)::int from unnest(string_to_array(current_setting('t.walk'), ',')) x where x = 'c3000000-0000-4000-8000-0000000d0002'), 1,
  'a row inserted BEHIND the cursor is picked up exactly once');
select set_config('t.walk2', array_to_string(public.zz_walk('last-action', 9, 2,
  $m$update public.job_assignments set last_progress_at = now() + interval '1 hour' where id in ('c3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000009')$m$), ','), true);
select is((select count(distinct x)::int from unnest(string_to_array(current_setting('t.walk2'), ',')) x), cardinality(string_to_array(current_setting('t.walk2'), ',')),
  'last-action: re-ranking rows between pages repeats nothing');
select is((select count(*)::int from unnest(string_to_array(current_setting('t.orig'), ',')) o
            where o not in ('c3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000009', 'c3000000-0000-4000-8000-000000000001')
              and not (o = any (string_to_array(current_setting('t.walk2'), ',')))), 0,
  'and skips no row that was not itself moved');
select public.zz_exec($m$update public.job_assignments set created_at = timestamptz '2027-06-01 10:00:00+00' where id in (select id from public.job_assignments where installer_user_id = '71000006-0000-4000-8000-000000000006'::uuid and job_id::text like 'c1000000-%' order by id limit 25)$m$);
select is(public.zz_walk('default', 2), (select array_agg(id) from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 300)),
  'EQUAL timestamps: 25 rows sharing one created_at, paged two at a time, come back in the single-read order — the id breaks every tie');
select is(public.zz_walk('oldest-first', 2), (select array_agg(id) from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'oldest-first', 300)),
  'EQUAL timestamps, ascending: the id breaks every tie in the sort''s own direction');

reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- D. Scope: another installer, and nobody
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select max(total_count)::int from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 300)), 2,
  'another installer pages ONLY their own two assignments');
select is((select count(*)::int from public.my_work_page(null, 'pgwork', null, null, null, 'all', 'default', 300) where job_title not like 'PGWORK B%'), 0,
  'and none of the first installer''s work appears for them');
select is((select sum(assignment_count)::int from public.my_work_counts()),
  public.zz_oracle($q$select count(*)::int from public.job_assignments where installer_user_id = '71000007-0000-4000-8000-000000000007'::uuid$q$), 'their counts are their own');
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select throws_ok($$select * from public.my_work_page(null, null, null, null, null, 'all', 'default', 6)$$, '42501', null, 'a caller with no identity is refused');
select is((select count(*)::int from public.my_work_counts()), 0, 'and counts nothing');
reset role;
set local request.jwt.claims = '';

set local role anon;
select throws_ok($$select * from public.my_work_page(null, null, null, null, null, 'all', 'default', 6)$$, '42501', null, 'anon is refused by privilege');
reset role;

select * from finish();
rollback;
