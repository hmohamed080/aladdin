-- pgTAP: membership lifecycle (Phase 1).
-- Only an ACTIVE membership grants tenant access. Invited/pending and revoked
-- memberships grant nothing.
create extension if not exists pgtap;

begin;
select plan(6);

-- Baseline: the active Cairo staff member has org + branch access.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(app.is_org_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true,
  'active member is recognized as an org member');
select is((select count(*)::int from public.branches), 1,
  'active branch-limited member sees its assigned branch');

-- Revoke the membership (server-side / manager action, done here as postgres).
reset role;
update public.memberships set status = 'revoked'
  where id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(app.is_org_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false,
  'revoked member is no longer an org member');
select is((select count(*)::int from public.branches), 0,
  'revoked member loses all branch access');

-- Set the membership to invited/pending — still no active access.
reset role;
update public.memberships set status = 'invited'
  where id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(app.is_org_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false,
  'invited (pending) member does not yet have active access');
select is((select count(*)::int from public.branches), 0,
  'invited member has no tenant (branch) access until active');

reset role;
select * from finish();
rollback;
