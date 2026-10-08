-- pgTAP: a published job ALWAYS has a publication time, and it is IMMUTABLE once set (20261007090007).
--
-- The real lifecycle: draft -> open | cancelled ; open -> awarded | closed | cancelled ; awarded -> completed | open.
-- So: draft = never published (published_at may be NULL) · open / awarded = published now · closed / completed = only ever
-- reached after publication · cancelled = legal BEFORE publication (from draft) and AFTER it (from open).
-- Hence a CHECK for the four states that imply publication, plus a guard that published_at, once set, can be neither
-- cleared nor changed (which covers a published job that is later cancelled).
create extension if not exists pgtap;

begin;
select plan(32);

\set org    '9a000000-aaaa-4aaa-8aaa-000000000005'
\set poster '70000006-0000-4000-8000-000000000006'

create function pg_temp.ins(p_status text, p_pub timestamptz, p_created timestamptz default now()) returns uuid language sql as $$
  insert into public.jobs (poster_org_id, title, description, trade_id, offered_amount, governorate, city, status, published_at, created_at, created_by)
  values ('9a000000-aaaa-4aaa-8aaa-000000000005', 'PI ' || p_status, 'x', (select id from public.trades where key = 'painting'), 5000, 'Cairo', 'New Cairo',
          p_status::public.job_status, p_pub, p_created, '70000006-0000-4000-8000-000000000006') returning id
$$;

-- ---------------------------------------------------------------------------
-- A. The constraint itself
-- ---------------------------------------------------------------------------
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_jobs_published_at_after_publication' and conrelid = 'public.jobs'::regclass),
  $c$CHECK (((status <> ALL (ARRAY['open'::job_status, 'awarded'::job_status, 'closed'::job_status, 'completed'::job_status])) OR (published_at IS NOT NULL)))$c$,
  'the CHECK: open / awarded / closed / completed require a published_at');

select lives_ok($q$ select pg_temp.ins('draft', null) $q$, 'a never-published DRAFT may have published_at NULL');
select throws_ok($q$ select pg_temp.ins('open', null) $q$, '23514', null, 'an OPEN job cannot be inserted without a publication time');
select throws_ok($q$ select pg_temp.ins('awarded', null) $q$, '23514', null, 'an AWARDED job cannot be inserted without a publication time');
select throws_ok($q$ select pg_temp.ins('closed', null) $q$, '23514', null, 'a CLOSED job (only ever reached after publication) cannot lack one');
select throws_ok($q$ select pg_temp.ins('completed', null) $q$, '23514', null, 'a COMPLETED job (only ever reached after publication) cannot lack one');
select lives_ok($q$ select pg_temp.ins('open', timestamptz '2027-01-01 00:00:00+00') $q$, 'with a publication time each of those is accepted');

-- A draft cannot become published without one, whoever writes the UPDATE.
select set_config('t.d', pg_temp.ins('draft', null)::text, true);
select throws_ok($q$ update public.jobs set status = 'open' where id = current_setting('t.d')::uuid $q$, '23514', null,
  'a service-role style UPDATE draft -> open that forgets published_at is refused');
select lives_ok($q$ update public.jobs set status = 'open', published_at = now() where id = current_setting('t.d')::uuid $q$,
  'the same UPDATE with a publication time is accepted: NULL -> value is the initial publication');

-- ---------------------------------------------------------------------------
-- B. The guard: once set, published_at is immutable. cancelled is legal BEFORE and AFTER publication.
-- ---------------------------------------------------------------------------
select set_config('t.c1', pg_temp.ins('draft', null)::text, true);
select lives_ok($q$ update public.jobs set status = 'cancelled' where id = current_setting('t.c1')::uuid $q$,
  'draft -> cancelled with NO publication time is legal (it was never published)');
select is((select published_at from public.jobs where id = current_setting('t.c1')::uuid), null, 'and it stays NULL — nothing invents one');

select set_config('t.c2', pg_temp.ins('open', timestamptz '2027-02-02 12:00:00+00')::text, true);
select lives_ok($q$ update public.jobs set status = 'cancelled' where id = current_setting('t.c2')::uuid $q$, 'open -> cancelled is legal');
select is((select published_at from public.jobs where id = current_setting('t.c2')::uuid), timestamptz '2027-02-02 12:00:00+00',
  'open -> cancelled preserves EXACTLY the original publication time');
select throws_ok($q$ update public.jobs set published_at = null where id = current_setting('t.c2')::uuid $q$, '23514', null,
  'non-NULL -> NULL is refused on a cancelled job that was published');
select throws_ok($q$ update public.jobs set published_at = null where id = current_setting('t.d')::uuid $q$, '23514', null,
  'non-NULL -> NULL is refused on an open job');
select throws_ok($q$ update public.jobs set published_at = timestamptz '2027-02-03 12:00:00+00' where id = current_setting('t.c2')::uuid $q$, '23514', null,
  'non-NULL -> a DIFFERENT value is refused (a published job cannot be moved, even to a later time)');
select throws_ok($q$ update public.jobs set published_at = now() + interval '1 day' where id = current_setting('t.d')::uuid $q$, '23514', null,
  'a published job cannot be made to look newly published either (no implicit republish)');
