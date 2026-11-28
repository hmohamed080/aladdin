-- pgTAP: a Sales Manager reads the organization's branches
-- (20261027090001_sales_manager_branch_read.sql).
--
-- An org-wide Sales Manager (sales.manage, no membership_branch_access rows) sees
-- every live branch of its own organization and nothing else; a member with
-- neither Sales management nor a branch assignment still sees none; the change is
-- read-only and leaves app.current_branch_ids() as it was.
--
-- Fixtures (seed.sql): Org A has Cairo + Sheikh Zayed, Org B has Maadi Studio.
-- 22222222 is Org A's Cairo staff (membership e2222222, sales.read + sales.write,
-- branch access Cairo). Its capabilities and branch access are reshaped below as
-- the DB owner, inside this rolled-back transaction.
create extension if not exists pgtap;

begin;
select plan(9);

-- A. No Sales management, no branch assignment: no branches.
delete from public.membership_branch_access where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.branches), 0,
  'a sales.read member without a branch assignment sees no branches');

-- B. Sales Manager (sales.manage), still no branch assignment: the whole organization.
reset role;
insert into public.membership_capabilities (membership_id, capability_key)
values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.manage');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.branches), 2,
  'an org-wide Sales Manager sees every branch of its organization');
select set_eq(
  $$ select name from public.branches $$,
  array['Cairo Branch', 'Sheikh Zayed Branch'],
  'the Sales Manager sees exactly Org A''s branches');

-- C. Tenant isolation: never another organization's branch.
select is(
  (select count(*)::int from public.branches where organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'the Sales Manager never sees Org B''s branch');

-- D. current_branch_ids() keeps its meaning (org.manage / branch.manage / assigned).
select is(
  (select count(*)::int from app.current_branch_ids('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as b),
  0, 'current_branch_ids is unchanged: sales.manage alone assigns no branch');

-- E. Read-only: authenticated holds only SELECT on branches (writes go through
-- SECURITY DEFINER RPCs), so the manager can neither edit nor create a branch.
select throws_ok(
  $$ update public.branches set name = 'renamed by a sales manager'
     where id = 'c2222222-cccc-4ccc-8ccc-cccccccccccc' $$,
  '42501', null, 'the Sales Manager cannot edit a branch');
select throws_ok(
  $$ insert into public.branches (organization_id, name, is_active)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Manager branch', true) $$,
  '42501', null, 'the Sales Manager cannot create a branch');

-- F. A soft-deleted branch stays hidden.
reset role;
update public.branches set deleted_at = now() where id = 'c2222222-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.branches), 1,
  'a soft-deleted branch stays hidden from the Sales Manager');

-- G. An inactive membership loses the branch list with the role.
reset role;
update public.memberships set status = 'suspended' where id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.branches), 0,
  'a suspended Sales Manager sees no branches');

reset role;
select * from finish();
rollback;
