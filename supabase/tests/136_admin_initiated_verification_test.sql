-- pgTAP: admin-initiated verification (20261115090002_admin_initiated_verification.sql), FINAL owner policy.
--
--   A. authority and validation: anonymous / Support refused; Moderator (users.verify) may start a USER verification; NO reason
--      is required (an optional note is capped at 500 characters); not for yourself, an inactive or non-professional account;
--   B. effects: ONE ordinary 'submitted' row, marked initiated_by_admin; an optional note is in the audit log only (never on
--      the row the applicant can read); repeat calls never duplicate; the audit row names the acting Admin and the target;
--   C. the decision is the UNCHANGED workflow: review_start -> review_approve -> apply, or review_reject; an approved
--      account cannot be initiated again, a rejected one can; a rejection reason is OPTIONAL: given, it is stored, audited and
--      carried in the owner's notification; omitted, the rejection succeeds with a generic notification; approvals and
--      rejections are audited with actor and target;
--   D. Admin approval has NO completion requirement: legacy, profile-completion and admin-initiated Craftsman requests
--      are all approvable, including at 0%;
--   E. organizations need the Administrator tier and an active owner; not for an organization that is not awaiting
--      approval; an INCOMPLETE showroom can be approved and activated (the approved-verification requirement stays);
--   H. decision history (reviewer, decision time, admin-initiated) in the account details;
--   F. grants;
--   G. the derived "attention" view of Admin Users: a VERIFIED account below 100% appears (right after an Admin approves
--      it, and after completion drops), carries its percentage, keeps its Verified state and status, is never revoked, and
--      leaves the view by itself once completion is back at 100%. Nothing is stored.
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(83);

