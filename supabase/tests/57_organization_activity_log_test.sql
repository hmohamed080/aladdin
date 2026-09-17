-- pgTAP: organization Activity Log (issue #50).
-- Proves capability-gated tenant reads, no-escalation delegation, the
-- audit-writer projection boundary, default-deny params, and append-only DML.
create extension if not exists pgtap;

begin;
select plan(28);

select has_table('public', 'organization_activity_events',
  'organization activity is stored separately from the security audit');

-- Requirement 1 (backfill): every existing org.manage holder must also hold
-- activity.read, because the RLS policy no longer carries an org.manage arm.
-- Asserted HERE, before any fixture below revokes it, so this reads the real
-- state produced by the migration backfill plus the seed grant.
select is(
  (select count(*)::int
   from public.membership_capabilities owner_cap
   join public.memberships m on m.id = owner_cap.membership_id
   where owner_cap.capability_key = 'org.manage'
     and m.status = 'active'
     and not exists (
       select 1 from public.membership_capabilities act
       where act.membership_id = owner_cap.membership_id
         and act.capability_key = 'activity.read')),
  0, 'every ACTIVE org.manage holder also holds activity.read (backfill + seed)');

-- Create one allow-listed event in each tenant through the real sales RPC.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.create_customer(
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'Activity Projection A', 'individual') $$,
  'an allow-listed business RPC succeeds for Org A');

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.create_customer(
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       'Activity Projection B', 'individual') $$,
  'an allow-listed business RPC succeeds for Org B');
reset role;

create temp table _activity_ids as
select
  (select id from public.customers where display_name = 'Activity Projection A') as customer_a,
  (select id from public.customers where display_name = 'Activity Projection B') as customer_b;
grant select on _activity_ids to authenticated;

select is(
  (select count(*)::int from public.organization_activity_events
   where subject_id = (select customer_a from _activity_ids)),
  1, 'one business audit event produces exactly one activity row');
select is(
  (select event_type from public.organization_activity_events
   where subject_id = (select customer_a from _activity_ids)),
  'customer.created', 'the projected event_type is the audit action');
select is(
  (select params from public.organization_activity_events
   where subject_id = (select customer_a from _activity_ids)),
  '{"customer_type":"individual"}'::jsonb,
  'params contains the explicitly projected customer type');
select is(
  (select count(*)::int
   from public.organization_activity_events e,
        lateral jsonb_object_keys(e.params) k
   where e.subject_id = (select customer_a from _activity_ids)
     and k <> 'customer_type'),
  0, 'params contains no unprojected metadata keys');

-- A security-only action is written to audit_log but never to the org feed.
do $$
begin
  perform app.record_audit_event(
    'verification.review_started', 'verification',
    '90000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    jsonb_build_object('reason', 'private review note', 'token', 'never expose'));
end;
$$;
select is(
  (select count(*)::int from public.organization_activity_events
   where subject_id = '90000000-0000-4000-8000-000000000001'),
  0, 'a non-allow-listed verification audit action is not projected');

-- Same-org membership is insufficient without activity.read. org.manage is NOT
-- an alternative: activity.read is the single authority for this feed.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.organization_activity_events),
  0, 'a member without activity.read sees no activity rows');
reset role;

-- A people manager still cannot delegate a capability they do not hold.
insert into public.membership_capabilities (membership_id, capability_key)
values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'org.members.manage')
on conflict do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.membership_set_capabilities(
       'e2222222-eeee-4eee-8eee-eeeeeeeeeee2',
       array['org.members.manage','activity.read']) $$,
  '42501', null,
  'a manager cannot grant activity.read when they do not hold it');
reset role;

-- Deliberately NOT a fixture insert. The owner's activity.read must already be
-- there from the real grant path; asserting it keeps the delegation test below
-- honest, and fails loudly here if the backfill or seed grant ever regresses.
select is(
  (select count(*)::int from public.membership_capabilities
   where membership_id = 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1'
     and capability_key = 'activity.read'),
  1, 'the existing organization owner already holds activity.read');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.organization_activity_events
   where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'the backfilled owner can read its own organization activity');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.membership_set_capabilities(
       'e2222222-eeee-4eee-8eee-eeeeeeeeeee2',
       array['org.members.manage','activity.read']) $$,
  'a manager can grant activity.read when they hold it');

