-- pgTAP: sales_assignable_members — the minimal, sales.assign-gated read-model
-- for CRM assignment dropdowns (Customers/Leads/Follow-ups), added to fix the
-- F3 capability regression (PR #43 second commit): org_members_list is
-- gated on org.members.manage, but every assignment write path
-- (set_customer_ownership, set_lead_source_branch, reassign_follow_up) is
-- gated on sales.assign OR org-wide sales authority — never on
-- org.members.manage. A sales_manager-preset holder (sales.read/write/
-- assign/manage, no org.members.manage — a real, UI-offered role) could
-- reach every assignment dropdown but not resolve a single teammate's name.
--
-- Proves: security posture (definer, pinned search_path, exact grants,
-- anon/service_role denied); the exact three-way authorization predicate
-- (sales.assign alone, sales.manage alone, org.manage alone all suffice; none
-- of the three is denied); a caller with none of the three is refused;
-- cross-organization enumeration is impossible; invited/suspended/revoked
-- memberships never appear; the deliberate non-branch-filtering design is
-- consistent with app.membership_can_access_branch (the same function the
-- write paths use as their OWN final enforcer); no raw membership id is ever
-- returned as a display name; and an id returned by this RPC is accepted by
-- the real write paths it exists to feed.
--
-- Fixture DML (grants, revokes, synthetic memberships) runs as the default
-- superuser role; every RPC call runs as `authenticated` with an impersonated
-- `request.jwt.claims`, matching this suite's existing convention (see
-- 19_sales_ownership_test.sql). `reset role;` precedes every DML block, since
-- the base tables are write-denied to `authenticated`.
create extension if not exists pgtap;

begin;
select plan(25);

-- Org aaaaaaaa (Nile Finishing Supplies): e1111 (Amina, org.manage owner),
-- e2222 (Karim, Cairo-branch-limited, seed.sql base grants sales.read +
-- sales.write only). Org bbbbbbbb: e3333 (Nadia) — a different tenant,
-- for the cross-org enumeration proof.

-- ===== Catalog / security posture ==========================================
select is((select prosecdef from pg_proc where proname = 'sales_assignable_members'), true,
  'sales_assignable_members is security definer');
select is((select array_to_string(proconfig, ',') from pg_proc where proname = 'sales_assignable_members'), 'search_path=""',
  'sales_assignable_members pins empty search_path');
select ok(has_function_privilege('authenticated', 'public.sales_assignable_members(uuid)', 'EXECUTE'),
  'authenticated may execute sales_assignable_members');
select ok(not has_function_privilege('anon', 'public.sales_assignable_members(uuid)', 'EXECUTE'),
  'anon may NOT execute sales_assignable_members (PUBLIC revoked)');
select ok(not has_function_privilege('service_role', 'public.sales_assignable_members(uuid)', 'EXECUTE'),
  'service_role gains no browser authority on sales_assignable_members');

-- Result shape: exactly the two OUT columns this migration declares, in
-- order, after the one IN parameter — no email/phone/status/capabilities/
-- branch data, unlike org_members_list.
select is(
  (select proargnames from pg_proc where proname = 'sales_assignable_members' and pronamespace = 'public'::regnamespace),
  array['p_org_id', 'membership_id', 'display_name'],
  'sales_assignable_members returns exactly membership_id + display_name (plus the p_org_id IN param) — nothing broader');

-- ===== p_org_id validation ===================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select * from public.sales_assignable_members(null) $$,
  '22023', null, 'a null organization id is rejected');

-- ===== Caller with none of the three capabilities is denied (seed.sql base:
--       e2222 has only sales.read + sales.write) ============================
select throws_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '42501', null, 'a caller with only sales.read/sales.write (no assign/manage) is denied');

