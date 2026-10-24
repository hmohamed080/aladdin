-- pgTAP: M4 - audit vocabulary and the narrowly-controlled writers for installer sensitive actions.
--
-- Proves, on the real schema:
--   * the new vocabulary EXTENDS ck_audit_action_known (123 = 119 existing + 4) without dropping any action;
--   * audit_log stays append-only, admin-read-only, and service_role still has NO INSERT on it;
--   * phone-change events are written by the journal's own state transitions, in the same transaction, with the
--     journal user as the actor, exactly once per transition, and never for a retried settle or a begin;
--   * the password-change event can only be written for a SPENT password.change receipt, once, for its owner;
--   * no audit row ever contains a password, token, receipt id, phone number or login alias.
-- The Admin API effect on auth.users.email is SIMULATED by a direct UPDATE as the test owner (see test 93).
create extension if not exists pgtap;

begin;
select plan(57);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values
  ('94000000-0000-4000-8000-000000000001', 'p201077700001@craftsman-login.aladdin.invalid'),
  ('94000000-0000-4000-8000-000000000002', 'p201077700002@craftsman-login.aladdin.invalid'),
  ('94000000-0000-4000-8000-000000000003', 'p201077700003@craftsman-login.aladdin.invalid'),
  ('94000000-0000-4000-8000-000000000004', 'p201077700004@craftsman-login.aladdin.invalid'),
  ('94000000-0000-4000-8000-0000000000e1', 'p94-email-1@example.test')) v(id, email);
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles p
   set phone_country_iso2 = 'EG', phone_national = substr(split_part(u.email, '@', 1), 4), phone_e164 = '+' || substr(split_part(u.email, '@', 1), 2)
  from auth.users u
 where u.id = p.user_id and u.email ~ '^p2010777000(0[1-4])@craftsman-login';
alter table public.profiles enable trigger guard_phone_password_identity;

create function pg_temp.u(k text) returns uuid language sql as $$
  select (case k when 'e1' then '94000000-0000-4000-8000-0000000000e1' else '94000000-0000-4000-8000-0000000000' || lpad(substr(k, 2), 2, '0') end)::uuid $$;
create function pg_temp.al(e164 text) returns text language sql as $$ select 'p' || substr(e164, 2) || '@craftsman-login.aladdin.invalid' $$;
create function pg_temp.mint(k text, ctx text, act text default 'change_phone') returns uuid language plpgsql security definer as $$
-- A receipt exactly as public.account_password_confirm issues it (PR #88 reauth receipts: single-use, 60 s, bound to
-- user + operation + target). The password check itself is covered by 109_reauth_operations_test.sql.
declare r uuid;
begin
  insert into app.reauth_receipts (user_id, operation, target, created_at, expires_at)
  values (pg_temp.u(k),
          case act when 'change_phone' then 'primary_phone.change' when 'change_password' then 'password.change' else act end,
          case when act = 'change_phone' then ctx else 'self' end,
          clock_timestamp(), clock_timestamp() + interval '60 seconds')
  returning id into r;
  return r;
end $$;
create function pg_temp.bgn(k text, tag text, e164 text) returns uuid language sql as $$
  select change_id from public.installer_phone_change_begin(pg_temp.u(k), md5('94:' || k || tag)::uuid, pg_temp.mint(k, e164), 'EG', substr(e164, 4), e164) $$;
create function pg_temp.settle(cid uuid, k text, fin boolean default false) returns text language sql as $$
  select s.state || '/' || coalesce(s.resolution, '-') from public.installer_phone_change_settle(pg_temp.u(k), cid, fin) s $$;
create function pg_temp.n(k text, act text) returns int language sql as $$
  select count(*)::int from public.audit_log where actor_user_id = pg_temp.u(k) and action = act $$;
-- Simulates an Auth write that BYPASSES the alias guard (an out-of-band write by an owner). The guard itself is proven in
-- 95_installer_alias_email_guard_test.sql; here the trigger is dropped and re-created around ONE statement (the test
-- transaction is rolled back at the end) so the settlement's reaction to states the guard normally prevents can be tested.
create function pg_temp.guard_off() returns void language plpgsql as $$
begin drop trigger installer_alias_email_guard on auth.users; end $$;
create function pg_temp.guard_on() returns void language plpgsql as $$
begin
  create trigger installer_alias_email_guard before update of email on auth.users
    for each row execute function app.installer_alias_email_guard();
end $$;
create function pg_temp.force_email(u uuid, e text) returns void language plpgsql as $$
begin
  perform pg_temp.guard_off();
  update auth.users set email = e where id = u;
  perform pg_temp.guard_on();
