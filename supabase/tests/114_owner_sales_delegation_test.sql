-- pgTAP: owner Sales delegation (20261026090001_owner_sales_delegation_capabilities.sql).
--
-- A business owner of a launched type (showroom_dealer, supplier, manufacturer,
-- importer) now holds sales.read / sales.write / sales.assign / sales.manage, so
-- the People-screen Sales Rep and Sales Manager presets can be delegated through
-- the UNCHANGED membership_set_capabilities (no-escalation rule intact).
--
--   A. creation: the public first-business path and every eligible type get the
--      four keys; design_office does not;
--   B. delegation: the owner grants the Sales Manager and Sales Rep presets and
--      limits the rep to one branch;
--   C. no escalation: rep, manager and a members-only manager still cannot grant
--      what they do not hold or manage members without org.members.manage;
--   D. tenant isolation: an owner cannot touch another organization's members;
--   E. backfill: insert-only, scoped to active eligible owners, audited, idempotent;
--   F. the helpers are DB-owner only; the Consumer Coming Soon rule is unchanged.
create extension if not exists pgtap;

begin;
select plan(34);

-- Fixture organizations are approved directly as the DB owner; the showroom
-- seller-readiness triggers are disabled for this transaction only (rolled back),
-- as in 27_account_workspace_model_test.sql.
alter table public.organizations disable trigger showroom_activation_complete;

-- ---------------------------------------------------------------------------
-- Fixtures: twelve confirmed users (11400001..12).
--   1 showroom founder (public path)   2..5 owners created by the helper
--   6 Sales Manager   7 Sales Rep   8 members-only manager   9 other-org owner
--   10 legacy owner   11 legacy design_office owner   12 consumer
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('114' || lpad(n::text, 5, '0') || '-0000-4000-8000-000000000114')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p114-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P114 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 12) n;

-- ===========================================================================
-- A. Creation
-- ===========================================================================
-- A1. The public first-business registration path (business track, showroom).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11400001-0000-4000-8000-000000000114","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en');
select public.onboarding_select_account_type('business', 'showroom_dealer');
select isnt(public.business_draft_save(
  p_legal_name => 'P114 Showroom LLC', p_display_name => 'P114 Showroom', p_org_type => 'showroom_dealer',
  p_primary_branch_name => 'P114 Cairo'), null, 'A1: the founder opens a business draft');
select lives_ok(
  $$ select public.business_draft_submit(
       (select id from public.business_creation_drafts
        where user_id = '11400001-0000-4000-8000-000000000114' and completed_at is null)) $$,
  'A1: submitting the draft creates the showroom');
reset role;

create temporary table p114_caps on commit drop as
select o.name, o.org_type, m.id as membership_id, m.user_id,
       array_agg(c.capability_key order by c.capability_key) as caps
from public.organizations o
join public.memberships m on m.organization_id = o.id
join public.membership_capabilities c on c.membership_id = m.id
where o.name like 'P114 %'
group by o.name, o.org_type, m.id, m.user_id;

select ok((select caps @> array['sales.assign','sales.manage','sales.read','sales.write','org.manage']
           from p114_caps where name = 'P114 Showroom'),
  'A1: the new showroom owner holds org.manage and the four Sales delegation keys');
select is((select count(*)::int from p114_caps where name = 'P114 Showroom'), 1,
  'A1: exactly one owner membership is created');

-- A2. Every eligible type through app.organization_create_owned (both overloads).
select set_config('request.jwt.claims', '{"sub":"11400002-0000-4000-8000-000000000114","role":"authenticated"}', true);
select app.organization_create_owned('P114 Supplier', 'supplier', 'en', 'Main', 'P114 Supplier LLC');
select set_config('request.jwt.claims', '{"sub":"11400003-0000-4000-8000-000000000114","role":"authenticated"}', true);
select app.organization_create_owned('P114 Manufacturer', 'manufacturer', 'en', 'Main', 'P114 Manufacturer LLC');
select set_config('request.jwt.claims', '{"sub":"11400004-0000-4000-8000-000000000114","role":"authenticated"}', true);
select app.organization_create_owned('P114 Importer', 'importer', 'en', 'Main');
select set_config('request.jwt.claims', '{"sub":"11400005-0000-4000-8000-000000000114","role":"authenticated"}', true);
select app.organization_create_owned('P114 Design Office', 'design_office', 'en', 'Main', 'P114 Design LLC');
select set_config('request.jwt.claims', '', true);

