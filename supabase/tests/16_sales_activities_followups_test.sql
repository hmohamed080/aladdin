-- pgTAP: B2B Sales — activities & follow-up tasks (Phase 2, Sprint 3).
-- Proves append-only tenant-private activities with unspoofable actors, follow-up
-- lifecycle + assignment rules, scoped overdue/due-today read models, audit
-- attribution, and the direct-DML write boundary.
create extension if not exists pgtap;

begin;
select plan(34);

-- Grant sales caps in-transaction (keeps the shared seed / Phase-1 snapshots intact).
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'sales.manage'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.read'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.write')
on conflict do nothing;

-- Manager seeds a Cairo lead + a Sheikh Zayed lead.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_lead('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture Lead','c1111111-cccc-4ccc-8ccc-cccccccccccc');
select public.create_lead('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SZ Fixture','c2222222-cccc-4ccc-8ccc-cccccccccccc');
reset role;
create temp table _f as
  select (select id from public.leads where title='Fixture Lead') as fixture_lead,
         (select id from public.leads where title='SZ Fixture')   as sz_fixture;
grant select on _f to authenticated, anon, service_role;

-- ===== Activities ===========================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  format($$ select public.add_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','call','Called the customer','%s') $$,
    (select fixture_lead from _f)),
  'a scoped salesperson can log a call activity on a lead in their branch');
select is(
  (select actor_membership_id::text from public.sales_activities
     where lead_id=(select fixture_lead from _f) and activity_type='call'),
  'e2222222-eeee-4eee-8eee-eeeeeeeeeee2',
  'the activity actor is the caller''s own membership (not spoofable)');
select throws_ok(
  format($$ select public.add_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','status_change','x','%s') $$,
    (select fixture_lead from _f)),
  '22023', null, 'status_change/assignment_change activities are system-generated only');
select throws_ok(
  $$ select public.add_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','note','no target') $$,
  '22023', null, 'an activity must reference a lead or customer');
select throws_ok(
  format($$ select public.add_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','note','out of scope','%s') $$,
    (select sz_fixture from _f)),
  '42501', null, 'a salesperson cannot log activity on a lead outside their scope');

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  format($$ select public.add_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','note','intrusion','%s') $$,
    (select fixture_lead from _f)),
  '42501', null, 'a non-member cannot log activity in the org');
select is(
  (select count(*)::int from public.sales_activities where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'sales activities are tenant-private (Org B cannot read Org A)');

reset role;
set local role authenticated;
select throws_ok(
  $$ update public.sales_activities set summary='tampered' where summary='Called the customer' $$,
  '42501', null, 'authenticated cannot UPDATE an activity (append-only)');
select throws_ok(
  $$ delete from public.sales_activities where summary='Called the customer' $$,
  '42501', null, 'authenticated cannot DELETE an activity (append-only)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.add_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','meeting','Site visit',
  (select fixture_lead from _f));
select is(
  (select actor_membership_id::text from public.sales_activities where activity_type='meeting'),
  'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'a manager''s activity records the manager''s own membership');

-- ===== Follow-ups ===========================================================
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  format($$ select public.create_follow_up('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Call back',
       'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','%s',null, now() + interval '2 days') $$,
    (select fixture_lead from _f)),
  'a salesperson can create a self-assigned follow-up');
select is((select status::text from public.follow_up_tasks where title='Call back'),
  'open', 'a new follow-up starts open');
select throws_ok(
  format($$ select public.create_follow_up('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Deleg',
       'e1111111-eeee-4eee-8eee-eeeeeeeeeee1','%s') $$, (select fixture_lead from _f)),
  '42501', null, 'assigning a follow-up to another member needs sales.assign');
select lives_ok(
  $$ select public.complete_follow_up((select id from public.follow_up_tasks where title='Call back')) $$,
  'the assignee can complete their follow-up');
select isnt((select completed_at from public.follow_up_tasks where title='Call back'),
  null, 'a completed follow-up has completed_at set');
select lives_ok(
  $$ select public.reopen_follow_up((select id from public.follow_up_tasks where title='Call back')) $$,
  'a completed follow-up can be reopened');
select is((select status::text from public.follow_up_tasks where title='Call back'),
  'open', 'a reopened follow-up is open again');
select lives_ok(
  $$ select public.cancel_follow_up((select id from public.follow_up_tasks where title='Call back')) $$,
  'an open follow-up can be cancelled');
select throws_ok(
  $$ select public.complete_follow_up((select id from public.follow_up_tasks where title='Call back')) $$,
  '22023', null, 'a cancelled follow-up cannot be completed');
select throws_ok(
  $$ select public.reassign_follow_up((select id from public.follow_up_tasks where title='Call back'),
       'e1111111-eeee-4eee-8eee-eeeeeeeeeee1') $$,
  '42501', null, 'a salesperson without sales.assign cannot reassign a follow-up');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  format($$ select public.create_follow_up('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Cross',
       'e3333333-eeee-4eee-8eee-eeeeeeeeeee3','%s') $$, (select fixture_lead from _f)),
  '22023', null, 'a follow-up cannot be assigned to a member of another organization');