end $$;
create temp table ids (k text primary key, v text);
grant all on ids to public;

-- ===========================================================================
-- 1. Vocabulary
-- ===========================================================================
select ok((select count(*)::int from regexp_matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_audit_action_known'), '''[^'']+''::text', 'g')) >= 123,
  'ck_audit_action_known still allows the 123 actions of M4 (119 that existed plus 4; later migrations only add)');
select ok((select bool_and(pg_get_constraintdef(c.oid) like '%''' || a || '''::text%')
             from pg_constraint c, unnest(array['organization.created', 'membership.granted', 'platform.override_used', 'verification.approved', 'lead.won',
               'order.completed', 'points.reversed', 'job.review.restored', 'network_referral.cancelled', 'profile.username_set', 'profile.phone_set',
               'profile.avatar_set', 'user.activities_set', 'admin_role.assigned', 'admin_staff.restored', 'account.suspended', 'organization.duplicate_dismissed',
               'account.platform_prepared', 'account.platform_cleanup']) a
            where c.conname = 'ck_audit_action_known'), 'earlier actions from every era are still allowed (first, last and in-between)');
select ok((select bool_and(pg_get_constraintdef(c.oid) like '%''' || a || '''::text%')
             from pg_constraint c, unnest(array['profile.phone_changed', 'profile.phone_change_compensated', 'profile.phone_change_needs_attention', 'profile.password_changed']) a
            where c.conname = 'ck_audit_action_known'), 'the four new actions are allowed');
select throws_ok($$ insert into public.audit_log (action, subject_type) values ('profile.phone_number_leaked', 'user') $$, '23514', null, 'an action outside the vocabulary is still refused');

-- ===========================================================================
-- 2. audit_log stays append-only and writer-restricted
-- ===========================================================================
select ok(not has_table_privilege('service_role', 'public.audit_log', 'INSERT') and not has_table_privilege('service_role', 'public.audit_log', 'UPDATE')
      and not has_table_privilege('service_role', 'public.audit_log', 'DELETE') and has_table_privilege('service_role', 'public.audit_log', 'SELECT'),
  'service_role still has SELECT only on audit_log: no INSERT was added');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'INSERT') and has_table_privilege('authenticated', 'public.audit_log', 'SELECT')
      and not has_table_privilege('anon', 'public.audit_log', 'SELECT'), 'authenticated keeps SELECT (RLS: admins) and no INSERT; anon has nothing');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.audit_log'::regclass and tgname in ('audit_log_no_update', 'audit_log_no_delete') and not tgisinternal), 2,
  'the append-only triggers are still installed');
set local role service_role;
select throws_ok($$ insert into public.audit_log (action, subject_type) values ('profile.phone_changed', 'user') $$, '42501', null, 'service_role cannot write a phone-change audit row directly');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"94000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ insert into public.audit_log (action, subject_type) values ('profile.password_changed', 'user') $$, '42501', null, 'an authenticated user cannot forge a password-change audit row');
reset role;
select ok(not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
   where has_function_privilege(r.rolname, 'app.installer_phone_change_audit()', 'EXECUTE')), 'the phone-change audit trigger function is callable by no API role');
select ok(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.proname in ('identity_password_change_audit', 'installer_phone_change_audit') and a.grantee = 0), 'neither new audit function is executable by PUBLIC');
select ok(has_function_privilege('service_role', 'public.identity_password_change_audit(uuid,uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.identity_password_change_audit(uuid,uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.identity_password_change_audit(uuid,uuid)', 'EXECUTE'), 'the password audit function is service_role only');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.proname in ('identity_password_change_audit', 'installer_phone_change_audit')),
  'both are SECURITY DEFINER with an empty search_path');

-- ===========================================================================
-- 3. Phone-change events follow the journal state machine
-- ===========================================================================
insert into ids values ('a1.c', pg_temp.bgn('a1', 'r', '+201077800001')::text);
select is(pg_temp.n('a1', 'profile.phone_changed') + pg_temp.n('a1', 'profile.phone_change_compensated') + pg_temp.n('a1', 'profile.phone_change_needs_attention'), 0,
  'beginning a change writes no audit event (the pending journal row is the record)');
update auth.users set email = pg_temp.al('+201077800001') where id = pg_temp.u('a1');
select is(pg_temp.settle((select v::uuid from ids where k = 'a1.c'), 'a1'), 'done/applied', 'a1: settled done');
select is(pg_temp.n('a1', 'profile.phone_changed'), 1, 'done writes exactly one profile.phone_changed, with the user as the actor');
select is(pg_temp.settle((select v::uuid from ids where k = 'a1.c'), 'a1'), 'done/applied', 'a1: a retried settle');
select is(pg_temp.n('a1', 'profile.phone_changed'), 1, 'and records nothing more (idempotent)');
select is((select subject_type || '/' || subject_id::text || '/' || coalesce(actor_role::text, 'none') from public.audit_log where actor_user_id = pg_temp.u('a1') and action = 'profile.phone_changed'),
  'user/' || pg_temp.u('a1')::text || '/none', 'the event is about the user, performed by the user (service_role has no auth.uid()), with no platform role');
select is((select array_agg(k order by k) from (select jsonb_object_keys(metadata) k from public.audit_log where actor_user_id = pg_temp.u('a1') and action = 'profile.phone_changed') t),
  array['change_id', 'resolution'], 'metadata is limited to the change id and a resolution code');
select is((select metadata->>'resolution' from public.audit_log where actor_user_id = pg_temp.u('a1') and action = 'profile.phone_changed'), 'applied', 'with resolution = applied');

insert into ids values ('a2.c', pg_temp.bgn('a2', 'r', '+201077800002')::text);
select is(pg_temp.settle((select v::uuid from ids where k = 'a2.c'), 'a2', true), 'compensated/restored', 'a2: compensated');
select is(pg_temp.n('a2', 'profile.phone_change_compensated'), 1, 'compensation writes profile.phone_change_compensated once');
select is(pg_temp.n('a2', 'profile.phone_changed'), 0, 'and no phone_changed');
select pg_temp.force_email(pg_temp.u('a2'), pg_temp.al('+201077800002'));
select is(pg_temp.settle((select v::uuid from ids where k = 'a2.c'), 'a2'), 'needs_attention/late_auth_change', 'a2: the abandoned call lands late');
select is(pg_temp.n('a2', 'profile.phone_change_needs_attention'), 1, 'late landing writes profile.phone_change_needs_attention');

insert into ids values ('a3.c', pg_temp.bgn('a3', 'r', '+201077800003')::text);
select pg_temp.force_email(pg_temp.u('a3'), 'other@example.test');
select is(pg_temp.settle((select v::uuid from ids where k = 'a3.c'), 'a3', true), 'needs_attention/alias_unexpected', 'a3: unexpected alias');
select is(pg_temp.settle((select v::uuid from ids where k = 'a3.c'), 'a3', true), 'needs_attention/alias_unexpected', 'a3: settled again');
select is(pg_temp.n('a3', 'profile.phone_change_needs_attention'), 1, 'a repeated needs_attention records ONE event, not one per retry');
select pg_temp.force_email(pg_temp.u('a3'), pg_temp.al('+201077800003'));
select is(pg_temp.settle((select v::uuid from ids where k = 'a3.c'), 'a3'), 'done/applied', 'a3: resolved by re-observation');
select is(pg_temp.n('a3', 'profile.phone_changed'), 1, 'resolution out of needs_attention writes profile.phone_changed');

-- a4: needs_attention whose RESOLUTION changes while the STATE does not must not write a second event.
insert into ids values ('a4.c', pg_temp.bgn('a4', 'r', '+201077800004')::text);
select pg_temp.force_email(pg_temp.u('a4'), 'other4@example.test');
select is(pg_temp.settle((select v::uuid from ids where k = 'a4.c'), 'a4', true), 'needs_attention/alias_unexpected', 'a4: unexpected alias');
select pg_temp.force_email(pg_temp.u('a4'), pg_temp.al('+201077800004'));
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles set phone_e164 = '+201077800999', phone_national = '1077800999' where user_id = pg_temp.u('a4');
alter table public.profiles enable trigger guard_phone_password_identity;
select is(pg_temp.settle((select v::uuid from ids where k = 'a4.c'), 'a4'), 'needs_attention/profile_mismatch', 'a4: still needs attention, for a different reason');
select is(pg_temp.n('a4', 'profile.phone_change_needs_attention'), 1, 'a4: a changed resolution under an unchanged state records no second event');

update app.installer_phone_changes set settle_attempts = settle_attempts + 5 where id = (select v::uuid from ids where k = 'a3.c');
select is(pg_temp.n('a3', 'profile.phone_changed'), 1, 'updating a journal column other than the state writes no audit row');

-- ===========================================================================
-- 4. Content: nothing sensitive in any of these rows
-- ===========================================================================
select is((select count(*)::int from public.audit_log where action in ('profile.phone_changed', 'profile.phone_change_compensated', 'profile.phone_change_needs_attention')
             and actor_user_id::text like '94000000-%'), 6, 'six phone-change events exist for the fixtures');
select is((select count(*)::int from public.audit_log where action in ('profile.phone_changed', 'profile.phone_change_compensated', 'profile.phone_change_needs_attention')
             and actor_user_id::text like '94000000-%'
             and (metadata::text ~* '\+?20[0-9]{8,}|craftsman|@|password|token|receipt|otp|secret' or organization_id is not null)), 0,
  'no phone number, login alias, password, token or receipt appears in the metadata');
select ok((select bool_and(actor_user_id = subject_id) from public.audit_log where actor_user_id::text like '94000000-%' and action like 'profile.phone_change%'),
  'the actor is the acting user for every event');

-- ===========================================================================
-- 5. Password-change event: only for a SPENT password.change receipt, once
-- ===========================================================================
insert into ids values ('p1', pg_temp.mint('e1', null, 'change_password')::text);
select is(public.identity_password_change_audit(pg_temp.u('e1'), (select v::uuid from ids where k = 'p1')), false, 'an UNSPENT receipt cannot be used to write the audit event');
select is(app.consume_reauth_receipt_for(pg_temp.u('e1'), (select v::uuid from ids where k = 'p1'), 'password.change', 'self'), true, 'e1: the receipt is spent (what the password update does first)');
select is(public.identity_password_change_audit(pg_temp.u('a1'), (select v::uuid from ids where k = 'p1')), false, 'another user''s id with that receipt writes nothing');
select is(public.identity_password_change_audit(pg_temp.u('e1'), (select v::uuid from ids where k = 'p1')), true, 'the owner of a spent password.change receipt records the event');
select is(pg_temp.n('e1', 'profile.password_changed'), 1, 'exactly one profile.password_changed with the user as the actor');
select is((select metadata::text from public.audit_log where actor_user_id = pg_temp.u('e1') and action = 'profile.password_changed'), '{}', 'with empty metadata');
select is(public.identity_password_change_audit(pg_temp.u('e1'), (select v::uuid from ids where k = 'p1')), false, 'a second call for the same receipt writes nothing (once per receipt)');
select is(pg_temp.n('e1', 'profile.password_changed'), 1, 'still one event');
insert into ids values ('p2', pg_temp.mint('e1', '+201077800099')::text);
select is(app.consume_reauth_receipt_for(pg_temp.u('e1'), (select v::uuid from ids where k = 'p2'), 'primary_phone.change', '+201077800099'), true, 'a spent PHONE receipt');
select is(public.identity_password_change_audit(pg_temp.u('e1'), (select v::uuid from ids where k = 'p2')), false, 'cannot be used to write a password-change event (wrong operation)');
insert into ids values ('p3', pg_temp.mint('e1', null, 'change_password')::text);
select is(app.consume_reauth_receipt_for(pg_temp.u('e1'), (select v::uuid from ids where k = 'p3'), 'password.change', 'self'), true, 'a second password receipt is spent');
update app.reauth_receipts set used_at = now() - interval '20 minutes' where id = (select v::uuid from ids where k = 'p3');
select is(public.identity_password_change_audit(pg_temp.u('e1'), (select v::uuid from ids where k = 'p3')), false, 'a receipt spent long ago can no longer be used to audit (15-minute window)');
select is(public.identity_password_change_audit(null, null), false, 'null arguments write nothing');
select is(public.identity_password_change_audit(pg_temp.u('e1'), gen_random_uuid()), false, 'an unknown receipt writes nothing');
select is((select count(*)::int from public.audit_log where actor_user_id = pg_temp.u('e1') and action = 'profile.password_changed'
             and (metadata::text ~* 'password|token|receipt' or organization_id is not null)), 0, 'the password event carries no secret');

-- ===========================================================================
-- 6. Compatibility
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"94000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
select lives_ok($$ select public.profile_set_phone('EG', '1077800005', '+201077800005') $$, 'profile_set_phone (an ordinary account) still works');
reset role;
select is(pg_temp.n('e1', 'profile.phone_set'), 1, 'and still records profile.phone_set through app.record_audit_event with the caller as the actor');
select lives_ok($$ delete from auth.users where id = '94000000-0000-4000-8000-000000000001' $$, 'deleting an account that has phone-change audit history still works (sign-up rollback)');
select is((select count(*)::int from public.audit_log where subject_id = '94000000-0000-4000-8000-000000000001' and action = 'profile.phone_changed' and actor_user_id is null), 1,
  'and its audit history is retained (main''s mechanism nulls the actor, the subject id stays)');

select * from finish();
rollback;