-- ===== sales.assign alone is sufficient (req. 2) ============================
reset role;
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.assign');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  'sales.assign alone is sufficient to call the RPC');
select ok(
  exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where membership_id = 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1'),
  'a sales.assign-only caller retrieves the org-wide manager as a valid assignable teammate');
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
             where display_name ~ 'e2222222|e1111111|-eeee-|-cccc-'),
  'no returned display_name is (or contains) a raw membership/branch id');

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
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  'a sales_manager-preset holder (sales.read/write/assign/manage, no org.members.manage) can call the RPC');

-- ===== sales.manage alone is sufficient, independent of the literal
--       sales.assign key (req. 3a) =========================================
reset role;
delete from public.membership_capabilities
  where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2' and capability_key = 'sales.assign';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  'sales.manage alone (no literal sales.assign key) is sufficient, via app.can_manage_sales');
reset role;
delete from public.membership_capabilities
  where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2' and capability_key = 'sales.manage';

-- ===== org.manage alone is sufficient (req. 3b) — e1111 holds it from seed ==
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  'org.manage alone is sufficient (the org owner)');

-- ===== Cross-organization enumeration is impossible (req. 5) ================
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select * from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '42501', null, 'a member of a DIFFERENT organization cannot call this RPC for aaaaaaaa, even though Nadia holds org.manage in her own org');

-- ===== Only same-org targets are ever returned (req. 6) =====================
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where membership_id = 'e3333333-eeee-4eee-8eee-eeeeeeeeeee3'),
  'a membership from a different organization (Nadia, e3333) never appears in aaaaaaaa''s assignable list');

-- ===== Invited / suspended / revoked memberships are excluded (req. 7) ======
reset role;
insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at) values
  ('e9990001-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'invited', null),
  ('e9990002-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'suspended', now()),
  ('e9990003-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'revoked', now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where membership_id = 'e9990001-0000-4000-8000-000000000001'),
  'an INVITED (not yet accepted) membership is excluded');
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where membership_id = 'e9990002-0000-4000-8000-000000000002'),
  'a SUSPENDED membership is excluded');
select ok(
  not exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where membership_id = 'e9990003-0000-4000-8000-000000000003'),
  'a REVOKED membership is excluded');

-- ===== Branch behavior matches the real write-path RPCs exactly (req. 8) ====
-- Deliberate design (see the migration's own header comment): the list is NOT
-- branch-filtered, matching every existing call site's pre-F3 behavior — the
-- write RPCs remain the sole, final branch-compatibility enforcer via
-- app.membership_can_access_branch, exactly as they always have been.
select ok(
  app.membership_can_access_branch('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'c1111111-cccc-4ccc-8ccc-cccccccccccc'),
  'sanity: Karim (Cairo-limited) can access the Cairo branch per the write paths'' own function');
select ok(
  exists(select 1 from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2'),
  'Karim (branch-limited, genuinely assignable in his own branch) IS returned by the list');
select ok(
  not app.membership_can_access_branch('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'c2222222-cccc-4ccc-8ccc-cccccccccccc'),
  'Karim cannot access Sheikh Zayed per the same function — the write RPC (not the list) is what would reject that specific pairing');

-- ===== A returned id is accepted by the real write path it feeds (req. 10) ==
reset role;
insert into public.leads (id, organization_id, branch_id, title, source, status, stage, assigned_membership_id, created_by) values
  ('1eadf900-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc', 'Round-trip lead', 'referral', 'active', 'new', null, '11111111-1111-4111-8111-111111111111');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.set_lead_source_branch('1eadf900-0000-4000-8000-000000000001', 1,
       p_reassign => true,
       p_reassign_membership_id => (select membership_id from public.sales_assignable_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2')) $$,
  'a membership_id returned by sales_assignable_members is accepted by set_lead_source_branch (as the org manager, reassigning to the branch-limited assignee)');
select is((select assigned_membership_id from public.leads where id = '1eadf900-0000-4000-8000-000000000001'), 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2',
  'the lead is genuinely reassigned to the id the list RPC returned');

select * from finish();
rollback;
