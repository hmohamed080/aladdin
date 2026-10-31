-- pgTAP: integration of the installer / contact migrations on top of main (RC2 schema 20261015090053).
--
-- Ported to the approved integration branch (main + PRs #88-#97 + #96). The rehearsal's secondary-phone and cooldown
-- actions are gone (PR #88 owns that domain); the PR stack's own actions are listed in stack_actions.
-- Proves the reconciliations made when this branch was rebuilt on main:
--   1. the audit vocabulary is main's 169 actions PLUS only the feature actions, and stays validated;
--   2. app.audit_actions_add appends, never removes, is idempotent and is not callable by any API role;
--   3. main's guard_phone_password_identity still refuses an unaccompanied phone change for an installer alias account, and
--      allows exactly the phones of an ACTIVE journal row (20261017090004) - evidence no client can forge;
--   4. main's audit-actor deletion mechanism is the one in force (the actor FK is kept).
create extension if not exists pgtap;

begin;
select plan(33);

-- ===========================================================================
-- 1. Vocabulary
-- ===========================================================================
create temp table main_actions(a text primary key) on commit drop;
insert into main_actions values
  ('account.platform_cleanup'),
  ('account.platform_prepared'),
  ('account.restored'),
  ('account.suspended'),
  ('account.type_changed'),
  ('account.upgrade_requested'),
  ('admin_case.created'),
  ('admin_follow_up.completed'),
  ('admin_follow_up.logged'),
  ('admin_note.created'),
  ('admin_role.archived'),
  ('admin_role.assigned'),
  ('admin_role.assignment_changed'),
  ('admin_role.created'),
  ('admin_role.permissions_changed'),
  ('admin_role.restored'),
  ('admin_role.unassigned'),
  ('admin_role.updated'),
  ('admin_staff.disabled'),
  ('admin_staff.restored'),
  ('affiliation.approved'),
  ('affiliation.cancelled'),
  ('affiliation.rejected'),
  ('affiliation.requested'),
  ('branch.assignment_changed'),
  ('branch.created'),
  ('branch.deactivated'),
  ('branch.reactivated'),
  ('branch.verification_requested'),
  ('branch.verification_revoked'),
  ('branch.verified'),
  ('conversation.opened'),
  ('customer.created'),
  ('customer.reassigned'),
  ('customer.updated'),
  ('followup.completed'),
  ('followup.created'),
  ('followup.reassigned'),
  ('followup.reopened'),
  ('job.application.accepted'),
  ('job.application.rejected'),
  ('job.application.submitted'),
  ('job.application.withdrawn'),
  ('job.assignment.cancelled'),
  ('job.assignment.completed'),
  ('job.assignment.progress_updated'),
  ('job.assignment.started'),
  ('job.cancelled'),
  ('job.closed'),
  ('job.created'),
  ('job.published'),
  ('job.review.restored'),
  ('job.review.submitted'),
  ('job.review.suppressed'),
  ('job.updated'),
  ('lead.archived'),
  ('lead.assigned'),
  ('lead.created'),
  ('lead.details_changed'),
  ('lead.lost'),
  ('lead.reassigned'),
  ('lead.reopened'),
  ('lead.stage_changed'),
  ('lead.won'),
  ('membership.activated'),
  ('membership.granted'),
  ('membership.revoked'),
  ('membership.role_changed'),
  ('membership.suspended'),
  ('network_candidate.approved'),
  ('network_candidate.cancelled'),
  ('network_candidate.rejected'),
  ('network_candidate.submitted'),
  ('network_referral.approved'),
  ('network_referral.cancelled'),
  ('network_referral.joined'),
  ('network_referral.rejected'),
  ('network_referral.submitted'),
  ('offer.archived'),
  ('offer.created'),
  ('offer.paused'),
  ('offer.published'),
  ('offer.resumed'),
  ('offer.updated'),
  ('onboarding.completed'),
  ('onboarding.consumer_completed'),
  ('onboarding.organization_created'),
  ('onboarding.professional_submitted'),
  ('order.cancelled'),
  ('order.completed'),
  ('order.created'),
  ('order.started'),
  ('organization.activities_set'),
  ('organization.application_abandoned'),
  ('organization.application_submitted'),
  ('organization.co_owner_requested'),
  ('organization.co_owner_revoked'),
  ('organization.co_owner_verified'),
  ('organization.contact_set'),
  ('organization.created'),
  ('organization.description_changed'),
  ('organization.duplicate_dismissed'),
  ('organization.duplicate_linked'),
  ('organization.identity_change_requested'),
  ('organization.identity_change_withdrawn'),
  ('organization.identity_changed'),
  ('organization.image_removed'),
  ('organization.image_set'),
  ('organization.restored'),
  ('organization.suspended'),
  ('organization.verified'),
  ('platform.override_used'),
  ('platform_role.granted'),
  ('platform_role.revoked'),
  ('points.adjusted'),
  ('points.reversed'),
  ('product.archived'),
  ('product.audiences_set'),
  ('product.created'),
  ('product.image_added'),
  ('product.image_removed'),
  ('product.image_reordered'),
  ('product.published'),
  ('product.restored'),
  ('product.unpublished'),
  ('product.updated'),
  ('profile.avatar_set'),
  ('profile.contact_visibility_set'),
  ('profile.hidden'),
  ('profile.listed'),
  ('profile.phone_set'),
  ('profile.username_set'),
  ('project.activated'),
  ('project.completed'),
  ('project.created'),
  ('publisher.approved'),
  ('publisher.reinstated'),
  ('publisher.requested'),
  ('publisher.revoked'),
  ('publisher.suspended'),
  ('purchase_request.cancelled'),
  ('purchase_request.closed'),
  ('purchase_request.created'),
  ('purchase_request.image_added'),
  ('purchase_request.image_removed'),
  ('purchase_request.published'),
  ('purchase_request.updated'),
  ('purchase_request_response.shortlisted'),
  ('purchase_request_response.submitted'),
  ('purchase_request_response.unshortlisted'),
  ('purchase_request_response.withdrawn'),
  ('quotation.accepted'),
  ('quotation.created'),
  ('quotation.rejected'),
  ('quotation.submitted'),
  ('quotation.updated'),
  ('referral.approved'),
  ('referral.rejected'),
  ('referral.submitted'),
  ('rfq.cancelled'),
  ('rfq.closed'),
  ('rfq.created'),
  ('rfq.submitted'),
  ('rfq.updated'),
  ('user.activities_set'),
  ('verification.approved'),
  ('verification.changes_requested'),
  ('verification.rejected'),
  ('verification.review_started');
create temp table feature_actions(a text primary key) on commit drop;
insert into feature_actions values
  ('contact.email_claim_started'),
  ('contact.email_removed'),
  ('contact.email_verified'),
  ('contact.support_lookup'),
  ('contact.support_released'),
  ('profile.password_changed'),
  ('profile.phone_alias_exception_issued'),
  ('profile.phone_alias_exception_revoked'),
  ('profile.phone_alias_exception_used'),
  ('profile.phone_change_compensated'),
  ('profile.phone_change_needs_attention'),
  ('profile.phone_changed'),
  -- Cover photo (20261024090009).
  ('profile.cover_set');
-- Actions the PR stack (#88 business verification + secondary phone, #91 media purge) and main's #96 added.
create temp table stack_actions(a text primary key) on commit drop;
insert into stack_actions values
  ('account.password_confirm_locked'),
  ('account.password_confirmed'),
  ('branch.location_changed'),
  ('business_verification.approved'),
  ('business_verification.document_added'),
  ('business_verification.document_removed'),
  ('business_verification.info_requested'),
  ('business_verification.rejected'),
  ('business_verification.review_started'),
  ('business_verification.submitted'),
  ('media.historical_purge'),
  ('organization.legal_name_changed'),
  ('phone_cooldown.overridden'),
  ('secondary_phone.cancelled'),
  ('secondary_phone.changed'),
  ('secondary_phone.converted'),
  ('secondary_phone.renewed'),
  ('secondary_phone.reserved');
create temp table live_actions(a text) on commit drop;
insert into live_actions
select unnest(regexp_split_to_array(substring(pg_get_constraintdef(oid) from 'ARRAY\[(.*)\]'), ', ')) from pg_constraint
 where conname = 'ck_audit_action_known' and conrelid = 'public.audit_log'::regclass;
update live_actions set a = regexp_replace(a, '^''(.*)''::text$', '\1');

select is((select count(*)::int from main_actions), 169, 'fixture: main''s vocabulary has 169 actions');
select is((select count(*)::int from main_actions m where not exists (select 1 from live_actions l where l.a = m.a)), 0,
  'EVERY action main allows is still allowed (none dropped)');
select is((select count(*)::int from feature_actions f where not exists (select 1 from live_actions l where l.a = f.a)), 0,
  'every feature action is allowed');
select is((select count(*)::int from stack_actions x where not exists (select 1 from live_actions l where l.a = x.a)), 0,
  'every action the PR stack and PR #96 added is still allowed (none dropped by the Installer port)');
select cmp_ok((select count(*)::int from live_actions), '>=', 186, 'the vocabulary is at least main + feature');
select is((select count(*)::int from live_actions l where not exists (select 1 from main_actions m where m.a = l.a)
            and not exists (select 1 from feature_actions f where f.a = l.a)
            and not exists (select 1 from stack_actions x where x.a = l.a)
            -- Phase B1 (20261030090001_phone_verification_authority.sql) adds exactly these two; extend this list for any later addition.
            and l.a not in ('phone_verification.started', 'phone_verification.completed')), 0,
  'nothing else was added: only feature actions on top of main (a later migration that adds more must extend this fixture)');
select is((select count(*)::int from live_actions l where l.a in ('phone_verification.started', 'phone_verification.completed')), 2,
  'Phase B1 added exactly its two phone verification audit actions');
select ok((select convalidated from pg_constraint where conname = 'ck_audit_action_known' and conrelid = 'public.audit_log'::regclass),
  'the constraint is validated');

-- ===========================================================================
-- 2. app.audit_actions_add
-- ===========================================================================
select is(app.audit_actions_add(array['profile.phone_changed', 'offer.created']), 0, 'adding actions that already exist adds nothing');
select is(app.audit_actions_add(array['zz_test.brand_new']), 1, 'a new action is added');
select ok(exists (select 1 from pg_constraint where conname = 'ck_audit_action_known' and pg_get_constraintdef(oid) like '%zz_test.brand_new%'),
  'and the constraint now allows it');
select is((select count(*)::int from main_actions m
            where (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_audit_action_known' and conrelid = 'public.audit_log'::regclass)
                  not like '%''' || m.a || '''::text%'), 0, 'adding one action removed none of main''s');
select ok((select convalidated from pg_constraint where conname = 'ck_audit_action_known' and conrelid = 'public.audit_log'::regclass), 'and it is validated again');
select throws_ok($$ select app.audit_actions_add(array['Not A Dotted Name']) $$, '22023', null, 'a malformed action name is refused');
select throws_ok($$ select app.audit_actions_add(array[null]::text[]) $$, '22023', null, 'a null action is refused');
select ok(not has_function_privilege('anon', 'app.audit_actions_add(text[])', 'execute')
      and not has_function_privilege('authenticated', 'app.audit_actions_add(text[])', 'execute')
      and not has_function_privilege('service_role', 'app.audit_actions_add(text[])', 'execute'), 'no API role can execute the helper');

-- ===========================================================================
-- 3. The phone-identity guard and the journal
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('10000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p201066601001@craftsman-login.aladdin.invalid', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now());
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1066601001', phone_e164 = '+201066601001'
 where user_id = '10000000-0000-4000-8000-0000000000a1';
select is((select phone_e164 from public.profiles where user_id = '10000000-0000-4000-8000-0000000000a1'), '+201066601001',
  'fixture: an alias account whose profile phone equals its alias');

select throws_ok($$ update public.profiles set phone_e164 = '+201066601002', phone_national = '1066601002' where user_id = '10000000-0000-4000-8000-0000000000a1' $$,
  '42501', 'phone identity changes require verified recovery', 'main''s guard: a direct phone change for an alias account is refused (no journal)');
select lives_ok($$ update public.profiles set phone_e164 = '+201066601001' where user_id = '10000000-0000-4000-8000-0000000000a1' $$, 'a same-number write is still fine');

-- Clients cannot forge journal evidence.
set local role authenticated;
select throws_ok($$ insert into app.installer_phone_changes (user_id, request_id, old_e164, old_alias, new_e164, new_country_iso2, new_national, new_alias, receipt_id, lease_expires_at)
  values ('10000000-0000-4000-8000-0000000000a1', gen_random_uuid(), '+201066601001', 'p201066601001@craftsman-login.aladdin.invalid', '+201066601002', 'EG', '1066601002',
          'p201066601002@craftsman-login.aladdin.invalid', gen_random_uuid(), now() + interval '5 minutes') $$, '42501', null, 'authenticated cannot write the journal');
reset role;
set local role service_role;
select throws_ok($$ insert into app.installer_phone_changes (user_id, request_id, old_e164, old_alias, new_e164, new_country_iso2, new_national, new_alias, receipt_id, lease_expires_at)
  values ('10000000-0000-4000-8000-0000000000a1', gen_random_uuid(), '+201066601001', 'p201066601001@craftsman-login.aladdin.invalid', '+201066601002', 'EG', '1066601002',
          'p201066601002@craftsman-login.aladdin.invalid', gen_random_uuid(), now() + interval '5 minutes') $$, '42501', null,
  'service_role cannot write the journal table directly either (only the definer functions do)');
reset role;

-- An ACTIVE journal row (written here as the table owner, standing in for installer_phone_change_begin) authorizes exactly its two phones.
insert into app.installer_phone_changes (user_id, request_id, old_e164, old_country_iso2, old_national, old_alias, new_e164, new_country_iso2, new_national, new_alias, receipt_id, lease_expires_at)
values ('10000000-0000-4000-8000-0000000000a1', gen_random_uuid(), '+201066601001', 'EG', '1066601001', 'p201066601001@craftsman-login.aladdin.invalid',
        '+201066601002', 'EG', '1066601002', 'p201066601002@craftsman-login.aladdin.invalid', gen_random_uuid(), now() + interval '5 minutes');
select lives_ok($$ update public.profiles set phone_country_iso2 = 'EG', phone_national = '1066601002', phone_e164 = '+201066601002' where user_id = '10000000-0000-4000-8000-0000000000a1' $$,
  'with an active journal row the journaled NEW phone is allowed');
select throws_ok($$ update public.profiles set phone_e164 = '+201066601003', phone_national = '1066601003' where user_id = '10000000-0000-4000-8000-0000000000a1' $$,
  '42501', 'phone identity changes require verified recovery', 'but a third phone is still refused while the journal is active');
select lives_ok($$ update public.profiles set phone_country_iso2 = 'EG', phone_national = '1066601001', phone_e164 = '+201066601001' where user_id = '10000000-0000-4000-8000-0000000000a1' $$,
  'the journaled OLD phone is allowed too (compensation)');
select throws_ok($$ update public.profiles set phone_e164 = null where user_id = '10000000-0000-4000-8000-0000000000a1' $$, '42501', null, 'clearing the phone is refused');

-- A different account does not benefit from someone else's journal.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('10000000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p201066601009@craftsman-login.aladdin.invalid', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now());
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1066601009', phone_e164 = '+201066601009' where user_id = '10000000-0000-4000-8000-0000000000a2';
select throws_ok($$ update public.profiles set phone_e164 = '+201066601002', phone_national = '1066601002' where user_id = '10000000-0000-4000-8000-0000000000a2' $$, '42501', null,
  'another account cannot use that journal row');

-- A finished change no longer authorizes anything.
update app.installer_phone_changes set state = 'done', resolution = 'applied', settled_at = now() where user_id = '10000000-0000-4000-8000-0000000000a1';
select throws_ok($$ update public.profiles set phone_e164 = '+201066601002', phone_national = '1066601002' where user_id = '10000000-0000-4000-8000-0000000000a1' $$, '42501', null,
  'a settled (done) journal row authorizes nothing');

-- profile_set_phone (M1) is unchanged: an alias account can only write its own alias number.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1066601005', '+201066601005') $$, '42501', null, 'profile_set_phone still refuses a different number for an alias account');
reset role;

-- ===========================================================================
-- 4. Audit actor deletion: main's mechanism
-- ===========================================================================
select is((select count(*)::int from pg_constraint where conname = 'audit_log_actor_user_id_fkey'), 1, 'the actor foreign key is kept');
select is((select p.proname::text from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.audit_log'::regclass and t.tgname = 'audit_log_no_update'),
  'guard_audit_actor_deletion', 'main''s guard_audit_actor_deletion is the no-update trigger function');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'guard_phone_password_identity'), 1,
  'one guard function (replaced, not duplicated)');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'guard_phone_password_identity' and tgenabled = 'O'), 1,
  'main''s guard trigger is present and enabled');
select ok((select count(*) from supabase_migrations.schema_migrations where version = '20261015090053') = 1
      and (select count(*) from supabase_migrations.schema_migrations where version > '20261015090053') >= 10,
  'the feature migrations sort after main''s newest (20261015090053)');

select * from finish();
rollback;
