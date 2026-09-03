-- pgTAP: Installer Pilot Increment 12 — reviews of completed work.
--
-- A review is the one thing in this product where an ORGANIZATION makes a
-- lasting public claim about a NAMED PERSON who cannot reply to it. Almost every
-- assertion below follows from taking that asymmetry seriously:
--
--   * it must be earned — only completed work, only by the organization that
--     hired them, only once;
--   * it must be honest afterwards — nobody can edit or delete it, including
--     every security-definer function in this schema, so a review cannot be
--     quietly softened or sharpened once the professional has seen it;
--   * it must be answerable by somebody — moderation exists, is append-only, and
--     belongs to platform staff rather than to either interested party;
--   * and it must not expose the person who wrote it, because the reviewed
--     professional cannot reply and an individual name on that surface is a
--     personal record wearing a business record's clothes.
--
-- THE FIXTURE IS BUILT THROUGH THE REAL RPCs — create, publish, apply, accept,
-- start, 100%, complete — rather than by inserting rows. A review is defined by
-- the state of the work it is about, so a hand-built assignment would test the
-- function against a world the product cannot actually produce.
--
-- Fixtures, from seed-pilot:
--   70000006 — contractor persona, holds job.manage on Horizon Contracting
--   71000006 — installer_technician, profile LISTED (the reviewed professional)
--   71000001 — a DIFFERENT organization's owner
--   11111111 — given the platform moderator role here, and only here
create extension if not exists pgtap;

begin;
select plan(65);

\set poster    '70000006-0000-4000-8000-000000000006'
\set installer '71000006-0000-4000-8000-000000000006'
\set outsider  '71000001-0000-4000-8000-000000000001'
\set moderator '11111111-1111-4111-8111-111111111111'
\set org       '9a000000-aaaa-4aaa-8aaa-000000000005'

-- ===========================================================================
-- A. The shape, and the columns that are deliberately absent
-- ===========================================================================
select has_table('public'::name, 'job_reviews'::name, 'job_reviews exists');
select has_table('public'::name, 'job_review_moderations'::name, 'the moderation history exists');

select col_is_unique('public'::name, 'job_reviews'::name, array['assignment_id'],
  'assignment_id is UNIQUE, so "one review per completed assignment" is a shape rather than a rule somebody remembers');

-- The absences are the product decision. Each of these would need an authority
-- that does not exist, and a per-category score in particular would be five
-- numbers nobody ever entered.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'job_reviews'
      and (column_name::text collate "C" like '%vote%'
        or column_name::text collate "C" like '%helpful%'
        or column_name::text collate "C" like '%like%'
        or column_name::text collate "C" like '%repl%'
        or column_name::text collate "C" like '%recommend%'
        or column_name::text collate "C" like '%sentiment%'
        or column_name::text collate "C" like '%score%'
        or column_name::text collate "C" like '%verif%'
        or column_name::text collate "C" like '%quality%'
        or column_name::text collate "C" like '%speed%'
        or column_name::text collate "C" like '%communication%')),
  0,
  'No votes, likes, replies, recommendation flag, sentiment, AI score, verification badge or per-category rating — each would need an authority this product does not have');

-- No updated_at, and that is not an oversight: the row cannot change, so a
-- column recording when it changed would be a permanent lie.
select hasnt_column('public'::name, 'job_reviews'::name, 'updated_at'::name,
  'and no updated_at, because an immutable row has nothing to say about when it was updated');

select has_column('public'::name, 'job_reviews'::name, 'submitted_by'::name,
  'submitted_by is recorded for audit and authority');

-- ===========================================================================
-- B. Grants and RLS
-- ===========================================================================
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('job_reviews', 'job_review_moderations')
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'No client role holds INSERT, UPDATE or DELETE on either table: the RPCs are the entire write path');

-- The Increment 11 defect, asserted for the new tables. TRUNCATE is granted by
-- Supabase default privileges and is NOT restricted by RLS.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('job_reviews', 'job_review_moderations')
      and privilege_type = 'TRUNCATE' and grantee <> 'postgres'),
  0,
  'and nobody but the owner holds TRUNCATE, which RLS would not have restricted');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_review_moderations'
      and grantee in ('anon', 'authenticated')),
  0,
  'The moderation history is not readable by ANY client role — a reader learning that a review was suppressed, or why, would be reading the moderation decision itself');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_reviews' and grantee = 'anon'),
  0,
  'and anon holds nothing on job_reviews — the public reads the projection, never the table');

