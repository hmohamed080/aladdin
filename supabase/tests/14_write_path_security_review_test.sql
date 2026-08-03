-- pgTAP: independent Sprint 2 write-path security review.
-- Proves exact DML/execute boundaries and adversarial lifecycle behavior that the
-- original happy-path suites did not cover.
create extension if not exists pgtap;

begin;
select plan(83);

-- ===== Direct service-role bypasses are prohibited =========================
set local role service_role;
select throws_ok(
  $$ update public.users set primary_account_type='engineer'
     where id='44444444-4444-4444-8444-444444444444' $$,
  '42501', null, 'service_role cannot directly update primary_account_type');
select throws_ok(
  $$ update public.profiles set public_profile_status='listed'
     where user_id='44444444-4444-4444-8444-444444444444' $$,
  '42501', null, 'service_role cannot directly update public_profile_status');
select throws_ok(
  $$ update public.verifications set status='approved' where false $$,
  '42501', null, 'service_role cannot directly update verification decisions');
select throws_ok(
  $$ insert into public.audit_log (action,subject_type)
     values ('platform.override_used','test') $$,
  '42501', null, 'service_role cannot forge an audit event');
select throws_ok(
  $$ update public.memberships set status='revoked' where id='e2222222-eeee-4eee-8eee-eeeeeeeeeee2' $$,
  '42501', null, 'service_role cannot directly update membership lifecycle');
select throws_ok(
  $$ insert into public.membership_capabilities (membership_id,capability_key)
     values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2','org.manage') $$,
  '42501', null, 'service_role cannot directly grant membership capabilities');
select throws_ok(
  $$ insert into public.membership_branch_access (membership_id,branch_id)
     values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2','c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'service_role cannot directly assign branch access');
select throws_ok(
  $$ insert into public.platform_role_grants (user_id,role)
     values ('11111111-1111-4111-8111-111111111111','administrator') $$,
  '42501', null, 'service_role cannot directly grant platform authority');

-- ===== Authenticated table DML cannot bypass RPC invariants ===============
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ insert into public.memberships (user_id,organization_id)
     values ('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '42501', null, 'authenticated cannot directly insert memberships');
select throws_ok(
  $$ update public.memberships set status='revoked'
     where id='e2222222-eeee-4eee-8eee-eeeeeeeeeee2' $$,
  '42501', null, 'authenticated cannot directly update memberships');
select throws_ok(
  $$ delete from public.membership_capabilities
     where membership_id='e1111111-eeee-4eee-8eee-eeeeeeeeeee1' and capability_key='org.manage' $$,
  '42501', null, 'authenticated cannot directly delete capabilities');
select throws_ok(
  $$ insert into public.membership_branch_access (membership_id,branch_id)
     values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2','c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'authenticated cannot directly insert branch assignments');
select throws_ok(
  $$ insert into public.contacts (user_id,channel,value,is_verified)
     values ('11111111-1111-4111-8111-111111111111','email','forged@example.test',true) $$,
  '42501', null, 'authenticated cannot forge contact verification on insert');
select throws_ok(
  $$ update public.contacts set is_verified=true
     where user_id='11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'authenticated cannot forge contact verification on update');
select throws_ok(
  $$ insert into public.branches (organization_id,name)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Unaudited Branch') $$,
  '42501', null, 'authenticated cannot bypass the deferred branch lifecycle path');
reset role;
set local role service_role;
select throws_ok(
  $$ update public.branches set is_active=false where id='c1111111-cccc-4ccc-8ccc-cccccccccccc' $$,
  '42501', null, 'service_role cannot bypass the deferred branch lifecycle path');

-- ===== Exact table/column privilege shape =================================
reset role;
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee='anon' and table_schema='public'
     and table_name = any(array[
       'users','profiles','verifications','verification_documents','memberships',
       'membership_capabilities','membership_branch_access','branches',
       'platform_role_grants','audit_log'])),
  0, 'anon has no base-table privilege on any reviewed table');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee='authenticated' and table_schema='public'
     and table_name = any(array[
       'users','profiles','verifications','verification_documents','memberships',
       'membership_capabilities','membership_branch_access','branches',
       'platform_role_grants','audit_log']) and privilege_type='SELECT'),
  10, 'authenticated has exactly SELECT on all ten reviewed tables');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee='authenticated' and table_schema='public'
     and table_name = any(array[
       'users','profiles','verifications','verification_documents','memberships',
       'membership_capabilities','membership_branch_access','branches',
       'platform_role_grants','audit_log']) and privilege_type<>'SELECT'),
  0, 'authenticated has no table-level write, truncate, reference, or trigger privilege');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee='service_role' and table_schema='public'
     and table_name = any(array[
       'users','profiles','verifications','verification_documents','memberships',
       'membership_capabilities','membership_branch_access','branches',
       'platform_role_grants','audit_log']) and privilege_type='SELECT'),
  10, 'service_role has exactly SELECT on all ten reviewed tables');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee='service_role' and table_schema='public'
     and table_name = any(array[
       'users','profiles','verifications','verification_documents','memberships',
       'membership_capabilities','membership_branch_access','branches',
       'platform_role_grants','audit_log']) and privilege_type<>'SELECT'),
  0, 'service_role has no table-level write, truncate, reference, or trigger privilege');
