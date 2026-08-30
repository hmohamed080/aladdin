-- pgTAP: the ONE approved Points earning event —
-- referral.organization_approved = 100 (docs/database/points-core.md, D1).
--
-- Proves that the award is a side effect of the authoritative Admin approval
-- transition (public.showroom_referral_approve) and of nothing else:
--   • +100 exactly, to the salesperson named by the organization's WRITE-ONCE
--     provenance — never the approver, never the owner, never the organization
--   • the deterministic identity is ('organization', organizations.id), so a
--     retry and a concurrent-equivalent duplicate both fail to pay twice
--   • the LINKING path awards nothing: a business that already existed was not
--     brought to Aladdin by this referral, so it has no attributed recipient
--   • submission, rejection and every non-approved transition award nothing
--   • award and approval are one transaction — a failed approval leaves no entry
--   • the pre-existing approval, audit and membership behaviour is unchanged
--
-- Fixtures, all from seed-pilot (the same ones 28_persona_sales_affiliation
-- uses, so the two suites describe one world):
--   70000002 — a `sales` persona, our referring salesperson
--   70000009 — an installer persona, an unrelated third party who also refers
--   70000001 — owner of Cairo Ceramics Showroom (business-only identity)
--   55555555 — platform administrator (the approver)
--   9c00…001 — Cairo Ceramics Showroom, which ALREADY EXISTS (the linking case)
create extension if not exists pgtap;

begin;
select plan(52);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001',
               '70000002-0000-4000-8000-000000000002',
               '70000009-0000-4000-8000-000000000009',
               '55555555-5555-4555-8555-555555555555');

-- The ledger starts empty: every entry this suite observes was written by the
-- approval transition under test, not by a fixture.
select is((select count(*)::int from public.points_ledger), 0,
  'the ledger is empty before any approval');

-- ===========================================================================
-- 1. Submitting a referral awards NOTHING
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select isnt(public.showroom_referral_save(
  null, 'Zayed Tiles LLC', 'Zayed Tiles', 'Tiles and sanitary ware',
  'giza', 'sheikh_zayed', 'Zayed Main'), null, 'a referral draft is created');
select isnt(public.showroom_referral_submit(null), null, '...and submitted');

reset role;
select is((select count(*)::int from public.points_ledger), 0,
  'SUBMITTING a referral awards nothing — a request is not an outcome');

-- ===========================================================================
-- 2. Rejection awards nothing
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select isnt(public.showroom_referral_save(
  null, 'Rejected Tiles LLC', 'Rejected Tiles', null,
  'cairo', 'nasr_city', 'Main'), null, 'a second salesperson drafts a referral');
select isnt(public.showroom_referral_submit(null), null, '...and submits it');

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.showroom_referral_reject(
       (select id from public.organization_referrals
        where referred_by = '70000009-0000-4000-8000-000000000009' and status = 'submitted'),
       'Not a real business') $$,
  'the administrator rejects it');

reset role;
select is((select count(*)::int from public.points_ledger), 0,
  'REJECTION awards nothing');
select is(
  (select count(*)::int from public.points_ledger
   where user_id = '70000009-0000-4000-8000-000000000009'),
  0, 'the rejected salesperson holds no points');

-- ===========================================================================
-- 3. Approval of a genuinely new referred business — the award
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select isnt(
  public.showroom_referral_approve(
    (select id from public.organization_referrals
     where referred_by = '70000002-0000-4000-8000-000000000002' and status = 'submitted')),
  null, 'the referred showroom is approved');

reset role;
select is((select count(*)::int from public.points_ledger), 1,
  'approval wrote exactly ONE ledger entry');

select is(
  (select points_delta from public.points_ledger),
  100, 'the award is exactly +100 Points');

select is(
  (select user_id from public.points_ledger),
  '70000002-0000-4000-8000-000000000002'::uuid,
  'the recipient is the canonical referring salesperson');

select is(
  (select event_type from public.points_ledger),
  'referral.organization_approved', 'the event key is referral.organization_approved');

select is(
  (select source_type from public.points_ledger),
  'organization', 'source_type is the approved deterministic source: organization');

select is(
  (select source_id from public.points_ledger),
  (select id from public.organizations where name = 'Zayed Tiles'),
  'source_id is the referred organization''s own id');

select is(
  (select organization_id from public.points_ledger),
  (select id from public.organizations where name = 'Zayed Tiles'),
  'the organization is retained as business CONTEXT on the entry');