create function pg_temp.q(p_user uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
  execute 'set local role authenticated';
  execute 'select (' || p_sql || ')::text' into r;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return 'ERR:' || sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: staff  adm (Administrator) | mdr (Moderator: users.verify only) | sup (Support: no verify)
--           subjects c1 craftsman | e1 engineer | e2 engineer | e3 engineer (suspended) | k1 end consumer
--                    c2 craftsman (legacy request) | c3 craftsman (marked request) | c4 craftsman (admin-initiated)
--           owners  o1 (supplier org) | o2 (showroom org, incomplete) | o3 (org that will be active) | o4 (no owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values
  ('13600000-0000-4000-8000-0000000000a1', 'ai-adm@example.test'),
  ('13600000-0000-4000-8000-0000000000a2', 'ai-mdr@example.test'),
  ('13600000-0000-4000-8000-0000000000a3', 'ai-sup@example.test'),
  ('13600000-0000-4000-8000-0000000000b1', 'ai-c1@example.test'),
  ('13600000-0000-4000-8000-0000000000b2', 'ai-e1@example.test'),
  ('13600000-0000-4000-8000-0000000000b3', 'ai-e2@example.test'),
  ('13600000-0000-4000-8000-0000000000b4', 'ai-e3@example.test'),
  ('13600000-0000-4000-8000-0000000000b5', 'ai-k1@example.test'),
  ('13600000-0000-4000-8000-0000000000b6', 'ai-c2@example.test'),
  ('13600000-0000-4000-8000-0000000000b7', 'ai-c3@example.test'),
  ('13600000-0000-4000-8000-0000000000b8', 'ai-c4@example.test'),
  ('13600000-0000-4000-8000-0000000000d1', 'ai-o1@example.test'),
  ('13600000-0000-4000-8000-0000000000d2', 'ai-o2@example.test'),
  ('13600000-0000-4000-8000-0000000000d3', 'ai-o3@example.test'),
  ('13600000-0000-4000-8000-0000000000d4', 'ai-o4@example.test')) v(id, email);

insert into public.platform_role_grants (user_id, role, granted_by) values
  ('13600000-0000-4000-8000-0000000000a1', 'administrator', '13600000-0000-4000-8000-0000000000a1'),
  ('13600000-0000-4000-8000-0000000000a3', 'support', '13600000-0000-4000-8000-0000000000a1');
insert into public.admin_role_assignments (user_id, role_id)
select '13600000-0000-4000-8000-0000000000a2'::uuid, r.id from public.admin_roles r where r.key = 'moderator';

update public.users set primary_account_type = 'installer_technician'
 where id in ('13600000-0000-4000-8000-0000000000b1', '13600000-0000-4000-8000-0000000000b6', '13600000-0000-4000-8000-0000000000b7', '13600000-0000-4000-8000-0000000000b8');
update public.users set primary_account_type = 'engineer'
 where id in ('13600000-0000-4000-8000-0000000000b2', '13600000-0000-4000-8000-0000000000b3', '13600000-0000-4000-8000-0000000000b4');
update public.users set primary_account_type = 'end_consumer' where id = '13600000-0000-4000-8000-0000000000b5';
update public.users set status = 'suspended' where id = '13600000-0000-4000-8000-0000000000b4';

-- Organizations through the real creator (owner membership + capabilities), as their owners.
do $$
declare v_o1 uuid; v_o2 uuid; v_o3 uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '13600000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
  v_o1 := app.organization_create_owned('AI Supplier One', 'supplier', 'en', 'Main', 'AI Supplier One LLC', 'cairo', 'al-marj', null);
  perform set_config('request.jwt.claims', json_build_object('sub', '13600000-0000-4000-8000-0000000000d2', 'role', 'authenticated')::text, true);
  v_o2 := app.organization_create_owned('AI Showroom Two', 'showroom_dealer', 'en', 'Main', 'AI Showroom Two LLC', 'cairo', 'al-marj', null);
  perform set_config('request.jwt.claims', json_build_object('sub', '13600000-0000-4000-8000-0000000000d3', 'role', 'authenticated')::text, true);
  v_o3 := app.organization_create_owned('AI Supplier Three', 'supplier', 'en', 'Main', 'AI Supplier Three LLC', 'cairo', 'al-marj', null);
  perform set_config('request.jwt.claims', '', true);
  create temp table t_org on commit drop as select v_o1 o1, v_o2 o2, v_o3 o3;
end $$;
-- o4: an organization with NO active owner membership
insert into public.organizations (name, legal_name, org_type, status, created_by)
values ('AI No Owner', 'AI No Owner LLC', 'supplier', 'pending_verification', '13600000-0000-4000-8000-0000000000d4');
create temp table t_o4 on commit drop as select id from public.organizations where name = 'AI No Owner';

-- ===========================================================================
-- A. authority and validation (user subjects)
-- ===========================================================================
select is(pg_temp.q(null, $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b2', 'owner could not submit')$$), 'ERR:42501', 'an unauthenticated caller is refused');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a3', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b2', 'owner could not submit')$$), 'ERR:42501', 'Support (no users.verify) is refused');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000b3', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b2', 'owner could not submit')$$), 'ERR:42501', 'an ordinary user is refused');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a2', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b2', repeat('x', 501))$$), 'ERR:22023', 'an optional note longer than 500 characters is refused');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a2', $$public.admin_initiate_verification('team', '13600000-0000-4000-8000-0000000000b2', 'owner could not submit')$$), 'ERR:22023', 'only user or organization subjects');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a2', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b5', 'owner could not submit')$$), 'ERR:22023', 'a non-professional account cannot be verified');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a2', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b4', 'owner could not submit')$$), 'ERR:22023', 'an inactive account cannot be verified');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000a1', 'verify myself please')$$), 'ERR:42501', 'an admin may not initiate for their own account');

