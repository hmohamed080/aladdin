-- pgTAP: Installer Pilot Increment 1 — Sales-affiliation persona hardening.
--
-- The security property under test:
--
--   An installer_technician (or any other non-Sales personal persona) must NEVER
--   obtain sales.* capabilities through the showroom affiliation flow — not by
--   creating a join request, not by having a previously-created request or
--   referral approved, and not by invoking any related public RPC directly.
--   The DATABASE enforces this, so bypassing the frontend gains nothing.
--
-- And the property that must NOT regress:
--
--   A legitimate salesperson — canonical persona OR the transitional declared
--   persona — keeps exactly the affiliation behaviour they had before.
--
-- Fixtures, all from seed-pilot:
--   70000001 — owner of Cairo Ceramics Showroom (org.members.manage; NULL persona)
--   70000002 — `sales` persona, ALREADY an active member of Cairo Ceramics
--   70000005 — NULL persona, owner of an unrelated wholesaler
--                → given a DECLARED sales persona here (the transitional path)
--   70000007 — Laila, `sales` persona, manages an UNRELATED business
--   70000008 — `engineer` persona (the unrelated non-Sales persona)
--   70000009 — `installer_technician` persona (the persona this increment is about)
--   55555555 — platform administrator
--   9c00…001 — Cairo Ceramics Showroom · b0000001-…001 — its Nasr City branch
--   9f00…004 — Delta Wholesale Supply (org_type wholesaler, for the type check)
create extension if not exists pgtap;

begin;
select plan(43);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002',
               '70000005-0000-4000-8000-000000000005', '70000007-0000-4000-8000-000000000007',
               '70000008-0000-4000-8000-000000000008', '70000009-0000-4000-8000-000000000009',
               '55555555-5555-4555-8555-555555555555');

-- The TRANSITIONAL fixture: a real salesperson between submitting their
-- professional profile and an Admin applying the upgrade. The canonical column is
-- still NULL — which is exactly the window in which gating on it alone would lock
-- a genuine salesperson out.
insert into public.individual_onboarding (user_id, prof_concrete_type)
values ('70000005-0000-4000-8000-000000000005', 'sales')
on conflict (user_id) do update set prof_concrete_type = 'sales';

-- ===========================================================================
-- 1. The predicate itself
-- ===========================================================================
select ok(app.is_sales_persona('70000007-0000-4000-8000-000000000007'),
  '1: the CANONICAL sales persona is a salesperson');
select ok(app.is_sales_persona('70000005-0000-4000-8000-000000000005'),
  '1: the DECLARED (transitional) sales persona is a salesperson');
select is(
  (select u.primary_account_type::text from public.users u
   where u.id = '70000005-0000-4000-8000-000000000005'),
  null, '1: ...and the transitional case really does have a NULL canonical persona');
select ok(not app.is_sales_persona('70000009-0000-4000-8000-000000000009'),
  '1: an installer_technician is NOT a salesperson');
select ok(not app.is_sales_persona('70000008-0000-4000-8000-000000000008'),
  '1: an engineer is NOT a salesperson');
select ok(not app.is_sales_persona(null),
  '1: a null user is NOT a salesperson');

-- ===========================================================================
-- 2. A canonical salesperson can still create the request (no regression)
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';
select isnt(
  public.showroom_join_request_create('9c000000-cccc-4ccc-8ccc-000000000001',
                                      'b0000001-0000-4000-8000-000000000001'),
  null, '2: a canonical salesperson creates the affiliation request');
reset role;
select is(
  (select r.status::text from public.organization_join_requests r
   where r.user_id = '70000007-0000-4000-8000-000000000007'
     and r.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  'pending', '2: ...and it is pending, exactly as before');

-- ===========================================================================
-- 3. The transitional salesperson is still allowed
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}';
select isnt(
  public.showroom_join_request_create('9c000000-cccc-4ccc-8ccc-000000000001'),
  null, '3: a DECLARED salesperson under review can still connect to their showroom');
select isnt(public.showroom_referral_save(
  null, 'Transitional Tiles LLC', 'Transitional Tiles', null, 'cairo', 'nasr_city', 'Main'),
  null, '3: ...and can still draft a referral');
reset role;

-- ===========================================================================
-- 4. The installer is rejected at every entry door
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_ok(
  $$ select public.showroom_join_request_create('9c000000-cccc-4ccc-8ccc-000000000001') $$,
  '42501', null, '4: an installer cannot create a showroom join request');
select throws_ok(
  $$ select public.showroom_referral_save(
       null, 'Installer Tiles LLC', 'Installer Tiles', null, 'cairo', 'nasr_city', 'Main') $$,
  '42501', null, '4: ...cannot draft a showroom referral');
select throws_ok(
  $$ select public.showroom_referral_submit(null) $$,
  '42501', null, '4: ...cannot submit one');