-- The recipient came from the write-once provenance, not from the request.
select is(
  (select o.referred_by_user_id from public.organizations o where o.name = 'Zayed Tiles'),
  (select user_id from public.points_ledger),
  'the recipient equals the organization''s immutable referral provenance');

-- Points are user-owned: the organization earns nothing of its own.
select is(
  (select count(*)::int from public.points_ledger
   where user_id in (select id from public.users
                     where id = (select referred_by_user_id from public.organizations
                                 where name = 'Zayed Tiles'))),
  1, 'the points are owned by a PERSON — the organization holds no balance of its own');

select is((select public.points_balance('70000002-0000-4000-8000-000000000002')), 100::bigint,
  'the salesperson''s derived balance increased by exactly 100');

-- Nobody else is paid for the transition.
select is((select public.points_balance('55555555-5555-4555-8555-555555555555')), 0::bigint,
  'the APPROVER receives nothing merely for approving');
select is((select public.points_balance('70000001-0000-4000-8000-000000000001')), 0::bigint,
  'an organization OWNER receives nothing merely for ownership');
select is((select public.points_balance('70000009-0000-4000-8000-000000000009')), 0::bigint,
  'an unrelated salesperson receives nothing');

-- No notification was emitted for the award (deferred by the spec).
select is(
  (select count(*)::int from public.notifications where event_type like 'points%'),
  0, 'the award emits no notification — that seam is deferred');

-- ===========================================================================
-- 4. Retry and concurrent-equivalent duplication
-- ===========================================================================
-- Re-approving an already-approved referral returns its organization unchanged
-- (the RPC's own idempotency) and must not pay a second time.
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(
  public.showroom_referral_approve(
    (select id from public.organization_referrals
     where referred_by = '70000002-0000-4000-8000-000000000002')),
  (select id from public.organizations where name = 'Zayed Tiles'),
  'a retried approval returns the same organization');

reset role;
select is((select count(*)::int from public.points_ledger), 1,
  'the retried approval wrote NO second entry');
select is((select public.points_balance('70000002-0000-4000-8000-000000000002')), 100::bigint,
  'the balance is still exactly 100 after the retry');

-- The second guard, independent of the RPC's status check: a concurrent
-- transaction re-presenting the same canonical identity is rejected by the
-- unique index itself. This is what protects two simultaneous approvals, which
-- the status check alone could not (both would read 'submitted' before either
-- committed).
select throws_ok(
  $$ insert into public.points_ledger
       (user_id, organization_id, event_type, points_delta, source_type, source_id)
     values ('70000002-0000-4000-8000-000000000002',
             (select id from public.organizations where name = 'Zayed Tiles'),
             'referral.organization_approved', 100, 'organization',
             (select id from public.organizations where name = 'Zayed Tiles')) $$,
  '23505', null, 'a concurrent-equivalent award is rejected by the unique index');

-- …and the direct trusted path collapses it to a no-op rather than raising.
select is(
  (select app.award_points(
     '70000002-0000-4000-8000-000000000002',
     (select id from public.organizations where name = 'Zayed Tiles'),
     'referral.organization_approved', 'organization',
     (select id from public.organizations where name = 'Zayed Tiles'),
     100)),
  null, 'a replayed award through the trusted primitive is collapsed to a no-op');

select is((select count(*)::int from public.points_ledger), 1,
  'one referred organization earns this event exactly ONCE');

-- ===========================================================================
-- 5. The LINKING path — an approval with no attributed recipient
-- ===========================================================================
-- A different salesperson refers a business that ALREADY EXISTS. Approval links
-- rather than creates, so the organization carries no salesperson_referral
-- provenance and there is nobody to credit. Crediting the referral REQUEST here
-- would pay for "referring" a business that was already on the platform.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select isnt(public.showroom_referral_save(
  null, null, '  cairo ceramics showroom ', null, 'cairo', 'nasr_city', 'Nasr City'),
  null, 'a salesperson refers a showroom that already exists');
select isnt(public.showroom_referral_submit(null), null, '...and submits it');

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(
  public.showroom_referral_approve(
    (select id from public.organization_referrals
     where referred_by = '70000009-0000-4000-8000-000000000009' and status = 'submitted')),
  '9c000000-cccc-4ccc-8ccc-000000000001',
  'approval LINKS to the existing organization instead of creating one');

reset role;
select is(
  (select o.source from public.organizations o
   where o.id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  'self_created', 'the linked organization keeps its own provenance — it was not referred');

select is((select count(*)::int from public.points_ledger), 1,
  'the LINKING approval awarded nothing — no attributed recipient exists');

select is((select public.points_balance('70000009-0000-4000-8000-000000000009')), 0::bigint,
  'no recipient was fabricated from the referral request');

-- ===========================================================================
-- 6. Transactional coupling — approval and award commit together or not at all
-- ===========================================================================
-- A failed approval must leave no Points behind. Driven through a real failure
-- of the real RPC (an unauthorised caller), then verified by counting.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.showroom_referral_approve(
       (select id from public.organization_referrals limit 1)) $$,
  '42501', null, 'a non-platform caller cannot approve');

reset role;
select is((select count(*)::int from public.points_ledger), 1,
  'a FAILED approval created no Points entry');

-- The other direction: if the award raises, the approval must not survive it.
-- Proven by making the ledger reject the write (a savepoint-scoped constraint
-- the award cannot satisfy) and observing that the referral stays 'submitted'.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select isnt(public.showroom_referral_save(
  null, 'Coupling Test Tiles LLC', 'Coupling Test Tiles', null,
  'giza', 'sheikh_zayed', 'Main'), null, 'a third referral is drafted');
select isnt(public.showroom_referral_submit(null), null, '...and submitted');
reset role;

-- NOT VALID: binds new inserts only, leaving the award already on the ledger
-- untouched. The award this approval is about to attempt will fail, and the
-- question is whether the approval survives it.
alter table public.points_ledger
  add constraint ck_points_tmp_block_award check (event_type <> 'referral.organization_approved')
  not valid;

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.showroom_referral_approve(
       (select id from public.organization_referrals
        where referred_by = '70000009-0000-4000-8000-000000000009' and status = 'submitted')) $$,
  '23514', null, 'an award that cannot be written aborts the whole approval');