-- ===========================================================================
-- C. The fixture: one completed assignment, built the way the product builds one
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.job', public.job_create(
  :'org'::uuid, 'Marble staircase cladding - Fifth Settlement',
  (select key from public.trades where is_active order by sort_order limit 1),
  9000::numeric, 'Full cladding, 18 steps.', 'Cairo', 'New Cairo', 'Street 9', 4::smallint)::text, true);
select lives_ok(
  format($$select public.job_publish(%L, 1)$$, current_setting('t.job')),
  'A job is published');
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.app', public.job_application_submit(
  current_setting('t.job')::uuid, 'Available next week.')::text, true);
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.asg', public.job_application_accept(current_setting('t.app')::uuid)::text, true);
reset role;
set local request.jwt.claims = '';

-- BEFORE COMPLETION, and this is the assertion the whole domain hangs on.
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  format($$select public.job_review_submit(%L, 5::smallint, 'early')$$, current_setting('t.asg')),
  '22023', null,
  'A SCHEDULED assignment cannot be reviewed: there is nothing yet to have an opinion about');
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  format($$select public.job_assignment_start(%L, 1)$$, current_setting('t.asg')),
  'The installer starts the work');
select lives_ok(
  format($$select public.job_progress_add(%L, 100::smallint, 'wrap', 'Finished.')$$,
    current_setting('t.asg')),
  'and reports it finished');
reset role;
set local request.jwt.claims = '';

-- IN PROGRESS AT 100% IS STILL NOT COMPLETE. Increment 9 drew that line; this
-- asserts the review domain honours it rather than treating a claim as a fact.
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  format($$select public.job_review_submit(%L, 5::smallint, 'early')$$, current_setting('t.asg')),
  '22023', null,
  'Work REPORTED finished at 100% still cannot be reviewed — the installer''s claim is not the organization''s confirmation');

select lives_ok(
  format($$select public.job_assignment_complete(%L,
    (select version from public.job_assignments where id = %L))$$,
    current_setting('t.asg'), current_setting('t.asg')),
  'The organization confirms completion');
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- D. Who may review
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  format($$select public.job_review_submit(%L, 5::smallint, 'great me')$$, current_setting('t.asg')),
  '42501', null,
  'THE INSTALLER CANNOT REVIEW THEMSELVES — the same refusal a stranger gets, because they hold no capability on the posting organization');
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format($$select public.job_review_submit(%L, 1::smallint, 'bad')$$, current_setting('t.asg')),
  '42501', null,
  'ANOTHER ORGANIZATION cannot review work it did not commission');
reset role;
set local request.jwt.claims = '';

set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  format($$select public.job_review_submit(%L, 1::smallint, null)$$, current_setting('t.asg')),
  '42501', null,
  'and an anonymous caller cannot reach the function at all');
reset role;

-- ===========================================================================
-- E. Submission
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  format($$select public.job_review_submit(%L, 6::smallint, null)$$, current_setting('t.asg')),
  '23514', null,
  'A rating of 6 is refused BY THE TABLE, so no writer can reach the column another way');
select throws_ok(
  format($$select public.job_review_submit(%L, 0::smallint, null)$$, current_setting('t.asg')),
  '23514', null,
  'and so is 0');

select set_config('t.rev',
  public.job_review_submit(current_setting('t.asg')::uuid, 5::smallint,
    'Excellent finish and on time. Would hire again.')::text, true);

-- IDEMPOTENT rather than an error. A double tap or a retried request converges
-- instead of failing at somebody who did nothing wrong — the shape
-- job_application_submit already uses.
select is(
  public.job_review_submit(current_setting('t.asg')::uuid, 1::smallint, 'a different opinion'),
  current_setting('t.rev')::uuid,
  'A second submission returns the FIRST review rather than raising, and rewrites nothing');

reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.job_reviews),
  1,
  'so exactly one review exists');
select is(
  (select rating from public.job_reviews),
  5::smallint,
  'still carrying the original rating, not the second attempt''s');

