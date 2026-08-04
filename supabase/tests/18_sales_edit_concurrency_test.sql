-- pgTAP: Sprint 5.1 edit-path optimistic concurrency + explicit clearing.
-- Sequential proof of the preconditions and clear semantics for update_customer
-- (expected updated_at), update_follow_up / reassign_follow_up (expected version).
-- The true two-session serialization is proven by the companion race scripts
-- (customer_update_concurrency_test.sh / follow_up_update_concurrency_test.sh).
create extension if not exists pgtap;

begin;
select plan(16);

-- Caller 22222222 (Cairo membership e2222) gets org-wide sales authority.
insert into public.membership_capabilities (membership_id, capability_key)
  values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.manage')
  on conflict do nothing;

-- Fixtures (as postgres): a Cairo customer with a phone/location, and an open
-- follow-up on a Cairo lead.
insert into public.customers (organization_id, branch_id, display_name, primary_phone, location_summary, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc',
        'Edit Cust', '01000000009', 'Nasr City', '22222222-2222-4222-8222-222222222222');
insert into public.leads (organization_id, branch_id, title, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','Edit FU Lead',
        '22222222-2222-4222-8222-222222222222');
insert into public.follow_up_tasks (organization_id, branch_id, lead_id, assigned_membership_id, title, description, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc',
        (select id from public.leads where title='Edit FU Lead'),
        'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','Edit FU','has a description',
        '22222222-2222-4222-8222-222222222222');

create temp table _e as
  select (select id from public.customers where display_name='Edit Cust') as cust_id,
         (select updated_at from public.customers where display_name='Edit Cust') as cust_u0,
         (select id from public.follow_up_tasks where title='Edit FU') as fu_id;
grant select on _e to authenticated, anon, service_role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

-- ===== Customer: expected updated_at ========================================
-- NOTE: now() is constant within a transaction, so the trigger-maintained
-- updated_at does not change between two edits in THIS single-transaction test;
-- the true stale-after-commit serialization is proven by
-- customer_update_concurrency_test.sh. Here we prove the precondition LOGIC: the
-- correct token succeeds and any mismatched token is rejected with 40001.
select lives_ok(
  $$ select public.update_customer((select cust_id from _e),
       p_expected_updated_at => (select cust_u0 from _e), p_display_name => 'Cust T1') $$,
  'update_customer with the correct expected updated_at succeeds');
select throws_ok(
  $$ select public.update_customer((select cust_id from _e),
       p_expected_updated_at => (select cust_u0 from _e) - interval '1 hour', p_display_name => 'Cust STALE') $$,
  '40001', null, 'a mismatched expected updated_at is rejected (40001)');
select is(
  (select display_name from public.customers where id=(select cust_id from _e)),
  'Cust T1', 'the rejected (stale-token) edit did not overwrite the newer value');

-- ===== Customer: explicit optional-field clearing ===========================
select lives_ok(
  $$ select public.update_customer((select cust_id from _e), p_clear_phone => true) $$,
  'update_customer can clear the phone');
select is(
  (select primary_phone from public.customers where id=(select cust_id from _e)),
  null, 'the phone is cleared to NULL (not an empty string)');
select is(
  (select primary_phone_e164 from public.customers where id=(select cust_id from _e)),
  null, 'the generated E.164 phone is NULL after clearing');
select lives_ok(
  $$ select public.update_customer((select cust_id from _e), p_clear_location => true) $$,
  'update_customer can clear the location summary');
select is(
  (select location_summary from public.customers where id=(select cust_id from _e)),
  null, 'the location summary is cleared to NULL');
-- Omitting a field leaves it unchanged.
select lives_ok(
  $$ select public.update_customer((select cust_id from _e), p_email => 'kept@co.test') $$,
  'update_customer sets email without touching the (already cleared) phone');
select is(
  (select primary_phone from public.customers where id=(select cust_id from _e)),
  null, 'omitting phone on a later edit leaves it NULL (not restored)');

-- ===== Follow-up: expected version ==========================================
select lives_ok(
  $$ select public.update_follow_up((select fu_id from _e), p_expected_version => 1, p_title => 'FU T1') $$,
  'update_follow_up with the correct expected version succeeds (v1->v2)');
select throws_ok(
  $$ select public.update_follow_up((select fu_id from _e), p_expected_version => 1, p_title => 'FU STALE') $$,
  '40001', null, 'a stale expected version is rejected (40001)');
select is(
  (select title from public.follow_up_tasks where id=(select fu_id from _e)),
  'FU T1', 'the stale follow-up edit did not overwrite the newer title');

-- Follow-up: clear description.
select lives_ok(
  $$ select public.update_follow_up((select fu_id from _e), p_expected_version => 2, p_clear_description => true) $$,
  'update_follow_up can clear the description');
select is(
  (select description from public.follow_up_tasks where id=(select fu_id from _e)),
  null, 'the follow-up description is cleared to NULL');

-- ===== Reassign: expected version ===========================================
select throws_ok(
  $$ select public.reassign_follow_up((select fu_id from _e),
       'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 1) $$,
  '40001', null, 'a stale expected version is rejected on reassignment (40001)');

reset role;
select * from finish();
rollback;