-- ===========================================================================
-- B. effects
-- ===========================================================================
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a2', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b2', 'owner could not submit')$$)::jsonb ->> 'state'), 'initiated', 'a Moderator (users.verify) initiates a user verification');
select is((select status::text || ':' || requested_account_type::text || ':' || (reviewer_id is null)::text || ':' || (metadata ->> 'initiated_by_admin') from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b2'),
  'submitted:engineer:true:true', 'ONE ordinary submitted row for the persona, marked admin-initiated, nobody assigned');
select is((select count(*)::int from public.audit_log where action = 'verification.admin_initiated' and actor_user_id = '13600000-0000-4000-8000-0000000000a2' and metadata ->> 'reason' = 'owner could not submit' and metadata ->> 'subject_user_id' = '13600000-0000-4000-8000-0000000000b2' and created_at is not null), 1, 'one audit row with the acting Admin, the target account, the optional note and a timestamp');
select is((select count(*)::int from (select jsonb_object_keys(metadata) k from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b2') x where k <> 'initiated_by_admin'), 0, 'the row carries no reason or initiator for the applicant to read');
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a2', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b2', 'owner could not submit')$$)::jsonb ->> 'state'), 'already_open', 'a repeat call finds the open request');
select is((select count(*)::int from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b2') || ':' || (select count(*)::int from public.audit_log where action = 'verification.admin_initiated' and subject_id = (select id from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b2')), '1:1', 'no duplicate request and no second audit row');

