-- pgTAP: B2B Sales — customers & leads (Phase 2, Sprint 3).
-- Proves tenant ownership, branch scope, duplicate detection, cross-tenant denial,
-- assignment rules, pipeline transitions with optimistic concurrency, audit
-- emission, revoked-member denial, and the direct-DML write boundary.
create extension if not exists pgtap;

begin;
select plan(49);

-- Sales capabilities are granted here (as postgres, inside the test transaction)
-- so the shared seed — and the existing Phase-1 assertions that snapshot it —
-- stay unchanged. e1111111 = A-owner (org-wide sales manager); e2222222 = Cairo
-- staff (branch-limited salesperson: read + write, no assign/manage).
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'sales.manage'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.read'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.write')
on conflict do nothing;

-- ===== Direct-DML write boundary (no client/service write path) =============
set local role authenticated;
select throws_ok(
  $$ insert into public.customers (organization_id, display_name, created_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x','11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'authenticated cannot INSERT a customer directly (RPC-only)');
select throws_ok(
  $$ insert into public.leads (organization_id, title, created_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x','11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'authenticated cannot INSERT a lead directly (RPC-only)');
reset role;
set local role service_role;
select throws_ok(
  $$ insert into public.leads (organization_id, title, created_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x','11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'service_role cannot INSERT a lead directly (SELECT-only)');
select throws_ok(
  $$ select public.create_lead('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x') $$,
  '42501', null, 'service_role cannot execute a sales workflow RPC');
reset role;

-- ===== Create fixtures (as their owners) ====================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select public.create_customer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Cairo Customer','individual','c1111111-cccc-4ccc-8ccc-cccccccccccc','0100 123 4567') $$,
  'branch-limited salesperson creates a customer in their branch');
select is((select status::text from public.customers where display_name='Cairo Customer'),
  'active', 'new customer starts active');
select is((select primary_phone_e164 from public.customers where display_name='Cairo Customer'),
  '+201001234567', 'phone is normalized to E.164 for duplicate detection');
select lives_ok(
  $$ select public.create_lead('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Cairo Lead','c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  'salesperson creates a lead in their branch');
select is((select status::text || '/' || stage::text from public.leads where title='Cairo Lead'),
  'active/new', 'a new lead starts active/new');

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.create_customer('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B Customer','individual',null,'0100 123 4567') $$,
  'the same phone can exist in another organization (no cross-tenant uniqueness)');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.create_customer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Org-wide OK') $$,
  'a sales manager can create an org-wide customer');
select lives_ok(
  $$ select public.create_lead('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SZ Only Lead','c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  'manager creates a Sheikh Zayed lead');
select lives_ok(
  $$ select public.create_lead('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Org-wide Lead') $$,
  'manager creates an unassigned org-wide lead');

-- Capture ids as postgres so later cross-scope assertions do not depend on the
-- acting role's RLS visibility.
reset role;
create temp table _ids as
  select
    (select id from public.customers where display_name='B Customer')  as b_customer,
    (select id from public.leads where title='Cairo Lead')             as cairo_lead,
    (select id from public.leads where title='SZ Only Lead')           as sz_lead,
    (select id from public.leads where title='Org-wide Lead')          as orgwide_lead;
grant select on _ids to authenticated, anon, service_role;

-- ===== Customer scope, dedup, cross-tenant ==================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.create_customer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SZ Customer','individual','c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'salesperson cannot create a customer outside their branch scope');
select throws_ok(
  $$ select public.create_customer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Org-wide Customer') $$,
  '42501', null, 'salesperson cannot create an org-wide (null-branch) customer');
select throws_ok(
  $$ select public.create_customer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Dup','individual','c1111111-cccc-4ccc-8ccc-cccccccccccc','+20 100 123 4567') $$,
  '23505', null, 'a second active customer with the same phone in the org is rejected');

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ select public.create_customer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Intruder','individual','c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'a non-member cannot create a customer in the org');

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.customers where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'Org B owner cannot read Org A customers (RLS)');

-- Manager archive + re-add after archive frees the phone.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.update_customer((select id from public.customers where display_name='Cairo Customer'), p_archive => true) $$,
  'manager can archive a customer');
select is((select status::text from public.customers where display_name='Cairo Customer'),
  'archived', 'archived customer has archived status');
select lives_ok(
  $$ select public.create_customer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Readd','individual','c1111111-cccc-4ccc-8ccc-cccccccccccc','0100 123 4567') $$,
  're-adding a customer with a previously-archived phone is allowed');
