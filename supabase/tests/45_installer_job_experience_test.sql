-- pgTAP: the installer's own view of Jobs, and who gets told what.
--
-- Increment 8 adds no lifecycle rule. It extends one projection and wires two
-- notifications, so this file is about three claims and nothing else:
--
--   1. AN APPLICATION OUTLIVES ITS OPENING (§A). The moment a job is awarded to
--      somebody else, closed, cancelled, or its poster's verification lapses, it
--      leaves `open_job_opportunities` — and the applicant must still be able to
--      read the thing they applied to, description and all. That is the whole
--      reason `my_job_applications` exists separately, and the five columns
--      added here are what make it a record rather than a summary line.
--   2. O5 IS STILL NOT AN AUTHORIZATION RULE (§B). Mahmoud's only declared trade
--      is `electrical`. He must see a `marble_granite` job, and apply to it, and
--      succeed. This is asserted behaviourally AND structurally, because the
--      failure mode is a filter someone adds later believing it is a feature.
--   3. A DECISION REACHES EXACTLY ONE PERSON (§C). Accept and reject now notify,
--      and the recipient of every notice is the applicant it is about. The
--      accept path also closes every sibling candidacy — each of those people is
--      told too, and none of them learns anything about the others.
create extension if not exists pgtap;

begin;
select plan(33);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

-- ===========================================================================
-- A. The applicant's own record
-- ===========================================================================
-- Sayed applies to the seeded OPEN marble job.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit(
      'f1000001-0000-4000-8000-000000000001', 'Available from Sunday.')$$,
  'an installer applies to an open job');

select is(
  (select count(*) from public.open_job_opportunities
    where id = 'f1000001-0000-4000-8000-000000000001')::int,
  1, 'and the opening is discoverable while it is open and its poster verified');

select is(
  (select has_applied from public.open_job_opportunities
    where id = 'f1000001-0000-4000-8000-000000000001'),
  true, 'discovery marks it as one they have already applied to');

select is(
  (select job_description from public.my_job_applications
    where job_id = 'f1000001-0000-4000-8000-000000000001'),
  'Cladding a villa staircase from ground to first floor, including nosings and skirting. Materials supplied on site.',
  'their own record carries the job description (added by Increment 8)');

-- NOW TAKE THE OPENING AWAY. Withdrawing the poster's verification is the
-- gentlest of the five ways a job leaves discovery, and the only one that
-- rewrites no job row at all — which is exactly why it is the one worth testing.
reset role;
update public.organizations set is_verified = false
  where id = '9a000000-aaaa-4aaa-8aaa-000000000005';
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.open_job_opportunities
    where id = 'f1000001-0000-4000-8000-000000000001')::int,
  0, 'THE OPENING VANISHES FROM DISCOVERY when the poster loses verification');

select is(
  (select count(*) from public.my_job_applications
    where job_id = 'f1000001-0000-4000-8000-000000000001')::int,
  1, 'AND THE APPLICATION DOES NOT — the applicant keeps their own record');

select is(
  (select job_title from public.my_job_applications
    where job_id = 'f1000001-0000-4000-8000-000000000001'),
  'Marble staircase cladding - Fifth Settlement',
  'with the job still fully legible: title');

select isnt(
  (select job_description from public.my_job_applications
    where job_id = 'f1000001-0000-4000-8000-000000000001'),
  null, 'description');

select is(
  (select expected_duration_days from public.my_job_applications
    where job_id = 'f1000001-0000-4000-8000-000000000001')::int,
  14, 'expected duration');

select isnt(
  (select published_at from public.my_job_applications
    where job_id = 'f1000001-0000-4000-8000-000000000001'),
  null, 'and when it was published');

-- A retired trade keeps its historical label here, for the same reason
-- `job_trade_labels` exists on the poster side: the definer reads `trades`
-- without `trades_select_active` in the way.
reset role;
update public.trades set is_active = false where key = 'marble_granite';
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select trade_key from public.my_job_applications
    where job_id = 'f1000001-0000-4000-8000-000000000001'),
  'marble_granite', 'a trade retired later still labels the historical application');
select is(
  (select count(*) from public.trades where key = 'marble_granite')::int,
  0, 'while the retired trade stays invisible in the catalog they filter with');

reset role;
update public.trades set is_active = true where key = 'marble_granite';
update public.organizations set is_verified = true
  where id = '9a000000-aaaa-4aaa-8aaa-000000000005';

-- Nobody else reads it, and it still withholds the site address.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is(
  (select count(*) from public.my_job_applications)::int,
  0, 'another installer sees none of it — the projection is scoped to auth.uid()');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.my_job_applications$$,
  '42501', null, 'anon cannot read it at all');

reset role;
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'my_job_applications'
      and column_name ~ 'site_address|created_by|version|closed_at|decided_by')::int,
  0, 'and the widening added no site address and no poster-side management column');

