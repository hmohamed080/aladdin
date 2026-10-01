-- pgTAP: business-track account activation (20261001090001_business_account_activation.sql).
--
-- A business-track registrant who is operationally ready (confirmed email, business
-- track with the account-type step done, current consent, a username, an ACTIVE
-- organization membership) must become users.status = 'active'; anyone missing a
-- piece must not; consumer / professional activation is untouched; suspended and
-- deactivated accounts are never revived; it is idempotent; nothing writes a persona,
-- a consumer/professional completion event, or an RBAC row.
--
--   A. Real lifecycle: consent -> business track -> username -> business_submit
--   B. Last missing piece = username          C. Last missing piece = consent
--   D. Consumer path unchanged                E. Professional-track member NOT activated
--   F. Suspended / deactivated never touched  G. Unconfirmed email NOT activated
--   H. Backfill (same rule) + idempotency     I. Grants, audit vocabulary, RBAC untouched
create extension if not exists pgtap;

begin;
select plan(38);

-- ---------------------------------------------------------------------------
-- Fixtures: six seeded users that hold no membership, driven to a known pending state.
-- ---------------------------------------------------------------------------
create temp table persona_before as
  select id, primary_account_type::text as persona from public.users
  where id in ('71000006-0000-4000-8000-000000000006', '71000009-0000-4000-8000-000000000009');

create function pg_temp.prep(p_uid uuid) returns void language plpgsql as $$
begin
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = p_uid;
  update public.users set status = 'pending_verification' where id = p_uid;
  update public.profiles set username = null where user_id = p_uid;
  delete from public.consent_receipts where user_id = p_uid;
  delete from public.onboarding_progress where user_id = p_uid;
  delete from public.individual_onboarding where user_id = p_uid;
end $$;

create function pg_temp.grant_consent(p_uid uuid) returns void language sql as $$
  insert into public.consent_receipts (user_id, consent_type, version, locale)
  select p_uid, t, app.current_consent_version(t), 'en'
  from unnest(array['terms', 'privacy', 'pilot']::public.consent_type[]) t;
$$;

create function pg_temp.set_track(p_uid uuid, p_track public.onboarding_track) returns void language sql as $$
  insert into public.onboarding_progress (user_id, selected_track, account_type_completed_at, completed_at)
  values (p_uid, p_track, now(), now());
$$;

create function pg_temp.add_username(p_uid uuid, p_name text) returns void language sql as $$
  update public.profiles set username = p_name where user_id = p_uid;
$$;

create function pg_temp.add_membership(p_uid uuid) returns void language sql as $$
  insert into public.memberships (user_id, organization_id, status, accepted_at)
  values (p_uid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', now());
$$;

-- ===========================================================================
-- A. Real lifecycle through the product RPCs (UA = ...006)
-- ===========================================================================
select pg_temp.prep('71000006-0000-4000-8000-000000000006');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en');
select public.onboarding_select_account_type('business', 'supplier');
select public.profile_set_username('act_ua_owner');
reset role;
select is((select status::text from public.users where id = '71000006-0000-4000-8000-000000000006'),
  'pending_verification',
  'consent + business track + username alone do not activate (no membership yet)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$ select public.business_save(p_display_name => 'Act UA Supply', p_org_type => 'supplier', p_primary_branch_name => 'Cairo HQ') $$,
  'business_save records the draft');
select lives_ok($$ select public.business_submit() $$,
  'business_submit creates the organization and the owner membership');
reset role;

select is((select status::text from public.users where id = '71000006-0000-4000-8000-000000000006'),
  'active', 'the membership event completes the last piece: the business account becomes active');
select is((select count(*)::int from public.audit_log
           where action = 'account.activated' and subject_id = '71000006-0000-4000-8000-000000000006'),
  1, 'the activation is audited exactly once');
select is((select metadata ->> 'source' from public.audit_log
           where action = 'account.activated' and subject_id = '71000006-0000-4000-8000-000000000006'),
  'business_lifecycle', 'the audit row records the lifecycle source');
select is((select u.primary_account_type::text from public.users u where u.id = '71000006-0000-4000-8000-000000000006'),
  (select persona from persona_before where id = '71000006-0000-4000-8000-000000000006'),
  'activation writes no persona');
select is((select count(*)::int from public.individual_onboarding where user_id = '71000006-0000-4000-8000-000000000006'),
  0, 'no consumer/professional onboarding record is created');
select is((select count(*)::int from public.audit_log
           where subject_id = '71000006-0000-4000-8000-000000000006'
             and action in ('onboarding.consumer_completed', 'onboarding.professional_submitted')),
  0, 'no consumer-completion or professional-submission event is emitted');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select public.my_registration_state()), 'active_personal',
  'the activated account still resolves to active_personal (registration semantics preserved)');
