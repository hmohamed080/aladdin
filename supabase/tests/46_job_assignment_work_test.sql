-- pgTAP: the assignment lifecycle, and the authority line running through it.
--
-- Increment 9 changes no status, adds no table and moves no lifecycle rule. It
-- adds one read projection and three notifications, so this file is about four
-- claims:
--
--   1. AN ASSIGNMENT IS A RECORD, NOT A SET OF UUIDS (§A). Three separate
--      policies stand between an installer and the context of their own work —
--      `organizations` is member-only, `trades` hides retired rows, and
--      `jobs_select_assigned_installer` drops out the moment an assignment is
--      cancelled. `my_job_assignments` answers past all three WITHOUT widening
--      any of them, and it is scoped to auth.uid() with no parameter.
--   2. THE RECORD OUTLIVES ITS SURROUNDINGS (§B, §E). A retired trade, a lapsed
--      poster verification and a cancelled engagement each remove something from
--      somebody's view. None of them may remove the installer's own history.
--   3. 100 PERCENT IS NOT COMPLETION (§C). The single most important assertion
--      in this file: the installer reports 100, the assignment stays
--      `in_progress`, the job stays `awarded`, and the installer is REFUSED when
--      they try to complete it. Completion is the posting organization's alone.
--   4. THE OTHER PARTY IS TOLD (§D). Three events, and each reaches the party
--      that did not cause it. `ready` goes to `job.manage` holders because that
--      is the capability the only possible response requires; `completed` and
--      the installer-facing `cancelled` go to one named column.
create extension if not exists pgtap;

begin;
select plan(65);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

-- Fixtures, all seeded:
--   Sayed    71000006-…06  installer, marble
--   Mahmoud  71000007-…07  installer, electrical only
--   Poster   70000006-…06  job.post + job.manage in org 9a000000-…05
--   Job 1    f1000001-…01  open, marble_granite
--   Job 2    f1000002-…02  draft, plumbing

-- ===========================================================================
-- A. The projection — my own work, and nobody else's
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit(
      'f1000001-0000-4000-8000-000000000001', 'Available from Sunday.')$$,
  'the installer applies');

set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_accept(
      (select id from public.job_applications
        where applicant_user_id = '71000006-0000-4000-8000-000000000006'))$$,
  'and the organization awards them the work');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select count(*) from public.my_job_assignments)::int,
  1, 'the assignment appears on the installer''s own surface');

-- THE THREE THINGS THE PROJECTION EXISTS FOR. Each is asserted beside the
-- policy that would otherwise withhold it, because the assertion means nothing
-- without the contrast.
select is(
  (select poster_org_name from public.my_job_assignments),
  'Horizon Contracting',
  'it names the organization that hired them');

select is(
  (select count(*) from public.organizations
    where id = '9a000000-aaaa-4aaa-8aaa-000000000005')::int,
  0, 'WHICH THEY CANNOT READ DIRECTLY — organizations is member-only, and they are not a member');

select is(
  (select job_title from public.my_job_assignments),
  'Marble staircase cladding - Fifth Settlement',
  'and it carries the job itself');

-- §11: the address is released to the professional who holds the work.
select is(
  (select site_address from public.my_job_assignments),
  '12 Street 90, Fifth Settlement',
  'the site address IS released to the assigned professional while the work is live');

set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is(
  (select count(*) from public.my_job_assignments)::int,
  0, 'another installer sees none of it — the projection is scoped to auth.uid()');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.my_job_assignments$$,
  '42501', null, 'anon cannot read it at all');

reset role;
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'my_job_assignments'
      and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))::int,
  0, 'and no client role can write through it — every move is still an RPC');

select ok(
  (select p.proconfig @> array['search_path=""'] and p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_my_job_assignments'),
  'the reader is SECURITY DEFINER with search_path pinned empty');

-- The column list is asserted in full, because the risk this projection carries
-- is a column added later "while we are here". `collate "C"` because
-- information_schema.columns.column_name is collation C and the database's
-- default provider is ICU — comparing it to a bare literal aborts the
-- transaction rather than failing one assertion.
select is(
  (select array_agg(c.n order by c.n) from (
     select column_name::text collate "C" as n
       from information_schema.columns
      where table_schema = 'public' and table_name = 'my_job_assignments') c),
  array['agreed_amount', 'agreed_currency', 'application_id', 'cancellation_reason',
        'cancelled_at', 'city', 'completed_at', 'created_at', 'ends_by',
        'expected_duration_days', 'governorate', 'id', 'job_description', 'job_id',
        'job_status', 'job_title', 'last_progress_at', 'latest_progress_percent',
        'poster_org_name', 'published_at', 'site_address', 'started_at', 'starts_on',
        'status', 'trade_is_active', 'trade_key', 'version'],
  'the projected column list is exactly these twenty-seven');

-- O5 again, structurally, on the surface it would be easiest to lose it: nothing
-- about the work a professional HOLDS is derived from the trades they declared.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_my_job_assignments'
      and p.prosrc like '%user_trades%')::int,
  0, 'the assignment projection does not read user_trades either (O5)');

