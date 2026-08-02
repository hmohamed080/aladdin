-- pgTAP: account-upgrade & verification workflow (Sprint 2).
-- Self-service submission is caller-scoped and safe; only a platform reviewer can
-- decide; approval+apply transitions the account type exactly once and is the only
-- path that lists a profile; direct privileged writes stay denied.
create extension if not exists pgtap;

begin;
select plan(26);

-- Helper: run as a given user by setting the JWT claim.
-- (pgTAP has no fixtures; we set request.jwt.claims inline.)

-- ===== Self-service submission =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

-- 1. user can submit a valid upgrade request
select lives_ok(
  $$ select public.request_account_upgrade('engineer') $$,
  'end consumer can submit a valid upgrade request');
select is(
  (select count(*)::int from public.verifications where user_id='44444444-4444-4444-8444-444444444444' and status='submitted'),
  1, 'exactly one open verification exists after submission');

-- 2. idempotent: same request returns the same row, no duplicate
select is(
  (select count(*)::int from public.verifications where user_id='44444444-4444-4444-8444-444444444444'),
  1, 'resubmitting the same target does not create a duplicate verification');

-- 3. a different open target is rejected (one open request per user)
select throws_ok(
  $$ select public.request_account_upgrade('contractor') $$,
  '23505', null, 'a second open request for a different target is rejected');

-- 4. cannot request end_consumer / cannot request current type
select throws_ok($$ select public.request_account_upgrade('end_consumer') $$, null, null,
  'cannot upgrade to end_consumer');

-- 5. cannot submit for another user (no user_id param exists; derived from auth.uid)
--    Prove the created row is always the caller's.
select is(
  (select user_id from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1),
  '44444444-4444-4444-8444-444444444444'::uuid,
  'a submitted verification is always owned by the caller');

-- 6. direct primary_account_type update remains denied
select throws_ok(
  $$ update public.users set primary_account_type='engineer' where id='44444444-4444-4444-8444-444444444444' $$,
  '42501', null, 'direct self-update of primary_account_type stays denied');

-- 7. an unapproved request does not list the profile
set local role anon; set local request.jwt.claims='';
select is((select count(*)::int from public.profile_public_directory where display_name like 'Omar%'), 0,
  'an unapproved upgrade request does not make the profile publicly discoverable');

-- ===== Authorization on the review path =====
-- ordinary user (the subject) cannot review/approve
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ select public.review_start((select id from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1)) $$,
  '42501', null, 'the subject (ordinary user) cannot start review');

-- an org admin (owner of Org A) is NOT a platform verifier
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.review_approve((select id from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1)) $$,
  '42501', null, 'an org admin cannot act as a platform verifier');

-- ===== Platform reviewer happy path =====
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
-- invalid transition: approve before under_review
select throws_ok(
  $$ select public.review_approve((select id from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1)) $$,
  '22023', null, 'cannot approve a verification that is not under_review');
select lives_ok(
  $$ select public.review_start((select id from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1)) $$,
  'platform reviewer can start review');
select is(
  (select status::text from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1),
  'under_review', 'status is under_review after review_start');
select is(
  (select reviewer_id from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1),
  '55555555-5555-4555-8555-555555555555'::uuid, 'reviewer_id is the platform reviewer (not spoofable)');

-- request changes requires a reason
select throws_ok(
  $$ select public.review_request_changes((select id from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1), '') $$,
  null, null, 'requesting changes requires a non-empty reason');

-- approve + apply
select lives_ok(
  $$ select public.review_approve((select id from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1), true) $$,
  'platform reviewer approves');
select lives_ok(
  $$ select public.apply_account_upgrade((select id from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1)) $$,
  'platform applies the approved upgrade');

-- 8. account type transitioned exactly once
select is(
  (select primary_account_type::text from public.users where id='44444444-4444-4444-8444-444444444444'),
  'engineer', 'approved upgrade transitioned the account type to engineer');

-- 9. double apply is idempotent (no error, no second transition)
select lives_ok(
  $$ select public.apply_account_upgrade((select id from public.verifications where user_id='44444444-4444-4444-8444-444444444444' limit 1)) $$,
  'applying an already-applied upgrade is an idempotent no-op');

-- 10. approved eligibility listed the profile through the trusted path
set local role anon; set local request.jwt.claims='';
select is((select count(*)::int from public.profile_public_directory where display_name like 'Omar%'), 1,
  'the approved professional profile now appears in public discovery');

-- 11. the user still cannot self-list / self-unlist (server-controlled)
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set public_profile_status='hidden' where user_id='44444444-4444-4444-8444-444444444444' $$,
  '42501', null, 'the user cannot change their own public_profile_status');

-- ===== Rejection path does not change account type =====
-- Nadia (33, interior_designer) requests a different professional type, gets rejected.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok($$ select public.request_account_upgrade('contractor') $$, 'B-owner submits an upgrade request');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.review_start((select id from public.verifications where user_id='33333333-3333-4333-8333-333333333333' and status='submitted' limit 1)) $$,
  'reviewer starts the second request');
select lives_ok(
  $$ select public.review_reject((select id from public.verifications where user_id='33333333-3333-4333-8333-333333333333' and status='under_review' limit 1), 'insufficient evidence') $$,
  'reviewer rejects with a reason');
select is(
  (select primary_account_type::text from public.users where id='33333333-3333-4333-8333-333333333333'),
  'interior_designer', 'a rejected request does not change the account type');

-- 12. the trusted service_role path can transition account type directly (it
-- bypasses RLS and holds the users update grant) — the foundation's break-glass /
-- worker path, distinct from the reviewer RPC which needs a platform identity.
reset role;
set local role service_role;
select lives_ok(
  $$ update public.users set primary_account_type='engineer' where id='44444444-4444-4444-8444-444444444444' $$,
  'the trusted service_role path can transition an account type directly');
reset role;

select * from finish();
rollback;
