-- pgTAP: Installer Pilot Increment 13 — the Network, derived from completed work.
--
-- The whole claim of this file is one sentence: an organization is in an
-- installer's Network if and only if `public.job_assignments` holds at least
-- one row for that (installer, organization) pair with `status = 'completed'`.
-- Everything below either builds that fact through the real Jobs RPCs or tries
-- to make the projection say something it should not.
--
-- THE FIXTURE IS BUILT THROUGH THE REAL RPCs — create, publish, apply, accept,
-- start, 100%, complete — the same discipline 49_job_reviews_test.sql uses, and
-- for the same reason: a relationship the product cannot actually produce is not
-- a relationship worth testing against.
--
-- Fixtures, from seed-pilot / seed:
--   70000006 — contractor persona, job.manage on Horizon Contracting (org H)
--   70000007 — contractor persona, job.post ONLY on Horizon Contracting — an org
--              MEMBER with no completed work of their own
--   71000006 — installer_technician, marble_granite declared (trade is never
--              authority — these jobs span two other trades on purpose)
--   71000007 — installer_technician, electrical only — "another installer"
--   11111111 — owner of Nile Finishing Supplies (org N), holds org.manage, so
--              can_post_job/can_manage_job pass on org.manage alone; given the
--              platform moderator role INSIDE this transaction only, exactly as
--              49_job_reviews_test.sql does for the same user
--   33333333 — owner of org B (bbbbbbbb…), used ONLY to prove a membership with
--              no completed work creates no relationship (§ "no Sales
--              affiliation used as Network authority")
create extension if not exists pgtap;

begin;
select plan(65);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set posterH    '70000006-0000-4000-8000-000000000006'
\set memberH    '70000007-0000-4000-8000-000000000007'
\set posterN    '11111111-1111-4111-8111-111111111111'
\set ownerB     '33333333-3333-4333-8333-333333333333'
\set install1   '71000006-0000-4000-8000-000000000006'
\set install2   '71000007-0000-4000-8000-000000000007'
\set orgH       '9a000000-aaaa-4aaa-8aaa-000000000005'
\set orgN       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set orgB       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

-- ===========================================================================
-- A. Build the fixture: three completed engagements across two organizations,
--    and one that never completes.
-- ===========================================================================

-- ---- Job A — org H, marble_granite -----------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('test.job_a',
  (select public.job_create(:'orgH'::uuid, 'Marble foyer restoration - Zamalek',
    'marble_granite', 5000))::text, true);
select lives_ok(
  $$select public.job_publish(current_setting('test.job_a')::uuid, 1)$$,
  'and published');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit(current_setting('test.job_a')::uuid, null)$$,
  'the installer applies to Job A');

set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('test.assignment_a',
  (select public.job_application_accept(
     (select id from public.job_applications
       where job_id = current_setting('test.job_a')::uuid
         and applicant_user_id = :'install1'::uuid)))::text, true);

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_assignment_start(current_setting('test.assignment_a')::uuid, 1)$$,
  'the installer starts Job A');
select lives_ok(
  $$select public.job_progress_add(current_setting('test.assignment_a')::uuid, 100::smallint, 'Done', 'Ready.')$$,
  'and reports 100 percent');

set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_assignment_complete(current_setting('test.assignment_a')::uuid, 2)$$,
  'THE ORGANIZATION CONFIRMS — Job A is completed');

-- ---- Job B — org H, tiling — the SAME organization, a SECOND completion ---
select set_config('test.job_b',
  (select public.job_create(:'orgH'::uuid, 'Tiling entrance hall - Zamalek',
    'tiling', 6200))::text, true);
select lives_ok(
  $$select public.job_publish(current_setting('test.job_b')::uuid, 1)$$, 'and published');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit(current_setting('test.job_b')::uuid, null)$$,
  'the same installer applies to Job B');

set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('test.assignment_b',
  (select public.job_application_accept(
     (select id from public.job_applications
       where job_id = current_setting('test.job_b')::uuid
         and applicant_user_id = :'install1'::uuid)))::text, true);

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_assignment_start(current_setting('test.assignment_b')::uuid, 1)$$, 'starts Job B');
select lives_ok(
  $$select public.job_progress_add(current_setting('test.assignment_b')::uuid, 100::smallint, null, null)$$,
  'reports 100 percent');

set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_assignment_complete(current_setting('test.assignment_b')::uuid, 2)$$,
  'Job B is completed too — the SECOND completion with org H');

