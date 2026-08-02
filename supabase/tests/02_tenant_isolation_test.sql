-- pgTAP: cross-tenant isolation (Phase 1).
-- User A (owner of Org A) must not read or write Org B's org row, memberships,
-- branches, or capabilities. Enforced by RLS, not by frontend filtering.
create extension if not exists pgtap;

begin;
select plan(13);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- A-owner is not a member of Org B.
select is(
  app.is_org_member('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false,
  'A-owner has no active membership in Org B');

-- A-owner sees ONLY Org A branches (2), never Org B's Maadi Studio branch.
select is(
  (select count(*)::int from public.branches where organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'A-owner cannot read Org B branches');
select is(
  (select count(*)::int from public.branches),
  2, 'A-owner sees exactly its own two org branches');

-- A-owner cannot read Org B memberships or their capabilities.
select is(
  (select count(*)::int from public.memberships where organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'A-owner cannot read Org B memberships');
select is(
  (select count(*)::int from public.membership_capabilities c
     join public.memberships m on m.id = c.membership_id
    where m.organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'A-owner cannot read Org B membership capabilities');

-- A-owner UPDATE on Org B runs but is scoped out by RLS (0 rows, no error).
select lives_ok(
  $$ update public.organizations set name = 'HACKED' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  'A-owner update attempt on Org B executes without error (RLS scopes it out)');

-- Positive control: A-owner CAN update its own Org A.
select lives_ok(
  $$ update public.organizations set name = 'Nile Finishing Supplies v2' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'A-owner can update its own Org A');

-- A-owner cannot INSERT into Org B (WITH CHECK fails → RLS error).
select throws_ok(
  $$ insert into public.branches (organization_id, name)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Rogue Branch') $$,
  '42501', null,
  'A-owner cannot insert a branch into Org B');
select throws_ok(
  $$ insert into public.memberships (user_id, organization_id, status)
     values ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'active') $$,
  '42501', null,
  'A-owner cannot insert a membership into Org B');

-- Verify the write isolation actually held (read back as the privileged path).
reset role;
select is(
  (select name from public.organizations where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'Delta Interiors Studio', 'Org B name is unchanged after A-owner update attempt');
select is(
  (select name from public.organizations where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'Nile Finishing Supplies v2', 'Org A name was updated by its own owner');

-- Symmetric check: B-owner cannot read Org A's private branches/memberships.
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.branches where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'B-owner cannot read Org A branches');
select is(
  (select count(*)::int from public.memberships where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'B-owner cannot read Org A memberships');

reset role;
select * from finish();
rollback;
