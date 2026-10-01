-- pgTAP: dedicated platform-account preparation
-- (20260930100006_admin_platform_account_preparation.sql).
--
-- app.admin_prepare_platform_account() promotes ONE explicitly named, dedicated platform
-- account (confirmed email, not banned, no persona, no active membership) from
-- pending_verification to active - so my_registration_state() resolves active_personal and the
-- normal sign-in chain lands staff in /admin - and nothing else. It is DB-owner-only, strict,
-- idempotent and audited, and the existing one-time Super Admin bootstrap and its
-- last-Super-Admin safeguards are untouched.
--
--   A. Preparation of a verified pending account (status, audit, no side-effect rows)
--   B. Resulting registration state; staff only after the (separate) bootstrap
--   C. Idempotency and reason
--   D. Strict-mode refusals
--   E. Non-staff pending users untouched; consumer flow unchanged
--   F. Bootstrap afterwards: exactly one Super Admin, safeguards intact
--   G. Grants, audit vocabulary, RBAC untouched
create extension if not exists pgtap;

begin;
select plan(46);

-- ---------------------------------------------------------------------------
-- Fixtures (seeded users that hold no membership), driven to a known state.
--   P1 71000006  clean dedicated-staff candidate
--   P2 71000007  ordinary pending user WITH a persona (non-staff)
--   P3 71000008  banned        P4 71000009  suspended      P5 71000010  deactivated
--   P6 71000011  unconfirmed email
--   P7 72000001  no persona but an ACTIVE membership
--   P8 70000010  consumer-track user (personal activation path stays unchanged)
-- ---------------------------------------------------------------------------
create function pg_temp.prep(p_uid uuid) returns void language plpgsql as $$
begin
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), banned_until = null where id = p_uid;
  update public.users set status = 'pending_verification' where id = p_uid;
  update public.profiles set username = null where user_id = p_uid;
  delete from public.consent_receipts where user_id = p_uid;
  delete from public.onboarding_progress where user_id = p_uid;
  delete from public.individual_onboarding where user_id = p_uid;
end $$;

create function pg_temp.no_persona(p_uid uuid) returns void language sql as $$
  update public.users set primary_account_type = null where id = p_uid;
$$;

select pg_temp.prep('71000006-0000-4000-8000-000000000006'); select pg_temp.no_persona('71000006-0000-4000-8000-000000000006');
select pg_temp.prep('71000007-0000-4000-8000-000000000007');
select pg_temp.prep('71000008-0000-4000-8000-000000000008'); select pg_temp.no_persona('71000008-0000-4000-8000-000000000008');
update auth.users set banned_until = now() + interval '1 day' where id = '71000008-0000-4000-8000-000000000008';
select pg_temp.prep('71000009-0000-4000-8000-000000000009'); select pg_temp.no_persona('71000009-0000-4000-8000-000000000009');
update public.users set status = 'suspended' where id = '71000009-0000-4000-8000-000000000009';
select pg_temp.prep('71000010-0000-4000-8000-000000000010'); select pg_temp.no_persona('71000010-0000-4000-8000-000000000010');
update public.users set status = 'deactivated' where id = '71000010-0000-4000-8000-000000000010';
select pg_temp.prep('71000011-0000-4000-8000-000000000011'); select pg_temp.no_persona('71000011-0000-4000-8000-000000000011');
update auth.users set email_confirmed_at = null where id = '71000011-0000-4000-8000-000000000011';
select pg_temp.prep('72000001-0000-4000-8000-000000000001'); select pg_temp.no_persona('72000001-0000-4000-8000-000000000001');
insert into public.memberships (user_id, organization_id, status, accepted_at)
  values ('72000001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', now());
select pg_temp.prep('70000010-0000-4000-8000-000000000010');

select is((select count(*)::int from public.admin_role_assignments a join public.admin_roles r on r.id = a.role_id
           where r.key = 'super_admin' and a.is_active), 0, 'fixture: the database starts with no Super Admin');

-- ===========================================================================
-- A. Preparation of a verified pending account
-- ===========================================================================
select is((select app.admin_prepare_platform_account('71000006-0000-4000-8000-000000000006', 'dedicated platform admin')),
  true, 'a verified, pending, persona-free, membership-free account is prepared');
select is((select status::text from public.users where id = '71000006-0000-4000-8000-000000000006'),
  'active', 'its status becomes active through the supported helper');