reset role;
alter table public.points_ledger drop constraint ck_points_tmp_block_award;

-- The approval was rolled back with it: no organization, no membership, no
-- audit row, and the referral is still awaiting a decision.
select is(
  (select count(*)::int from public.organizations where name = 'Coupling Test Tiles'),
  0, 'the aborted approval created NO organization');
select is(
  (select status from public.organization_referrals
   where referred_by = '70000009-0000-4000-8000-000000000009'
     and display_name = 'Coupling Test Tiles'),
  'submitted', 'the referral is still submitted — the approval did not partially commit');
-- Two approvals genuinely succeeded before this point (Zayed Tiles created,
-- Cairo Ceramics linked). The aborted one must have added no third.
select is(
  (select count(*)::int from public.audit_log where action = 'referral.approved'),
  2, 'no referral.approved audit row survived the aborted approval');
select is((select count(*)::int from public.points_ledger), 1,
  'and still exactly one ledger entry overall');

-- ===========================================================================
-- 7. The pre-existing approval behaviour is unchanged
-- ===========================================================================
-- Attribution, membership shape and audit are exactly what Sprint 13 specified;
-- adding Points changed none of them.
select is(
  (select o.source from public.organizations o where o.name = 'Zayed Tiles'),
  'salesperson_referral', 'the organization still records HOW it came to exist');
select is(
  (select o.referred_by_user_id from public.organizations o where o.name = 'Zayed Tiles'),
  '70000002-0000-4000-8000-000000000002'::uuid,
  'referral attribution still survives approval');
select throws_ok(
  $$ update public.organizations set referred_by_user_id = '70000009-0000-4000-8000-000000000009'
     where name = 'Zayed Tiles' $$,
  '23514', null, 'referral attribution is still IMMUTABLE — the award cannot be redirected');
select is(
  (select count(*)::int from public.memberships m
   where m.organization_id = (select id from public.organizations where name = 'Zayed Tiles')
     and m.user_id = '70000002-0000-4000-8000-000000000002'
     and m.status = 'active'),
  1, 'the referring salesperson still gets exactly one active membership');
select is(
  (select count(*)::int from public.memberships m
   join public.membership_capabilities c on c.membership_id = m.id
   where m.organization_id = (select id from public.organizations where name = 'Zayed Tiles')
     and c.capability_key = 'org.manage'),
  0, 'the referred business still has NO owner — the referrer was not made one');
select is(
  (select count(*)::int from public.audit_log
   where action = 'referral.approved'
     and metadata->>'referred_by' = '70000002-0000-4000-8000-000000000002'),
  1, 'the referral.approved audit row is still written exactly once');
select is(
  (select count(*)::int from public.audit_log where action like 'points.%'),
  0, 'an ordinary award writes no points.* audit row — the business event''s own row covers it');

select finish();
rollback;
