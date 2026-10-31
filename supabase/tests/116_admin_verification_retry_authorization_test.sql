-- pgTAP: administrative account verification — reviewer restrictions on the DECISION and on the RETRY path.
--
-- The Users directory / user page and the Verifications queue drive the SAME RPCs:
--   review_start → review_approve | review_reject → apply_account_upgrade (idempotent via applied_at).
-- The app's approve action now ALWAYS calls review_approve (even for an already-approved request) before the
-- apply step, because apply_account_upgrade only checks the `users.verify` permission. This file pins, as a hostile
-- client calling the RPCs directly, that:
--   A. permissions: an applicant, a Support user (no users.verify) and an anonymous caller cannot decide or apply;
--   B. review_approve on an approved request is a no-op for the assigned reviewer, refused for any other admin and
--      for the applicant, and writes no second audit event or notification;
--   C. the public-listing flag is reviewer-set: approving with it off verifies the account but never lists it;
--   D. apply is idempotent: applied_at and the audit trail do not change on a repeat;
--   E. a reviewer may not approve their own verification;
--   F. invalid transitions and the required rejection reason, with no side effects on a refusal.
--
-- Fixtures (seed): 55555555 holds the legacy `administrator` grant (users.verify). Every other staff role is granted
-- INSIDE THIS TRANSACTION ONLY; the whole file rolls back.
create extension if not exists pgtap;

begin;
select plan(41);

\set revA   '55555555-5555-4555-8555-555555555555'
\set revB   '22222222-2222-4222-8222-222222222222'
\set supp   '11111111-1111-4111-8111-111111111111'
\set appl   '44444444-4444-4444-8444-444444444444'
\set appl2  '33333333-3333-4333-8333-333333333333'

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon;

create function pg_temp.vid(p_user uuid) returns uuid language sql security definer as $$
  select id from public.verifications where user_id = p_user order by submitted_at desc limit 1 $$;
grant execute on function pg_temp.vid(uuid) to authenticated, anon;

-- Fixture roles (this transaction only): revB is a second Administrator, supp is read-only Support.
insert into public.platform_role_grants (user_id, role, granted_by) values (:'revB', 'administrator', :'revA');
insert into public.platform_role_grants (user_id, role, granted_by) values (:'supp', 'support', :'revA');

-- The applicant files a professional upgrade request; revB (a staff member) files one of their own.
select pg_temp.act_as(:'appl');
select lives_ok($$ select public.request_account_upgrade('engineer') $$, 'the applicant submits a professional upgrade request');
select pg_temp.act_as(:'revB');
select lives_ok($$ select public.request_account_upgrade('engineer') $$, 'a staff member submits a request of their own');
select pg_temp.as_dba();

-- ===========================================================================
-- A. Permissions on the decision and on apply
-- ===========================================================================
select pg_temp.act_as(:'appl');
select throws_ok($$ select public.review_start(pg_temp.vid('44444444-4444-4444-8444-444444444444')) $$, '42501', null,
  'the applicant cannot start the review of their own request');
select pg_temp.act_as(:'supp');
select throws_ok($$ select public.review_start(pg_temp.vid('44444444-4444-4444-8444-444444444444')) $$, '42501', null,
  'a Support user (read-only, no users.verify) cannot start a review');
select throws_ok($$ select public.review_reject(pg_temp.vid('44444444-4444-4444-8444-444444444444'), 'nope') $$, '42501', null,
  'a Support user cannot reject');
select pg_temp.as_dba();
select is((select status::text from public.verifications where id = pg_temp.vid(:'appl')), 'submitted',
  'refused calls left the request untouched');
set local role anon; set local request.jwt.claims = '';
select throws_ok($$ select public.review_approve(pg_temp.vid('44444444-4444-4444-8444-444444444444')) $$, '42501', null,
  'an anonymous caller cannot approve (no execute privilege)');
select pg_temp.as_dba();

-- ===========================================================================
-- C. Approval with the listing flag OFF verifies the account but never lists it
-- ===========================================================================
select pg_temp.act_as(:'revA');
select lives_ok($$ select public.review_start(pg_temp.vid('44444444-4444-4444-8444-444444444444')) $$, 'the reviewer claims the request');
select lives_ok($$ select public.review_approve(pg_temp.vid('44444444-4444-4444-8444-444444444444'), false) $$,
  'the reviewer approves WITHOUT a public listing');
select pg_temp.as_dba();
select is((select grants_public_listing from public.verifications where id = pg_temp.vid(:'appl')), false,
  'the decision records that no public listing was granted');
select is((select count(*)::int from public.audit_log where action = 'verification.approved' and subject_id = pg_temp.vid(:'appl')), 1,
  'the approval is audited exactly once');

-- ===========================================================================
-- B. Retry of an already-approved request
-- ===========================================================================
select pg_temp.act_as(:'revA');
select lives_ok($$ select public.review_approve(pg_temp.vid('44444444-4444-4444-8444-444444444444'), true) $$,
  'the ASSIGNED reviewer may re-confirm an approved request (idempotent no-op)');
select pg_temp.as_dba();
select is((select grants_public_listing from public.verifications where id = pg_temp.vid(:'appl')), false,
  'a retry cannot flip the recorded listing decision');
select is((select count(*)::int from public.audit_log where action = 'verification.approved' and subject_id = pg_temp.vid(:'appl')), 1,
  'a retry writes no second approval audit event');

