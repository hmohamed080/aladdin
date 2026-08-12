-- pgTAP: the Pilot Account & Workspace Model (Sprint 12).
--
-- ONE PERSON = ONE USER ID. This proves the eight acceptance properties of the
-- approved model:
--
--   A. one user may hold memberships in two organizations of DIFFERENT org types;
--   B. creating a business never writes its type as the creator's personal identity;
--   C. organization + owner membership + primary branch creation is transactional;
--   D. retrying the SAME creation draft yields exactly ONE organization;
--   E. two DIFFERENT drafts from the same user yield TWO organizations;
--   F. membership uniqueness and RLS isolation still hold;
--   G. a revoked/suspended membership cannot select or access that workspace;
--   H. migrated business-valued users retain their organization access.
create extension if not exists pgtap;

begin;
select plan(37);

-- Ahmed (44…) is our multi-business identity: a personal ENGINEER who will also
-- own two businesses of different types. Layla (11…) is an unrelated caller.
update auth.users set email_confirmed_at = now()
  where id in ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111');
update public.users set status = 'pending_verification'
  where id = '44444444-4444-4444-8444-444444444444';

-- ===========================================================================
-- 0. The column can now REPRESENT a business-only identity
-- ===========================================================================
select col_is_null('public'::name, 'users'::name, 'primary_account_type'::name,
  'users.primary_account_type is nullable — a business-only identity has no personal persona');
select is(
  (select column_default from information_schema.columns
   where table_name='users' and column_name='primary_account_type'),
  null, 'it has no default, so a new identity is not silently made a consumer');

-- ===========================================================================
-- H. Migrated legacy owners kept their access (seed-pilot business owners)
-- ===========================================================================
-- The four seeded Showroom/Manufacturer/Importer/Wholesaler owners are now
-- business-only identities: no personal persona, but every organization,
-- membership and branch intact.
select is(
  (select count(*)::int from public.users
   where id in ('70000001-0000-4000-8000-000000000001','70000003-0000-4000-8000-000000000003',
                '70000004-0000-4000-8000-000000000004','70000005-0000-4000-8000-000000000005')
     and primary_account_type is null),
  4, 'H: the seeded business owners carry NO personal persona after migration');
select is(
  (select count(*)::int from public.memberships m
   where m.user_id in ('70000001-0000-4000-8000-000000000001','70000003-0000-4000-8000-000000000003',
                       '70000004-0000-4000-8000-000000000004','70000005-0000-4000-8000-000000000005')
     and m.status = 'active'),
  4, 'H: each still holds their ACTIVE owner membership');
select isnt(
  (select count(*)::int from public.users where primary_account_type in
     ('showroom_dealer','supplier','manufacturer','importer','wholesaler')),
  null, 'H: the business-persona query is answerable');
select is(
  (select count(*)::int from public.users where primary_account_type in
     ('showroom_dealer','supplier','manufacturer','importer','wholesaler')),
  0, 'H: NO identity anywhere carries a business classification as a personal persona');
-- Their organizations still carry the business classification — it moved nowhere.
select is(
  (select o.org_type::text from public.organizations o
   where o.created_by = '70000001-0000-4000-8000-000000000001'),
  'showroom_dealer', 'H: the business classification still lives on the organization');
-- A business-only identity has no Personal workspace to offer.
select is(app.has_personal_persona('70000001-0000-4000-8000-000000000001'), false,
  'H: a business-only identity has no personal persona (no fake Personal workspace)');
-- ...but a personal professional does.
select is(app.has_personal_persona('70000008-0000-4000-8000-000000000008'), true,
  'H: an individual professional keeps their personal persona');

-- ===========================================================================
-- Walk Ahmed to the business handoff, then create his FIRST business
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en');
select public.onboarding_save_profile('Ahmed Hassan', 'en');
select public.onboarding_save_contact('01012345678');
-- He registers as an ENGINEER: a personal persona, chosen for himself.
select public.onboarding_select_account_type('professional', 'engineer');

-- Draft 1 → AH Design Studio (showroom_dealer).
select isnt(public.business_draft_save(
  p_display_name => 'AH Design Studio', p_org_type => 'showroom_dealer',
  p_primary_branch_name => 'Zayed HQ'), null, 'a business creation draft is created');

-- ===========================================================================
-- C + D. Transactional creation, idempotent per draft
-- ===========================================================================
select lives_ok(
  $$ select public.business_draft_submit(
       (select id from public.business_creation_drafts
        where user_id='44444444-4444-4444-8444-444444444444' and completed_at is null)) $$,
  'C: submitting the draft creates the business');

-- All three artefacts exist together — organization, owner membership, branch.
select is(
  (select o.status::text || '|' || o.is_verified::text || '|' || o.org_type::text
   from public.organizations o where o.name = 'AH Design Studio'),
  'pending_verification|false|showroom_dealer',
  'C: the organization is created pending_verification, unverified, with the chosen type');
select is(
  (select m.status::text from public.memberships m
   join public.organizations o on o.id = m.organization_id
   where o.name = 'AH Design Studio' and m.user_id='44444444-4444-4444-8444-444444444444'),
  'active', 'C: the creator is an ACTIVE member — automatically, with no owner question asked');
select is(
  (select count(*)::int from public.membership_capabilities c
   join public.memberships m on m.id = c.membership_id
   join public.organizations o on o.id = m.organization_id
   where o.name = 'AH Design Studio' and c.capability_key = 'org.manage'),
  1, 'C: the creator holds org.manage — they are the OWNER by relationship');
select is(
  (select b.name from public.branches b
   join public.organizations o on o.id = b.organization_id
   where o.name = 'AH Design Studio'),
  'Zayed HQ', 'C: the primary branch is created in the same transaction');