-- ===========================================================================
-- C. the decision is the unchanged workflow
-- ===========================================================================
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.review_start((select id from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b2'))$$), '', 'review_start claims it (existing state machine)');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.review_approve((select id from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b2'), false)$$), '', 'review_approve decides it');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.apply_account_upgrade((select id from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b2'))$$), '', 'the unchanged apply step runs');
select is((select status::text || ':' || (applied_at is not null)::text from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b2'), 'approved:true', 'approved and applied');
-- approval notification: the account owner is told once, with the existing centralized writer and i18n keys; retries add none
select is((select count(*)::int from public.notifications where recipient_user_id = '13600000-0000-4000-8000-0000000000b2' and event_type = 'verification.approved' and body_key = 'notifications.verification.userApproved.body' and title_key = 'notifications.verification.userApproved.title' and deep_link = '/home/profile'), 1, 'the account owner is notified of the approval');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.review_approve((select id from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b2'), false)$$), '', 'a retry of the approval by the same Admin succeeds idempotently');
select is((select count(*)::int from public.notifications where recipient_user_id = '13600000-0000-4000-8000-0000000000b2' and event_type = 'verification.approved'), 1, 'and sends no second notification');

select is((select count(*)::int from public.audit_log where action = 'verification.approved' and actor_user_id = '13600000-0000-4000-8000-0000000000a1' and metadata ->> 'subject_user_id' = '13600000-0000-4000-8000-0000000000b2' and metadata ->> 'admin_initiated' = 'true'), 1, 'the approval is audited with the acting Admin, the target account and the admin-initiated mark');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a2', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b2', 'owner could not submit')$$), 'ERR:22023', 'an already verified account cannot be initiated again');

-- reject path: e2 is initiated, started and rejected with a reason; a new initiation is then allowed
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a2', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b3')$$)::jsonb ->> 'state'), 'initiated', 'e2 initiated with NO reason and NO note');
select is((select (metadata ? 'reason')::text || ':' || (metadata ->> 'subject_user_id') from public.audit_log where action = 'verification.admin_initiated' and metadata ->> 'subject_user_id' = '13600000-0000-4000-8000-0000000000b3'), 'false:13600000-0000-4000-8000-0000000000b3', 'a no-reason initiation is still audited with its target and no reason key');
select pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.review_start((select id from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b3'))$$);
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.review_reject((select id from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b3'), 'documents unclear')$$), '', 'reject with a reason');
select is((select reason from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b3' and status = 'rejected'), 'documents unclear', 'the reason is stored on the request (the owner sees it)');
select is((select body_key || '|' || (params ->> 'reason') from public.notifications where recipient_user_id = '13600000-0000-4000-8000-0000000000b3' and event_type = 'verification.rejected' and params ? 'reason'), 'notifications.verification.userRejected.bodyReason|documents unclear', 'the owner is notified WITH the reason');
select is((select count(*)::int from public.audit_log where action = 'verification.rejected' and actor_user_id = '13600000-0000-4000-8000-0000000000a1' and metadata ->> 'subject_user_id' = '13600000-0000-4000-8000-0000000000b3' and metadata ->> 'reason' = 'documents unclear'), 1, 'the rejection is audited with the acting Admin, the target and the reason');
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a2', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b3', 'try again after rejection')$$)::jsonb ->> 'state'), 'initiated', 'after a rejection a new request can be initiated');
-- a rejection WITHOUT a reason succeeds and sends the generic notification
select pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.review_start((select id from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b3' and status = 'submitted'))$$);
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.review_reject((select id from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b3' and status = 'under_review'), null)$$), '', 'a rejection with NO reason succeeds');
select is((select count(*)::int from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b3' and status = 'rejected' and reason is null), 1, 'and stores no reason');
select is((select count(*)::int from public.notifications where recipient_user_id = '13600000-0000-4000-8000-0000000000b3' and event_type = 'verification.rejected' and body_key = 'notifications.verification.userRejected.body' and params = '{}'::jsonb), 1, 'the owner gets the generic notification without a reason');
select is((select count(*)::int from public.audit_log where action = 'verification.rejected' and metadata ->> 'subject_user_id' = '13600000-0000-4000-8000-0000000000b3' and not (metadata ? 'reason')), 1, 'the no-reason rejection is audited too, without a reason key');

-- ===========================================================================
-- D. Craftsman guard grandfathering (all three craftsmen have INCOMPLETE profiles)
-- ===========================================================================
insert into public.verifications (subject_type, user_id, verification_type, requested_account_type, status, submitted_at, metadata) values
  ('user', '13600000-0000-4000-8000-0000000000b6', 'professional', 'installer_technician', 'submitted', now(), '{}'::jsonb),
  ('user', '13600000-0000-4000-8000-0000000000b7', 'professional', 'installer_technician', 'submitted', now(), '{"source":"profile_completion"}'::jsonb);
select is((app.profile_completion('13600000-0000-4000-8000-0000000000b8') ->> 'percent')::int, 0, 'c4 is a craftsman profile at 0%');
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a2', $$public.admin_initiate_verification('user', '13600000-0000-4000-8000-0000000000b8')$$)::jsonb ->> 'state'), 'initiated', 'c4 (0% craftsman) initiated by an admin without a request or reason');
select lives_ok($$ update public.verifications set status = 'approved', decided_at = now() where user_id = '13600000-0000-4000-8000-0000000000b6' $$, 'a legacy (unmarked) craftsman request is approvable below 100%');
select lives_ok($$ update public.verifications set status = 'approved', decided_at = now() where user_id = '13600000-0000-4000-8000-0000000000b8' $$, 'an admin-initiated craftsman request is approvable at 0%');
select lives_ok($$ update public.verifications set status = 'approved', decided_at = now() where user_id = '13600000-0000-4000-8000-0000000000b7' $$, 'a profile-completion request is approvable below 100% too');

-- ===========================================================================
-- E. organizations
-- ===========================================================================
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a2', format($$public.admin_initiate_verification('organization', %L::uuid, 'owner could not submit')$$, (select o1 from t_org))), 'ERR:42501', 'a Moderator (not Administrator tier) cannot initiate an organization');
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a1', format($$public.admin_initiate_verification('organization', %L::uuid, 'owner could not submit')$$, (select o1 from t_org)))::jsonb ->> 'state'), 'initiated', 'an Administrator initiates an organization verification');
select is((select verification_type::text || ':' || status::text || ':' || (metadata ->> 'initiated_by_admin') from public.verifications where organization_id = (select o1 from t_org)), 'organization:submitted:true', 'an ordinary submitted organization request, marked admin-initiated');
select is((select count(*)::int from public.audit_log where action = 'verification.admin_initiated' and organization_id = (select o1 from t_org)), 1, 'one audit row scoped to the organization');
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a1', format($$public.admin_initiate_verification('organization', %L::uuid, 'owner could not submit')$$, (select o1 from t_org)))::jsonb ->> 'state'), 'already_open', 'a repeat finds the open organization request');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', format($$public.admin_initiate_verification('organization', %L::uuid, 'owner could not submit')$$, (select id from t_o4))), 'ERR:22023', 'an organization with no active owner is refused');
update public.organizations set status = 'active' where id = (select o3 from t_org);
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', format($$public.admin_initiate_verification('organization', %L::uuid, 'owner could not submit')$$, (select o3 from t_org))), 'ERR:22023', 'an organization that is not awaiting approval is refused');
-- the showroom completeness guard still applies to an admin-initiated approval
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a1', format($$public.admin_initiate_verification('organization', %L::uuid, 'owner could not submit')$$, (select o2 from t_org)))::jsonb ->> 'state'), 'initiated', 'an incomplete showroom can be initiated');
select pg_temp.q('13600000-0000-4000-8000-0000000000a1', format($$public.review_start((select id from public.verifications where organization_id = %L::uuid))$$, (select o2 from t_org)));
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', format($$public.review_approve((select id from public.verifications where organization_id = %L::uuid), false)$$, (select o2 from t_org))), '', 'and an Admin may approve it: showroom business-completeness no longer restricts approval');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', format($$public.apply_organization_verification((select id from public.verifications where organization_id = %L::uuid))$$, (select o2 from t_org))), '', 'the unchanged apply step activates it');
select is((select status::text || ':' || is_verified::text from public.organizations where id = (select o2 from t_org)), 'active:true', 'the incomplete showroom is active and verified (the approved-verification requirement was met)');
select is((select count(*)::int from public.audit_log where action = 'verification.approved' and actor_user_id = '13600000-0000-4000-8000-0000000000a1' and metadata ->> 'subject_organization_id' = (select o2::text from t_org) and organization_id = (select o2 from t_org)), 1, 'the organization approval is audited with the acting Admin and the target organization');

-- ===========================================================================
-- H. decision history in the account details (authorized Admin)
-- ===========================================================================
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_user_detail('13600000-0000-4000-8000-0000000000b2')$$)::jsonb -> 'verifications' -> 0 ->> 'reviewer_id') || ':' || ((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_user_detail('13600000-0000-4000-8000-0000000000b2')$$)::jsonb -> 'verifications' -> 0 ->> 'initiated_by_admin')) || ':' || ((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_user_detail('13600000-0000-4000-8000-0000000000b2')$$)::jsonb -> 'verifications' -> 0 ->> 'decided_at') is not null)::text,
  '13600000-0000-4000-8000-0000000000a1:true:true', 'the user details show who decided, when, and that an Admin started it');
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a1', format($$public.admin_organization_detail(%L::uuid)$$, (select o2 from t_org)))::jsonb -> 'verifications' -> 0 ->> 'initiated_by_admin') || ':' || (pg_temp.q('13600000-0000-4000-8000-0000000000a1', format($$public.admin_organization_detail(%L::uuid)$$, (select o2 from t_org)))::jsonb -> 'verifications' -> 0 ->> 'reviewer_id'),
  'true:13600000-0000-4000-8000-0000000000a1', 'the organization details show the same decision history');