select is(
  (select submitted_by from public.job_reviews),
  :'poster'::uuid,
  'and recording WHICH employee submitted it, for audit');

select is(
  (select count(*)::int from public.audit_log where action = 'job.review.submitted'),
  1,
  'The submission is audited');

-- ===========================================================================
-- F. Immutability
-- ===========================================================================
-- Not "clients cannot", but NOBODY can — the trigger refuses this transaction,
-- which is running as the table's owner. That is what makes immutability a
-- property of the table rather than a consequence of a withheld grant.
select throws_ok(
  $$update public.job_reviews set rating = 1$$,
  null, null,
  'No UPDATE succeeds, even here as the owning role');
select throws_ok(
  $$delete from public.job_reviews$$,
  null, null,
  'and no DELETE');

select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.job_reviews'::regclass and not tgisinternal),
  2,
  'Both guards are present, so the refusal is structural rather than a policy that could be widened');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname::text collate "C" like 'job_review%'
      and (p.prosrc like '%update public.job_reviews%'
        or p.prosrc like '%delete from public.job_reviews%')),
  0,
  'and no function in this schema even attempts to mutate a review');

-- ===========================================================================
-- G. The installer's read model
-- ===========================================================================
select is(
  (select array_agg(column_name::text order by column_name::text collate "C")
     from information_schema.columns
    where table_schema = 'public' and table_name = 'my_job_reviews'),
  array['comment', 'created_at', 'id', 'job_title', 'org_name', 'rating', 'trade_key'],
  'The installer''s projection carries the reviewing ORGANIZATION and the work context — and no submitted_by, no assignment id, no moderation state');

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select count(*)::int from public.my_job_reviews),
  1,
  'The reviewed professional sees their review');
select is(
  (select org_name from public.my_job_reviews),
  'Horizon Contracting',
  'named by the organization that wrote it');
select is(
  (select rating from public.my_job_reviews),
  5::smallint,
  'with the rating');
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is(
  (select count(*)::int from public.my_job_reviews),
  0,
  'and ANOTHER installer sees none of it');
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- H. The public projection
-- ===========================================================================
select is(
  (select array_agg(column_name::text order by column_name::text collate "C")
     from information_schema.columns
    where table_schema = 'public' and table_name = 'public_profile_reviews'),
  array['comment', 'created_at', 'id', 'job_title', 'org_name', 'profile_id', 'rating', 'trade_key'],
  'The public projection exposes only rendering data: no reviewer user id, no submitted_by, no assignment id, no moderation state, no hidden count');

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'public_profile_reviews'
      and column_name::text collate "C" like '%user_id%'),
  0,
  'and no user id of any kind, which is the rule 17_public_directory_hardening keeps for every public surface');

set local role anon;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.public_profile_reviews),
  1,
  'A signed-out visitor sees the review of a LISTED professional');
select is(
  (select org_name from public.public_profile_reviews),
  'Horizon Contracting',
  'attributed to the organization');
reset role;

-- Delisting withdraws every review at once, without touching a row.
update public.profiles set public_profile_status = 'hidden' where user_id = :'installer';
set local role anon;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.public_profile_reviews),
  0,
  'DELISTING the profile removes its reviews from the public projection immediately');
reset role;
select is(
  (select count(*)::int from public.job_reviews),
  1,
  'while the review itself is untouched — publication is a property of the profile, not of the review');

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select count(*)::int from public.my_job_reviews),
  1,
  'and the professional still sees it: being unlisted is not being erased');
reset role;
set local request.jwt.claims = '';

update public.profiles set public_profile_status = 'listed' where user_id = :'installer';
set local role anon;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.public_profile_reviews),
  1,
  'Relisting restores it with nothing to resubmit');
reset role;

-- ===========================================================================
-- I. Moderation
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  format($$select public.job_review_moderate(%L, 'suppress', 'we changed our mind')$$,
    current_setting('t.rev')),
  '42501', null,
  'THE ORGANIZATION THAT WROTE IT cannot suppress it — a review it can withdraw is not a review');
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  format($$select public.job_review_moderate(%L, 'suppress', 'unfair')$$, current_setting('t.rev')),
  '42501', null,
  'and neither can the professional it is about');
select throws_ok(
  $$select count(*) from public.job_review_moderations$$,
  '42501', null,
  'who also cannot read the moderation history at all');
