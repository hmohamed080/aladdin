-- pgTAP: membership & branch write-path RPCs (Sprint 2).
-- Authorized managers can invite/activate/change-role/suspend/revoke and assign
-- branches; unauthorized callers, escalation, cross-tenant assignment, and
-- last-owner orphaning are all denied.
create extension if not exists pgtap;

begin;
select plan(19);

-- ===== Authorized manager operations (A-owner on Org A) =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- invite the consumer (44) to Org A
select lives_ok(
  $$ select public.membership_invite('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444') $$,
  'a manager (org.members.manage) can invite a user');
select is(
  (select status::text from public.memberships where user_id='44444444-4444-4444-8444-444444444444' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'invited', 'the new membership starts invited (no active access yet)');

-- duplicate active membership denied (uq_memberships_user_org)
select throws_ok(
  $$ select public.membership_invite('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444') $$,
  '23505', null, 'a duplicate membership for the same (user, org) is denied');

-- no-escalation: cannot grant a capability the caller does not hold
select throws_ok(
  $$ select public.membership_set_capabilities(
       (select id from public.memberships where user_id='44444444-4444-4444-8444-444444444444' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
       array['quote.decide']) $$,
  '42501', null, 'a manager cannot grant a capability they do not themselves hold');

-- can grant a held capability
select lives_ok(
  $$ select public.membership_set_capabilities(
       (select id from public.memberships where user_id='44444444-4444-4444-8444-444444444444' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
       array['catalog.write']) $$,
  'a manager can grant a capability they hold');

-- ===== Membership lifecycle: invited grants no access until active =====
-- The invited consumer sees no org branches yet.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(app.is_org_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false,
  'an invited (pending) member is not yet an active org member');
-- the invited user activates their own membership
select lives_ok(
  $$ select public.membership_activate(
       (select id from public.memberships where user_id='44444444-4444-4444-8444-444444444444' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) $$,
  'the invited user can activate their own membership');
select is(app.is_org_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true,
  'after activation the user is an active org member');

-- ===== Branch assignment =====
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
-- cross-tenant assignment denied (Org B branch to an Org A membership)
select throws_ok(
  $$ select public.branch_assign(
       (select id from public.memberships where user_id='44444444-4444-4444-8444-444444444444' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
       'cb333333-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'a manager cannot assign a membership to another tenant''s branch');
-- same-tenant assignment succeeds
select lives_ok(
  $$ select public.branch_assign(
       (select id from public.memberships where user_id='44444444-4444-4444-8444-444444444444' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
       'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  'a manager can assign a same-tenant branch');
-- duplicate assignment is an idempotent no-op (no error)
select lives_ok(
  $$ select public.branch_assign(
       (select id from public.memberships where user_id='44444444-4444-4444-8444-444444444444' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
       'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  'a duplicate branch assignment is an idempotent no-op');
-- removal works
select lives_ok(
  $$ select public.branch_unassign(
       (select id from public.memberships where user_id='44444444-4444-4444-8444-444444444444' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
       'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  'a manager can remove a branch assignment');
-- primary_branch_id grants no hidden authority (the newly active member has none set,
-- and no explicit assignment now, so no branch is visible)
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from app.current_branch_ids('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') b), 0,
  'a member with no assignment and no capability sees no branches');

-- ===== Unauthorized callers =====
-- ordinary member cannot elevate themselves (no members.manage)
select throws_ok(
  $$ select public.membership_set_capabilities(
       (select id from public.memberships where user_id='44444444-4444-4444-8444-444444444444' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
       array['org.manage']) $$,
  '42501', null, 'an ordinary member cannot grant themselves capabilities');
-- non-member cannot invite into an org
select throws_ok(
  $$ select public.membership_invite('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444') $$,
  '42501', null, 'a non-member cannot invite into another tenant''s org');

-- ===== Revocation removes access; last-owner protection =====
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.membership_revoke(
       (select id from public.memberships where user_id='44444444-4444-4444-8444-444444444444' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) $$,
  'a manager can revoke a membership');
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(app.is_org_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false,
  'a revoked member loses org access immediately');
-- last-owner protection: A-owner cannot revoke themselves (last org.manage owner)
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.membership_revoke('e1111111-eeee-4eee-8eee-eeeeeeeeeee1') $$,
  '23514', null, 'the last active org.manage owner cannot be revoked');
select throws_ok(
  $$ select public.membership_suspend('e1111111-eeee-4eee-8eee-eeeeeeeeeee1') $$,
  '23514', null, 'the last active org.manage owner cannot be suspended');

select * from finish();
rollback;
