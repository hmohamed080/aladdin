-- pgTAP: Installer Pilot Increment 6 — Jobs domain foundation.
--
-- Four things in this domain are easy to build in a way that works and is
-- wrong, and every section below exists to pin one of them down.
--
--   1. TRADE BECOMING A GATE. The single most likely regression in the whole
--      Installer milestone, because it feels like a feature. Someone adds "only
--      show jobs matching your trades", then "only let matching installers
--      apply", and O5 is gone without one line of it being discussed. Section J
--      asserts it STRUCTURALLY — no policy and no function in this domain may
--      mention user_trades — because by the time it shows up behaviourally, a
--      real installer has already been refused work they were allowed to take.
--
--   2. VERIFICATION BEING CACHED. A denormalised is_verified on jobs would keep
--      a suppressed job visible after a lapse AND keep a re-verified org's jobs
--      buried after a restore: wrong in both directions, and invisible until
--      someone complains. Section C proves suppression is derived by revoking
--      verification and watching discovery change with no row rewritten — and
--      that work already under way is untouched by the same revocation.
--
--   3. THE INSTALLER COMPLETING THEIR OWN WORK. A rating anchored to work the
--      rated party declared finished about themselves is not evidence. Section
--      G proves the installer can report 100% and still not complete anything.
--
--   4. A DOUBLE AWARD. Two accepts on one job is the failure that produces two
--      people turning up to the same site. Section F attacks the invariant
--      directly at the storage layer, because an RPC-level check is only as
--      good as the next RPC.
--
-- Fixtures, all from seed-pilot:
--   70000006 Mostafa Bakr  — Horizon, org.manage (the blanket unlock)
--   70000007 Laila Shafik  — Horizon, job.post AND NOT job.manage
--   70000008 Yasser Fouad  — Horizon member, no job capability at all
--   70000009 Ahmed Sobhy   — installer_technician who is ALSO a Horizon member
--   71000006 Sayed         — installer_technician, trade marble_granite
--   71000007 Mahmoud       — installer_technician, trade electrical
--   70000003 Tarek Halim   — owner of a DIFFERENT, unverified organization
--   44444444 Omar Zaki     — end_consumer
--   11111111               — business-only identity (null persona)
--   55555555 Platform Admin— administrator (satisfies is_platform('support'))
--   f1000001 open job (marble_granite) · f1000002 draft job (plumbing)
create extension if not exists pgtap;

begin;
select plan(162);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

-- Ids created during the run. A temp table rather than psql variables, so the
-- whole suite is one transaction and rolls back cleanly.
create temp table ids (k text primary key, v uuid);
-- The suite switches roles constantly and reads this table from inside those
-- sections. It is a test scratchpad in a transaction that always rolls back,
-- and it holds nothing but ids the test itself just created.
grant all on ids to authenticated, anon;

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select has_table('public'::name, 'jobs'::name, 'jobs exists');
select has_table('public'::name, 'job_applications'::name, 'job_applications exists');
select has_table('public'::name, 'job_assignments'::name, 'job_assignments exists');
select has_table('public'::name, 'job_progress_updates'::name, 'job_progress_updates exists');

select has_type('public'::name, 'job_status'::name, 'job_status enum exists');
select has_type('public'::name, 'job_application_status'::name, 'job_application_status enum exists');
select has_type('public'::name, 'job_assignment_status'::name, 'job_assignment_status enum exists');

select results_eq(
  $$select unnest(enum_range(null::public.job_status))::text order by 1$$,
  $$values ('awarded'),('cancelled'),('closed'),('completed'),('draft'),('open')$$,
  'job_status carries exactly the six approved states');

-- A job names ONE organization. There is no second org column to join across
-- tenants, which is what makes cross-tenant leakage impossible by shape.
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs'
      and column_name like '%org%')::int,
  1, 'jobs names exactly one organization column');

-- The offer is money, and money that cannot be compared for equality cannot be
-- audited. numeric, never float.
select col_type_is('public'::name, 'jobs'::name, 'offered_amount'::name, 'numeric(12,2)',
  'offered_amount is numeric, never floating point');

-- The forbidden vocabulary (§5.2). Not one of these may ever appear.
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name in ('jobs', 'job_applications', 'job_assignments', 'job_progress_updates')
      and (column_name ~ 'payment|payout|settlement|escrow|commission|invoice|wallet|balance|earn'))::int,
  0, 'no payment, wallet, escrow, payout, commission, invoice or balance column exists');

-- No ranking, scoring or matching field crept in with discovery.
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name in ('jobs', 'job_applications', 'job_assignments')
      and (column_name ~ 'score|rank|match|skill_level'))::int,
  0, 'no ranking, match-score or skill-level column exists');

-- No expiry column: O4 forbids automatic expiry, and a column named for it is
-- how one arrives later without a decision.
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs'
      and column_name ~ 'expire|expiry|expires')::int,
  0, 'jobs has no expiry column — a job leaves open only because a human moved it');