select is(
  (select array_agg(table_name||'.'||column_name order by table_name,column_name)
   from information_schema.role_column_grants
   where grantee='service_role' and table_schema='public'
     and table_name = any(array[
       'users','profiles','verifications','verification_documents','memberships',
       'membership_capabilities','membership_branch_access','branches',
       'platform_role_grants','audit_log']) and privilege_type='UPDATE'),
  array['users.locale'],
  'service_role has exactly one reviewed column update grant: users.locale');
select is(has_table_privilege('authenticated','public.memberships','select'), true,
  'authenticated retains membership SELECT');
select is(has_table_privilege('service_role','public.memberships','select'), true,
  'service_role retains membership SELECT');
select is(has_column_privilege('service_role','public.users','primary_account_type','update'), false,
  'service_role lacks UPDATE on users.primary_account_type');
select is(has_column_privilege('service_role','public.users','locale','update'), true,
  'service_role may update only the non-privileged users.locale column');
select is(has_column_privilege('service_role','public.profiles','public_profile_status','update'), false,
  'service_role lacks UPDATE on profiles.public_profile_status');
select is(has_column_privilege('service_role','public.verifications','status','update'), false,
  'service_role lacks UPDATE on verifications.status');
select is(has_column_privilege('service_role','public.verifications','reviewer_id','update'), false,
  'service_role lacks UPDATE on verifications.reviewer_id');
select is(has_column_privilege('service_role','public.verifications','grants_public_listing','update'), false,
  'service_role lacks UPDATE on verifications.grants_public_listing');
select is(has_column_privilege('service_role','public.verifications','applied_at','update'), false,
  'service_role lacks UPDATE on verifications.applied_at');