-- ===========================================================================
-- G. derived "Needs attention" view
-- ===========================================================================
-- A craftsman with a COMPLETE profile and an approved verification (fixture), plus an unverified incomplete one (c1 has none).
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('13600000-0000-4000-8000-0000000000b9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-c5@example.test',
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now());
do $$
declare v_avatar uuid; v_trade uuid; u uuid := '13600000-0000-4000-8000-0000000000b9';
begin
  select id into v_trade from public.trades where is_active order by key limit 1;
  update public.users set primary_account_type = 'installer_technician' where id = u;
  insert into public.avatar_uploads (owner_user_id, object_key, content_type) values (u, gen_random_uuid()::text || '.jpg', 'image/jpeg') returning id into v_avatar;
  update public.profiles set avatar_media_id = v_avatar, phone_e164 = '+201000136001', display_name_confirmed_at = now(), display_name = 'AI C5' where user_id = u;
  insert into public.individual_onboarding (user_id, prof_concrete_type, prof_years_experience, prof_availability) values (u, 'installer_technician', 5, 'full_time')
    on conflict (user_id) do update set prof_concrete_type = 'installer_technician', prof_years_experience = 5, prof_availability = 'full_time';
  insert into public.user_trades (user_id, trade_id) values (u, v_trade);
  insert into public.user_service_areas (user_id, governorate_key, is_primary) values (u, 'cairo', true);
  insert into public.portfolio_projects (owner_user_id, title) values (u, 'AI project');
  insert into public.verifications (subject_type, user_id, verification_type, requested_account_type, status, submitted_at, decided_at, applied_at)
    values ('user', u, 'professional', 'installer_technician', 'approved', now(), now(), now());