-- ===========================================================================
-- B. Posting authority
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  $$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'Tiling - villa terrace',
      'tiling', 9000.00, 'Terrace and steps.', 'Cairo', 'New Cairo')$$,
  'org.manage creates a draft through the blanket unlock');

insert into ids
select 'draft_a', id from public.jobs where title = 'Tiling - villa terrace';

select is(
  (select status::text from public.jobs where id = (select v from ids where k = 'draft_a')),
  'draft', 'a new job starts as a draft, never open');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';

select lives_ok(
  $$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'Electrical second fix',
      'electrical', 7000.00)$$,
  'job.post alone creates a draft — the capability works without org.manage');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000008-0000-4000-8000-000000000008","role":"authenticated"}';

select throws_ok(
  $$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'Unauthorized',
      'tiling', 1000.00)$$,
  '42501', null, 'a member WITHOUT job.post or org.manage cannot create a job');

-- An installer who happens to be a member of the posting organization gains no
-- posting authority from that membership. Membership is not a job capability.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select throws_ok(
  $$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'Installer posting',
      'tiling', 1000.00)$$,
  '42501', null, 'an installer who is also an org member still cannot post a job');

-- A different organization's owner has no reach into Horizon's jobs at all.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';

select throws_ok(
  $$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'Cross tenant',
      'tiling', 1000.00)$$,
  '42501', null, 'another organization cannot create a job for Horizon');

select throws_ok(
  $$select public.job_publish('f1000001-0000-4000-8000-000000000001', 1)$$,
  '42501', null, 'another organization cannot publish Horizon''s job');

select throws_ok(
  $$select public.job_cancel('f1000001-0000-4000-8000-000000000001', 1, 'no')$$,
  '42501', null, 'another organization cannot cancel Horizon''s job');

-- Publishing from an UNVERIFIED organization. Drafting was allowed — capability
-- alone — and it is exactly here that verification bites: it gates public
-- discoverability, never workspace access.
select lives_ok(
  $$select public.job_create('9d000000-dddd-4ddd-8ddd-000000000002', 'Unverified opening',
      'tiling', 5000.00)$$,
  'an UNVERIFIED organization may still DRAFT a job (verification is not workspace access)');

insert into ids select 'draft_unverified', id from public.jobs where title = 'Unverified opening';

select throws_ok(
  format($$select public.job_publish(%L, 1)$$, (select v from ids where k = 'draft_unverified')),
  '42501', null, 'an unverified organization cannot PUBLISH into discovery');

-- ===========================================================================
-- C. Compensation and trade validation at the boundary
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  $$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'Free work', 'tiling', 0)$$,
  '23514', null, 'a zero-value job is refused — there is no negotiable job in the Pilot');

select throws_ok(
  $$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'Negative', 'tiling', -5)$$,
  '23514', null, 'a negative offer is refused');

select throws_ok(
  $$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005', 'No such trade',
      'underwater_basket_weaving', 1000.00)$$,
  '22023', null, 'an unknown trade key is refused');

reset role;
select is(
  (select offered_currency from public.jobs where id = 'f1000001-0000-4000-8000-000000000001'),
  'EGP', 'the offer currency is EGP');

select throws_ok(
  $$update public.jobs set offered_currency = 'USD'
     where id = 'f1000001-0000-4000-8000-000000000001'$$,
  '23514', null, 'the currency is pinned to EGP by constraint, not by convention');

-- A retired trade cannot be NEWLY published under, and retiring it destroys no
-- history: the job that already names it is untouched.
update public.trades set is_active = false where key = 'tiling';

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  format($$select public.job_publish(%L, 1)$$, (select v from ids where k = 'draft_a')),
  '22023', null, 'a job whose trade has been retired cannot be published');

reset role;
select isnt(
  (select trade_id from public.jobs where id = (select v from ids where k = 'draft_a')),
  null, 'retiring a trade leaves the historical job''s trade_id intact');

update public.trades set is_active = true where key = 'tiling';

-- ===========================================================================
-- D. Discovery — derived suppression, and what is never projected
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.open_job_opportunities
    where id = 'f1000001-0000-4000-8000-000000000001')::int,
  1, 'an open job from a verified poster reaches the installer pool');

select is(
  (select count(*) from public.open_job_opportunities
    where id = 'f1000002-0000-4000-8000-000000000002')::int,
  0, 'a DRAFT job is never discoverable, however verified its poster');

-- The precise address is withheld until assignment (§11).
select hasnt_column('public'::name, 'open_job_opportunities'::name, 'site_address'::name,
  'discovery never projects the site address');

-- Nor any poster-side management metadata.
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'open_job_opportunities'
      and column_name in ('version', 'created_by', 'closed_at', 'status'))::int,
  0, 'discovery projects no poster-side management metadata');

-- Sayed's declared trade is marble_granite and the open job is marble_granite,
-- so this alone would not prove anything. Mahmoud is electrical and must see
-- exactly the same row: discovery is NOT filtered by the caller's trades.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';