reset role;

-- ===========================================================================
-- B. Last missing piece = username (UB = ...007)
-- ===========================================================================
select pg_temp.prep('71000007-0000-4000-8000-000000000007');
select pg_temp.grant_consent('71000007-0000-4000-8000-000000000007');
select pg_temp.set_track('71000007-0000-4000-8000-000000000007', 'business');
select pg_temp.add_membership('71000007-0000-4000-8000-000000000007');
select is((select status::text from public.users where id = '71000007-0000-4000-8000-000000000007'),
  'pending_verification', 'an incomplete business account (membership, no username) does NOT activate');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select public.profile_set_username('act_ub_owner');
reset role;
select is((select status::text from public.users where id = '71000007-0000-4000-8000-000000000007'),
  'active', 'storing the username (the last missing piece) activates it');

-- ===========================================================================
-- C. Last missing piece = consent (UC = ...008)
-- ===========================================================================
select pg_temp.prep('71000008-0000-4000-8000-000000000008');
select pg_temp.set_track('71000008-0000-4000-8000-000000000008', 'business');
select pg_temp.add_username('71000008-0000-4000-8000-000000000008', 'act_uc_owner');
select pg_temp.add_membership('71000008-0000-4000-8000-000000000008');
select is((select status::text from public.users where id = '71000008-0000-4000-8000-000000000008'),
  'pending_verification', 'an incomplete business account (no consent) does NOT activate');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000008-0000-4000-8000-000000000008","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en');
reset role;
select is((select status::text from public.users where id = '71000008-0000-4000-8000-000000000008'),
  'active', 'recording consent (the last missing piece) activates it');

-- ===========================================================================
-- D. Consumer behaviour unchanged (UD = ...009)
-- ===========================================================================
select pg_temp.prep('71000009-0000-4000-8000-000000000009');
-- A fresh consumer selection is Coming Soon (20260924090013), so the consumer track is
-- seeded directly; the completion RPC under test is the real one.
select pg_temp.set_track('71000009-0000-4000-8000-000000000009', 'consumer');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000009-0000-4000-8000-000000000009","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en');
select public.individual_complete_consumer();
reset role;
select is((select status::text from public.users where id = '71000009-0000-4000-8000-000000000009'),
  'active', 'consumer completion still activates through the personal path');
select is((select count(*)::int from public.audit_log
           where action = 'onboarding.consumer_completed' and subject_id = '71000009-0000-4000-8000-000000000009'),
  1, 'consumer completion still emits its own event');
select is((select count(*)::int from public.audit_log
           where action = 'account.activated' and subject_id = '71000009-0000-4000-8000-000000000009'),
  0, 'the business activation never fires for a consumer-track account');
select is((select u.primary_account_type::text from public.users u where u.id = '71000009-0000-4000-8000-000000000009'),
  (select persona from persona_before where id = '71000009-0000-4000-8000-000000000009'),
  'consumer persona handling is unchanged');

-- ===========================================================================
-- E. A professional-track member is NOT activated by the business rule (UE = ...010)
-- ===========================================================================
select pg_temp.prep('71000010-0000-4000-8000-000000000010');
select pg_temp.grant_consent('71000010-0000-4000-8000-000000000010');
select pg_temp.set_track('71000010-0000-4000-8000-000000000010', 'professional');
select pg_temp.add_username('71000010-0000-4000-8000-000000000010', 'act_ue_pro');
select pg_temp.add_membership('71000010-0000-4000-8000-000000000010');
select app.activate_business_accounts_backfill();
select is((select status::text from public.users where id = '71000010-0000-4000-8000-000000000010'),
  'pending_verification', 'a professional-track member with consent, username and membership stays pending');
select is((select count(*)::int from public.audit_log
           where action = 'account.activated' and subject_id = '71000010-0000-4000-8000-000000000010'),
  0, 'no business activation event for the professional track');

-- ===========================================================================
-- F. Suspended / deactivated accounts are never revived (UF = ...011)
-- ===========================================================================
select pg_temp.prep('71000011-0000-4000-8000-000000000011');
update public.users set status = 'suspended' where id = '71000011-0000-4000-8000-000000000011';
select pg_temp.grant_consent('71000011-0000-4000-8000-000000000011');
select pg_temp.set_track('71000011-0000-4000-8000-000000000011', 'business');
select pg_temp.add_username('71000011-0000-4000-8000-000000000011', 'act_uf_owner');
select pg_temp.add_membership('71000011-0000-4000-8000-000000000011');
update public.memberships set status = 'active' where user_id = '71000011-0000-4000-8000-000000000011';
select app.activate_business_accounts_backfill();
select is((select status::text from public.users where id = '71000011-0000-4000-8000-000000000011'),
  'suspended', 'a suspended, otherwise-ready business account stays suspended (every event + backfill)');