end $$;
select is((app.profile_completion('13600000-0000-4000-8000-0000000000b9') ->> 'percent')::int, 100, 'the verified fixture is at 100%');
select is(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_status => 'attention', p_page_size => 50)$$)::jsonb -> 'rows') @> '[{"id":"13600000-0000-4000-8000-0000000000b9"}]'::jsonb)::text, 'false', 'a verified account at 100% is NOT in the attention view');
delete from public.portfolio_projects where owner_user_id = '13600000-0000-4000-8000-0000000000b9';
select is(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_status => 'attention', p_page_size => 50)$$)::jsonb -> 'rows') @> '[{"id":"13600000-0000-4000-8000-0000000000b9","verification_state":"verified","completion":88}]'::jsonb)::text, 'true', 'once completion drops it appears, still Verified, with its actual percentage');
select is((select status::text from public.verifications where user_id = '13600000-0000-4000-8000-0000000000b9'), 'approved', 'verification is NEVER revoked when completion drops');
select ok(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_status => 'attention', p_page_size => 50)$$)::jsonb ->> 'total')::int) >= 1, 'the attention view total includes it');
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_page_size => 50)$$)::jsonb -> 'counts') ? 'attention', false, 'the always-on counts no longer evaluate the attention flag (performance)');
-- an Admin-approved profile below 100 is covered by the same derived rule (e1 was approved by an Admin while incomplete)
select is(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_status => 'attention', p_page_size => 50)$$)::jsonb -> 'rows') @> '[{"id":"13600000-0000-4000-8000-0000000000b2","verification_state":"verified"}]'::jsonb)::text, 'true', 'a profile an Admin approved below 100% is flagged too');
select is(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_status => 'attention', p_page_size => 50)$$)::jsonb -> 'rows') @> '[{"id":"13600000-0000-4000-8000-0000000000b3"}]'::jsonb)::text, 'false', 'an unverified (rejected) incomplete account is not in the view');
insert into public.portfolio_projects (owner_user_id, title) values ('13600000-0000-4000-8000-0000000000b9', 'AI project again');
select is(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_status => 'attention', p_page_size => 50)$$)::jsonb -> 'rows') @> '[{"id":"13600000-0000-4000-8000-0000000000b9"}]'::jsonb)::text, 'false', 'the warning clears by itself when completion returns to 100%');
select is(pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_status => 'bogus')$$), 'ERR:22023', 'the status filter stays validated');