-- ===== Function ownership/configuration/execute ACLs ======================
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where n.nspname='public'
      and p.proname = any(array[
        'request_account_upgrade','review_start','review_request_changes','review_reject',
        'review_approve','apply_account_upgrade','set_profile_hidden',
        'membership_invite','membership_activate','membership_set_capabilities',
        'membership_suspend','membership_revoke','branch_assign','branch_unassign'])
      and a.grantee=0 and a.privilege_type='EXECUTE'),
  0, 'PUBLIC has execute on no workflow RPC');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname = any(array[
        'request_account_upgrade','review_start','review_request_changes','review_reject',
        'review_approve','apply_account_upgrade','set_profile_hidden',
        'membership_invite','membership_activate','membership_set_capabilities',
        'membership_suspend','membership_revoke','branch_assign','branch_unassign'])
      and has_function_privilege('anon',p.oid,'execute')),
  0, 'anon can execute no workflow RPC');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname = any(array[
        'request_account_upgrade','review_start','review_request_changes','review_reject',
        'review_approve','apply_account_upgrade','set_profile_hidden',
        'membership_invite','membership_activate','membership_set_capabilities',
        'membership_suspend','membership_revoke','branch_assign','branch_unassign'])
      and has_function_privilege('service_role',p.oid,'execute')),
  0, 'service_role can execute no caller-attributed workflow RPC');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname = any(array[
        'request_account_upgrade','review_start','review_request_changes','review_reject',
        'review_approve','apply_account_upgrade','set_profile_hidden',
        'membership_invite','membership_activate','membership_set_capabilities',
        'membership_suspend','membership_revoke','branch_assign','branch_unassign'])
      and has_function_privilege('authenticated',p.oid,'execute')),
  14, 'authenticated can reach exactly the fourteen internally-authorized workflow RPCs');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join pg_roles r on r.oid=p.proowner
    where n.nspname='public'
      and p.proname = any(array[
        'request_account_upgrade','review_start','review_request_changes','review_reject',
        'review_approve','apply_account_upgrade','set_profile_hidden',
        'membership_invite','membership_activate','membership_set_capabilities',
        'membership_suspend','membership_revoke','branch_assign','branch_unassign'])
      and r.rolname='postgres'),
  14, 'all workflow RPCs are owned by postgres');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname = any(array[
        'request_account_upgrade','review_start','review_request_changes','review_reject',
        'review_approve','apply_account_upgrade','set_profile_hidden',
        'membership_invite','membership_activate','membership_set_capabilities',
        'membership_suspend','membership_revoke','branch_assign','branch_unassign'])
      and p.prosecdef),
  14, 'all workflow RPCs are security definer');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname = any(array[
        'request_account_upgrade','review_start','review_request_changes','review_reject',
        'review_approve','apply_account_upgrade','set_profile_hidden',
        'membership_invite','membership_activate','membership_set_capabilities',
        'membership_suspend','membership_revoke','branch_assign','branch_unassign'])
      and array_position(p.proconfig,'search_path=""') is not null),
  14, 'all workflow RPCs pin an empty search_path');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname = any(array[
        'request_account_upgrade','review_start','review_request_changes','review_reject',
        'review_approve','apply_account_upgrade','set_profile_hidden',
        'membership_invite','membership_activate','membership_set_capabilities',
        'membership_suspend','membership_revoke','branch_assign','branch_unassign'])
      and p.provolatile='v'),
  14, 'all state-changing workflow RPCs are volatile');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app'
      and p.proname = any(array[
        'record_audit_event','assert_not_last_owner','guard_verification_update',
        'enforce_membership_branch_tenant'])
      and has_function_privilege('anon',p.oid,'execute')),
  0, 'anon cannot execute internal security helpers');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app'
      and p.proname = any(array[
        'record_audit_event','assert_not_last_owner','guard_verification_update',
        'enforce_membership_branch_tenant'])
      and has_function_privilege('authenticated',p.oid,'execute')),
  0, 'authenticated cannot execute internal security helpers');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app'
      and p.proname = any(array[
        'record_audit_event','assert_not_last_owner','guard_verification_update',
        'enforce_membership_branch_tenant'])
      and has_function_privilege('service_role',p.oid,'execute')),
  0, 'service_role cannot execute internal security helpers');
select is(pg_has_role('authenticated','postgres','member'), false,
  'ordinary authenticated sessions cannot assume the function-owner role');

-- ===== Verification lifecycle adversarial cases ===========================
-- Add a second platform reviewer as a test fixture.
insert into public.platform_role_grants (user_id,role,granted_by)
values ('11111111-1111-4111-8111-111111111111','support','55555555-5555-4555-8555-555555555555');

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select lives_ok($$ select public.request_account_upgrade('engineer') $$,
  'subject creates a caller-scoped professional upgrade request');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.review_start((select id from public.verifications
       where user_id='44444444-4444-4444-8444-444444444444')) $$,
  'platform administrator claims the review');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.review_approve((select id from public.verifications
       where user_id='44444444-4444-4444-8444-444444444444'),false) $$,
  '42501', null, 'a stale second reviewer cannot approve another reviewer''s claim');
select is(
  (select reviewer_id from public.verifications
    where user_id='44444444-4444-4444-8444-444444444444'),
  '55555555-5555-4555-8555-555555555555'::uuid,
  'stale review attempt cannot replace reviewer_id');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.review_approve((select id from public.verifications
       where user_id='44444444-4444-4444-8444-444444444444'),true) $$,
  'the assigned reviewer can approve');
reset role;
select throws_ok(
  $$ update public.verifications set requested_account_type='contractor'
     where user_id='44444444-4444-4444-8444-444444444444' $$,
  '23514', null, 'requested account type is immutable after submission');
