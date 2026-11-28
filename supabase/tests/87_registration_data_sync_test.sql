-- pgTAP: registration data is saved, linked to the right account, editable afterwards, and visible to Admin
-- (20261020090001_registration_data_sync.sql).
--
--   A. SHOWROOM registration: every collected field lands on the organization / branch / activities and is
--      mirrored into the editable contact row.
--   B. EDITING afterwards: contact (one value for Admin and the editor), legal name (locked once verified),
--      branch location - each with its authority check.
--   C. INSTALLER registration: account type, name and phone land on the person Admin lists.
--   D. ADMIN sees all of it through the platform read paths.
--
-- Every call is made as `authenticated` with the caller's own JWT claims. Fixtures live inside this
-- transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(45);

\set showroom  '87000001-0000-4000-8000-000000000087'
\set outsider  '87000002-0000-4000-8000-000000000087'
\set installer '87000003-0000-4000-8000-000000000087'
\set admin     '87000004-0000-4000-8000-000000000087'
\set supplier  '87000005-0000-4000-8000-000000000087'
\set orgS      '87aaaaaa-0000-4000-8000-000000000087'

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('87' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000087')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p87-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P87 User ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 5) n;

insert into public.onboarding_progress (user_id, selected_track, selected_org_type, account_type_completed_at, completed_at)
values (:'showroom', 'business', 'showroom_dealer', now(), now());

insert into public.platform_role_grants (user_id, role) values (:'admin', 'administrator');

-- A supplier organization owned by `supplier` (for the verified-lock check; the showroom activation guard
-- is not involved).
insert into public.organizations (id, name, org_type, status, created_by, legal_name)
values (:'orgS', 'P87 Supplier', 'supplier', 'pending_verification', :'supplier', 'P87 Supplier LLC');
insert into public.memberships (id, user_id, organization_id, status)
values ('87e00005-0000-4000-8000-000000000087', :'supplier', :'orgS', 'active');
insert into public.membership_capabilities (membership_id, capability_key)
values ('87e00005-0000-4000-8000-000000000087', 'org.manage');

-- ===========================================================================
-- A. Showroom registration
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"87000001-0000-4000-8000-000000000087","role":"authenticated"}';

select lives_ok($$
  select public.business_draft_save_v2(
    p_legal_name => 'P87 Showroom Trading LLC', p_display_name => 'P87 Showroom',
    p_org_type => 'showroom_dealer', p_description => 'Tiles and paint for homes',
    p_governorate => 'cairo', p_city_custom_name => 'P87 District',
    p_primary_branch_name => 'P87 Main Branch',
    p_contact_phone => '+201012345678', p_contact_email => 'Owner@P87-Showroom.test',
    p_activity_type => 'decor_showroom', p_detailed_address => '12 Example Street, Block 4')
$$, 'A1. the complete showroom draft saves');
select lives_ok($$ select public.business_draft_submit_v2(null) $$, 'A2. ...and submits');

reset role;
select is((select legal_name from public.organizations where created_by = :'showroom'),
  'P87 Showroom Trading LLC', 'A3. legal name reaches the organization');
select is((select description from public.organizations where created_by = :'showroom'),
  'Tiles and paint for homes', 'A4. description reaches the organization');
select is((select contact_phone from public.organizations where created_by = :'showroom'),
  '+201012345678', 'A5. contact phone reaches the organization');
select is((select contact_email from public.organizations where created_by = :'showroom'),
  'owner@p87-showroom.test', 'A6. contact e-mail reaches the organization (lower-cased)');
select is((select count(*)::int from public.organization_activities oa join public.activities a on a.id = oa.activity_id
            join public.organizations o on o.id = oa.organization_id
            where o.created_by = :'showroom' and a.key = 'decor_showroom'), 1,
  'A7. the showroom activity is linked');
select results_eq($$
  select b.address_ar, b.governorate_key, b.city_custom_name, b.name
    from public.branches b join public.organizations o on o.id = b.organization_id
   where o.created_by = '87000001-0000-4000-8000-000000000087'
$$, $$ values ('12 Example Street, Block 4'::text, 'cairo'::text, 'P87 District'::text, 'P87 Main Branch'::text) $$,
  'A8. address, governorate, city and branch name reach the primary branch');