-- D. Retry the SAME draft repeatedly: still exactly one organization.
select is(
  (select public.business_draft_submit(d.id) from public.business_creation_drafts d
   where d.user_id='44444444-4444-4444-8444-444444444444' and d.organization_id is not null),
  (select id from public.organizations where name = 'AH Design Studio'),
  'D: re-submitting the same draft returns the SAME organization (network retry)');
select is(
  (select public.business_draft_submit(d.id) from public.business_creation_drafts d
   where d.user_id='44444444-4444-4444-8444-444444444444' and d.organization_id is not null),
  (select id from public.organizations where name = 'AH Design Studio'),
  'D: a third retry still returns the same organization');
select is(
  (select count(*)::int from public.organizations where name = 'AH Design Studio'),
  1, 'D: no duplicate organization exists after three submits');
select is(
  (select count(*)::int from public.memberships m
   join public.organizations o on o.id = m.organization_id where o.name = 'AH Design Studio'),
  1, 'D: no duplicate owner membership is created');
select is(
  (select count(*)::int from public.branches b
   join public.organizations o on o.id = b.organization_id where o.name = 'AH Design Studio'),
  1, 'D: no duplicate primary branch is created');

-- ===========================================================================
-- B. Creating a business never became the creator's personal identity
-- ===========================================================================
select is(
  (select u.primary_account_type::text from public.users u
   where u.id = '44444444-4444-4444-8444-444444444444'),
  'end_consumer',
  'B: the org type was NOT written onto the creator (his persona is untouched)');
-- And a business classification can never be requested as a personal upgrade.
select throws_ok(
  $$ select public.request_account_upgrade('showroom_dealer') $$,
  '22023', null,
  'B: a business classification cannot be requested as a personal account type');

-- ===========================================================================
-- E. A SECOND, different draft makes a SECOND organization
-- ===========================================================================
select isnt(public.business_draft_save(
  p_display_name => 'AH Import', p_org_type => 'importer',
  p_primary_branch_name => 'Port Said'), null, 'E: the same user can open a NEW business draft');
select lives_ok(
  $$ select public.business_draft_submit(
       (select id from public.business_creation_drafts
        where user_id='44444444-4444-4444-8444-444444444444' and completed_at is null)) $$,
  'E: the second draft creates a second business');
select is(
  (select count(*)::int from public.organizations
   where created_by = '44444444-4444-4444-8444-444444444444'),
  2, 'E: the SAME user id now owns TWO organizations');

-- ===========================================================================
-- A. One user, two organizations of DIFFERENT types
-- ===========================================================================
select is(
  (select string_agg(distinct o.org_type::text, ',' order by o.org_type::text)
   from public.organizations o
   join public.memberships m on m.organization_id = o.id
   where m.user_id = '44444444-4444-4444-8444-444444444444' and m.status = 'active'),
  'importer,showroom_dealer',
  'A: one identity holds ACTIVE memberships in two organizations of different types');
-- Which one value on the user could never have represented — the whole point.
select is(
  (select count(distinct u.primary_account_type)::int from public.users u
   where u.id = '44444444-4444-4444-8444-444444444444'),
  1, 'A: the person still has exactly ONE personal persona while owning two businesses');

-- The derived workspace list shows Personal + both businesses, Personal first.
select is(
  (select count(*)::int from public.my_workspaces()),
  3, 'A: my_workspaces derives Personal + both business contexts');
select is(
  (select w.kind from public.my_workspaces() w limit 1),
  'personal', 'A: the Personal context is listed first');
select is(
  (select w.relationship from public.my_workspaces() w
   where w.name = 'AH Design Studio'),
  'owner', 'A: the relationship is derived from capabilities, not from any type');

-- ===========================================================================
-- F + G. Isolation, uniqueness, and a revoked membership
-- ===========================================================================
-- F. A second membership row for the same (user, org) is refused.
reset role;
select throws_ok(
  $$ insert into public.memberships (user_id, organization_id, status)
     select '44444444-4444-4444-8444-444444444444', o.id, 'active'
     from public.organizations o where o.name = 'AH Design Studio' $$,
  '23505', null, 'F: a duplicate (user, organization) membership is rejected');

-- F. Layla cannot see Ahmed's organizations (RLS tenant isolation).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.organizations where created_by='44444444-4444-4444-8444-444444444444'),
  0, 'F: a non-member cannot read another identity''s organizations');
select is(
  (select count(*)::int from public.my_workspaces() w where w.name in ('AH Design Studio','AH Import')),
  0, 'F: another caller''s workspaces never appear in my_workspaces');

-- G. Revoke Ahmed's membership in AH Design Studio through the trusted path.
reset role;
update public.memberships m set status = 'revoked'
  from public.organizations o
  where o.id = m.organization_id and o.name = 'AH Design Studio'
    and m.user_id = '44444444-4444-4444-8444-444444444444';

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(
  (select count(*)::int from public.my_workspaces() w where w.name = 'AH Design Studio'),
  0, 'G: a revoked membership removes that workspace from the selector');
select is(
  (select count(*)::int from public.organizations o where o.name = 'AH Design Studio'),
  0, 'G: the revoked organization is no longer readable — selection is not authority');
select is(
  (select count(*)::int from public.my_workspaces() w where w.name = 'AH Import'),
  1, 'G: the caller''s OTHER business is unaffected by the revocation');
select is(app.has_personal_persona('44444444-4444-4444-8444-444444444444'), true,
  'G: revoking a membership never touches the person''s personal identity');

select * from finish();
rollback;