select is(
  (select count(*) from public.open_job_opportunities
    where id = 'f1000001-0000-4000-8000-000000000001')::int,
  1, 'an installer whose declared trade does NOT match still sees the job (O5)');

-- Suppression, derived. Nothing is rewritten; the job simply stops matching.
reset role;
update public.organizations set is_verified = false
  where id = '9a000000-aaaa-4aaa-8aaa-000000000005';

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.open_job_opportunities
    where id = 'f1000001-0000-4000-8000-000000000001')::int,
  0, 'losing verification removes the job from discovery');

reset role;
select is(
  (select status::text from public.jobs where id = 'f1000001-0000-4000-8000-000000000001'),
  'open', 'and the job row itself is NOT rewritten — suppression is derived, not stored');

-- `reset role` does NOT clear request.jwt.claims, so the identity is cleared
-- explicitly. Without this the call would still run as the previous caller and
-- the test would pass for the wrong reason.
set local request.jwt.claims = '{}';

select throws_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001')$$,
  '42501', null, 'a caller with no identity cannot apply');

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001')$$,
  '22023', null, 'a NEW application is blocked while the poster is unverified');

-- Restore, and confirm it comes back with no backfill of any kind.
reset role;
update public.organizations set is_verified = true
  where id = '9a000000-aaaa-4aaa-8aaa-000000000005';

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.open_job_opportunities
    where id = 'f1000001-0000-4000-8000-000000000001')::int,
  1, 'regaining verification restores the job with no row rewritten and no backfill');

-- ===========================================================================
-- E. Applying — who may, who may not, and what trade has to do with it
-- ===========================================================================
select lives_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001', 'Available next week.')$$,
  'a professional installer can apply');

reset role;
insert into ids
select 'app_sayed', id from public.job_applications
where job_id = 'f1000001-0000-4000-8000-000000000001'
  and applicant_user_id = '71000006-0000-4000-8000-000000000006';

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

-- Idempotency: a retry returns the SAME candidacy rather than erroring or
-- queueing a duplicate.
select is(
  (select public.job_application_submit('f1000001-0000-4000-8000-000000000001', 'again')),
  (select v from ids where k = 'app_sayed'),
  'a repeat application returns the existing candidacy, never a duplicate');

reset role;
select is(
  (select count(*) from public.job_applications
    where job_id = 'f1000001-0000-4000-8000-000000000001'
      and applicant_user_id = '71000006-0000-4000-8000-000000000006')::int,
  1, 'and only one row exists');

-- THE O5 TEST. Mahmoud's only declared trade is electrical; the job is
-- marble_granite. He must be able to apply.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';

select is(
  (select count(*) from public.user_trades ut
    join public.trades t on t.id = ut.trade_id
   where ut.user_id = '71000007-0000-4000-8000-000000000007' and t.key = 'marble_granite')::int,
  0, 'Mahmoud has NOT declared the job''s trade');

select lives_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001', 'I can do this too.')$$,
  'an installer may apply OUTSIDE their declared trades (O5)');

reset role;
insert into ids
select 'app_mahmoud', id from public.job_applications
where job_id = 'f1000001-0000-4000-8000-000000000001'
  and applicant_user_id = '71000007-0000-4000-8000-000000000007';

-- A consumer is not a professional and has nothing to apply with.
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select throws_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001')$$,
  '42501', null, 'an end consumer cannot apply for work');

-- A business-only identity holds no personal persona at all.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select throws_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001')$$,
  '42501', null, 'a business-only identity cannot apply as a professional');

reset role;
set local role anon;

select throws_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001')$$,
  '42501', null, 'anon cannot apply');

select throws_ok(
  $$select * from public.open_job_opportunities$$,
  '42501', null, 'anon cannot read the job board — there is no anonymous discovery');

-- Withdrawal is the applicant's own act and nobody else's.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  format($$select public.job_application_withdraw(%L)$$, (select v from ids where k = 'app_mahmoud')),
  '42501', null, 'one applicant cannot withdraw another applicant''s candidacy');

-- ===========================================================================
-- F. The award — atomic, and one active assignment or none
-- ===========================================================================

-- job.post is NOT job.manage. Laila can publish an opening and cannot decide it.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';

select throws_ok(
  format($$select public.job_application_accept(%L)$$, (select v from ids where k = 'app_sayed')),
  '42501', null, 'job.post does not confer job.manage — publishing is not deciding');

-- An applicant cannot award themselves.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  format($$select public.job_application_accept(%L)$$, (select v from ids where k = 'app_sayed')),
  '42501', null, 'an applicant cannot accept their own application');

-- Another organization cannot award.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';

select throws_ok(
  format($$select public.job_application_accept(%L)$$, (select v from ids where k = 'app_sayed')),
  '42501', null, 'an unrelated organization cannot award Horizon''s job');

-- The real award.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_accept(%L)$$, (select v from ids where k = 'app_sayed')),
  'the poster accepts one application');