select is((select count(*)::int from public.audit_log
           where action = 'account.platform_prepared' and subject_id = '71000006-0000-4000-8000-000000000006'),
  1, 'exactly one account.platform_prepared audit row');
select is((select metadata ->> 'previous_status' || '|' || (metadata ->> 'source') || '|' || (metadata ->> 'reason')
           from public.audit_log where action = 'account.platform_prepared' and subject_id = '71000006-0000-4000-8000-000000000006'),
  'pending_verification|dba_platform_prepare|dedicated platform admin',
  'the audit row records the previous status, the source and the reason');
select is((select primary_account_type::text from public.users where id = '71000006-0000-4000-8000-000000000006'),
  null, 'no persona is created');
select is((select count(*)::int from public.organizations where created_by = '71000006-0000-4000-8000-000000000006'), 0,
  'no organization is created');
select is((select count(*)::int from public.memberships where user_id = '71000006-0000-4000-8000-000000000006'), 0,
  'no membership is created');
select is((select count(*)::int from public.onboarding_progress where user_id = '71000006-0000-4000-8000-000000000006'), 0,
  'no onboarding completion is faked');
select is((select count(*)::int from public.consent_receipts where user_id = '71000006-0000-4000-8000-000000000006'), 0,
  'no consent record is created');

-- ===========================================================================
-- B. Registration state; staff only after the separate bootstrap
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select public.my_registration_state()), 'active_personal',
  'the prepared account resolves to active_personal with no persona and no organization (no ordinary onboarding)');
select is((select public.admin_my_access() ->> 'is_staff'), 'false',
  'preparation alone grants no staff authority (that is the separate bootstrap)');
reset role;

-- ===========================================================================
-- C. Idempotency and reason
-- ===========================================================================
select is((select app.admin_prepare_platform_account('71000006-0000-4000-8000-000000000006', 'again')),
  false, 'preparing an already-active dedicated account is a no-op');
select is((select count(*)::int from public.audit_log
           where action = 'account.platform_prepared' and subject_id = '71000006-0000-4000-8000-000000000006'),
  1, 'a repeat writes no second audit row');
select throws_ok($$ select app.admin_prepare_platform_account('71000008-0000-4000-8000-000000000008', null) $$,
  '22023', 'a reason is required', 'a reason is mandatory (null)');
select throws_ok($$ select app.admin_prepare_platform_account('71000008-0000-4000-8000-000000000008', '   ') $$,
  '22023', 'a reason is required', 'a reason is mandatory (blank)');

-- ===========================================================================
-- D. Strict-mode refusals (each leaves the account untouched)
-- ===========================================================================
select throws_ok($$ select app.admin_prepare_platform_account('71000011-0000-4000-8000-000000000011', 'x') $$,
  '22023', 'a confirmed email is required', 'an unconfirmed email is refused');
select throws_ok($$ select app.admin_prepare_platform_account('71000008-0000-4000-8000-000000000008', 'x') $$,
  '22023', 'a banned account cannot be prepared', 'a banned account is refused');
select throws_ok($$ select app.admin_prepare_platform_account('71000009-0000-4000-8000-000000000009', 'x') $$,
  '22023', 'a suspended account cannot be prepared', 'a suspended account is refused');
select throws_ok($$ select app.admin_prepare_platform_account('71000010-0000-4000-8000-000000000010', 'x') $$,
  '22023', 'a deactivated account cannot be prepared', 'a deactivated account is refused');
select throws_ok($$ select app.admin_prepare_platform_account('71000007-0000-4000-8000-000000000007', 'x') $$,
  '22023', 'an account with a personal persona is not a dedicated platform account', 'an account with a persona is refused');
select throws_ok($$ select app.admin_prepare_platform_account('72000001-0000-4000-8000-000000000001', 'x') $$,
  '22023', 'an account with an active organization membership is not a dedicated platform account',
  'an account with an active membership is refused');
select throws_ok($$ select app.admin_prepare_platform_account('99999999-9999-4999-8999-999999999999', 'x') $$,
  '22023', 'user not found', 'an unknown user is refused');
select is((select status::text from public.users where id = '71000008-0000-4000-8000-000000000008'), 'pending_verification', 'the banned account stays pending');
select is((select status::text from public.users where id = '71000009-0000-4000-8000-000000000009'), 'suspended', 'the suspended account stays suspended');
select is((select status::text from public.users where id = '71000010-0000-4000-8000-000000000010'), 'deactivated', 'the deactivated account stays deactivated');
select is((select status::text from public.users where id = '71000011-0000-4000-8000-000000000011'), 'pending_verification', 'the unconfirmed account stays pending');
select is((select status::text from public.users where id = '72000001-0000-4000-8000-000000000001'), 'pending_verification', 'the member account stays pending');

