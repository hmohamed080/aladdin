-- pgTAP: sales_assignable_members — the minimal, sales.assign-gated,
-- BRANCH-AWARE read-model for CRM assignment dropdowns (Customers/Leads/
-- Follow-ups). Round 1 (PR #43 first correction commit) fixed the capability
-- mismatch: org_members_list is gated on org.members.manage, but every
-- assignment write path (set_customer_ownership, set_lead_source_branch,
-- reassign_follow_up) is gated on sales.assign OR org-wide sales authority —
-- never org.members.manage. Round 1 still returned every ACTIVE org member
-- unfiltered by branch, reasoning "the write RPC is the final enforcer" —
-- correct for security, insufficient for product: a branch-scoped caller
-- could be OFFERED a name from a branch they (or the target) cannot access,
-- discovering the mismatch only when the write RPC rejects it. This revision
-- (round 2, same still-undeployed migration) adds `p_branch_id`.
--
-- Proves: security posture (definer, pinned search_path, exact grants,
-- anon/service_role denied) on the 2-arg signature; the exact three-way
-- authorization predicate (sales.assign alone, sales.manage alone, org.manage
-- alone all suffice; none of the three is denied); a caller with none of the
-- three is refused; cross-organization enumeration is impossible; a branch id
-- from a DIFFERENT organization is rejected outright; a branch-scoped caller
-- CANNOT query a branch (or the org-wide bucket) outside their own access,
-- matching the write RPCs' own caller-scope rule exactly; a target WITH
-- branch access is returned and a target WITHOUT it is excluded, per the
-- IDENTICAL app.membership_can_access_branch the write RPCs use; an org-wide
-- target is returned for every branch (and the org-wide bucket); invited/
-- suspended/revoked memberships never appear; no raw membership id is ever
-- returned as a display name; and an id returned by this RPC for a specific
-- branch is accepted by the real write path assigning a record in that branch.
--
-- Fixture DML (grants, revokes, synthetic memberships) runs as the default
-- superuser role; every RPC call runs as `authenticated` with an impersonated
-- `request.jwt.claims`, matching this suite's existing convention (see
-- 19_sales_ownership_test.sql). `reset role;` precedes every DML block, since
-- the base tables are write-denied to `authenticated`.
create extension if not exists pgtap;

begin;
select plan(36);

-- Org aaaaaaaa (Nile Finishing Supplies): e1111 (Amina, org.manage owner,
-- org-wide — reaches every branch), e2222 (Karim, Cairo-branch-limited via
-- membership_branch_access, seed.sql base grants sales.read + sales.write
-- only). Branches: c1111111 Cairo, c2222222 Sheikh Zayed. Org bbbbbbbb
-- (Delta Interiors Studio): e3333 (Nadia, org.manage) — a different tenant,
-- with its own branch cb333333 (Maadi Studio) — for the cross-org proofs.

-- ===== Catalog / security posture (2-arg signature) =========================
select is((select prosecdef from pg_proc where proname = 'sales_assignable_members'), true,
  'sales_assignable_members is security definer');
select is((select array_to_string(proconfig, ',') from pg_proc where proname = 'sales_assignable_members'), 'search_path=""',
  'sales_assignable_members pins empty search_path');
select ok(has_function_privilege('authenticated', 'public.sales_assignable_members(uuid, uuid)', 'EXECUTE'),
  'authenticated may execute sales_assignable_members');
select ok(not has_function_privilege('anon', 'public.sales_assignable_members(uuid, uuid)', 'EXECUTE'),
  'anon may NOT execute sales_assignable_members (PUBLIC revoked)');
select ok(not has_function_privilege('service_role', 'public.sales_assignable_members(uuid, uuid)', 'EXECUTE'),
  'service_role gains no browser authority on sales_assignable_members');

-- Result shape: exactly the two OUT columns this migration declares, in
-- order, after the two IN parameters — no email/phone/status/capabilities/
-- branch-management data, unlike org_members_list.
select is(
  (select proargnames from pg_proc where proname = 'sales_assignable_members' and pronamespace = 'public'::regnamespace),
  array['p_org_id', 'p_branch_id', 'membership_id', 'display_name'],
  'sales_assignable_members returns exactly membership_id + display_name (plus the two IN params) — nothing broader');

-- ===== p_org_id validation ===================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select * from public.sales_assignable_members(null, 'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  '22023', null, 'a null organization id is rejected');

-- ===== Caller with none of the three capabilities is denied (seed.sql base:
--       e2222 has only sales.read + sales.write) ============================
select throws_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'a caller with only sales.read/sales.write (no assign/manage) is denied');

-- ===== sales.assign alone is sufficient, for a branch the caller can access
--       (req. 1 caller predicate) ============================================
reset role;
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.assign');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  'sales.assign alone is sufficient to call the RPC for a branch the caller can access');
select ok(
  exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') where membership_id = 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1'),
  'a sales.assign-only caller retrieves the org-wide manager as a valid, branch-compatible teammate');
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc')
             where display_name ~ 'e2222222|e1111111|-eeee-|-cccc-'),
  'no returned display_name is (or contains) a raw membership/branch id');

-- ===== A branch-scoped caller CANNOT query a branch outside their own access
--       (req. 2: the core defect this revision closes) ======================
select throws_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'Karim (Cairo-only) cannot query Sheikh Zayed — a branch he has no access to');

-- ===== A branch-scoped (non-manager) caller cannot query the org-wide bucket
--       either — matches "org-wide requires sales.manage" on every write path
select throws_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null) $$,
  '42501', null, 'Karim (branch-scoped, not a manager) cannot query the org-wide (null-branch) bucket');