reset role;
insert into ids
select 'asg', id from public.job_assignments
where job_id = 'f1000001-0000-4000-8000-000000000001' and status <> 'cancelled';

select is(
  (select count(*) from public.job_assignments
    where job_id = 'f1000001-0000-4000-8000-000000000001')::int,
  1, 'accepting creates exactly ONE assignment');

select is(
  (select status::text from public.jobs where id = 'f1000001-0000-4000-8000-000000000001'),
  'awarded', 'the job moves to awarded as a side effect, never set directly');

select is(
  (select status::text from public.job_applications where id = (select v from ids where k = 'app_sayed')),
  'accepted', 'the accepted candidacy is marked accepted');

select is(
  (select status::text from public.job_applications where id = (select v from ids where k = 'app_mahmoud')),
  'rejected', 'every sibling still in the running is auto-rejected in the same transaction');

select isnt(
  (select decision_reason from public.job_applications where id = (select v from ids where k = 'app_mahmoud')),
  null, 'and the auto-rejection carries a reason the applicant can read');

select is(
  (select agreed_amount from public.job_assignments where id = (select v from ids where k = 'asg')),
  18000.00::numeric(12,2), 'the assignment freezes the offer as accepted');

select is(
  (select installer_user_id from public.job_assignments where id = (select v from ids where k = 'asg')),
  '71000006-0000-4000-8000-000000000006'::uuid, 'the assignment names the applicant, not an organization');

-- Idempotent re-accept returns the assignment it already produced.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select public.job_application_accept((select v from ids where k = 'app_sayed'))),
  (select v from ids where k = 'asg'),
  're-accepting returns the existing assignment rather than creating a second');

-- An awarded job accepts no new applications.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000008-0000-4000-8000-000000000008","role":"authenticated"}';

select throws_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001')$$,
  '22023', null, 'an AWARDED job accepts no new applications');

-- THE INVARIANT, attacked at the storage layer rather than through the RPC that
-- is supposed to protect it. This is the assertion that still holds when a
-- future write path forgets the rule.
reset role;
select throws_ok(
  format($$insert into public.job_assignments
            (job_id, application_id, installer_user_id, poster_org_id, agreed_amount)
          values ('f1000001-0000-4000-8000-000000000001', %L,
                  '71000007-0000-4000-8000-000000000007',
                  '9a000000-aaaa-4aaa-8aaa-000000000005', 1000.00)$$,
    (select v from ids where k = 'app_mahmoud')),
  '23505', null,
  'a second ACTIVE assignment for one job is impossible at the database level');

select has_index('public'::name, 'job_assignments'::name, 'ux_job_assignments_active_job'::name,
  'the one-active-assignment invariant is a partial unique index, enforced across transactions');

-- ===========================================================================
-- G. Progress and completion — the authority line that matters most
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';

select throws_ok(
  format($$select public.job_assignment_start(%L, 1)$$, (select v from ids where k = 'asg')),
  '42501', null, 'an installer who is not the assignee cannot start the work');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  format($$select public.job_progress_add(%L, 10::smallint)$$, (select v from ids where k = 'asg')),
  '22023', null, 'progress cannot be reported before the work has started');

select lives_ok(
  format($$select public.job_assignment_start(%L, 1)$$, (select v from ids where k = 'asg')),
  'the assigned installer starts the work');

select throws_ok(
  format($$select public.job_progress_add(%L, 101::smallint)$$, (select v from ids where k = 'asg')),
  '22023', null, 'progress above 100 is refused');

select throws_ok(
  format($$select public.job_progress_add(%L, -1::smallint)$$, (select v from ids where k = 'asg')),
  '22023', null, 'negative progress is refused');

select lives_ok(
  format($$select public.job_progress_add(%L, 40::smallint, 'Substrate', 'Levelling done.')$$,
    (select v from ids where k = 'asg')),
  'the assigned installer reports progress');

select lives_ok(
  format($$select public.job_progress_add(%L, 100::smallint, 'Finishing', 'Ready for inspection.')$$,
    (select v from ids where k = 'asg')),
  'the installer signals readiness at 100 percent');

reset role;
select is(
  (select count(*) from public.job_progress_updates
    where assignment_id = (select v from ids where k = 'asg'))::int,
  2, 'progress is append-only history — the earlier report is still there');

select is(
  (select latest_progress_percent from public.job_assignments where id = (select v from ids where k = 'asg')),
  100::smallint, 'the assignment summary agrees with the history it summarises');

-- THE LINE. 100 percent is a claim, not a completion.
select is(
  (select status::text from public.job_assignments where id = (select v from ids where k = 'asg')),
  'in_progress', 'reaching 100 percent does NOT complete the assignment');

select is(
  (select status::text from public.jobs where id = 'f1000001-0000-4000-8000-000000000001'),
  'awarded', 'and it does not complete the job');

select throws_ok(
  format($$update public.job_progress_updates set progress_percent = 5
            where assignment_id = %L$$, (select v from ids where k = 'asg')),
  'P0001', null, 'a progress report cannot be revised after the fact');