select throws_ok(
  $$ update public.verifications set grants_public_listing=false
     where user_id='44444444-4444-4444-8444-444444444444' $$,
  '23514', null, 'listing eligibility is immutable after approval');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.apply_account_upgrade((select id from public.verifications
       where user_id='44444444-4444-4444-8444-444444444444')) $$,
  'valid approved professional upgrade applies through the sole RPC');
reset role;

insert into public.verifications (
  subject_type,user_id,verification_type,requested_account_type,status,
  reviewer_id,submitted_at,decided_at,expires_at)
values (
  'user','22222222-2222-4222-8222-222222222222','professional','contractor','approved',
  '55555555-5555-4555-8555-555555555555',now()-interval '2 days',now()-interval '1 day',now()-interval '1 hour');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.apply_account_upgrade((select id from public.verifications
       where user_id='22222222-2222-4222-8222-222222222222')) $$,
  '22023', null, 'an expired approved verification cannot be applied');
reset role;
select is((select primary_account_type::text from public.users
  where id='22222222-2222-4222-8222-222222222222'), 'sales',
  'expired approval leaves account type unchanged');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$ select public.request_account_upgrade('engineer') $$,
  'subject can create a new open request after an earlier terminal decision');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.review_start((select id from public.verifications
       where user_id='22222222-2222-4222-8222-222222222222' and status='submitted')) $$,
  'reviewer claims the resubmission fixture');
select lives_ok(
  $$ select public.review_request_changes((select id from public.verifications
       where user_id='22222222-2222-4222-8222-222222222222' and status='under_review'),'more evidence') $$,
  'assigned reviewer can request more information');
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$ select public.request_account_upgrade('engineer') $$,
  'same self-service RPC resubmits a needs-more-info request');
select is(
  (select status::text from public.verifications
   where user_id='22222222-2222-4222-8222-222222222222' and status='submitted'),
  'submitted', 'resubmission returns the request to submitted state');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.review_approve((select id from public.verifications
       where user_id='22222222-2222-4222-8222-222222222222' and status='submitted'),false) $$,
  '22023', null, 'resubmitted request requires a fresh review_start claim before decision');

reset role;

insert into public.verifications (
  subject_type,organization_id,verification_type,status,reviewer_id,decided_at)
values (
  'organization','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','organization','approved',
  '55555555-5555-4555-8555-555555555555',now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.apply_account_upgrade((select id from public.verifications
       where subject_type='organization')) $$,
  '22023', null, 'organization verification cannot enter the user-account upgrade path');

-- Audit failure must roll back all protected business writes.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok($$ select public.request_account_upgrade('contractor') $$,
  'second subject creates an upgrade request for rollback testing');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.review_start((select id from public.verifications
       where user_id='33333333-3333-4333-8333-333333333333' and status='submitted')) $$,
  'rollback fixture enters review');
select lives_ok(
  $$ select public.review_approve((select id from public.verifications
       where user_id='33333333-3333-4333-8333-333333333333' and status='under_review'),false) $$,
  'rollback fixture is approved');
reset role;
create function pg_temp.reject_account_type_audit()
returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$;
create trigger reject_account_type_audit
  before insert on public.audit_log
  for each row when (new.action='account.type_changed')
  execute function pg_temp.reject_account_type_audit();
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.apply_account_upgrade((select id from public.verifications
       where user_id='33333333-3333-4333-8333-333333333333' and status='approved')) $$,
  'P0001', null, 'audit insertion failure aborts account-upgrade application');
reset role;
select is((select primary_account_type::text from public.users
  where id='33333333-3333-4333-8333-333333333333'), 'interior_designer',
  'audit failure rolls back the account-type transition');
select is((select applied_at from public.verifications
  where user_id='33333333-3333-4333-8333-333333333333'), null,
  'audit failure rolls back applied_at');
drop trigger reject_account_type_audit on public.audit_log;

-- ===== Membership/capability/branch adversarial cases =====================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.membership_set_capabilities(
       'e1111111-eeee-4eee-8eee-eeeeeeeeeee1',array[]::text[]) $$,
  '23514', null, 'capability replacement cannot remove the final org.manage owner');