-- ===== The full sales_manager preset (sales.read/write/assign/manage, no
--       org.members.manage — frontend/src/lib/org/roles.ts) can call (req. 1) ==
reset role;
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.manage');
select ok(
  not exists(select 1 from public.membership_capabilities
             where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2' and capability_key = 'org.members.manage'),
  'sanity: the sales_manager-preset test membership still holds NO org.members.manage');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  'a sales_manager-preset holder (sales.read/write/assign/manage, no org.members.manage) can call the RPC');

-- ===== sales.manage promotes Karim to ORG-WIDE reach: now he CAN query
--       Sheikh Zayed and the org-wide bucket too (req. 3a + branch reach) ====
select lives_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  'sales.manage alone (no literal sales.assign key) grants org-wide branch reach, via app.can_manage_sales');
select lives_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null) $$,
  'sales.manage also grants access to the org-wide (null-branch) bucket');
reset role;
delete from public.membership_capabilities
  where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2' and capability_key in ('sales.assign', 'sales.manage');

-- ===== org.manage alone is sufficient, and reaches every branch + org-wide
--       (req. 3b) — e1111 holds it from seed ================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  'org.manage alone is sufficient (the org owner), Cairo branch');
select lives_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  'org.manage alone reaches Sheikh Zayed too (org-wide authority)');
select lives_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null) $$,
  'org.manage alone reaches the org-wide (null-branch) bucket too');

-- ===== Cross-organization enumeration is impossible (req. 5) ================
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'a member of a DIFFERENT organization cannot call this RPC for aaaaaaaa, even though Nadia holds org.manage in her own org');

-- ===== A branch id from a DIFFERENT organization is rejected outright
--       (req. 3: prevent cross-org enumeration via a mismatched branch id) ==
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cb333333-cccc-4ccc-8ccc-cccccccccccc') $$,
  '22023', null, 'a branch belonging to a DIFFERENT organization (Delta''s Maadi Studio) is rejected for aaaaaaaa, even for its own org.manage owner');

-- ===== Only same-org targets are ever returned (req. 6) =====================
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') where membership_id = 'e3333333-eeee-4eee-8eee-eeeeeeeeeee3'),
  'a membership from a different organization (Nadia, e3333) never appears in aaaaaaaa''s assignable list');

-- ===== Branch behavior: a target WITH access is returned, a target WITHOUT
--       it is excluded — filtered through the IDENTICAL function the write
--       RPCs use as their own final enforcer (req. 4/5/8) ===================
select ok(
  app.membership_can_access_branch('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'c1111111-cccc-4ccc-8ccc-cccccccccccc'),
  'sanity: Karim (Cairo-limited) can access the Cairo branch per the write paths'' own function');
select ok(
  exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2'),
  'Karim (branch-limited, genuinely assignable in Cairo) IS returned when querying Cairo');
select ok(
  not app.membership_can_access_branch('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'c2222222-cccc-4ccc-8ccc-cccccccccccc'),
  'sanity: Karim cannot access Sheikh Zayed per the same function');
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc') where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2'),
  'Karim (Cairo-limited) is EXCLUDED when a manager queries Sheikh Zayed — he would be rejected by the write RPC for that branch');

-- ===== An org-wide target is returned for every branch, and for the
--       org-wide bucket (req. 6) =============================================
select ok(
  exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') where membership_id = 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1'),
  'Amina (org-wide, org.manage) is returned for Cairo');
select ok(
  exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc') where membership_id = 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1'),
  'Amina (org-wide) is returned for Sheikh Zayed too');
select ok(
  exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null) where membership_id = 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1'),
  'Amina (org-wide) is returned for the org-wide (null-branch) bucket too');

-- ===== Invited / suspended / revoked memberships are excluded, regardless of
--       branch context (req. 7) ==============================================
reset role;
insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at) values
  ('e9990001-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'invited', null),
  ('e9990002-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'suspended', now()),
  ('e9990003-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'revoked', now());
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e9990001-0000-4000-8000-000000000001', 'org.manage'),
  ('e9990002-0000-4000-8000-000000000002', 'org.manage'),
  ('e9990003-0000-4000-8000-000000000003', 'org.manage');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null) where membership_id = 'e9990001-0000-4000-8000-000000000001'),
  'an INVITED (not yet accepted) membership is excluded, even with org.manage and querying org-wide');
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null) where membership_id = 'e9990002-0000-4000-8000-000000000002'),
  'a SUSPENDED membership is excluded');
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null) where membership_id = 'e9990003-0000-4000-8000-000000000003'),
  'a REVOKED membership is excluded');

-- ===== A returned id, fetched for the RECORD'S OWN branch, is accepted by
--       the real write path it feeds (req. 10) ===============================
reset role;
insert into public.leads (id, organization_id, branch_id, title, source, status, stage, assigned_membership_id, created_by) values
  ('1eadf900-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc', 'Round-trip lead', 'referral', 'active', 'new', null, '11111111-1111-4111-8111-111111111111');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.set_lead_source_branch('1eadf900-0000-4000-8000-000000000001', 1,
       p_reassign => true,
       p_reassign_membership_id => (select membership_id from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2')) $$,
  'a membership_id returned by sales_assignable_members for the lead''s own branch is accepted by set_lead_source_branch (as the org manager, reassigning to the branch-limited assignee)');
select is((select assigned_membership_id from public.leads where id = '1eadf900-0000-4000-8000-000000000001'), 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2',
  'the lead is genuinely reassigned to the id the list RPC returned for its own branch');

-- ===== No database state persists past this transaction (req. 11 — rollback
--       below is the actual proof; this just documents intent for a reader) =
select ok(true, 'fixture DML above runs only inside this transaction, rolled back at the end (see rollback; below)');

select * from finish();
rollback;