select throws_ok(
  format($$delete from public.job_progress_updates where assignment_id = %L$$,
    (select v from ids where k = 'asg')),
  'P0001', null, 'and it cannot be deleted');

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  format($$select public.job_assignment_complete(%L, 2)$$, (select v from ids where k = 'asg')),
  '42501', null, 'THE INSTALLER CANNOT COMPLETE THEIR OWN WORK RECORD');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000008-0000-4000-8000-000000000008","role":"authenticated"}';

select throws_ok(
  format($$select public.job_assignment_complete(%L, 2)$$, (select v from ids where k = 'asg')),
  '42501', null, 'nor can an org member without job.manage');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_assignment_complete(%L, 2)$$, (select v from ids where k = 'asg')),
  'the posting organization confirms completion');

reset role;
select is(
  (select status::text from public.job_assignments where id = (select v from ids where k = 'asg')),
  'completed', 'the assignment is completed');

select is(
  (select status::text from public.jobs where id = 'f1000001-0000-4000-8000-000000000001'),
  'completed', 'and the job follows it, consistently, in the same transaction');

-- ===========================================================================
-- H. Cancellation, reopening, and history that is not rewritten
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_publish(%L, 1)$$, (select v from ids where k = 'draft_a')),
  'a second opening is published');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000008-0000-4000-8000-000000000008","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_submit(%L, 'Interested.')$$,
    (select v from ids where k = 'draft_a')),
  'an installer applies to it');

reset role;
insert into ids
select 'app_b', id from public.job_applications
where job_id = (select v from ids where k = 'draft_a')
  and applicant_user_id = '71000008-0000-4000-8000-000000000008';

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000009-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_submit(%L, 'Also interested.')$$,
    (select v from ids where k = 'draft_a')),
  'and so does a second installer');

reset role;
insert into ids
select 'app_c', id from public.job_applications
where job_id = (select v from ids where k = 'draft_a')
  and applicant_user_id = '71000009-0000-4000-8000-000000000009';

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_accept(%L)$$, (select v from ids where k = 'app_b')),
  'the poster awards it');

reset role;
insert into ids
select 'asg_b', id from public.job_assignments
where job_id = (select v from ids where k = 'draft_a') and status <> 'cancelled';

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_assignment_cancel(%L, 1, 'The client postponed the fit-out.')$$,
    (select v from ids where k = 'asg_b')),
  'the assignment is cancelled');

reset role;
select is(
  (select status::text from public.job_assignments where id = (select v from ids where k = 'asg_b')),
  'cancelled', 'the assignment is cancelled, NOT deleted');

select is(
  (select count(*) from public.job_assignments where id = (select v from ids where k = 'asg_b'))::int,
  1, 'and the record survives for audit');

select is(
  (select status::text from public.jobs where id = (select v from ids where k = 'draft_a')),
  'open', 'the job returns to open — the opening goes back to the pool');

-- The applicant who lost the first round does NOT silently re-enter it.
select is(
  (select status::text from public.job_applications where id = (select v from ids where k = 'app_c')),
  'rejected', 'a previously rejected applicant stays rejected on the reopened job');

select is(
  (select status::text from public.job_applications where id = (select v from ids where k = 'app_b')),
  'accepted', 'and the cancelled engagement''s application keeps its decided history');

-- A reopened job takes new applications again.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_submit(%L, 'Available now.')$$,
    (select v from ids where k = 'draft_a')),
  'the reopened job accepts a new application while the poster is verified');

-- And the cancelled assignment does not block a fresh award, which is the whole
-- reason ux_job_assignments_active_job excludes cancelled rows.
reset role;
insert into ids
select 'app_d', id from public.job_applications
where job_id = (select v from ids where k = 'draft_a')
  and applicant_user_id = '71000006-0000-4000-8000-000000000006';

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_accept(%L)$$, (select v from ids where k = 'app_d')),
  'the reopened job can be awarded again despite the cancelled assignment');

-- ===========================================================================
-- I. Privacy
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.job_applications
    where id = (select v from ids where k = 'app_sayed'))::int,
  1, 'an installer reads their own application');

select is(
  (select count(*) from public.job_applications
    where id = (select v from ids where k = 'app_mahmoud'))::int,
  0, 'AN APPLICANT NEVER SEES A COMPETING APPLICATION');

select is(
  (select count(*) from public.job_assignments
    where id = (select v from ids where k = 'asg'))::int,
  1, 'an installer reads their own assignment');

select is(
  (select count(*) from public.job_progress_updates
    where assignment_id = (select v from ids where k = 'asg'))::int,
  2, 'and their own progress history');

select is(
  (select count(*) from public.my_job_applications
    where id = (select v from ids where k = 'app_sayed'))::int,
  1, 'my_job_applications makes an applicant''s own candidacy legible');

select hasnt_column('public'::name, 'my_job_applications'::name, 'site_address'::name,
  'and still withholds the site address, because applying is not assignment');

