-- pgTAP: unauthorized access (Phase 1).
-- Anonymous access is denied to private tenant/personal data (no grant at all —
-- stricter than RLS-filtered empty); an authenticated non-member is denied a
-- tenant's private rows. Public discovery (active+verified orgs, public
-- professional profiles) is the only anonymous-readable surface.
create extension if not exists pgtap;

begin;
select plan(9);

-- Anonymous: private tables are not even granted to anon → hard permission denial.
set local role anon;
set local request.jwt.claims = '';
select throws_ok('select count(*) from public.branches', '42501', null,
  'anon is denied any access to branches');
select throws_ok('select count(*) from public.memberships', '42501', null,
  'anon is denied any access to memberships');
select throws_ok('select count(*) from public.contacts', '42501', null,
  'anon is denied any access to contacts');
select throws_ok('select count(*) from public.audit_log', '42501', null,
  'anon is denied any access to the audit log');
-- Public discovery IS allowed for active+verified orgs (product feature 06 §3.6).
select is((select count(*)::int from public.organizations), 2,
  'anon sees only active+verified orgs (public discovery)');
-- Anonymous writes are rejected.
select throws_ok(
  $$ insert into public.organizations (name, org_type, created_by)
     values ('Anon Co', 'supplier', '11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'anon cannot insert an organization');

-- Authenticated non-member (the end consumer) is denied Org A's private data.
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.branches), 0,
  'authenticated non-member cannot read a tenant''s branches');
select is((select count(*)::int from public.memberships where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0,
  'authenticated non-member cannot read a tenant''s memberships');
-- A non-member cannot read another user's contacts.
select is((select count(*)::int from public.contacts where user_id = '11111111-1111-4111-8111-111111111111'), 0,
  'a user cannot read another user''s contacts');

reset role;
select * from finish();
rollback;