select lives_ok(
  format($$ select public.create_follow_up('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Deleg2',
       'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','%s') $$, (select fixture_lead from _f)),
  'a manager can assign a follow-up to a branch-compatible member');
select lives_ok(
  $$ select public.reassign_follow_up((select id from public.follow_up_tasks where title='Deleg2'),
       'e1111111-eeee-4eee-8eee-eeeeeeeeeee1') $$,
  'a manager can reassign a follow-up');
select lives_ok(
  $$ select public.membership_suspend('e2222222-eeee-4eee-8eee-eeeeeeeeeee2') $$,
  'manager suspends the staff membership');
select throws_ok(
  $$ select public.reassign_follow_up((select id from public.follow_up_tasks where title='Deleg2'),
       'e2222222-eeee-4eee-8eee-eeeeeeeeeee2') $$,
  '22023', null, 'a suspended member cannot receive a follow-up assignment');
select lives_ok(
  $$ select public.membership_activate('e2222222-eeee-4eee-8eee-eeeeeeeeeee2') $$,
  'manager reactivates the staff membership');

-- ===== Overdue / due-today read models respect scope ========================
select public.create_follow_up('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Overdue',
  'e2222222-eeee-4eee-8eee-eeeeeeeeeee2',(select fixture_lead from _f), null, now() - interval '1 day');
select public.create_follow_up('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','DueToday',
  'e2222222-eeee-4eee-8eee-eeeeeeeeeee2',(select fixture_lead from _f), null, date_trunc('day', now()) + interval '9 hours');
select ok((select count(*) from public.sales_overdue_follow_ups where title='Overdue') >= 1,
  'a manager sees the overdue follow-up in the overdue read model');
select ok((select count(*) from public.sales_follow_ups_due_today where title='DueToday') >= 1,
  'a manager sees the due-today follow-up in the due-today read model');
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select ok((select count(*) from public.sales_overdue_follow_ups where title='Overdue') >= 1,
  'the assignee sees their own overdue follow-up');
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.sales_overdue_follow_ups where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'Org B cannot see Org A follow-ups in the read models');

-- ===== Direct-DML write boundary + audit attribution ========================
reset role;
set local role authenticated;
select throws_ok(
  $$ insert into public.follow_up_tasks (organization_id, assigned_membership_id, title, created_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','e1111111-eeee-4eee-8eee-eeeeeeeeeee1','x','11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'authenticated cannot INSERT a follow-up directly (RPC-only)');
reset role;
set local role service_role;
select throws_ok(
  $$ update public.follow_up_tasks set status='completed' where title='Overdue' $$,
  '42501', null, 'service_role cannot UPDATE follow-ups directly (SELECT-only)');
reset role;
select is(
  (select actor_user_id::text from public.audit_log where action='followup.completed' order by created_at desc limit 1),
  '22222222-2222-4222-8222-222222222222',
  'the follow-up audit records the acting user as actor (unspoofable)');
select ok(
  (select count(*) from public.audit_log where action in ('followup.created','followup.completed','followup.reopened','followup.reassigned')) >= 4,
  'follow-up lifecycle actions are audited');

select * from finish();
rollback;