-- The poster side.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.job_applications
    where job_id = 'f1000001-0000-4000-8000-000000000001')::int,
  2, 'the posting organization sees every applicant for its own job');

select is(
  (select count(*) from public.job_progress_updates
    where assignment_id = (select v from ids where k = 'asg'))::int,
  2, 'and the progress reported against its own assignment');

-- An unrelated organization sees none of it.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';

select is(
  (select count(*) from public.jobs where id = 'f1000001-0000-4000-8000-000000000001')::int,
  0, 'an unrelated organization cannot read the job');

select is(
  (select count(*) from public.job_applications
    where job_id = 'f1000001-0000-4000-8000-000000000001')::int,
  0, 'nor its applicants');

select is(
  (select count(*) from public.job_assignments
    where id = (select v from ids where k = 'asg'))::int,
  0, 'nor its assignment');

select is(
  (select count(*) from public.job_progress_updates
    where assignment_id = (select v from ids where k = 'asg'))::int,
  0, 'nor the progress notes, which are bilateral and never public');

-- A consumer reaches nothing at all.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select is(
  (select count(*) from public.jobs)::int, 0,
  'an end consumer reads no job rows');

-- Platform support, through the EXISTING support authority and no new one.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select cmp_ok(
  (select count(*) from public.job_applications)::int, '>', 0,
  'platform support reads applications through the existing platform authority');

-- ===========================================================================
-- J. Structural — the rules that must not be reachable by behaviour at all
-- ===========================================================================
reset role;

-- NO CLIENT DML. Not one insert/update/delete privilege on any of the four
-- tables, in any client role. This is what makes every lifecycle transition go
-- through an RPC that re-checks authority.
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('jobs', 'job_applications', 'job_assignments', 'job_progress_updates')
      and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))::int,
  0, 'no client role holds INSERT, UPDATE, DELETE or TRUNCATE on any Jobs table');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('jobs', 'job_applications', 'job_assignments', 'job_progress_updates')
      and cmd <> 'SELECT')::int,
  0, 'no INSERT/UPDATE/DELETE policy exists on any Jobs table');

-- O5, STRUCTURALLY. No policy in this domain may mention user_trades.
select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('jobs', 'job_applications', 'job_assignments', 'job_progress_updates')
      and coalesce(qual, '') || coalesce(with_check, '') like '%user_trades%')::int,
  0, 'NO RLS POLICY IN THE JOBS DOMAIN REFERENCES user_trades');

-- Nor may any of its write paths or readers.
select is(
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and (p.proname like 'job\_%' or p.proname like '\_open\_job%' or p.proname like '\_my\_job%')
     and pg_get_functiondef(p.oid) like '%user_trades%')::int,
  0, 'NO JOBS FUNCTION READS user_trades — trade is a signal, never authority');

-- The taxonomy cannot be edited through this domain: no Jobs function writes to
-- public.trades, so posting a job can never invent, rename or retire a trade.
select is(
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and p.proname like 'job%'
     and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\s+public\.trades')::int,
  0, 'no Jobs authority can create, rename, retire or reorder a canonical trade');

-- The FK direction is the history-safe one: retiring a trade must never be able
-- to cascade into deleted work.
select is(
  (select confdeltype from pg_constraint
    where conrelid = 'public.jobs'::regclass and confrelid = 'public.trades'::regclass),
  'r'::"char", 'jobs.trade_id is ON DELETE RESTRICT — history is never deleted to tidy a vocabulary');

-- Every write path is a definer function with a pinned search_path.
select is(
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'job\_%'
     -- Postgres stores `set search_path = ''` as the quoted form
     -- `search_path=""`. Asserting that exact value rather than a prefix match
     -- proves the path is pinned EMPTY, not merely pinned — the distinction
     -- test 29 already makes for the catalog reader.
     and not (p.prosecdef and p.proconfig @> array['search_path=""']))::int,
  0, 'every public job_* function is SECURITY DEFINER with search_path pinned EMPTY');

-- And none of them takes a user id: acting as somebody else is unexpressible.
select is(
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'job\_%'
     and pg_get_function_arguments(p.oid) ~ 'p_(user|applicant|installer|actor)_id')::int,
  0, 'no Jobs RPC accepts a user id — the actor is always auth.uid()');

-- The lifecycle guards exist as triggers, so a future RPC bug cannot produce a
-- job whose history is not a legal path.
select has_trigger('public'::name, 'jobs'::name, 'jobs_status_transition'::name,
  'the job lifecycle graph is enforced by a trigger, not only by the RPCs');
select has_trigger('public'::name, 'jobs'::name, 'jobs_offer_immutable'::name,
  'the offer freeze is enforced by a trigger');
select has_trigger('public'::name, 'job_assignments'::name, 'job_assignments_status_transition'::name,
  'the assignment lifecycle graph is enforced by a trigger');
select has_trigger('public'::name, 'job_applications'::name, 'job_applications_status_transition'::name,
  'decided applications are made terminal by a trigger');