reset role;
select ok((select count(*) from public.audit_log where action='customer.created' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') >= 3,
  'customer.created audit events are emitted');
select ok((select count(*) from public.audit_log where action='customer.updated') >= 1,
  'customer.updated audit event is emitted on archive');

-- ===== Anonymous denial =====================================================
set local role anon;
select throws_ok($$ select 1 from public.customers limit 1 $$, '42501', null, 'anon has no privilege on customers');
select throws_ok($$ select 1 from public.leads limit 1 $$,     '42501', null, 'anon has no privilege on leads');
reset role;

-- ===== Lead structural tenant safety + assignment ===========================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.create_lead('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SZ Lead','c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'salesperson cannot create a lead outside their branch scope');
select throws_ok(
  format($$ select public.create_lead('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Bad link','c1111111-cccc-4ccc-8ccc-cccccccccccc','%s') $$,
    (select b_customer from _ids)),
  '23503', null, 'a lead cannot reference a customer from another tenant (composite FK)');
select throws_ok(
  format($$ select public.assign_lead('%s','e2222222-eeee-4eee-8eee-eeeeeeeeeee2',1) $$, (select cairo_lead from _ids)),
  '42501', null, 'a salesperson without sales.assign cannot assign a lead');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  format($$ select public.assign_lead('%s','e2222222-eeee-4eee-8eee-eeeeeeeeeee2',1) $$, (select cairo_lead from _ids)),
  'a sales manager can assign a lead to a branch-compatible member');
select throws_ok(
  format($$ select public.assign_lead('%s','e3333333-eeee-4eee-8eee-eeeeeeeeeee3',2) $$, (select cairo_lead from _ids)),
  '22023', null, 'a lead cannot be assigned to a member of another organization');
reset role;
select is((select count(*)::int from public.audit_log where action='lead.assigned' and subject_id=(select cairo_lead from _ids)),
  1, 'assignment emits exactly one lead.assigned audit event');
select is((select count(*)::int from public.sales_activities where activity_type='assignment_change' and lead_id=(select cairo_lead from _ids)),
  1, 'assignment emits an assignment_change timeline activity');

-- ===== Branch isolation =====================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.leads where title='SZ Only Lead'),
  0, 'branch-limited staff cannot see a lead in a branch outside their scope');
select is((select count(*)::int from public.leads where title='Org-wide Lead'),
  0, 'branch-limited staff cannot see an unassigned org-wide lead');
select ok(exists (select 1 from public.leads where title='Cairo Lead'),
  'branch-limited staff can see a lead in their own branch');

-- ===== Pipeline transitions + optimistic concurrency ========================
-- Cairo Lead is at version 2 after the manager's assignment above.
select is(
  public.transition_lead((select cairo_lead from _ids),2,'contacted'),
  3, 'staff progresses their assigned lead new->contacted (version bumps to 3)');
select is((select stage::text from public.leads where title='Cairo Lead'),
  'contacted', 'the lead stage is now contacted');
select throws_ok(
  format($$ select public.transition_lead('%s',2,'qualified') $$, (select cairo_lead from _ids)),
  '40001', null, 'a stale-version transition is rejected (optimistic concurrency)');
select throws_ok(
  format($$ select public.transition_lead('%s',3,null,'lost',null) $$, (select cairo_lead from _ids)),
  '22023', null, 'marking a lead lost without a reason is rejected');
select lives_ok(
  format($$ select public.transition_lead('%s',3,null,'lost','Chose another supplier') $$, (select cairo_lead from _ids)),
  'a lead can be marked lost with a reason');
select isnt((select closed_at from public.leads where title='Cairo Lead'),
  null, 'a lost lead has a closed_at timestamp');
select throws_ok(
  format($$ select public.transition_lead('%s',4,null,'won',null) $$, (select cairo_lead from _ids)),
  '22023', null, 'a closed (lost) lead cannot jump straight to won (must reopen)');
select lives_ok(
  format($$ select public.transition_lead('%s',4,null,'active',null) $$, (select cairo_lead from _ids)),
  'a lost lead can be reopened to active');
select is((select lost_reason from public.leads where title='Cairo Lead'),
  null, 'reopening clears the previous lost reason');
reset role;
select is(
  (select count(*)::int from public.audit_log where action in ('lead.lost','lead.reopened') and subject_id=(select cairo_lead from _ids)),
  2, 'won/lost/reopen transitions are audited');

-- ===== Revoked-member denial ================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.membership_revoke('e2222222-eeee-4eee-8eee-eeeeeeeeeee2') $$,
  'a member-manager revokes the salesperson membership');
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.leads where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'a revoked member can no longer read any org leads (RLS)');
select throws_ok(
  $$ select public.create_lead('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Nope','c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'a revoked member cannot create leads');
reset role;

-- ===== Dashboard read model respects scope ==================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select ok(
  (select count(*) from public.sales_lead_stage_counts where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') >= 1,
  'a manager sees stage counts across the org');
reset role;

select * from finish();
rollback;