select is(
  (select array_agg(c.n order by c.n) from (
     select column_name::text collate "C" as n
       from information_schema.columns
      where table_schema = 'public' and table_name = 'my_job_applications') c),
  array['city', 'created_at', 'decided_at', 'decision_reason', 'ends_by',
        'expected_duration_days', 'governorate', 'id', 'job_description', 'job_id',
        'job_status', 'job_title', 'note', 'offered_amount', 'offered_currency',
        'poster_org_name', 'published_at', 'starts_on', 'status', 'trade_key'],
  'the projected column list is exactly these twenty');

select ok(
  (select p.proconfig @> array['search_path=""'] and p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_my_job_applications'),
  'the reader is still SECURITY DEFINER with search_path pinned empty');

select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'my_job_applications'
      and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))::int,
  0, 'no client role can write through it — the DROP+CREATE reasserted grants correctly');

-- ===========================================================================
-- B. O5 — a declared trade is not a gate, on the installer's side either
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';

select is(
  (select count(*) from public.user_trades ut join public.trades t on t.id = ut.trade_id
    where ut.user_id = '71000007-0000-4000-8000-000000000007' and t.key = 'marble_granite')::int,
  0, 'Mahmoud has not declared marble & granite');

select is(
  (select count(*) from public.open_job_opportunities
    where id = 'f1000001-0000-4000-8000-000000000001')::int,
  1, 'HE SEES THE MARBLE JOB ANYWAY — discovery applies no trade filter');

select lives_ok(
  $$select public.job_application_submit(
      'f1000001-0000-4000-8000-000000000001', 'I can bring a marble fixer with me.')$$,
  'AND HE CAN APPLY TO IT — trade membership is not an authorization input');

-- Structural, because the behavioural test above only proves it is true today.
reset role;
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('_open_job_opportunities', '_my_job_applications')
      and p.prosrc like '%user_trades%')::int,
  0, 'neither installer-facing projection reads user_trades at all (O5)');

-- ===========================================================================
-- C. A decision reaches exactly the person it is about
-- ===========================================================================
-- Two live candidacies now: Sayed and Mahmoud. The poster rejects Mahmoud by
-- hand, then awards Sayed — which auto-closes nobody, because Mahmoud is
-- already decided. So the two paths are exercised separately and cleanly.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  $$select public.job_application_reject(
      (select id from public.job_applications
        where applicant_user_id = '71000007-0000-4000-8000-000000000007'),
      'We need someone with marble experience on site.')$$,
  'the poster declines one applicant');

reset role;
select is(
  (select count(*) from public.notifications
    where event_type = 'job.application.rejected')::int,
  1, 'exactly one rejection notice was written');

select is(
  (select recipient_user_id from public.notifications
    where event_type = 'job.application.rejected'),
  '71000007-0000-4000-8000-000000000007'::uuid,
  'AND ITS RECIPIENT IS THE APPLICANT — not the poster, not the org, not a fan-out');

select is(
  (select deep_link from public.notifications
    where event_type = 'job.application.rejected'),
  '/home/jobs/applications', 'it opens the applicant''s own tracking surface');

-- The poster's own side is deliberately NOT notified: 'job.application.submitted'
-- has no canonical recipient rule in the approved contract, so that seam is
-- reserved rather than guessed at.
select is(
  (select count(*) from public.notifications where event_type = 'job.application.submitted')::int,
  0, 'and applying still notifies nobody — that recipient rule is reserved, not invented');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_accept(
      (select id from public.job_applications
        where applicant_user_id = '71000006-0000-4000-8000-000000000006'))$$,
  'and awards the job to the other');

reset role;
select is(
  (select count(*) from public.notifications
    where event_type = 'job.application.accepted')::int,
  1, 'one acceptance notice');

select is(
  (select recipient_user_id from public.notifications
    where event_type = 'job.application.accepted'),
  '71000006-0000-4000-8000-000000000006'::uuid,
  'to exactly the installer who was awarded the work');

-- The already-rejected applicant is not told twice: he was decided by hand
-- before the award, so the accept path had no live sibling to close.
select is(
  (select count(*) from public.notifications
    where event_type = 'job.application.rejected')::int,
  1, 'and an applicant already decided is not notified a second time by the award');

select is(
  (select count(*) from public.notifications n
    where n.event_type like 'job.application.%'
      and n.recipient_user_id not in (
        '71000006-0000-4000-8000-000000000006'::uuid,
        '71000007-0000-4000-8000-000000000007'::uuid))::int,
  0, 'NOBODY ELSE RECEIVED ANYTHING — no organization fan-out, no bystanders');

-- Every notice a person can actually read, in their own language: the row
-- carries keys and params, never a rendered sentence.
select is(
  (select count(*) from public.notifications
    where event_type like 'job.application.%'
      and (title_key not like 'notifications.job.application.%'
           or params->>'job_title' is null))::int,
  0, 'each carries an i18n key and its params rather than a built sentence');

select finish();
rollback;