select pg_temp.act_as(:'revB');
select throws_ok($$ select public.review_approve(pg_temp.vid('44444444-4444-4444-8444-444444444444')) $$, '42501',
  'only the assigned reviewer may confirm approval',
  'another administrator cannot re-confirm (retry) a decision they did not make');
select pg_temp.act_as(:'appl');
select throws_ok($$ select public.review_approve(pg_temp.vid('44444444-4444-4444-8444-444444444444')) $$, '42501', null,
  'the applicant cannot re-confirm their own approval');
select throws_ok($$ select public.apply_account_upgrade(pg_temp.vid('44444444-4444-4444-8444-444444444444')) $$, '42501', null,
  'the applicant cannot apply their own approved upgrade');
select pg_temp.act_as(:'supp');
select throws_ok($$ select public.apply_account_upgrade(pg_temp.vid('44444444-4444-4444-8444-444444444444')) $$, '42501', null,
  'a Support user cannot apply an approved upgrade');
select pg_temp.as_dba();
select is((select primary_account_type::text from public.users where id = :'appl'), 'end_consumer',
  'none of the refused calls changed the account type');
select is((select applied_at is null from public.verifications where id = pg_temp.vid(:'appl')), true,
  'nothing has been applied yet');

-- ===========================================================================
-- D. Apply is idempotent and honours the listing decision
-- ===========================================================================
select pg_temp.act_as(:'revA');
select lives_ok($$ select public.apply_account_upgrade(pg_temp.vid('44444444-4444-4444-8444-444444444444')) $$, 'the reviewer applies the upgrade');
select pg_temp.as_dba();
select is((select primary_account_type::text from public.users where id = :'appl'), 'engineer', 'the account type changed to the approved type');
select is((select count(*)::int from public.profile_public_directory where display_name like 'Omar%'), 0,
  'an approval without the listing flag does NOT publish the profile');
select is((select count(*)::int from public.audit_log where action = 'profile.listed' and subject_id = :'appl'), 0,
  'no profile.listed audit event was written');
create temp table t_applied on commit drop as
  select applied_at from public.verifications where id = pg_temp.vid(:'appl');
select pg_temp.act_as(:'revA');
select lives_ok($$ select public.apply_account_upgrade(pg_temp.vid('44444444-4444-4444-8444-444444444444')) $$, 'applying again is a no-op');
select pg_temp.as_dba();
select is((select applied_at from public.verifications where id = pg_temp.vid(:'appl')), (select applied_at from t_applied),
  'a repeat apply leaves applied_at unchanged');
select is((select count(*)::int from public.audit_log where action = 'account.type_changed' and subject_id = :'appl'), 1,
  'a repeat apply writes no second account.type_changed event');

-- ===========================================================================
-- E. A reviewer may not approve their own verification
-- ===========================================================================
select pg_temp.act_as(:'revA');
select lives_ok($$ select public.review_start(pg_temp.vid('22222222-2222-4222-8222-222222222222')) $$, 'revA claims revB''s request');
select lives_ok($$ select public.review_approve(pg_temp.vid('22222222-2222-4222-8222-222222222222'), false) $$, 'revA approves revB''s request');
select pg_temp.act_as(:'revB');
select throws_ok($$ select public.review_approve(pg_temp.vid('22222222-2222-4222-8222-222222222222')) $$, '42501',
  'a reviewer may not approve their own verification',
  'a staff member cannot confirm (retry) their OWN approved request, despite holding users.verify');
select pg_temp.as_dba();

-- ===========================================================================
-- F. Invalid transitions and the required rejection reason
-- ===========================================================================
select pg_temp.act_as(:'appl2');
select lives_ok($$ select public.request_account_upgrade('contractor') $$, 'a second applicant submits a request');
select pg_temp.act_as(:'revA');
select throws_ok($$ select public.review_approve(pg_temp.vid('33333333-3333-4333-8333-333333333333')) $$, '22023', null,
  'a submitted request cannot be approved before it is under review');
select lives_ok($$ select public.review_start(pg_temp.vid('33333333-3333-4333-8333-333333333333')) $$, 'revA claims it');
select throws_ok($$ select public.review_reject(pg_temp.vid('33333333-3333-4333-8333-333333333333'), '') $$, null, null,
  'a rejection without a reason is refused');
select throws_ok($$ select public.review_reject(pg_temp.vid('33333333-3333-4333-8333-333333333333'), '   ') $$, null, null,
  'a whitespace-only reason is refused');
select pg_temp.as_dba();
select is((select status::text from public.verifications where id = pg_temp.vid(:'appl2')), 'under_review',
  'refused rejections left the request under review');
select pg_temp.act_as(:'revA');
select lives_ok($$ select public.review_reject(pg_temp.vid('33333333-3333-4333-8333-333333333333'), 'Blurry ID') $$, 'a reasoned rejection succeeds');
select throws_ok($$ select public.review_approve(pg_temp.vid('33333333-3333-4333-8333-333333333333')) $$, '22023', null,
  'a rejected request cannot be approved');
select throws_ok($$ select public.apply_account_upgrade(pg_temp.vid('33333333-3333-4333-8333-333333333333')) $$, '22023', null,
  'a rejected request cannot be applied');
select throws_ok($$ select public.review_reject(pg_temp.vid('44444444-4444-4444-8444-444444444444'), 'late') $$, '22023', null,
  'an approved request cannot be rejected afterwards');
select pg_temp.as_dba();
select is((select primary_account_type::text from public.users where id = :'appl2'), 'engineer',
  'a rejection never changes the applicant''s account type');

select * from finish();
rollback;