-- ===========================================================================
-- E. Non-staff pending users untouched; the personal activation path unchanged
-- ===========================================================================
select is((select status::text from public.users where id = '71000007-0000-4000-8000-000000000007'),
  'pending_verification', 'an ordinary pending user is never activated by preparing someone else');
select is((select count(*)::int from public.audit_log where action = 'account.platform_prepared'), 1,
  'exactly one account has been prepared in total');

select pg_temp.prep('70000010-0000-4000-8000-000000000010');
insert into public.onboarding_progress (user_id, selected_track, account_type_completed_at, completed_at)
  values ('70000010-0000-4000-8000-000000000010', 'consumer', now(), now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en');
select public.individual_complete_consumer();
reset role;
select is((select status::text from public.users where id = '70000010-0000-4000-8000-000000000010'),
  'active', 'consumer completion still activates through the personal path');
select is((select count(*)::int from public.audit_log
           where action = 'account.platform_prepared' and subject_id = '70000010-0000-4000-8000-000000000010'),
  0, 'the personal path never emits the platform-preparation event');

-- ===========================================================================
-- F. Bootstrap afterwards: exactly one Super Admin, safeguards intact
-- ===========================================================================
select lives_ok($$ select app.admin_bootstrap_super_admin('71000006-0000-4000-8000-000000000006') $$,
  'the existing one-time bootstrap accepts the prepared account');
select is((select count(*)::int from public.admin_role_assignments a join public.admin_roles r on r.id = a.role_id
           where r.key = 'super_admin' and a.is_active), 1, 'exactly one active Super Admin exists');
select is((select a.user_id::text from public.admin_role_assignments a join public.admin_roles r on r.id = a.role_id
           where r.key = 'super_admin' and a.is_active), '71000006-0000-4000-8000-000000000006',
  'and it is the prepared account');
select is((select count(*)::int from public.audit_log
           where action = 'admin_role.assigned' and metadata ->> 'source' = 'dba_bootstrap'), 1,
  'the bootstrap audit row exists');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select public.admin_my_access() ->> 'is_staff') || '|' || (select public.admin_my_access() ->> 'rank'),
  'true|100', 'the account is now platform staff at Super Admin rank (the landing resolver sends staff to /admin first)');
select is((select public.my_registration_state()), 'active_personal',
  'it still resolves active_personal after the bootstrap (no onboarding is ever shown)');
reset role;
select throws_ok($$ select app.admin_bootstrap_super_admin('71000007-0000-4000-8000-000000000007') $$,
  '42501', null, 'a second bootstrap is refused once a Super Admin exists');
select throws_ok(
  $$ update public.admin_role_assignments
     set is_active = false, deactivated_at = now(), deactivation_kind = 'unassigned'
     where user_id = '71000006-0000-4000-8000-000000000006'
       and role_id = (select id from public.admin_roles where key = 'super_admin') $$,
  '42501', null, 'the last-Super-Admin safeguard still refuses to deactivate the only Super Admin');

-- ===========================================================================
-- G. Grants, audit vocabulary, RBAC untouched
-- ===========================================================================
select ok(not has_function_privilege('anon', 'app.admin_prepare_platform_account(uuid,text)', 'execute')
      and not has_function_privilege('authenticated', 'app.admin_prepare_platform_account(uuid,text)', 'execute')
      and not has_function_privilege('service_role', 'app.admin_prepare_platform_account(uuid,text)', 'execute'),
  'the helper is executable by no client role (DB owner only)');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_audit_action_known') like '%account.platform_prepared%',
  'account.platform_prepared is in the audit vocabulary');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_audit_action_known') like '%account.platform_cleanup%',
  'account.platform_cleanup (the explicit cleanup record) is in the audit vocabulary');
select is((select count(*)::int from public.audit_log where action = 'account.platform_cleanup'), 0,
  'the helper itself never writes a cleanup event (only the operational transaction does)');
select is((select count(*)::int from public.admin_permissions), 25, 'the permission catalog is unchanged');
select is((select count(*)::int from public.admin_roles), 4, 'the admin roles are unchanged');

select * from finish();
rollback;
