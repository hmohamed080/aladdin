-- pgTAP: branch-level isolation within a tenant (Phase 1).
-- A branch-limited member sees only assigned branches; an org-wide member
-- (org.manage / branch.manage) sees all branches of the org. Branch visibility
-- is driven by assignment + capability, never by a global role.
create extension if not exists pgtap;

begin;
select plan(6);

-- Branch-limited Cairo staff sees only the Cairo branch.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.branches), 1,
  'branch-limited member sees exactly one branch');
select is((select name from public.branches),
  'Cairo Branch', 'branch-limited member sees its assigned Cairo branch, not Sheikh Zayed');
select is(
  (select count(*)::int from app.current_branch_ids('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as b),
  1, 'current_branch_ids returns only the assigned branch for a branch-limited member');

-- Org-wide owner (org.manage) sees all Org A branches.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.branches), 2,
  'org-wide member (org.manage) sees all branches of the org');

-- Extend the Cairo staff assignment to also include Sheikh Zayed → visibility grows.
reset role;
insert into public.membership_branch_access (membership_id, branch_id)
values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'c2222222-cccc-4ccc-8ccc-cccccccccccc');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.branches), 2,
  'adding a branch assignment grows the branch-limited member''s visibility');

-- Even after the extra assignment, the member still cannot see Org B's branch.
select is(
  (select count(*)::int from public.branches where organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'branch assignments never cross the tenant boundary');

reset role;
select * from finish();
rollback;
