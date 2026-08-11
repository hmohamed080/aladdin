-- pgTAP: audit foundation (Phase 1).
-- audit_log is append-only: ordinary users cannot read, insert, update, or delete;
-- platform admins can read; and even a privileged path cannot mutate history
-- (immutability trigger).
create extension if not exists pgtap;

begin;
select plan(11);

-- Seed one audit row via the trusted (service-role/DBA) path — here as postgres.
insert into public.audit_log (actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata)
values ('55555555-5555-4555-8555-555555555555', 'administrator', 'membership.granted',
        'membership', 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '{"note":"synthetic test row"}'::jsonb);

-- Ordinary org user cannot READ the audit log.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.audit_log), 0,
  'ordinary org user cannot read the audit log');

-- Ordinary user cannot INSERT into the audit log (no grant / no policy).
select throws_ok(
  $$ insert into public.audit_log (action, subject_type, subject_id)
     values ('platform.override_used', 'organization', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'ordinary user cannot insert an audit record');

-- Platform admin CAN read the audit log. Scoped to THIS test's row: the pilot
-- world seeds its own audit history so /admin/audit is reviewable, and this
-- assertion is about read access, not about the size of the seeded trail.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(
  (select count(*)::int from public.audit_log where metadata->>'note' = 'synthetic test row'),
  1, 'platform administrator can read the audit log');

-- Admin cannot UPDATE or DELETE audit rows (no grant → permission denied).
select throws_ok(
  $$ update public.audit_log set action = 'tampered' where subject_type = 'membership' $$,
  '42501', null,
  'platform admin has no UPDATE grant on the audit log');
select throws_ok(
  $$ delete from public.audit_log where subject_type = 'membership' $$,
  '42501', null,
  'platform admin has no DELETE grant on the audit log');

-- TRUNCATE must NOT be a back door (Sprint 1.1 CRITICAL-1): TRUNCATE bypasses RLS
-- and the row-level immutability trigger, so anon/authenticated must not hold it.
set local role anon;
set local request.jwt.claims = '';
select throws_ok('truncate public.audit_log', '42501', null,
  'anon cannot TRUNCATE the audit log');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok('truncate public.audit_log', '42501', null,
  'a platform admin (authenticated) cannot TRUNCATE the audit log');

-- The service role must use constrained SECURITY DEFINER RPCs. Direct audit
-- insertion would allow actor, tenant, subject, and metadata spoofing.
set local role service_role;
select throws_ok(
  $$ insert into public.audit_log (action, subject_type, subject_id)
     values ('branch.created', 'branch', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null,
  'service_role cannot directly insert a spoofed audit record');
select throws_ok('truncate public.audit_log', '42501', null,
  'service_role cannot TRUNCATE the audit log');

-- Immutability trigger: even a privileged path (postgres) cannot mutate history.
reset role;
select throws_ok(
  $$ update public.audit_log set action = 'tampered' where subject_type = 'membership' $$,
  'P0001', null,
  'the append-only trigger blocks UPDATE even for a superuser path');
select throws_ok(
  $$ delete from public.audit_log where subject_type = 'membership' $$,
  'P0001', null,
  'the append-only trigger blocks DELETE even for a superuser path');

select * from finish();
rollback;