truncate p114_caps;
insert into p114_caps
select o.name, o.org_type, m.id, m.user_id, array_agg(c.capability_key order by c.capability_key)
from public.organizations o
join public.memberships m on m.organization_id = o.id
join public.membership_capabilities c on c.membership_id = m.id
where o.name like 'P114 %'
group by o.name, o.org_type, m.id, m.user_id;

select ok((select caps @> array['sales.assign','sales.manage','sales.read','sales.write'] from p114_caps where name = 'P114 Supplier'),
  'A2: supplier owner (8-argument overload) holds the four keys');
select ok((select caps @> array['sales.assign','sales.manage','sales.read','sales.write'] from p114_caps where name = 'P114 Manufacturer'),
  'A2: manufacturer owner holds the four keys');
select ok((select caps @> array['sales.assign','sales.manage','sales.read','sales.write'] from p114_caps where name = 'P114 Importer'),
  'A2: importer owner (4-argument overload) holds the four keys');
select ok((select not (caps && array['sales.assign','sales.manage','sales.read','sales.write']) from p114_caps where name = 'P114 Design Office'),
  'A2: design_office (not an eligible type) gets none of the four keys');
select is((select count(*)::int from p114_caps where name = 'P114 Design Office' and 'org.manage' = any(caps)), 1,
  'A2: the design_office owner keeps its unchanged owner capabilities');
select is((select array_length(caps, 1) from p114_caps where name = 'P114 Supplier')
          - (select array_length(caps, 1) from p114_caps where name = 'P114 Design Office'), 4,
  'A2: an eligible owner differs from the unchanged owner set by exactly the four keys');

-- ===========================================================================
-- B. Delegation by the showroom owner
-- ===========================================================================
update public.organizations set status = 'active', is_verified = true where name = 'P114 Showroom';
update public.users set primary_account_type = null where id in (
  '11400006-0000-4000-8000-000000000114', '11400007-0000-4000-8000-000000000114', '11400008-0000-4000-8000-000000000114');
insert into public.branches (id, organization_id, name)
select '114bbbb2-0000-4000-8000-000000000114', id, 'P114 Giza' from public.organizations where name = 'P114 Showroom';
insert into public.memberships (id, user_id, organization_id, status, accepted_at)
select v.mid, v.uid, o.id, 'active', now()
from public.organizations o,
     (values ('114e0006-0000-4000-8000-000000000114'::uuid, '11400006-0000-4000-8000-000000000114'::uuid),
             ('114e0007-0000-4000-8000-000000000114'::uuid, '11400007-0000-4000-8000-000000000114'::uuid),
             ('114e0008-0000-4000-8000-000000000114'::uuid, '11400008-0000-4000-8000-000000000114'::uuid)) v(mid, uid)
where o.name = 'P114 Showroom';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11400001-0000-4000-8000-000000000114","role":"authenticated"}';
select lives_ok($$ select public.membership_set_capabilities('114e0006-0000-4000-8000-000000000114',
                  array['sales.read','sales.write','sales.assign','sales.manage']) $$,
  'B1: the owner delegates the Sales Manager preset');
select lives_ok($$ select public.membership_set_capabilities('114e0007-0000-4000-8000-000000000114',
                  array['sales.read','sales.write']) $$,
  'B2: the owner delegates the Sales Rep preset');
select lives_ok($$ select public.branch_assign('114e0007-0000-4000-8000-000000000114',
                  (select b.id from public.branches b join public.organizations o on o.id = b.organization_id
                   where o.name = 'P114 Showroom' and b.name = 'P114 Cairo')) $$,
  'B3: the owner limits the Sales Rep to the Cairo branch');
select lives_ok($$ select public.membership_set_capabilities('114e0008-0000-4000-8000-000000000114',
                  array['org.members.manage']) $$,
  'B4: the owner delegates the members-only manager preset');