select results_eq($$
  select c.phone_e164, c.contact_email, c.show_phone, c.show_email
    from public.organization_contacts c join public.organizations o on o.id = c.organization_id
   where o.created_by = '87000001-0000-4000-8000-000000000087'
$$, $$ values ('+201012345678'::text, 'owner@p87-showroom.test'::text, false, false) $$,
  'A9. the editable contact row is seeded with the registered values, hidden by default');
select is((select m.status::text from public.memberships m join public.organizations o on o.id = m.organization_id
            where o.created_by = :'showroom' and m.user_id = :'showroom'), 'active',
  'A10. the registrant is the active owner of the organization');

-- ===========================================================================
-- B. Editing afterwards
-- ===========================================================================
create temp table org87 as select id from public.organizations where created_by = '87000001-0000-4000-8000-000000000087';
grant select on org87 to authenticated;
create temp table branch87 as select b.id from public.branches b join org87 o on o.id = b.organization_id;
grant select on branch87 to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"87000001-0000-4000-8000-000000000087","role":"authenticated"}';

select lives_ok($$ select public.organization_contact_set((select id from org87), '+201112345678', '+201212345678', 'new@p87-showroom.test', true, false, true) $$,
  'B1. the owner updates the business contact');
reset role;
select results_eq($$
  select o.contact_phone, o.contact_email, c.phone_e164, c.whatsapp_e164, c.show_phone
    from public.organizations o join public.organization_contacts c on c.organization_id = o.id
   where o.id = (select id from org87)
$$, $$ values ('+201112345678'::text, 'new@p87-showroom.test'::text, '+201112345678'::text, '+201212345678'::text, true) $$,
  'B2. the edit reaches the organization (what Admin reads) and the contact row together');

set local role authenticated;
set local request.jwt.claims = '{"sub":"87000001-0000-4000-8000-000000000087","role":"authenticated"}';
select throws_ok($$ select public.organization_contact_set((select id from org87), '', '', 'new@p87-showroom.test', false, false, false) $$,
  '22023', 'a showroom needs a business phone', 'B3. a showroom cannot clear its business phone');
select throws_ok($$ select public.organization_contact_set((select id from org87), '+20555', '', null, false, false, false) $$,
  '22023', null, 'B4. a phone that is not a valid business number is refused');
reset role;
select is((select contact_phone from public.organizations where id = (select id from org87)), '+201112345678',
  'B5. ...and the refused edits changed nothing');

set local role authenticated;
set local request.jwt.claims = '{"sub":"87000002-0000-4000-8000-000000000087","role":"authenticated"}';
select throws_ok($$ select public.organization_contact_set((select id from org87), '+201112345678', '', null, false, false, false) $$,
  '42501', null, 'B6. a stranger cannot edit the contact');
select throws_ok($$ select public.organization_legal_name_set((select id from org87), 'Hijacked LLC') $$,
  '42501', null, 'B7. a stranger cannot edit the legal name');
select throws_ok($$ select public.branch_location_set((select id from branch87), 'giza', null, 'Elsewhere') $$,
  '22023', 'branch not found', 'B8. a stranger cannot even learn the branch exists');

set local request.jwt.claims = '{"sub":"87000001-0000-4000-8000-000000000087","role":"authenticated"}';
select is(public.organization_legal_name_set((select id from org87), '  P87 Showroom Trading Co.  '),
  'P87 Showroom Trading Co.', 'B9. the owner corrects the legal name (trimmed)');
select throws_ok($$ select public.organization_legal_name_set((select id from org87), 'x') $$,
  '22023', null, 'B10. a one-character legal name is refused');
reset role;
select is((select legal_name from public.organizations where id = (select id from org87)),
  'P87 Showroom Trading Co.', 'B11. the new legal name is stored');
select is((select count(*)::int from public.audit_log where action = 'organization.legal_name_changed'
            and organization_id = (select id from org87)), 1, 'B12. the legal-name edit is audited');
select ok(not exists (select 1 from public.audit_log where action = 'organization.legal_name_changed'
            and metadata::text like '%Trading%'), 'B13. ...without recording the private name itself');

set local role authenticated;
set local request.jwt.claims = '{"sub":"87000005-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.organization_legal_name_set('87aaaaaa-0000-4000-8000-000000000087', 'P87 Supplier Trading LLC') $$,
  'B14. an unverified organization can still correct its legal name');
reset role;
update public.organizations set is_verified = true where id = :'orgS';
set local role authenticated;
set local request.jwt.claims = '{"sub":"87000005-0000-4000-8000-000000000087","role":"authenticated"}';
select throws_ok($$ select public.organization_legal_name_set('87aaaaaa-0000-4000-8000-000000000087', 'Another Name LLC') $$,
  '42501', null, 'B15. a verified organization changes its legal name only through Admin review');

