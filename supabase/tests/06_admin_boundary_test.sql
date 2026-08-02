-- pgTAP: platform-admin boundary (Phase 1).
-- Platform authority lives ONLY in platform_role_grants — never derived from a
-- profile field or an org capability, and never self-grantable by an org user.
-- The documented platform-admin context has audited cross-tenant read.
create extension if not exists pgtap;

begin;
select plan(8);

-- An org owner with org.manage is NOT a platform admin.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(app.has_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'org.manage'), true,
  'org owner holds org.manage in its own org');
select is(app.is_platform('administrator'), false,
  'org owner (org.manage) is NOT a platform administrator');
select is(app.is_platform('support'), false,
  'org owner is not platform support either');

-- An org user cannot self-grant a platform role (no write path exists).
select throws_ok(
  $$ insert into public.platform_role_grants (user_id, role)
     values ('11111111-1111-4111-8111-111111111111', 'administrator') $$,
  '42501', null,
  'an ordinary org user cannot insert a platform_role_grant (no escalation)');

-- The seeded platform administrator is recognized and has cross-tenant read.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(app.is_platform('administrator'), true,
  'the provisioned platform admin is recognized');
select is(app.is_platform('support'), true,
  'administrator implies support-level read authority');
select is((select count(*)::int from public.memberships), 3,
  'platform admin has cross-tenant read of all memberships');
select is((select count(*)::int from public.branches), 3,
  'platform admin has cross-tenant read of all branches (both tenants)');

reset role;
select * from finish();
rollback;