reset role;

select is((select array_agg(capability_key order by capability_key) from public.membership_capabilities
           where membership_id = '114e0006-0000-4000-8000-000000000114'),
  array['sales.assign','sales.manage','sales.read','sales.write'], 'B1: the Sales Manager holds exactly the preset');
select is((select array_agg(capability_key order by capability_key) from public.membership_capabilities
           where membership_id = '114e0007-0000-4000-8000-000000000114'),
  array['sales.read','sales.write'], 'B2: the Sales Rep holds exactly the preset');

-- Branch scope as seen by each member under RLS.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11400007-0000-4000-8000-000000000114","role":"authenticated"}';
select is((select array_agg(b.name order by b.name) from public.branches b
           join public.organizations o on o.id = b.organization_id where o.name = 'P114 Showroom'),
  array['P114 Cairo'], 'B3: the branch-limited Sales Rep sees only the Cairo branch');
select ok(not app.can_manage_sales((select id from public.organizations where name = 'P114 Showroom')),
  'B3: the Sales Rep cannot manage sales');
set local request.jwt.claims = '{"sub":"11400006-0000-4000-8000-000000000114","role":"authenticated"}';
select ok(app.can_manage_sales((select id from public.organizations where name = 'P114 Showroom')),
  'B1: the Sales Manager can manage sales');

-- ===========================================================================
-- C. No escalation (membership_set_capabilities is unchanged)
-- ===========================================================================
set local request.jwt.claims = '{"sub":"11400007-0000-4000-8000-000000000114","role":"authenticated"}';
select throws_ok($$ select public.membership_set_capabilities('114e0007-0000-4000-8000-000000000114',
                   array['sales.read','sales.write','sales.manage']) $$,
  '42501', null, 'C1: the Sales Rep cannot raise its own capabilities');
set local request.jwt.claims = '{"sub":"11400006-0000-4000-8000-000000000114","role":"authenticated"}';
select throws_ok($$ select public.membership_set_capabilities('114e0007-0000-4000-8000-000000000114',
                   array['sales.read','sales.write','sales.manage']) $$,
  '42501', 'org.members.manage required', 'C2: the Sales Manager cannot change members without org.members.manage');
set local request.jwt.claims = '{"sub":"11400008-0000-4000-8000-000000000114","role":"authenticated"}';
select throws_ok($$ select public.membership_set_capabilities('114e0007-0000-4000-8000-000000000114',
                   array['sales.read','sales.write','sales.manage']) $$,
  '42501', 'cannot grant a capability you do not hold: sales.read',
  'C3: a members-only manager still cannot grant Sales keys it does not hold');
select throws_ok($$ select public.membership_set_capabilities('114e0008-0000-4000-8000-000000000114',
                   array['org.members.manage','org.manage']) $$,
  '42501', 'cannot grant a capability you do not hold: org.manage',
  'C4: a members-only manager cannot promote itself to owner');
reset role;

-- ===========================================================================
-- D. Tenant isolation
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11400002-0000-4000-8000-000000000114","role":"authenticated"}';
select throws_ok($$ select public.membership_set_capabilities('114e0007-0000-4000-8000-000000000114',
                   array['sales.read']) $$,
  '42501', 'org.members.manage required', 'D1: another organization''s owner cannot change the showroom''s members');
select is((select count(*)::int from public.memberships where id in (
            '114e0006-0000-4000-8000-000000000114', '114e0007-0000-4000-8000-000000000114')), 0,
  'D2: another organization''s owner cannot see the showroom''s members');
set local request.jwt.claims = '{"sub":"11400006-0000-4000-8000-000000000114","role":"authenticated"}';
select ok(not app.can_manage_sales((select o.id from public.organizations o where o.name = 'P114 Supplier')),
  'D3: the showroom''s Sales Manager has no Sales authority in another organization');
reset role;