-- ===========================================================================
-- B. The record outlives its surroundings
-- ===========================================================================
update public.trades set is_active = false where key = 'marble_granite';
update public.organizations set is_verified = false
  where id = '9a000000-aaaa-4aaa-8aaa-000000000005';

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select trade_key from public.my_job_assignments),
  'marble_granite', 'a trade retired afterwards still labels the work it was agreed as');

select is(
  (select trade_is_active from public.my_job_assignments),
  false, 'and the projection says plainly that it is retired');

select is(
  (select count(*) from public.trades where key = 'marble_granite')::int,
  0, 'while the retired trade stays invisible in the live catalog (not widened)');

select is(
  (select poster_org_name from public.my_job_assignments),
  'Horizon Contracting',
  'a poster whose verification lapses does not become anonymous on work already awarded');

reset role;
update public.trades set is_active = true where key = 'marble_granite';
update public.organizations set is_verified = true
  where id = '9a000000-aaaa-4aaa-8aaa-000000000005';

-- ===========================================================================
-- C. The lifecycle, and the line the installer cannot cross
-- ===========================================================================
-- The id is captured HERE, as superuser, and every refusal below is asserted
-- against it. Resolving it inside each caller's own session would have made the
-- test weaker than it looks: `job_assignments_select_installer` hides another
-- professional's row entirely, so a subquery would return null and the RPC would
-- answer "assignment not found" — a pass that proves the SUBQUERY was blocked
-- and says nothing about the function's own authorization.
reset role;
select set_config('test.aid', (select id::text from public.job_assignments limit 1), true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select throws_ok(
  $$select public.job_assignment_start(current_setting('test.aid')::uuid, 1)$$,
  '42501', null,
  'another installer handed the id outright STILL cannot start work that is not theirs');

set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  $$select public.job_assignment_start(current_setting('test.aid')::uuid, 1)$$,
  '42501', null, 'and neither can the posting organization — starting is the professional''s move');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_assignment_start(
      current_setting('test.aid')::uuid, 1)$$,
  'the assigned professional starts the work');

select is(
  (select status::text from public.my_job_assignments),
  'in_progress', 'and the assignment moves scheduled -> in_progress');

select isnt(
  (select started_at from public.my_job_assignments),
  null, 'with a start time stamped by the database');

select lives_ok(
  $$select public.job_progress_add(
      current_setting('test.aid')::uuid, 25::smallint, 'Base course', 'Ground floor done.')$$,
  'they report progress');

select is(
  (select latest_progress_percent from public.my_job_assignments)::int,
  25, 'and the summary agrees with the history in the same transaction');

select is(
  (select count(*) from public.job_progress_updates)::int,
  1, 'the history has exactly the one report');

-- §16. THE ASSERTION THIS FILE EXISTS FOR.
select throws_ok(
  $$select public.job_assignment_complete(
      current_setting('test.aid')::uuid, 2)$$,
  '42501', null,
  'THE INSTALLER CANNOT COMPLETE THEIR OWN WORK — that is the posting organization''s alone');

select lives_ok(
  $$select public.job_progress_add(
      current_setting('test.aid')::uuid, 100::smallint, 'Finishing', 'Ready for inspection.')$$,
  'they report 100 percent');

-- §14, three ways. Reaching 100 is a CLAIM and it moves nothing.
select is(
  (select status::text from public.my_job_assignments),
  'in_progress', 'AT 100 PERCENT THE ASSIGNMENT IS STILL in_progress — 100 is not completion');

select is(
  (select job_status::text from public.my_job_assignments),
  'awarded', 'and the job is still awarded, not completed');

select is(
  (select completed_at from public.my_job_assignments),
  null, 'with no completion timestamp, because nobody has confirmed anything');

select throws_ok(
  $$select public.job_assignment_complete(
      current_setting('test.aid')::uuid, 2)$$,
  '42501', null, 'and the installer is still refused completion at 100 percent');

