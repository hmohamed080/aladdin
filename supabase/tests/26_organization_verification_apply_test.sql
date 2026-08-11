-- pgTAP: apply an approved ORGANIZATION verification (Pilot UAT round 1 —
-- migration 20260813090002).
--
-- Proves the Admin approval now actually reaches the organization: an approved
-- organization verification, once applied, sets is_verified and releases a
-- pending_verification organization to active — idempotently, platform-only, and
-- never for a verification that has not been approved.
create extension if not exists pgtap;

begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- Fixtures: a pending organization and its submitted verification. The seeded
-- platform admin (55555555…) is the reviewer; 11111111… is an ordinary user.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, org_type, status, is_verified, primary_locale, created_by)
values ('a9000000-9999-4999-8999-000000000001', 'Zayed Marble Test', 'zayed-marble-test',
        'manufacturer', 'pending_verification', false, 'en',
        '11111111-1111-4111-8111-111111111111');

insert into public.verifications (id, subject_type, organization_id, verification_type, status, submitted_at)
values ('a9100000-9999-4999-8999-000000000001', 'organization', 'a9000000-9999-4999-8999-000000000001',
        'organization', 'submitted', now() - interval '1 day');

-- ===========================================================================
-- 1. Authorization
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.apply_organization_verification('a9100000-9999-4999-8999-000000000001') $$,
  '42501', null, 'an ordinary user cannot apply an organization verification');
reset role;

-- ===========================================================================
-- 2. Only an APPROVED verification can be applied
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select throws_ok(
  $$ select public.apply_organization_verification('a9100000-9999-4999-8999-000000000001') $$,
  '22023', null, 'a submitted (undecided) verification cannot be applied');

-- ===========================================================================
-- 3. The real decision path: start → approve → apply
-- ===========================================================================
select lives_ok(
  $$ select public.review_start('a9100000-9999-4999-8999-000000000001') $$,
  'the platform reviewer claims the organization review');
-- Public listing is professional-only; an organization approval must pass false
-- (this is exactly what the Admin console was getting wrong).
select throws_ok(
  $$ select public.review_approve('a9100000-9999-4999-8999-000000000001', true) $$,
  '23514', null, 'an organization approval cannot grant a public professional listing');
select lives_ok(
  $$ select public.review_approve('a9100000-9999-4999-8999-000000000001', false) $$,
  'the organization review is approved');

-- Approval alone records the decision only — the organization is untouched.
select is(
  (select is_verified from public.organizations where id = 'a9000000-9999-4999-8999-000000000001'),
  false, 'approval alone does not verify the organization (apply is a separate step)');

select lives_ok(
  $$ select public.apply_organization_verification('a9100000-9999-4999-8999-000000000001') $$,
  'the approved organization verification is applied');
select is(
  (select is_verified from public.organizations where id = 'a9000000-9999-4999-8999-000000000001'),
  true, 'applying sets organizations.is_verified');
select is(
  (select status::text from public.organizations where id = 'a9000000-9999-4999-8999-000000000001'),
  'active', 'applying releases a pending_verification organization to active');
select isnt(
  (select applied_at from public.verifications where id = 'a9100000-9999-4999-8999-000000000001'),
  null, 'the verification is stamped as applied');

-- Idempotent: re-applying changes nothing and does not raise.
select lives_ok(
  $$ select public.apply_organization_verification('a9100000-9999-4999-8999-000000000001') $$,
  're-applying an already-applied verification is a no-op');

reset role;

-- The apply is audited with the organization as both subject and tenant.
select is(
  (select count(*)::int from public.audit_log
   where action = 'organization.verified'
     and subject_id = 'a9000000-9999-4999-8999-000000000001'),
  1, 'applying emits exactly one organization.verified audit event');

select * from finish();
rollback;