-- 8: direct invocation is the same call — there is no privileged path the UI has
-- and the installer does not. The table itself is unreachable too.
select throws_ok(
  $$ insert into public.organization_join_requests (user_id, organization_id)
     values ('70000009-0000-4000-8000-000000000009',
             '9c000000-cccc-4ccc-8ccc-000000000001') $$,
  '42501', null, '8: ...and cannot write the request table directly');

-- ===========================================================================
-- 5. Another unrelated personal persona is rejected the same way
-- ===========================================================================
set local request.jwt.claims = '{"sub":"70000008-0000-4000-8000-000000000008","role":"authenticated"}';
select throws_ok(
  $$ select public.showroom_join_request_create('9c000000-cccc-4ccc-8ccc-000000000001') $$,
  '42501', null, '5: an engineer cannot create a showroom join request either');
select throws_ok(
  $$ select public.showroom_referral_save(
       null, 'Engineer Tiles LLC', 'Engineer Tiles', null, 'cairo', 'nasr_city', 'Main') $$,
  '42501', null, '5: ...nor draft a referral');
reset role;

-- 9. Nothing was created by any of those refusals.
select is(
  (select count(*)::int from public.organization_join_requests r
   where r.user_id in ('70000009-0000-4000-8000-000000000009',
                       '70000008-0000-4000-8000-000000000008')),
  0, '9: a refused attempt left NO join request behind');
select is(
  (select count(*)::int from public.organization_referrals f
   where f.referred_by in ('70000009-0000-4000-8000-000000000009',
                           '70000008-0000-4000-8000-000000000008')),
  0, '9: ...and NO referral');
select is(
  (select count(*)::int from public.audit_log a
   where a.action in ('affiliation.requested', 'referral.submitted')
     and (a.metadata->>'user_id' = '70000009-0000-4000-8000-000000000009'
       or a.metadata->>'referred_by' = '70000009-0000-4000-8000-000000000009')),
  0, '10: ...and wrote no affiliation audit row');

-- ===========================================================================
-- 6. A request that ALREADY EXISTS cannot be approved into Sales authority
-- ===========================================================================
-- The row is inserted as the table owner, deliberately bypassing the RPC: this is
-- precisely a request created BEFORE this hardening shipped, sitting in an
-- Owner's queue. The gate must hold on the approval side too.
insert into public.organization_join_requests (id, user_id, organization_id, requested_branch_id, status)
values ('cafe0001-0000-4000-8000-000000000001',
        '70000009-0000-4000-8000-000000000009',
        '9c000000-cccc-4ccc-8ccc-000000000001',
        'b0000001-0000-4000-8000-000000000001', 'pending');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(app.has_capability('9c000000-cccc-4ccc-8ccc-000000000001', 'org.members.manage'),
  '5: the showroom owner genuinely holds org.members.manage');
select throws_ok(
  $$ select public.org_join_request_approve('cafe0001-0000-4000-8000-000000000001') $$,
  '42501', null,
  '5: an authorized Owner still cannot approve an INSTALLER''s pre-existing request');
reset role;

select is(
  (select count(*)::int from public.memberships m
   where m.user_id = '70000009-0000-4000-8000-000000000009'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  0, '5: no membership was created for the installer');
select is(
  (select count(*)::int from public.membership_capabilities c
   join public.memberships m on m.id = c.membership_id
   where m.user_id = '70000009-0000-4000-8000-000000000009'
     and c.capability_key like 'sales.%'),
  0, '5: the installer holds NO sales.* capability anywhere');
select is(
  (select r.status::text from public.organization_join_requests r
   where r.id = 'cafe0001-0000-4000-8000-000000000001'),
  'pending', '5: the request stays pending — a refused approval decides nothing');

-- ===========================================================================
-- 7. The REFERRAL approval path is closed by the same chokepoint
-- ===========================================================================
-- Same construction: a referral that already exists, approved by a real Admin.
-- app.membership_grant_sales refuses, and because the award and the approval
-- share one transaction, nothing at all survives — including Points.
insert into public.organization_referrals
  (id, referred_by, display_name, governorate, city, primary_branch_name, status)
values ('cafe0002-0000-4000-8000-000000000002',
        '70000009-0000-4000-8000-000000000009',
        'Installer Referred Tiles', 'cairo', 'nasr_city', 'Main', 'submitted');

select is((select count(*)::int from public.points_ledger), 0,
  '7: no Points exist before the attempted approval');

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.showroom_referral_approve('cafe0002-0000-4000-8000-000000000002') $$,
  '42501', null,
  '7: an Admin cannot approve an INSTALLER''s referral into Sales authority');
reset role;

select is(
  (select count(*)::int from public.organizations o where o.name = 'Installer Referred Tiles'),
  0, '7: the refused approval created NO organization');