-- ===========================================================================
-- D. Telling the other party
-- ===========================================================================
reset role;
select is(
  (select count(*) from public.notifications where event_type = 'job.assignment.ready')::int,
  1, 'reaching 100 tells the organization exactly once');

select is(
  (select recipient_user_id from public.notifications
    where event_type = 'job.assignment.ready'),
  '70000006-0000-4000-8000-000000000006'::uuid,
  'and the recipient is the job.manage holder — the only person who can respond to it');

select is(
  (select deep_link from public.notifications where event_type = 'job.assignment.ready'),
  '/b2b/jobs/f1000001-0000-4000-8000-000000000001',
  'it opens the job the work belongs to');

-- A TRANSITION, not a value: a second report at 100 announces nothing new.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_progress_add(
      current_setting('test.aid')::uuid, 100::smallint, null, 'Adding a note.')$$,
  'the professional reports 100 a second time');

reset role;
select is(
  (select count(*) from public.notifications where event_type = 'job.assignment.ready')::int,
  1, 'and the organization is NOT told twice — the notice is on the transition, not the value');

-- The posting organization confirms.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_assignment_complete(
      current_setting('test.aid')::uuid, 2)$$,
  'THE POSTING ORGANIZATION CONFIRMS COMPLETION');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select status::text from public.my_job_assignments),
  'completed', 'the assignment is completed');

select is(
  (select job_status::text from public.my_job_assignments),
  'completed', 'and the job followed it, in the same transaction');

select is(
  (select job_title from public.my_job_assignments),
  'Marble staircase cladding - Fifth Settlement',
  'the finished work stays a legible historical record');

reset role;
select is(
  (select count(*) from public.notifications where event_type = 'job.assignment.completed')::int,
  1, 'one completion notice');

select is(
  (select recipient_user_id from public.notifications
    where event_type = 'job.assignment.completed'),
  '71000006-0000-4000-8000-000000000006'::uuid,
  'AND IT GOES TO THE INSTALLER — the one lifecycle event they cannot cause and could not predict');

select is(
  (select deep_link from public.notifications where event_type = 'job.assignment.completed'),
  '/home/work/' || current_setting('test.aid'),
  'opening their own work record');

-- ===========================================================================
-- E. Cancellation — either party, and history survives it
-- ===========================================================================
-- A second engagement on the draft job, so the terminal states do not collide.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_publish('f1000002-0000-4000-8000-000000000002', 1)$$,
  'the organization publishes a second opening');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit('f1000002-0000-4000-8000-000000000002', null)$$,
  'one professional applies');

set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit('f1000002-0000-4000-8000-000000000002', null)$$,
  'and so does another');

-- Awarding it auto-rejects the sibling, which is the state §17 protects.
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_accept(
      (select id from public.job_applications
        where job_id = 'f1000002-0000-4000-8000-000000000002'
          and applicant_user_id = '71000007-0000-4000-8000-000000000007'))$$,
  'the organization awards it to one of them');

-- The INSTALLER walks away.
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select lives_ok(
  $$select public.job_assignment_cancel(
      (select id from public.job_assignments
        where job_id = 'f1000002-0000-4000-8000-000000000002'), 1,
      'A family emergency has taken me out of Cairo.')$$,
  'the assigned professional cancels — either party may (Increment 6)');

reset role;
select is(
  (select status::text from public.jobs
    where id = 'f1000002-0000-4000-8000-000000000002'),
  'open', 'THE OPENING RETURNS TO THE POOL');

select is(
  (select status::text from public.job_applications
    where job_id = 'f1000002-0000-4000-8000-000000000002'
      and applicant_user_id = '71000006-0000-4000-8000-000000000006'),
  'rejected',
  'and the applicant already declined stays declined — they are not silently re-entered');

select is(
  (select count(*) from public.notifications
    where event_type = 'job.assignment.cancelled'
      and recipient_user_id = '70000006-0000-4000-8000-000000000006')::int,
  1, 'the organization is told, because it was not the party that cancelled');

-- §19. The cancelled engagement is still the installer's record, and this is
-- exactly where the base-table policy stops answering.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is(
  (select count(*) from public.jobs
    where id = 'f1000002-0000-4000-8000-000000000002')::int,
  0, 'the JOB row closes to them — jobs_select_assigned_installer excludes cancelled assignments');