-- Forbidden jumps, proven against the guard directly.
select throws_ok(
  $$update public.jobs set status = 'completed'
     where id = 'f1000002-0000-4000-8000-000000000002'$$,
  '22023', null, 'draft -> completed is refused');

select throws_ok(
  $$update public.jobs set status = 'awarded'
     where id = 'f1000002-0000-4000-8000-000000000002'$$,
  '22023', null, 'draft -> awarded is refused');

select throws_ok(
  $$update public.jobs set status = 'open'
     where id = 'f1000001-0000-4000-8000-000000000001'$$,
  '22023', null, 'completed -> open is refused: a finished job cannot recruit again');

select lives_ok(
  $$update public.jobs set status = 'cancelled'
     where id = 'f1000002-0000-4000-8000-000000000002'$$,
  'draft -> cancelled is allowed');

-- The offer freeze, at the trigger.
select throws_ok(
  $$update public.jobs set offered_amount = 25000
     where id = 'f1000001-0000-4000-8000-000000000001'$$,
  '22023', null, 'the offer cannot change once someone has applied (O7)');

select throws_ok(
  $$update public.jobs set trade_id = (select id from public.trades where key = 'hvac')
     where id = 'f1000001-0000-4000-8000-000000000001'$$,
  '22023', null, 'and neither can the trade — an applicant consented to both');

-- Applying creates NO relationship inside the posting organization (§10.1).
select is(
  (select count(*) from public.memberships
    where user_id = '71000006-0000-4000-8000-000000000006'
      and organization_id = '9a000000-aaaa-4aaa-8aaa-000000000005')::int,
  0, 'an installer who applied, was assigned and completed the work gained NO membership');

-- The reserved audit vocabulary exists, and carries no monetary value.
select is(
  (select count(*) from public.audit_log
    where action in ('job.published', 'job.application.submitted', 'job.application.accepted',
                     'job.assignment.completed')
      and metadata::text ~ 'amount|offered|currency')::int,
  0, 'no Jobs audit event carries the offered amount');

select cmp_ok(
  (select count(*) from public.audit_log where action like 'job.%')::int, '>', 0,
  'the Jobs lifecycle emits audit events in the same transaction as the change');

-- Notifications are deliberately untouched by this increment.
select is(
  (select count(*) from public.notifications where event_type like 'job%')::int,
  0, 'this increment emits NO notification — the event seam is reserved, not wired');

-- ===========================================================================
-- K. An awarded job cannot be called off in one step
--
-- `draft_a` is currently AWARDED with a live assignment (section H re-awarded
-- it). Cancelling the opening from here would end that installer's work as an
-- unnamed side effect, with no reason attached to the record they will later
-- read. The engagement is ended first, on its own terms; only the resulting
-- open job can be cancelled.
-- ===========================================================================
reset role;

select throws_ok(
  format($$update public.jobs set status = 'cancelled' where id = %L$$,
    (select v from ids where k = 'draft_a')),
  '22023', null, 'awarded -> cancelled is refused by the lifecycle guard itself');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  format($$select public.job_cancel(%L, %s, 'The client pulled out.')$$,
    (select v from ids where k = 'draft_a'),
    (select version from public.jobs where id = (select v from ids where k = 'draft_a'))),
  '22023', null, 'and the poster cannot reach it through job_cancel either');

insert into ids
select 'asg_d', id from public.job_assignments
where job_id = (select v from ids where k = 'draft_a') and status <> 'cancelled';

select lives_ok(
  format($$select public.job_assignment_cancel(%L, %s, 'The client pulled out.')$$,
    (select v from ids where k = 'asg_d'),
    (select version from public.job_assignments where id = (select v from ids where k = 'asg_d'))),
  'the engagement is ended first, carrying its own reason');

reset role;
select is(
  (select status::text from public.jobs where id = (select v from ids where k = 'draft_a')),
  'open', 'which returns the opening to the pool');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_cancel(%L, %s, 'No longer needed.')$$,
    (select v from ids where k = 'draft_a'),
    (select version from public.jobs where id = (select v from ids where k = 'draft_a'))),
  'and only THEN can the opening be cancelled');

reset role;
select is(
  (select status::text from public.jobs where id = (select v from ids where k = 'draft_a')),
  'cancelled', 'the job is cancelled');

select is(
  (select status::text from public.job_assignments where id = (select v from ids where k = 'asg_d')),
  'cancelled', 'the assignment is cancelled, in its own act');

select isnt(
  (select cancellation_reason from public.job_assignments where id = (select v from ids where k = 'asg_d')),
  null, 'and the installer can read WHY, which a one-step cancel would not have given them');

-- ===========================================================================
-- L. A withdrawal is reversible. A decision is not.
--
-- `withdrawn` is the applicant's own statement about their own availability,
-- and undoing it costs nobody anything. `accepted` and `rejected` are the
-- poster's decisions, and reversing either from the applicant's side would let
-- someone re-enter a competition they were already told they had lost.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  $$select public.job_create('9a000000-aaaa-4aaa-8aaa-000000000005',
      'Ceramic wall tiling - Zayed', 'tiling', 11000.00)$$,
  'a fresh opening is created for the resubmission rules');