-- Exact activity.read grants Org A only; RLS still excludes Org B.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.organization_activity_events
   where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'activity.read exposes the member organization activity');
select is(
  (select count(*)::int from public.organization_activity_events
   where organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'activity.read cannot cross from Org A into Org B');

-- Requirement 4: org.manage is NOT a read path. Strip activity.read from Org B's
-- owner, who keeps org.manage, and prove the feed closes for them. This is the
-- assertion that pins the correction: if an org.manage arm is ever re-added to
-- the RLS policy, this test is what fails.
reset role;
delete from public.membership_capabilities
where membership_id = 'e3333333-eeee-4eee-8eee-eeeeeeeeeee3'
  and capability_key = 'activity.read';
-- Guard the fixture itself: if the revoke above silently affected no rows, the
-- denial assertion below would pass for the wrong reason.
select is(
  (select count(*)::int from public.membership_capabilities
   where membership_id = 'e3333333-eeee-4eee-8eee-eeeeeeeeeee3'
     and capability_key = 'activity.read'),
  0, 'the fixture revoke actually removed activity.read from Org B''s owner');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.organization_activity_events
   where organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'org.manage without activity.read is denied its own organization activity');
select is(
  (select count(*)::int from public.organization_activity_events
   where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'org.manage without activity.read cannot cross from Org B into Org A');

-- Requirement 2: a newly created organization grants its owner activity.read
-- through app.organization_create_owned's array -- the path the backfill cannot
-- cover, because those memberships do not exist when the migration runs.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select public.business_draft_save(
  p_display_name => 'Activity Fresh Org',
  p_org_type => 'showroom_dealer',
  p_primary_branch_name => 'Main Branch'
);

select lives_ok(
  $$ select public.business_draft_submit(
       (
         select id
         from public.business_creation_drafts
         where user_id = '22222222-2222-4222-8222-222222222222'
           and display_name = 'Activity Fresh Org'
           and completed_at is null
         order by created_at desc
         limit 1
       )
     ) $$,
  'an authenticated user can create a new owned organization through the public business flow');

reset role;

select is(
  (select count(*)::int
   from public.memberships m
   join public.organizations o on o.id = m.organization_id
   join public.membership_capabilities c on c.membership_id = m.id
   where o.name = 'Activity Fresh Org'
     and c.capability_key = 'activity.read'),
  1, 'a newly created organization grants its owner activity.read');

set local role authenticated;
-- Clients have SELECT only. These fail at the privilege boundary before a
-- policy could accidentally create a write path.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.organization_activity_events (
       organization_id, audit_log_id, event_type, subject_type)
     select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, action, subject_type
     from public.audit_log limit 1 $$,
  '42501', null, 'authenticated cannot insert activity rows directly');
select throws_ok(
  $$ update public.organization_activity_events set params = '{}'::jsonb
     where subject_id = (select customer_a from _activity_ids) $$,
  '42501', null, 'authenticated cannot update activity rows');
select throws_ok(
  $$ delete from public.organization_activity_events
     where subject_id = (select customer_a from _activity_ids) $$,
  '42501', null, 'authenticated cannot delete activity rows');
reset role;

-- Even the table owner is stopped by the shared append-only triggers.
select throws_ok(
  $$ update public.organization_activity_events set params = '{}'::jsonb
     where subject_id = (select customer_a from _activity_ids) $$,
  'P0001', null, 'the append-only trigger rejects owner UPDATE');
select throws_ok(
  $$ delete from public.organization_activity_events
     where subject_id = (select customer_a from _activity_ids) $$,
  'P0001', null, 'the append-only trigger rejects owner DELETE');

set local role anon;
select throws_ok(
  $$ select 1 from public.organization_activity_events limit 1 $$,
  '42501', null, 'anonymous callers have no activity-table privilege');
reset role;

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name = 'organization_activity_events'
     and grantee = 'authenticated'
     and privilege_type <> 'SELECT'),
  0, 'authenticated holds no non-SELECT activity-table privilege');

select * from finish();
rollback;