-- ===========================================================================
-- E. Backfill of existing owners
-- ===========================================================================
-- Seeds load AFTER migrations, so seeded owners may still lack the keys: normalize
-- them first, so E1 counts only the fixtures below.
select app.owner_sales_delegation_backfill() >= 0 as normalized;
-- E fixtures: a legacy eligible owner (org.manage, no Sales keys, plus a historical
-- key), a legacy design_office owner, a SUSPENDED legacy owner, a deleted org owner.
insert into public.organizations (id, name, org_type, status, created_by, deleted_at)
values ('114aaa10-0000-4000-8000-000000000114', 'P114 Legacy Importer', 'importer', 'active', '11400010-0000-4000-8000-000000000114', null),
       ('114aaa11-0000-4000-8000-000000000114', 'P114 Legacy Design', 'design_office', 'active', '11400011-0000-4000-8000-000000000114', null),
       ('114aaa12-0000-4000-8000-000000000114', 'P114 Legacy Deleted', 'supplier', 'active', '11400009-0000-4000-8000-000000000114', now());
insert into public.memberships (id, user_id, organization_id, status, accepted_at)
values ('114e0010-0000-4000-8000-000000000114', '11400010-0000-4000-8000-000000000114', '114aaa10-0000-4000-8000-000000000114', 'active', now()),
       ('114e0011-0000-4000-8000-000000000114', '11400011-0000-4000-8000-000000000114', '114aaa11-0000-4000-8000-000000000114', 'active', now()),
       ('114e0012-0000-4000-8000-000000000114', '11400009-0000-4000-8000-000000000114', '114aaa12-0000-4000-8000-000000000114', 'active', now()),
       ('114e0013-0000-4000-8000-000000000114', '11400012-0000-4000-8000-000000000114', '114aaa10-0000-4000-8000-000000000114', 'suspended', now());
insert into public.membership_capabilities (membership_id, capability_key)
values ('114e0010-0000-4000-8000-000000000114', 'org.manage'),
       ('114e0010-0000-4000-8000-000000000114', 'network.refer'),
       ('114e0011-0000-4000-8000-000000000114', 'org.manage'),
       ('114e0012-0000-4000-8000-000000000114', 'org.manage'),
       ('114e0013-0000-4000-8000-000000000114', 'org.manage');

select is(app.owner_sales_delegation_backfill(), 1,
  'E1: the backfill changes exactly the one legacy eligible active owner');
select is((select array_agg(capability_key order by capability_key) from public.membership_capabilities
           where membership_id = '114e0010-0000-4000-8000-000000000114'),
  array['network.refer','org.manage','sales.assign','sales.manage','sales.read','sales.write'],
  'E1: the four keys are added and the historical capabilities are kept');
select is((select count(*)::int from public.membership_capabilities
           where membership_id in ('114e0011-0000-4000-8000-000000000114', '114e0012-0000-4000-8000-000000000114',
                                   '114e0013-0000-4000-8000-000000000114')
             and capability_key like 'sales.%'), 0,
  'E2: design_office, deleted-organization and suspended owners are untouched');
select is((select count(*)::int from public.audit_log
           where action = 'membership.role_changed' and subject_id = '114e0010-0000-4000-8000-000000000114'
             and metadata->>'source' = 'migration_20261026090001_owner_sales_delegation'), 1,
  'E3: the change is audited once with its source');
select is(app.owner_sales_delegation_backfill(), 0, 'E4: a second run changes nothing (idempotent)');
select is((select count(*)::int from public.audit_log
           where action = 'membership.role_changed' and subject_id = '114e0010-0000-4000-8000-000000000114'), 1,
  'E4: and writes no second audit row');

-- ===========================================================================
-- F. Grants and unchanged rules
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'app.owner_sales_delegation_backfill()', 'execute')
          and not has_function_privilege('anon', 'app.owner_sales_delegation_backfill()', 'execute')
          and not has_function_privilege('service_role', 'app.owner_sales_delegation_backfill()', 'execute'),
  'F1: the backfill is DB-owner only');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11400012-0000-4000-8000-000000000114","role":"authenticated"}';
select throws_ok($$ select public.onboarding_select_account_type('consumer', 'end_consumer') $$,
  '22023', 'this account type is not available yet', 'F2: the Consumer type is still Coming Soon');
reset role;

select * from finish();
rollback;