set local request.jwt.claims = '{"sub":"87000001-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.branch_location_set((select id from branch87), 'giza', null, 'P87 New District') $$,
  'B16. the owner moves the branch location');
select throws_ok($$ select public.branch_location_set((select id from branch87), 'atlantis', null, 'X City') $$,
  '22023', null, 'B17. an unknown governorate is refused');
select throws_ok($$ select public.branch_location_set((select id from branch87), 'giza', null, null) $$,
  '22023', null, 'B18. a governorate without a city is refused');
reset role;
select results_eq($$ select governorate_key, city_key, city_custom_name from public.branches where id = (select id from branch87) $$,
  $$ values ('giza'::text, null::text, 'P87 New District'::text) $$, 'B19. the new location is stored, the refused ones changed nothing');
select ok(app.showroom_profile_complete((select id from org87)),
  'B20. the edited showroom still satisfies the profile-completeness rule');

-- ===========================================================================
-- C. Installer registration
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"87000003-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'ar') $$, 'C1. consent is recorded');
select lives_ok($$ select public.onboarding_select_account_type('professional', 'installer_technician') $$, 'C2. the installer account type is chosen');
select lives_ok($$ select public.profile_set_phone('EG', '1012349999', '+201012349999') $$, 'C3. the installer phone is claimed');
select lives_ok($$ select public.profile_set_username('p87installer') $$, 'C3b. the generated username is claimed');
reset role;
select is(app.effective_persona(:'installer')::text, 'installer_technician',
  'C4. the app treats the registrant as an Installer account (declared persona; primary_account_type is only set on upgrade approval)');

-- ===========================================================================
-- D. Admin sees both
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"87000004-0000-4000-8000-000000000087","role":"authenticated"}';
select results_eq($$
  select e ->> 'account_type', e ->> 'phone', e ->> 'display_name'
    from jsonb_array_elements(public.admin_users_list(p_search => 'P87 User 3') -> 'rows') e
$$, $$ values ('installer_technician'::text, '+201012349999'::text, 'P87 User 3'::text) $$,
  'D1. Admin lists the Installer with the right account type, phone and name');
select is((select count(*)::int from jsonb_array_elements(public.admin_users_list(p_account_type => 'installer_technician', p_search => 'P87') -> 'rows')), 1,
  'D2. the Installer filter finds exactly that registrant');
select is((select e -> 'organization' ->> 'name' from jsonb_array_elements(public.admin_users_list(p_search => 'P87 User 1') -> 'rows') e),
  'P87 Showroom', 'D3. the showroom owner is listed with the showroom organization');
select is((public.admin_user_detail('87000001-0000-4000-8000-000000000087') ->> 'registered_account'), 'showroom_dealer',
  'D3b. Admin sees what the showroom owner registered as');
select is((public.admin_organization_detail((select id from org87)) ->> 'org_type'), 'showroom_dealer',
  'D4. Admin opens the showroom organization');
select results_eq($$
  select r ->> 'contact_phone', r ->> 'governorate', r ->> 'city_custom_name'
    from jsonb_array_elements(public.admin_organizations_list(p_search => 'P87 Showroom') -> 'rows') r
$$, $$ values ('+201112345678'::text, 'giza'::text, 'P87 New District'::text) $$,
  'D4b. the organizations directory shows the current phone and primary-branch location');
select is((select count(*)::int from jsonb_array_elements(public.admin_organizations_list(p_search => 'P87 Showroom') -> 'rows')), 1,
  'D4c. ...for exactly that business');
select results_eq($$
  select o.legal_name, o.contact_phone, o.description from public.organizations o where o.id = (select id from org87)
$$, $$ values ('P87 Showroom Trading Co.'::text, '+201112345678'::text, 'Tiles and paint for homes'::text) $$,
  'D5. Admin reads the current legal name, contact and description');
select results_eq($$
  select b.governorate_key, b.city_custom_name, b.address_ar from public.branches b where b.id = (select id from branch87)
$$, $$ values ('giza'::text, 'P87 New District'::text, '12 Example Street, Block 4'::text) $$,
  'D6. Admin reads the branch location and address');
select is((select count(*)::int from public.organization_activities where organization_id = (select id from org87)), 1,
  'D7. Admin reads the activity');
reset role;

select * from finish();
rollback;