-- ---- Job C — org N, marble_granite — a DIFFERENT organization -------------
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select set_config('test.job_c',
  (select public.job_create(:'orgN'::uuid, 'Marble reception desk - New Cairo',
    'marble_granite', 3000))::text, true);
select lives_ok(
  $$select public.job_publish(current_setting('test.job_c')::uuid, 1)$$, 'and published');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit(current_setting('test.job_c')::uuid, null)$$,
  'the installer applies to org N''s Job C');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select set_config('test.assignment_c',
  (select public.job_application_accept(
     (select id from public.job_applications
       where job_id = current_setting('test.job_c')::uuid
         and applicant_user_id = :'install1'::uuid)))::text, true);

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_assignment_start(current_setting('test.assignment_c')::uuid, 1)$$, 'starts Job C');
select lives_ok(
  $$select public.job_progress_add(current_setting('test.assignment_c')::uuid, 100::smallint, null, null)$$,
  'reports 100 percent');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$select public.job_assignment_complete(current_setting('test.assignment_c')::uuid, 2)$$,
  'org N confirms — a THIRD completion, across a SECOND organization');

-- ===========================================================================
-- B. The projection, once three real completions exist
-- ===========================================================================
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.my_network_organizations)::int,
  2, 'exactly two organizations — MULTIPLE completions with org H COLLAPSE into one row');

select is(
  (select completed_count from public.my_network_organizations where org_id = :'orgH'::uuid)::int,
  2, 'org H shows two completed assignments');

select is(
  (select completed_count from public.my_network_organizations where org_id = :'orgN'::uuid)::int,
  1, 'org N shows one');

select is(
  (select org_name from public.my_network_organizations where org_id = :'orgH'::uuid),
  'Horizon Contracting', 'org H is named');

select is(
  (select org_name from public.my_network_organizations where org_id = :'orgN'::uuid),
  'Nile Finishing Supplies', 'org N is named');

select is(
  (select trade_keys from public.my_network_organizations where org_id = :'orgH'::uuid),
  array['marble_granite', 'tiling'],
  'org H carries BOTH trades actually worked, sorted');

select is(
  (select trade_keys from public.my_network_organizations where org_id = :'orgN'::uuid),
  array['marble_granite'],
  'org N carries the one trade worked there');

-- All three completions land in the SAME transaction, so now() is literally
-- identical across them — asserted rather than fought, and it is exactly why
-- the tie-break inside the reader is deterministic on assignment_id.
select is(
  (select first_completed_at from public.my_network_organizations where org_id = :'orgH'::uuid),
  (select last_completed_at from public.my_network_organizations where org_id = :'orgH'::uuid),
  'first and last completed collapse to the one instant this transaction shares');

select is(
  (select last_completed_at from public.my_network_organizations where org_id = :'orgH'::uuid),
  (select completed_at from public.job_assignments where id = current_setting('test.assignment_a')::uuid),
  'and that instant is the real completed_at on the assignment');

select is(
  (select latest_assignment_id from public.my_network_organizations where org_id = :'orgH'::uuid),
  (select id from public.job_assignments
     where id in (current_setting('test.assignment_a')::uuid, current_setting('test.assignment_b')::uuid)
     order by completed_at desc, id desc limit 1),
  'the latest-job tie-break is deterministic, not arbitrary');

select is(
  (select latest_job_title from public.my_network_organizations where org_id = :'orgH'::uuid),
  (select j.title from public.jobs j
     where j.id = (select job_id from public.job_assignments
        where id = (select id from public.job_assignments
           where id in (current_setting('test.assignment_a')::uuid, current_setting('test.assignment_b')::uuid)
           order by completed_at desc, id desc limit 1))),
  'and the title matches the job it names');

-- ===========================================================================
-- C. scheduled / in_progress / cancelled — NONE of them count
-- ===========================================================================
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('test.job_d',
  (select public.job_create(:'orgH'::uuid, 'Electrical rewire - Maadi',
    'electrical', 4000))::text, true);
select lives_ok(
  $$select public.job_publish(current_setting('test.job_d')::uuid, 1)$$, 'and published');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit(current_setting('test.job_d')::uuid, null)$$,
  'the installer applies to Job D');