select throws_ok(
  $$ select public.membership_set_capabilities(
       'e2222222-eeee-4eee-8eee-eeeeeeeeeee2',array['catalog.write','catalog.write']) $$,
  '22023', null, 'duplicate capability keys are rejected');
select throws_ok(
  $$ select public.membership_set_capabilities(
       'e2222222-eeee-4eee-8eee-eeeeeeeeeee2',array['platform.administrator']) $$,
  '22023', null, 'platform authority cannot be expressed as a membership capability');
select lives_ok(
  $$ select public.membership_set_capabilities(
       'e2222222-eeee-4eee-8eee-eeeeeeeeeee2',array[]::text[]) $$,
  'empty capability set intentionally removes all non-owner capabilities');
reset role;
select is(
  (select metadata->'before' from public.audit_log
   where action='membership.role_changed' and subject_id='e2222222-eeee-4eee-8eee-eeeeeeeeeee2'
   order by created_at desc limit 1),
  '["sales.opportunity.read", "sales.opportunity.write"]'::jsonb,
  'capability audit metadata records the sorted before set');

update public.branches set is_active=false where id='c2222222-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.branch_assign('e2222222-eeee-4eee-8eee-eeeeeeeeeee2','c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  '22023', null, 'inactive branch cannot be assigned');
reset role;
update public.branches set is_active=true where id='c2222222-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$ select public.membership_suspend('e2222222-eeee-4eee-8eee-eeeeeeeeeee2') $$,
  'manager can suspend a non-owner membership');
select throws_ok(
  $$ select public.branch_assign('e2222222-eeee-4eee-8eee-eeeeeeeeeee2','c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  '22023', null, 'inactive membership cannot receive branch access');
select lives_ok($$ select public.membership_activate('e2222222-eeee-4eee-8eee-eeeeeeeeeee2') $$,
  'manager can reactivate a suspended membership');
reset role;
select throws_ok(
  $$ insert into public.membership_branch_access (membership_id,branch_id)
     values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2','cb333333-cccc-4ccc-8ccc-cccccccccccc') $$,
  '23514', null, 'structural trigger rejects cross-tenant branch assignment even for owner DML');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select isnt(
  public.branch_assign('e2222222-eeee-4eee-8eee-eeeeeeeeeee2','c2222222-cccc-4ccc-8ccc-cccccccccccc'),
  null::uuid, 'first same-tenant branch assignment returns its id');
select is(
  public.branch_assign('e2222222-eeee-4eee-8eee-eeeeeeeeeee2','c2222222-cccc-4ccc-8ccc-cccccccccccc'),
  (select id from public.membership_branch_access
    where membership_id='e2222222-eeee-4eee-8eee-eeeeeeeeeee2'
      and branch_id='c2222222-cccc-4ccc-8ccc-cccccccccccc'),
  'duplicate branch assignment is idempotent and returns the existing id');
reset role;
select is((select count(*)::int from public.audit_log
  where action='branch.assignment_changed'
    and subject_id='e2222222-eeee-4eee-8eee-eeeeeeeeeee2'
    and metadata->>'op'='assign'
    and metadata->>'branch_id'='c2222222-cccc-4ccc-8ccc-cccccccccccc'),
  1, 'duplicate branch assignment emits no false second audit event');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.branch_unassign('e2222222-eeee-4eee-8eee-eeeeeeeeeee2','c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  'branch assignment can be removed');
select lives_ok(
  $$ select public.branch_unassign('e2222222-eeee-4eee-8eee-eeeeeeeeeee2','c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  'duplicate branch unassignment is an idempotent no-op');
reset role;
select is((select count(*)::int from public.audit_log
  where action='branch.assignment_changed'
    and subject_id='e2222222-eeee-4eee-8eee-eeeeeeeeeee2'
    and metadata->>'op'='unassign'
    and metadata->>'branch_id'='c2222222-cccc-4ccc-8ccc-cccccccccccc'),
  1, 'duplicate branch unassignment emits no false second audit event');
select ok(
  (select lower(p.prosrc) like '%from public.organizations%for update%'
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='app' and p.proname='assert_not_last_owner'),
  'last-owner guard locks the stable organization row');

select * from finish();
rollback;