select is(
  (select job_title from public.my_job_assignments
    where job_id = 'f1000002-0000-4000-8000-000000000002'),
  'Bathroom sanitary fitting - Maadi handover',
  'AND THE RECORD SURVIVES ANYWAY — which is what the projection is for');

select is(
  (select poster_org_name from public.my_job_assignments
    where job_id = 'f1000002-0000-4000-8000-000000000002'),
  'Horizon Contracting', 'with the organization still named');

select is(
  (select cancellation_reason from public.my_job_assignments
    where job_id = 'f1000002-0000-4000-8000-000000000002'),
  'A family emergency has taken me out of Cairo.',
  'and the reason kept, so the record says what happened rather than merely that it ended');

-- ...but the one column §11 protects is withheld again, exactly as the base
-- policy would have.
select is(
  (select site_address from public.my_job_assignments
    where job_id = 'f1000002-0000-4000-8000-000000000002'),
  null, 'while the site address is withheld again — the projection is not wider than the policy');

select is(
  (select count(*) from public.my_job_assignments)::int,
  1, 'and they still see only their own assignment, cancelled or not');

-- A REOPENED JOB IS NOT A SECOND CHANCE FOR SOMEBODY ALREADY DECLINED, and this
-- falls out of Increment 6 rather than being added here: job_application_submit
-- revives a `withdrawn` row and is IDEMPOTENT for every other state, so a
-- declined professional who applies again silently gets their own decided row
-- back. The reopening genuinely offers the work to people who have not been
-- answered yet, and to nobody else.
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select public.job_application_submit('f1000002-0000-4000-8000-000000000002', null)),
  (select id from public.job_applications
    where job_id = 'f1000002-0000-4000-8000-000000000002'
      and applicant_user_id = '71000006-0000-4000-8000-000000000006'),
  'a declined professional applying to the reopened job gets their decided row back, unchanged');

select is(
  (select status::text from public.job_applications
    where job_id = 'f1000002-0000-4000-8000-000000000002'
      and applicant_user_id = '71000006-0000-4000-8000-000000000006'),
  'rejected', 'still rejected — the reopening did not quietly revive it');

-- The other direction: the ORGANIZATION ends an engagement, and the installer is
-- the one told. It needs an opening neither professional has been answered on,
-- so the fixture makes one.
reset role;
insert into public.jobs (
  id, poster_org_id, poster_branch_id, title, description, trade_id,
  offered_amount, governorate, city, site_address, expected_duration_days,
  status, version, published_at, created_by)
select 'f1000003-0000-4000-8000-000000000003', '9a000000-aaaa-4aaa-8aaa-000000000005',
       'b0000005-0000-4000-8000-000000000005',
       'Electrical second fix - Sheikh Zayed', 'Second fix across two floors.',
       t.id, 9000.00, 'Giza', 'Sheikh Zayed', '4 Beverly Hills, Sheikh Zayed',
       7::smallint, 'open'::public.job_status, 1, now(),
       '70000006-0000-4000-8000-000000000006'
  from public.trades t where t.key = 'electrical';

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit('f1000003-0000-4000-8000-000000000003', null)$$,
  'a professional applies to a third opening');

set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_accept(
      (select id from public.job_applications
        where job_id = 'f1000003-0000-4000-8000-000000000003'))$$,
  'and is awarded it');

select lives_ok(
  $$select public.job_assignment_cancel(
      (select id from public.job_assignments
        where job_id = 'f1000003-0000-4000-8000-000000000003'), 1,
      'The client has postponed the handover.')$$,
  'this time the ORGANIZATION ends the assignment');

reset role;
select is(
  (select count(*) from public.notifications
    where event_type = 'job.assignment.cancelled'
      and recipient_user_id = '71000006-0000-4000-8000-000000000006')::int,
  1, 'and the professional is the one told, with the reason carried');

select is(
  (select count(*) from public.notifications
    where event_type = 'job.assignment.cancelled'
      and params->>'reason' = 'The client has postponed the handover.')::int,
  1, 'the reason travels in the notice, because there is no other route to it');

-- Nothing in this domain notified anybody outside the two parties and the
-- posting organization's job.manage holders.
select is(
  (select count(*) from public.notifications n
    where n.event_type like 'job.assignment.%'
      and n.recipient_user_id not in (
        '71000006-0000-4000-8000-000000000006'::uuid,
        '71000007-0000-4000-8000-000000000007'::uuid,
        '70000006-0000-4000-8000-000000000006'::uuid))::int,
  0, 'and no assignment notice reached anybody who was not a party to it');

select * from finish();
rollback;