select is((select count(*)::int from public.points_ledger), 0,
  '7: ...and NO Points entry — the whole transaction rolled back');
select is(
  (select f.status::text from public.organization_referrals f
   where f.id = 'cafe0002-0000-4000-8000-000000000002'),
  'submitted', '7: ...and the referral was not decided');

-- ===========================================================================
-- 8. A VALID Sales approval still grants exactly what it always granted
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select isnt(
  public.org_join_request_approve(
    (select r.id from public.organization_join_requests r
     where r.user_id = '70000007-0000-4000-8000-000000000007'
       and r.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001')),
  null, '6: the salesperson''s request is approved exactly as before');
reset role;

select is(
  (select m.status::text from public.memberships m
   where m.user_id = '70000007-0000-4000-8000-000000000007'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  'active', '6: ...activating exactly one membership');
-- The capability set is asserted as a SET, not a count: a hardening that quietly
-- dropped or added a capability would pass a count check.
select set_eq(
  $$ select c.capability_key from public.membership_capabilities c
     join public.memberships m on m.id = c.membership_id
     where m.user_id = '70000007-0000-4000-8000-000000000007'
       and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001' $$,
  array['catalog.read',
        'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
        'sales.task.write', 'sales.followup.send',
        'rfq.create', 'rfq.respond', 'quote.submit',
        'project.read', 'conversation.participate'],
  '6: ...with the UNCHANGED sales capability set');
select is(
  (select count(*)::int from public.membership_branch_access a
   join public.memberships m on m.id = a.membership_id
   where m.user_id = '70000007-0000-4000-8000-000000000007'
     and a.branch_id = 'b0000001-0000-4000-8000-000000000001'),
  1, '6: ...and the requested branch scope');
-- Never an owner or manager OF THE SHOWROOM: the affiliation grants a seat, not
-- the business. Scoped to Cairo Ceramics on purpose — Laila legitimately manages
-- a DIFFERENT organization, and an unscoped count would read her authority there
-- as authority here, which is the very confusion this flow must not create.
select is(
  (select count(*)::int from public.membership_capabilities c
   join public.memberships m on m.id = c.membership_id
   where m.user_id = '70000007-0000-4000-8000-000000000007'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'
     and c.capability_key in ('org.manage', 'org.members.manage')),
  0, '6: ...and never owner/manager authority IN THE SHOWROOM');

-- ===========================================================================
-- 9. Existing organization/type/capability rules are untouched
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok(
  $$ select public.showroom_join_request_create('9f000000-ffff-4fff-8fff-000000000004') $$,
  '22023', null, '7: a non-showroom organization is still refused on TYPE, not persona');
select throws_ok(
  $$ select public.showroom_join_request_create(
       '9c000000-cccc-4ccc-8ccc-000000000001',
       'b0000009-0000-4000-8000-000000000009') $$,
  '22023', null, '7: a foreign branch id is still refused');
-- Already a member: 70000002 is a salesperson who already works at Cairo Ceramics.
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.showroom_join_request_create('9c000000-cccc-4ccc-8ccc-000000000001') $$,
  '23505', null, '7: an existing member is still refused as a member, not a persona');
-- And the capability check still comes first for an unauthorised approver.
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';
select throws_ok(
  $$ select public.org_join_request_approve('cafe0001-0000-4000-8000-000000000001') $$,
  '42501', null, '7: a caller without org.members.manage is still refused');
reset role;

-- ===========================================================================
-- 10. Audit behaviour for the legitimate flow is unchanged
-- ===========================================================================
select is(
  (select count(*)::int from public.audit_log a
   where a.action = 'affiliation.requested'
     and a.metadata->>'user_id' = '70000007-0000-4000-8000-000000000007'),
  1, '10: the salesperson''s request still writes affiliation.requested');
select is(
  (select count(*)::int from public.audit_log a
   where a.action = 'affiliation.approved'
     and a.metadata->>'user_id' = '70000007-0000-4000-8000-000000000007'
     and a.metadata->>'relationship' = 'sales_member'),
  1, '10: ...and the approval still writes affiliation.approved as sales_member');
select is(
  (select count(*)::int from public.audit_log a
   where a.action = 'membership.granted'
     and a.metadata->>'via' = 'showroom_affiliation'
     and a.metadata->>'user_id' = '70000007-0000-4000-8000-000000000007'),
  1, '10: ...and membership.granted via showroom_affiliation');

-- ===========================================================================
-- Structural: the hardening added no surface of its own
-- ===========================================================================
select ok(
  not has_function_privilege('authenticated', 'app.is_sales_persona(uuid)', 'execute'),
  'the predicate is internal — authenticated cannot call it');
select ok(
  has_function_privilege('authenticated', 'public.showroom_join_request_create(uuid,uuid,text)', 'execute'),
  'the existing RPC grant survived create-or-replace');

select finish();
rollback;