select lives_ok($q$ update public.jobs set published_at = published_at, title = 'PI same value' where id = current_setting('t.c2')::uuid $q$,
  'non-NULL -> the SAME value is allowed (an UPDATE that leaves it unchanged)');

-- ---------------------------------------------------------------------------
-- C. Product semantics are unchanged: only job_publish sets it; edits and status moves preserve it
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.p', public.job_create(:'org'::uuid, 'PI published', 'painting', 5000::numeric, 'x', 'Cairo', 'New Cairo', null, 3::smallint)::text, true);
select is((select published_at from public.jobs where id = current_setting('t.p')::uuid), null, 'job_create makes a draft with NO publication time');
select public.job_publish(current_setting('t.p')::uuid, 1);
reset role;
set local request.jwt.claims = '';
select ok((select published_at from public.jobs where id = current_setting('t.p')::uuid) between now() - interval '1 minute' and now(),
  'job_publish (NULL -> value) sets published_at to now');
select set_config('t.pub', (select published_at::text from public.jobs where id = current_setting('t.p')::uuid), true);
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_update(current_setting('t.p')::uuid, (select version from public.jobs where id = current_setting('t.p')::uuid), 'PI published (edited)', 'painting', 5000::numeric, 'edited');
select is((select published_at::text from public.jobs where id = current_setting('t.p')::uuid), current_setting('t.pub'), 'an ordinary job_update leaves published_at unchanged');
select public.job_close(current_setting('t.p')::uuid, (select version from public.jobs where id = current_setting('t.p')::uuid));
reset role;
set local request.jwt.claims = '';
select is((select published_at::text from public.jobs where id = current_setting('t.p')::uuid), current_setting('t.pub'),
  'open -> closed preserves exactly the original timestamp');

select set_config('t.aw', pg_temp.ins('open', timestamptz '2027-04-04 04:04:04+00')::text, true);
update public.jobs set status = 'awarded' where id = current_setting('t.aw')::uuid;
select is((select published_at from public.jobs where id = current_setting('t.aw')::uuid), timestamptz '2027-04-04 04:04:04+00', 'open -> awarded preserves it');
update public.jobs set status = 'open' where id = current_setting('t.aw')::uuid;
select is((select published_at from public.jobs where id = current_setting('t.aw')::uuid), timestamptz '2027-04-04 04:04:04+00',
  'awarded -> open preserves exactly the original timestamp (and does not republish)');

-- the final schema carries no migration-only helper, and the guard is in place
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.proname ilike '%backfill%' and n.nspname in ('app', 'public')), 0,
  'no backfill-only helper function is left in the runtime schema');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.jobs'::regclass and tgname = 'jobs_published_at_immutable' and not tgisinternal), 1,
  'the immutability guard trigger exists on public.jobs');

-- ---------------------------------------------------------------------------
-- D. The migration's backfill semantics: created_at, and nothing else
--    (the migration runs its UPDATE inline; this mirrors that statement against rows the final constraint now forbids)
-- ---------------------------------------------------------------------------
alter table public.jobs drop constraint ck_jobs_published_at_after_publication;   -- rebuild "legacy" rows
create temp table legacy as
select t.s as status, pg_temp.ins(t.s, null, ('2026-01-0' || t.n || ' 08:00:00+00')::timestamptz) as id
  from (select s, row_number() over () as n from unnest(array['open', 'awarded', 'closed', 'completed', 'draft', 'cancelled']) s) t;
select set_config('t.keep', pg_temp.ins('open', timestamptz '2026-06-06 06:06:06+00', timestamptz '2026-01-01 00:00:00+00')::text, true);
create temp table upd_before as select id, updated_at from public.jobs where id in (select id from legacy);

alter table public.jobs disable trigger set_jobs_updated_at;
create temp table repaired as
with u as (
  update public.jobs set published_at = created_at
   where published_at is null and status in ('open', 'awarded', 'closed', 'completed')
  returning id
) select id from u;
alter table public.jobs enable trigger set_jobs_updated_at;

select is((select count(*)::int from repaired), 4, 'the backfill repairs exactly the four post-publication rows that lacked a publication time (and passes the immutability guard)');
select is((select count(*)::int from legacy l join public.jobs j on j.id = l.id where l.status in ('open', 'awarded', 'closed', 'completed') and j.published_at = j.created_at), 4,
  'each one got its own created_at (deterministic — not now())');
select is((select count(*)::int from legacy l join public.jobs j on j.id = l.id where l.status in ('draft', 'cancelled') and j.published_at is null), 2,
  'a draft and a cancelled job that may never have been published are left alone');
select is((select published_at from public.jobs where id = current_setting('t.keep')::uuid), timestamptz '2026-06-06 06:06:06+00',
  'an existing non-null published_at is never overwritten');
select is((select count(*)::int from upd_before b join public.jobs j on j.id = b.id where j.updated_at is distinct from b.updated_at), 0,
  'a data repair is not an edit: updated_at was not bumped');
alter table public.jobs add constraint ck_jobs_published_at_after_publication
  check (status not in ('open', 'awarded', 'closed', 'completed') or published_at is not null);   -- validates every row
select pass('after the backfill every row satisfies the constraint again (it re-adds and validates cleanly)');

select * from finish();
rollback;