update public.users set status = 'deactivated' where id = '71000011-0000-4000-8000-000000000011';
update public.memberships set status = 'active' where user_id = '71000011-0000-4000-8000-000000000011';
select app.activate_business_accounts_backfill();
select is((select status::text from public.users where id = '71000011-0000-4000-8000-000000000011'),
  'deactivated', 'a deactivated, otherwise-ready business account stays deactivated');
select is((select count(*)::int from public.audit_log
           where action = 'account.activated' and subject_id = '71000011-0000-4000-8000-000000000011'),
  0, 'no activation event is written for an excluded account');

-- ===========================================================================
-- G. Unconfirmed Auth email is not activated (UI = 72...001)
-- ===========================================================================
select pg_temp.prep('72000001-0000-4000-8000-000000000001');
update auth.users set email_confirmed_at = null where id = '72000001-0000-4000-8000-000000000001';
select pg_temp.grant_consent('72000001-0000-4000-8000-000000000001');
select pg_temp.set_track('72000001-0000-4000-8000-000000000001', 'business');
select pg_temp.add_username('72000001-0000-4000-8000-000000000001', 'act_ui_owner');
select pg_temp.add_membership('72000001-0000-4000-8000-000000000001');
select is((select status::text from public.users where id = '72000001-0000-4000-8000-000000000001'),
  'pending_verification', 'an unconfirmed Auth email is never activated');

-- ===========================================================================
-- H. Backfill uses the same rule; repeats are no-ops (UH = 70...010)
-- ===========================================================================
select pg_temp.prep('70000010-0000-4000-8000-000000000010');
select pg_temp.grant_consent('70000010-0000-4000-8000-000000000010');
select pg_temp.set_track('70000010-0000-4000-8000-000000000010', 'business');
select pg_temp.add_username('70000010-0000-4000-8000-000000000010', 'act_uh_owner');
select pg_temp.add_membership('70000010-0000-4000-8000-000000000010');
-- The lifecycle already activated it; put it back to pending to simulate a pre-fix account.
update public.users set status = 'pending_verification' where id = '70000010-0000-4000-8000-000000000010';
select cmp_ok((select app.activate_business_accounts_backfill()), '>=', 1,
  'the backfill activates qualifying pending business accounts');
select is((select status::text from public.users where id = '70000010-0000-4000-8000-000000000010'),
  'active', 'the backfilled account is active');
select is((select count(*)::int from public.audit_log
           where action = 'account.activated' and subject_id = '70000010-0000-4000-8000-000000000010'
             and metadata ->> 'source' = 'business_backfill'),
  1, 'the backfill is audited with its own source');
select is((select app.activate_business_accounts_backfill()), 0,
  'running the backfill again activates nothing (idempotent)');
select is((select app.activate_business_account('71000006-0000-4000-8000-000000000006')), false,
  'activating an already-active account is a no-op');
select is((select count(*)::int from public.audit_log
           where action = 'account.activated' and subject_id = '71000006-0000-4000-8000-000000000006'),
  1, 'a repeated activation writes no second audit row');

-- ===========================================================================
-- I. Grants, audit vocabulary, RBAC untouched
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'app.business_account_ready(uuid)', 'execute'),
  'the rule helper is not client-executable');
select ok(not has_function_privilege('authenticated', 'app.activate_business_account(uuid,text)', 'execute'),
  'the promotion helper is not client-executable');
select ok(not has_function_privilege('authenticated', 'app.activate_business_accounts_backfill()', 'execute'),
  'the backfill is not client-executable');
select ok(not has_function_privilege('authenticated', 'app.business_activation_trigger()', 'execute'),
  'the trigger function is not client-executable');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select throws_ok($$ select app.activate_business_account('71000007-0000-4000-8000-000000000007') $$,
  '42501', null, 'a client cannot call the promotion helper directly');
reset role;
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_audit_action_known') like '%account.activated%',
  'account.activated is in the audit vocabulary');
select is((select count(*)::int from public.admin_permissions), 25, 'the permission catalog is unchanged');
select is((select count(*)::int from public.admin_roles), 4, 'the admin roles are unchanged');

select * from finish();
rollback;