reset role;
set local request.jwt.claims = '';

insert into public.platform_role_grants (user_id, role, granted_by)
values (:'moderator'::uuid, 'moderator', :'moderator'::uuid)
on conflict do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  format($$select public.job_review_moderate(%L, 'suppress', '   ')$$, current_setting('t.rev')),
  '22023', null,
  'A moderator must give a reason: an unexplained suppression is indistinguishable from a mistake');
select throws_ok(
  format($$select public.job_review_moderate(%L, 'delete', 'x')$$, current_setting('t.rev')),
  '22023', null,
  'and there is no "delete" action to reach for');
select lives_ok(
  format($$select public.job_review_moderate(%L, 'suppress', 'Defamatory language.')$$,
    current_setting('t.rev')),
  'A platform moderator suppresses it');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.job_reviews),
  1,
  'THE BASE REVIEW IS STILL THERE — suppression is a moderation act, never a delete');

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select count(*)::int from public.my_job_reviews),
  0,
  'It leaves the professional''s own surface too — showing them a review the public cannot see would let them read the moderation decision by inference');
reset role;
set local request.jwt.claims = '';

set local role anon;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.public_profile_reviews),
  0,
  'and it leaves the public one');
reset role;

select is(
  (select count(*)::int from public.audit_log where action = 'job.review.suppressed'),
  1,
  'The suppression is audited');

-- Restore is another row, not an undo.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  format($$select public.job_review_moderate(%L, 'restore', 'Reviewed on appeal.')$$,
    current_setting('t.rev')),
  'A later act restores it');
reset role;
set local request.jwt.claims = '';

set local role anon;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.public_profile_reviews),
  1,
  'and the review returns, because state is the LATEST act rather than a flag somebody flipped back');
reset role;

select is(
  (select count(*)::int from public.job_review_moderations),
  2,
  'with BOTH acts kept: a restore does not erase the suppression that preceded it');

select throws_ok(
  $$update public.job_review_moderations set reason = 'rewritten'$$,
  null, null,
  'The moderation history cannot be edited');
select throws_ok(
  $$delete from public.job_review_moderations$$,
  null, null,
  'nor deleted — append-only means append-only');

-- ===========================================================================
-- J. The review survives the world moving on
-- ===========================================================================
-- §6 and §2: a review is a historical record, and none of the ordinary discovery
-- changes may erase the context that makes it readable. Each of these would have
-- hidden the job, the trade or the organization from an ordinary reader.
-- The job is ALREADY out of discovery: completing an assignment moves the job to
-- `completed`, so `open_job_opportunities` has long since stopped returning it.
-- Retiring the trade and un-verifying the organization are the other two changes
-- that hide a row from an ordinary reader.
update public.trades set is_active = false
 where id = (select trade_id from public.jobs where id = current_setting('t.job')::uuid);
update public.organizations set is_verified = false where id = :'org'::uuid;

select is(
  (select status::text from public.jobs where id = current_setting('t.job')::uuid),
  'completed',
  'The job itself has already left discovery, which is the ordinary end state rather than a contrivance');

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select count(*)::int from public.my_job_reviews),
  1,
  'A RETIRED TRADE, an UNVERIFIED organization and a job out of discovery together do not erase the review');
select isnt(
  (select trade_key from public.my_job_reviews),
  null,
  'and the trade label the work was agreed under is still readable');
select isnt(
  (select job_title from public.my_job_reviews),
  null,
  'as is the job it was about');
reset role;
set local request.jwt.claims = '';

set local role anon;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.public_profile_reviews),
  1,
  'and the public projection survives the same three changes');
reset role;

-- ===========================================================================
-- K. Reviews grant nothing, and nothing grants reviews
-- ===========================================================================
select is(
  (select count(*)::int from public.memberships
    where user_id = :'installer'::uuid and organization_id = :'org'::uuid),
  0,
  'Being reviewed creates no membership in the reviewing organization');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename not in ('job_reviews', 'job_review_moderations')
      and (coalesce(qual, '') like '%job_reviews%' or coalesce(qual, '') like '%job_review_moderations%')),
  0,
  'and no policy anywhere else consults a review: a rating is never an authorization input');

select * from finish();
rollback;
