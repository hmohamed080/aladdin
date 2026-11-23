-- pgTAP: business creation through the registration wrappers (Sprint 8, updated
-- for the Sprint 12 account/workspace model).
--
-- Proves the owner org-creation path is server-authoritative and caller-scoped:
-- business_submit enforces the required fields and then TRANSACTIONALLY creates the
-- organization (pending_verification, never self-verified) + the owner's ACTIVE
-- membership + the full owner capability grant + the primary branch, drives
-- my_registration_state() to active_personal, and emits the organization.created
-- audit. The internal org-creation helper is not callable by clients, direct table
-- writes are denied, and RLS is self-only.
--
-- Sprint 12 changes pinned here:
--   * the business-TRACK gate is gone. Any verified caller may create a business —
--     an existing Engineer adding one is on the professional track, and refusing
--     them would contradict "one person, many businesses".
--   * the owner/manager CONFIRMATION is gone. Creating a business is what makes
--     the creator its owner; there is nothing to confirm.
--   * both wrappers operate on the caller's open business_creation_drafts row, so
--     there is one persistence model behind every entry point.
create extension if not exists pgtap;

begin;
select plan(24);

-- Omar (44…) is our fresh business registrant; Layla (11…) is an unrelated caller.
update auth.users set email_confirmed_at = now()
  where id in ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111');
update public.users set status = 'pending_verification'
  where id = '44444444-4444-4444-8444-444444444444';

-- Omar is a genuine business registrant: a business-only identity holds NO personal
-- persona (the seed fixture carries one, which would make him a persona-holder).
update public.users set primary_account_type = null
  where id = '44444444-4444-4444-8444-444444444444';

set local role authenticated;

-- ===== walk Omar through the shared steps to the business handoff =====
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en');
select public.onboarding_save_profile('Omar Hassan', 'en');
select public.onboarding_save_contact('01012345678');
select public.onboarding_select_account_type('business', 'supplier');
-- Staging-prep Increment 7 (20260924090007_registration_state_access_ready.sql)
-- removed organization_setup_pending as a return value of
-- my_registration_state() — once account_type_completed_at is set, the only
-- remaining gate before access_ready is the mandatory username step.
select is((select public.my_registration_state()), 'access_ready',
  'a business selection with no username yet lands on access_ready (P1 M1: username_pending is gone)');

-- ===== required-field gates on submit =====
-- A draft exists but carries no name yet.
select lives_ok(
  $$ select public.business_save(p_display_name => null) $$,
  'business_save opens a draft even before any answer is given');
select throws_ok(
  $$ select public.business_submit() $$,
  '22023', null, 'submit requires a business name');
select lives_ok(
  $$ select public.business_save(p_display_name => '  Al-Noor Supply  ') $$,
  'business_save persists the accumulated draft');
select is((select display_name from public.business_creation_drafts
           where user_id='44444444-4444-4444-8444-444444444444' and completed_at is null),
  'Al-Noor Supply', 'the display name is trimmed and persisted');
select throws_ok(
  $$ select public.business_submit() $$,
  '22023', null, 'submit requires a business type');
select lives_ok(
  $$ select public.business_save(p_display_name => 'Al-Noor Supply', p_org_type => 'supplier') $$,
  'business_save records the type before the legal name is known');
select throws_ok(
  $$ select public.business_submit() $$,
  '22023', 'a legal business name is required', 'submit requires a legal business name');

-- ===== successful creation (no owner confirmation is asked for) =====
select lives_ok(
  $$ select public.business_save(p_legal_name => 'Al-Noor Supply Trading LLC', p_display_name => 'Al-Noor Supply',
       p_org_type => 'supplier', p_primary_branch_name => 'Cairo HQ') $$,
  'business_save records the org type and primary branch');
select lives_ok(
  $$ select public.business_submit() $$,
  'business_submit creates the organization');

-- The legal name is persisted on the organization (private); the display name stays the organization name.
select is(
  (select o.legal_name || '|' || o.name from public.organizations o
    where o.created_by = '44444444-4444-4444-8444-444444444444'),
  'Al-Noor Supply Trading LLC|Al-Noor Supply', 'organizations.legal_name receives the legal name; name stays the display name');

-- The organization starts pending_verification and is NOT self-verified.
select is(
  (select o.status::text || '|' || o.is_verified::text || '|' || o.org_type::text
   from public.organizations o where o.created_by='44444444-4444-4444-8444-444444444444'),
  'pending_verification|false|supplier',
  'the org is created pending_verification, unverified, with the chosen type');

-- The owner has an ACTIVE membership with the primary branch wired in.
select is(
  (select m.status::text from public.memberships m
   join public.organizations o on o.id = m.organization_id
   where m.user_id='44444444-4444-4444-8444-444444444444' and o.created_by='44444444-4444-4444-8444-444444444444'),
  'active', 'the creator receives an active membership automatically');
select is(
  (select b.name from public.branches b
   join public.memberships m on m.primary_branch_id = b.id
   where m.user_id='44444444-4444-4444-8444-444444444444'),
  'Cairo HQ', 'the primary branch is created and wired as the membership home branch');

-- The owner holds org.manage (drives workspace sales authority) and the full set.
select is(
  (select count(*)::int from public.membership_capabilities c
   join public.memberships m on m.id = c.membership_id
   where m.user_id='44444444-4444-4444-8444-444444444444' and c.capability_key='org.manage'),
  1, 'the creator is granted org.manage — owner by relationship');
select is(
  (select count(*)::int from public.membership_capabilities c
   join public.memberships m on m.id = c.membership_id
   where m.user_id='44444444-4444-4444-8444-444444444444'),
  -- 27 founder keys + the four Sales delegation keys for launched business types
  -- (20261026090001_owner_sales_delegation_capabilities.sql).
  31, 'the owner receives the full org capability set');

-- Now an active member -> the workspace.
select is((select public.my_registration_state()), 'active_personal',
  'after org creation the owner resolves to active_personal (workspace)');

-- Idempotent: re-submitting returns the same org, does not create a second one.
select lives_ok(
  $$ select public.business_submit() $$,
  'business_submit is idempotent after the org exists');
select is(
  (select count(*)::int from public.organizations where created_by='44444444-4444-4444-8444-444444444444'),
  1, 'no duplicate organization is created on re-submit');

-- The business type was never written onto the person.
select is(
  (select u.primary_account_type::text from public.users u
   where u.id = '44444444-4444-4444-8444-444444444444'),
  null,
  'creating a supplier business does NOT make the creator a "supplier" (a business-only identity holds no persona)');

-- ===== audit + authorization boundaries =====
reset role;
select is(
  (select count(*)::int from public.audit_log
   where action='organization.created'
     and organization_id in (select id from public.organizations where created_by='44444444-4444-4444-8444-444444444444')),
  1, 'org creation emits an organization.created audit event');
set local role authenticated;

-- Direct client writes to the draft table are denied (RPC-only).
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ insert into public.business_creation_drafts (user_id, display_name)
     values ('11111111-1111-4111-8111-111111111111', 'X') $$,
  '42501', null, 'direct client insert into business_creation_drafts is denied');
-- A caller cannot read another user's draft (RLS self-only).
select is(
  (select count(*)::int from public.business_creation_drafts where user_id='44444444-4444-4444-8444-444444444444'),
  0, 'a user cannot read another user''s business creation draft');
-- The internal org-creation helper is not callable by clients.
select throws_ok(
  $$ select app.organization_create_owned('Sneaky Org', 'supplier', 'en', null, 'Sneaky Org LLC') $$,
  '42501', null, 'app.organization_create_owned is internal (not client-callable)');

select * from finish();
rollback;
