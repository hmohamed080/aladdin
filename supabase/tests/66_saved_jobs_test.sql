-- pgTAP: Installer Jobs — Saved Opportunities (public.saved_jobs).
--
-- A saved job is a PRIVATE bookmark. Everything below follows from that:
--   * the only owner is auth.uid() — no function takes a user id, so there is
--     nothing to spoof, and one user can neither read nor remove another's;
--   * the table is SELECT-only for clients, so every write is an RPC;
--   * anon reaches none of it;
--   * a job that stops being discoverable is KEPT but no longer listed as active.
--
-- Fixtures (seed-pilot):
--   70000006 — contractor persona, holds job.manage on Horizon Contracting
--   71000006 — installer A     71000007 — installer B
create extension if not exists pgtap;

begin;
select plan(30);

\set poster '70000006-0000-4000-8000-000000000006'
\set a      '71000006-0000-4000-8000-000000000006'
\set b      '71000007-0000-4000-8000-000000000007'
\set org    '9a000000-aaaa-4aaa-8aaa-000000000005'

-- ===========================================================================
-- A. Shape and grants
-- ===========================================================================
select has_table('public'::name, 'saved_jobs'::name, 'saved_jobs exists');
select col_is_pk('public'::name, 'saved_jobs'::name, array['user_id', 'job_id'],
  'the primary key is (user_id, job_id): a second save of the same job cannot be a second row');
select is(
  (select relrowsecurity from pg_class where oid = 'public.saved_jobs'::regclass),
  true, 'RLS is enabled');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'saved_jobs'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0, 'clients hold NO write privilege on the table — every write is an RPC');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'saved_jobs' and grantee = 'anon'),
  0, 'anon holds nothing on saved_jobs');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('job_save', 'job_unsave')
      and pg_get_function_arguments(p.oid) ilike '%user%'),
  0, 'neither RPC takes a user argument — the owner can only be auth.uid()');

-- ===========================================================================
-- B. Fixture: two published jobs from a verified poster
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.job1', public.job_create(
  :'org'::uuid, 'Saved-jobs fixture one', 'painting', 9000::numeric, 'Cladding.', 'Cairo', 'New Cairo', 'Street 9', 4::smallint)::text, true);
select set_config('t.job2', public.job_create(
  :'org'::uuid, 'Saved-jobs fixture two', 'painting', 7000::numeric, 'Floors.', 'Giza', 'Dokki', 'Street 1', 3::smallint)::text, true);
select public.job_publish(current_setting('t.job1')::uuid, 1);
select public.job_publish(current_setting('t.job2')::uuid, 1);
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- C. A saves, reads, unsaves
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_save(%L)$$, current_setting('t.job1')),
  'user A can save an open job');
select lives_ok(
  format($$select public.job_save(%L)$$, current_setting('t.job1')),
  'saving the same job again is safe (idempotent)');
select is((select count(*)::int from public.saved_jobs), 1,
  'and there is still exactly one row — duplicate save is unique');
select is((select user_id from public.saved_jobs limit 1), '71000006-0000-4000-8000-000000000006'::uuid,
  'the row is owned by the CALLER, derived from auth.uid()');
select is(
  (select count(*)::int from public.saved_job_opportunities where job_id = current_setting('t.job1')::uuid),
  1, 'the saved job is listed among the caller''s saved opportunities');

select throws_ok(
  format($$select public.job_save(%L)$$, '00000000-0000-4000-8000-00000000dead'),
  'P0002', null, 'an unknown job cannot be saved');

select lives_ok(
  format($$select public.job_save(%L)$$, current_setting('t.job2')),
  'a second job can be saved');
select is((select count(*)::int from public.saved_jobs), 2, 'A reads exactly their own two saved jobs');

select lives_ok(
  format($$select public.job_unsave(%L)$$, current_setting('t.job2')),
  'user A can unsave their own job');
select is((select count(*)::int from public.saved_jobs), 1, 'and it is gone');
select lives_ok(
  format($$select public.job_unsave(%L)$$, current_setting('t.job2')),
  'unsaving it again is a safe no-op');

-- A client cannot write the table directly, even for itself or for somebody else.
select throws_ok(
  format($$insert into public.saved_jobs (user_id, job_id) values ('71000006-0000-4000-8000-000000000006', %L)$$, current_setting('t.job2')),
  '42501', null, 'a direct INSERT is refused — there is no write grant');
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- D. B cannot see or touch A's saved jobs
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';

select is((select count(*)::int from public.saved_jobs), 0,
  'user B reads NONE of user A''s saved jobs (RLS)');
select is((select count(*)::int from public.saved_job_opportunities), 0,
  'nor through the saved-opportunities view');

select lives_ok(
  format($$select public.job_unsave(%L)$$, current_setting('t.job1')),
  'user B "unsaving" A''s job is accepted as a no-op …');
reset role;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.saved_jobs
    where user_id = '71000006-0000-4000-8000-000000000006' and job_id = current_setting('t.job1')::uuid),
  1, '… and A''s saved job is untouched — B cannot delete it');

-- Spoofing: the RPC has no user argument, so B saving a job saves it for B only.
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select lives_ok(
  format($$select public.job_save(%L)$$, current_setting('t.job1')),
  'B saves the job');
reset role;
set local request.jwt.claims = '';
select is(
  (select array_agg(user_id order by user_id::text) from public.saved_jobs where job_id = current_setting('t.job1')::uuid),
  array['71000006-0000-4000-8000-000000000006'::uuid, '71000007-0000-4000-8000-000000000007'::uuid],
  'each save belongs to whoever called it — there is no way to save on behalf of another user');

-- ===========================================================================
-- E. Anonymous
-- ===========================================================================
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  format($$select public.job_save(%L)$$, current_setting('t.job1')),
  '42501', null, 'anon cannot save a job');
select throws_ok(
  format($$select public.job_unsave(%L)$$, current_setting('t.job1')),
  '42501', null, 'anon cannot unsave a job');
select throws_ok($$select count(*) from public.saved_jobs$$, '42501', null, 'anon cannot read saved_jobs');
reset role;

-- ===========================================================================
-- F. A job that stops being discoverable is KEPT but not listed as active
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_close(current_setting('t.job1')::uuid,
  (select version from public.jobs where id = current_setting('t.job1')::uuid));
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.saved_jobs), 1,
  'the saved record is KEPT after the job closes');
select is((select count(*)::int from public.saved_job_opportunities), 0,
  'but it is no longer listed as an active opportunity');
select lives_ok(
  format($$select public.job_unsave(%L)$$, current_setting('t.job1')),
  'and the owner can still remove it');
reset role;
set local request.jwt.claims = '';

select * from finish();
rollback;