set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('test.assignment_d',
  (select public.job_application_accept(
     (select id from public.job_applications
       where job_id = current_setting('test.job_d')::uuid
         and applicant_user_id = :'install1'::uuid)))::text, true);

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select completed_count from public.my_network_organizations where org_id = :'orgH'::uuid)::int,
  2, 'a SCHEDULED assignment adds nothing to the completed count');

select is(
  (select count(*) from public.my_network_organizations)::int,
  2, 'and no new organization appears for it');

select lives_ok(
  $$select public.job_assignment_start(current_setting('test.assignment_d')::uuid, 1)$$,
  'the installer starts Job D — now IN_PROGRESS');

select is(
  (select completed_count from public.my_network_organizations where org_id = :'orgH'::uuid)::int,
  2, 'IN_PROGRESS adds nothing either');

select lives_ok(
  $$select public.job_assignment_cancel(current_setting('test.assignment_d')::uuid, 2,
      'The client postponed the rewire indefinitely.')$$,
  'the installer cancels Job D');

select is(
  (select completed_count from public.my_network_organizations where org_id = :'orgH'::uuid)::int,
  2, 'and a CANCELLED assignment never counts, either — org H stays at two');

select is(
  (select count(*) from public.my_network_organizations)::int,
  2, 'the organization total is still exactly two');

-- ===========================================================================
-- D. Membership is not the authority — "no Sales affiliation as Network
--    authority", proven with a real membership row and zero completed work
-- ===========================================================================
-- Direct table writes — the same way seed-pilot itself establishes a
-- membership, and outside the point under test: no client write path onto
-- `memberships` exists (or should exist) for this file to exercise.
reset role;
insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at)
values ('e9999999-eeee-4eee-8eee-eeeeeeeeeee9', '71000006-0000-4000-8000-000000000006',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 'active', now());
insert into public.membership_capabilities (membership_id, capability_key)
values ('e9999999-eeee-4eee-8eee-eeeeeeeeeee9', 'sales.opportunity.read');

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select count(*) from public.my_network_organizations)::int,
  2, 'org B does NOT appear — membership alone is not Network authority, even though the installer really does hold it');

select is(
  (select count(*) from public.my_network_organizations where org_id = :'orgB'::uuid)::int,
  0, 'stated directly: org B is absent');

-- ===========================================================================
-- E. Reviews — visible ones show, suppressed ones do not leak through
-- ===========================================================================
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('test.review_h',
  (select public.job_review_submit(current_setting('test.assignment_a')::uuid, 5::smallint, 'Excellent finish.'))::text, true);

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select set_config('test.review_n',
  (select public.job_review_submit(current_setting('test.assignment_c')::uuid, 4::smallint, 'Good work.'))::text, true);

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select review_count from public.my_network_organizations where org_id = :'orgH'::uuid)::int,
  1, 'org H shows one visible review');
select is(
  (select review_count from public.my_network_organizations where org_id = :'orgN'::uuid)::int,
  1, 'org N shows one too');

reset role;
select lives_ok(
  $$insert into public.platform_role_grants (user_id, role, granted_by)
    values ('11111111-1111-4111-8111-111111111111'::uuid, 'moderator', '11111111-1111-4111-8111-111111111111'::uuid)$$,
  'org N''s owner is given the platform moderator role INSIDE THIS TRANSACTION ONLY');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$select public.job_review_moderate(current_setting('test.review_n')::uuid, 'suppress', 'Testing that suppression is honoured here too.')$$,
  'the moderator suppresses org N''s review');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select review_count from public.my_network_organizations where org_id = :'orgN'::uuid)::int,
  0, 'SUPPRESSED REVIEWS LEAVE NETWORK TOO — the same test my_job_reviews applies');
select is(
  (select review_count from public.my_network_organizations where org_id = :'orgH'::uuid)::int,
  1, 'org H''s own review is unaffected by org N''s suppression');

-- ===========================================================================
-- F. The relationship survives verification loss and trade retirement
-- ===========================================================================
reset role;
update public.trades set is_active = false where key = 'marble_granite';
update public.organizations set is_verified = false where id = :'orgH'::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.my_network_organizations)::int,
  2, 'both relationships survive a retirement and a verification lapse');

select is(
  (select org_name from public.my_network_organizations where org_id = :'orgH'::uuid),
  'Horizon Contracting', 'org H keeps its name after losing verification');

select is(
  (select trade_keys from public.my_network_organizations where org_id = :'orgH'::uuid),
  array['marble_granite', 'tiling'],
  'the retired trade stays labelled on the historical relationship');