reset role;
insert into ids select 'k_job', id from public.jobs where title = 'Ceramic wall tiling - Zayed';

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_publish(%L, 1)$$, (select v from ids where k = 'k_job')),
  'and published');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_submit(%L, 'First note.')$$,
    (select v from ids where k = 'k_job')),
  'an installer applies');

reset role;
insert into ids
select 'app_k', id from public.job_applications
where job_id = (select v from ids where k = 'k_job')
  and applicant_user_id = '71000006-0000-4000-8000-000000000006';

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_submit(%L, 'Keen.')$$, (select v from ids where k = 'k_job')),
  'and so does a second');

reset role;
insert into ids
select 'app_k2', id from public.job_applications
where job_id = (select v from ids where k = 'k_job')
  and applicant_user_id = '71000007-0000-4000-8000-000000000007';

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_reject(%L, 'Not this time.')$$,
    (select v from ids where k = 'app_k2')),
  'the poster rejects the second');

-- The withdrawal, and the return.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_withdraw(%L)$$, (select v from ids where k = 'app_k')),
  'the first applicant withdraws');

reset role;
select is(
  (select status::text from public.job_applications where id = (select v from ids where k = 'app_k')),
  'withdrawn', 'the candidacy is withdrawn');

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select public.job_application_submit((select v from ids where k = 'k_job'), 'Free again.')),
  (select v from ids where k = 'app_k'),
  'resubmitting returns THE SAME row, never a second candidacy');

reset role;
select is(
  (select status::text from public.job_applications where id = (select v from ids where k = 'app_k')),
  'submitted', 'and that row is submitted again');

select is(
  (select count(*) from public.job_applications
    where job_id = (select v from ids where k = 'k_job')
      and applicant_user_id = '71000006-0000-4000-8000-000000000006')::int,
  1, 'still exactly one application row for this person and this job');

select is(
  (select note from public.job_applications where id = (select v from ids where k = 'app_k')),
  'Free again.', 'carrying the note the person wrote when they came back');

-- A rejection is not undone by tapping Apply again.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';

select is(
  (select public.job_application_submit((select v from ids where k = 'k_job'), 'Please reconsider.')),
  (select v from ids where k = 'app_k2'),
  'a REJECTED applicant gets their own row back');

reset role;
select is(
  (select status::text from public.job_applications where id = (select v from ids where k = 'app_k2')),
  'rejected', 'AND IT IS STILL REJECTED — a decision is not resubmittable');

select is(
  (select note from public.job_applications where id = (select v from ids where k = 'app_k2')),
  'Keen.', 'the row was not touched at all — even the original note stands');

-- Nor is an acceptance. (f1000001 is completed by now, so this also proves the
-- decided branch returns BEFORE the job-state gate is consulted.)
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select public.job_application_submit('f1000001-0000-4000-8000-000000000001', 'again?')),
  (select v from ids where k = 'app_sayed'),
  'an ACCEPTED applicant gets their own row back');

reset role;
select is(
  (select status::text from public.job_applications where id = (select v from ids where k = 'app_sayed')),
  'accepted', 'and it stays accepted');

-- The guard, directly: exactly one edge leaves a non-submitted state.
select throws_ok(
  format($$update public.job_applications set status = 'submitted' where id = %L$$,
    (select v from ids where k = 'app_k2')),
  '22023', null, 'rejected -> submitted is refused by the guard');

select throws_ok(
  format($$update public.job_applications set status = 'submitted' where id = %L$$,
    (select v from ids where k = 'app_sayed')),
  '22023', null, 'accepted -> submitted is refused by the guard');

-- A withdrawal cannot be undone through a door a first-time applicant does not
-- have. Both gates apply to the return exactly as they apply to a fresh apply.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_application_withdraw(%L)$$, (select v from ids where k = 'app_k')),
  'the applicant withdraws a second time');

reset role;
update public.organizations set is_verified = false
  where id = '9a000000-aaaa-4aaa-8aaa-000000000005';

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  format($$select public.job_application_submit(%L)$$, (select v from ids where k = 'k_job')),
  '22023', null, 'a withdrawn candidacy cannot return while the poster is unverified');

reset role;
update public.organizations set is_verified = true
  where id = '9a000000-aaaa-4aaa-8aaa-000000000005';

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  format($$select public.job_close(%L, %s)$$,
    (select v from ids where k = 'k_job'),
    (select version from public.jobs where id = (select v from ids where k = 'k_job'))),
  'the poster stops recruiting');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  format($$select public.job_application_submit(%L)$$, (select v from ids where k = 'k_job')),
  '22023', null, 'nor once the job has stopped recruiting');

reset role;
select is(
  (select status::text from public.job_applications where id = (select v from ids where k = 'app_k')),
  'withdrawn', 'and the row is left untouched by either refusal');

select finish();
rollback;