-- decision history comes from the immutable Audit Log: acting Admin (id + name) and timestamp for each step
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_user_detail('13600000-0000-4000-8000-0000000000b2')$$)::jsonb -> 'verifications' -> 0 -> 'events' -> 0 ->> 'action'), 'verification.admin_initiated', 'history: the first event is the Admin initiation');
select is((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_user_detail('13600000-0000-4000-8000-0000000000b2')$$)::jsonb -> 'verifications' -> 0 -> 'events' -> 0 ->> 'actor_name'), (select display_name from public.profiles where user_id = (pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_user_detail('13600000-0000-4000-8000-0000000000b2')$$)::jsonb -> 'verifications' -> 0 -> 'events' -> 0 ->> 'actor_id')::uuid), 'history: names the acting Admin');
select ok((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_user_detail('13600000-0000-4000-8000-0000000000b2')$$)::jsonb -> 'verifications' -> 0 -> 'events' -> 0 ->> 'at') is not null, 'history: carries the timestamp');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_user_detail('13600000-0000-4000-8000-0000000000b2')$$)::jsonb -> 'verifications' -> 0 -> 'events') e where e ->> 'action' = 'verification.approved' and e ->> 'actor_name' is not null and e ->> 'actor_id' is not null), 'history: the approval names the deciding Admin');

-- status tab: an approved verification lists the account under Verified (never activating it); the other rules are unchanged
select is(app.admin_user_status_tab('pending_verification', 'approved'), 'verified', 'tab: an approved verification is listed under Verified');
select is(app.admin_user_status_tab('pending_verification', 'submitted'), 'pending', 'tab: an open request stays Pending');
select is(app.admin_user_status_tab('pending_verification', null), null::text, 'tab: an unfinished registration with no request has no Pending tab (ADR-0031 step 1)');
select is(app.admin_user_status_tab('pending_verification', 'rejected'), 'rejected', 'tab: a rejection is still Rejected');
select is(app.admin_user_status_tab('suspended', 'approved'), 'suspended', 'tab: Suspended always wins');
select is(app.admin_user_status_tab('active', null), null, 'tab: an active account that never asked for verification is NOT Verified (All only)');
select is(app.admin_user_status_tab('active', 'submitted'), 'pending', 'tab: an active account with an open request is Pending');
select is(app.admin_user_status_tab('active', 'approved'), 'verified', 'tab: an active account with an approved verification is Verified');
select is(app.admin_user_status_tab('deactivated', null), null, 'tab: a deactivated account is under All only');
-- the active, never-verified Admin account (a1) stays reachable: in All and under the Unverified filter, not in the Verified tab
select is(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_page_size => 50)$$)::jsonb -> 'rows') @> '[{"id":"13600000-0000-4000-8000-0000000000a1"}]'::jsonb)::text, 'true', 'directory: an active unverified account is listed under All');
select is(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_verification => 'unverified', p_page_size => 50)$$)::jsonb -> 'rows') @> '[{"id":"13600000-0000-4000-8000-0000000000a1"}]'::jsonb)::text, 'true', 'directory: and under the Unverified filter');
select is(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_status => 'verified', p_page_size => 50)$$)::jsonb -> 'rows') @> '[{"id":"13600000-0000-4000-8000-0000000000a1"}]'::jsonb)::text, 'false', 'directory: but not in the Verified tab');
select is(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_status => 'verified', p_page_size => 50)$$)::jsonb -> 'rows') @> '[{"id":"13600000-0000-4000-8000-0000000000b2"}]'::jsonb)::text, 'true', 'directory: the Admin-approved account is in the Verified tab');
select is(((pg_temp.q('13600000-0000-4000-8000-0000000000a1', $$public.admin_users_list(p_status => 'pending', p_page_size => 50)$$)::jsonb -> 'rows') @> '[{"id":"13600000-0000-4000-8000-0000000000b2"}]'::jsonb)::text, 'false', 'directory: and no longer in the Pending tab');
select is((select status::text from public.users where id = '13600000-0000-4000-8000-0000000000b2'), 'pending_verification', 'the approval did NOT activate the account (users.status is untouched)');

-- ===========================================================================
-- F. grants
-- ===========================================================================
select ok(has_function_privilege('authenticated', 'public.admin_initiate_verification(text,uuid,text)', 'execute')
      and not has_function_privilege('anon', 'public.admin_initiate_verification(text,uuid,text)', 'execute'), 'authenticated may execute, anon may not');

select * from finish();
rollback;