select is(
  (select count(*) from public.trades where key = 'marble_granite')::int,
  0, 'while the live catalog no longer offers it (not widened)');

select is(
  (select count(*) from public.my_network_work_history
     where org_id = :'orgH'::uuid and trade_key = 'marble_granite')::int,
  1, 'the work history still labels Job A with its retired trade');

-- Job discovery loss: a completed job was never open in the first place from
-- this point on, and now it is doubly gone.
select is(
  (select count(*) from public.open_job_opportunities
     where id in (current_setting('test.job_a')::uuid, current_setting('test.job_b')::uuid))::int,
  0, 'neither completed job is discoverable any more, while the relationship stays readable');

-- ===========================================================================
-- G. The organization relationship detail — my_network_work_history
-- ===========================================================================
select is(
  (select count(*) from public.my_network_work_history where org_id = :'orgH'::uuid)::int,
  2, 'org H''s detail shows exactly the two completed jobs');

select is(
  (select count(*) from public.my_network_work_history where org_id = :'orgN'::uuid)::int,
  1, 'org N''s detail shows exactly the one');

select is(
  (select array_agg(assignment_id order by assignment_id) from public.my_network_work_history where org_id = :'orgH'::uuid),
  (select array_agg(id order by id) from public.job_assignments
     where id in (current_setting('test.assignment_a')::uuid, current_setting('test.assignment_b')::uuid)),
  'the assignment ids are exactly the ones /home/work/[assignmentId] would resolve');

select is(
  (select count(*) from public.my_network_work_history
     where org_id = :'orgH'::uuid and assignment_id = current_setting('test.assignment_d')::uuid)::int,
  0, 'the cancelled Job D never appears in the work history either');

-- ===========================================================================
-- H. Isolation — this is a PRIVATE surface
-- ===========================================================================
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is(
  (select count(*) from public.my_network_organizations)::int,
  0, 'a DIFFERENT installer, handed no id and no shortcut, sees none of this');

select is(
  (select count(*) from public.my_network_work_history)::int,
  0, 'and none of the completed work history either');

set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is(
  (select count(*) from public.my_network_organizations)::int,
  0, 'AN ORGANIZATION MEMBER of org H — job.post, not job.manage — reads their OWN network, which is empty; membership grants nothing here');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.my_network_organizations$$,
  '42501', null, 'anon cannot read the network at all');
select throws_ok(
  $$select * from public.my_network_work_history$$,
  '42501', null, 'nor the work history');

reset role;
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('my_network_organizations', 'my_network_work_history')
      and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))::int,
  0, 'no client role holds INSERT, UPDATE or DELETE on either projection — every fact still comes from job_assignments');

-- ===========================================================================
-- I. Structural guards
-- ===========================================================================
select ok(
  (select p.proconfig @> array['search_path=""'] and p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_my_network_organizations'),
  'the organizations reader is SECURITY DEFINER with search_path pinned empty');

select ok(
  (select p.proconfig @> array['search_path=""'] and p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_my_network_work_history'),
  'so is the work-history reader');

select is(
  (select array_agg(c.n order by c.n) from (
     select column_name::text collate "C" as n
       from information_schema.columns
      where table_schema = 'public' and table_name = 'my_network_organizations') c),
  array['completed_count', 'first_completed_at', 'last_completed_at', 'latest_assignment_id',
        'latest_job_title', 'org_id', 'org_name', 'review_count', 'trade_keys'],
  'the organizations projection carries exactly these nine columns');

select is(
  (select array_agg(c.n order by c.n) from (
     select column_name::text collate "C" as n
       from information_schema.columns
      where table_schema = 'public' and table_name = 'my_network_work_history') c),
  array['agreed_amount', 'agreed_currency', 'assignment_id', 'completed_at',
        'job_title', 'org_id', 'org_name', 'trade_key'],
  'and the work-history projection exactly these eight');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('_my_network_organizations', '_my_network_work_history')
      and p.prosrc like '%user_trades%')::int,
  0, 'neither reader consults user_trades (O5) — trade is never authority here either');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('_my_network_organizations', '_my_network_work_history')
      and (p.prosrc like '%organization_join_requests%' or p.prosrc like '%organization_referrals%'
        or p.prosrc like '%sales_affiliation%'))::int,
  0, 'and neither reads Sales affiliation or organization membership tables — completed job_assignments is the whole authority');

select * from finish();
rollback;
