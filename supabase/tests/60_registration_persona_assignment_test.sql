-- pgTAP: staging-prep Increment 11 — registration account type becomes an
-- AUTHORITATIVE personal persona for Tradespeople and Sales (declared persona,
-- never the trust-reviewed canonical column, never a membership), organization
-- audiences stay intent-only with zero organizations, and EVERY active
-- registration type can reach 100% profile completion through a real write
-- path. Generated fixture-by-fixture for the six active types.
create extension if not exists pgtap;

begin;

-- Synthetic verifier evidence for existing metadata/lifecycle tests only.
-- The missing-object and forged-receipt security regression is covered by 78.
create function pg_temp.attest_owned_fixture() returns void language sql security definer set search_path='' as $$
  insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type,size_bytes,sha256,verified_at)
  select ns,key,owner,'supabase',mime,100,repeat('a',64),now() from (
    select 'portfolio' ns,object_key key,owner_user_id owner,content_type mime from public.portfolio_items where state='pending'
    union all select 'certificate',object_path,owner_user_id,content_type from public.professional_certificates where state='pending'
    union all select 'avatar',object_key,owner_user_id,content_type from public.avatar_uploads where state='pending'
  ) f where owner=(select auth.uid())
  on conflict(namespace,object_key) do nothing;
$$;

select plan(149);


insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values
  ('60000000-0000-4000-8000-000000000001', 'p60-trade@example.test'),
  ('60000000-0000-4000-8000-000000000002', 'p60-sales@example.test'),
  ('60000000-0000-4000-8000-000000000003', 'p60-showroom@example.test'),
  ('60000000-0000-4000-8000-000000000004', 'p60-supplier@example.test'),
  ('60000000-0000-4000-8000-000000000005', 'p60-manufacturer@example.test'),
  ('60000000-0000-4000-8000-000000000006', 'p60-importer@example.test')) v(id, email);

insert into public.consent_receipts (user_id, consent_type, version, locale)
select u.id, t.t, app.current_consent_version(t.t), 'en'
from public.users u
cross join unnest(array['terms','privacy','pilot']::public.consent_type[]) t(t)
where u.id::text like '60000000-0000-4000-8000-00000000000_';

-- ===========================================================================
-- trade: registers as professional/installer_technician
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'installer_technician') $$, 'trade: registration account type is recorded');
select lives_ok($$ select public.profile_set_username('p60trade') $$, 'trade: username claimed');
select is(public.my_registration_state(), 'access_ready', 'trade: access_ready — not active_personal');
reset role;
select is((select status::text from public.users where id = '60000000-0000-4000-8000-000000000001'), 'pending_verification', 'trade: users.status is NOT activated (active_personal invariant untouched)');
select is((select count(*)::int from public.memberships where user_id = '60000000-0000-4000-8000-000000000001'), 0, 'trade: no membership is created');
select is((select count(*)::int from public.organizations where created_by = '60000000-0000-4000-8000-000000000001'), 0, 'trade: no organization is created');
select is((select primary_account_type::text from public.users where id = '60000000-0000-4000-8000-000000000001'), null, 'trade: the trust-reviewed canonical persona is NOT written');
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '60000000-0000-4000-8000-000000000001'), 'installer_technician', 'trade: the choice is now the authoritative DECLARED persona');
select ok(app.is_professional_persona('60000000-0000-4000-8000-000000000001'), 'trade: app.is_professional_persona admits the account');
select is(app.effective_persona('60000000-0000-4000-8000-000000000001')::text, 'installer_technician', 'trade: effective persona resolves to the choice');
select ok(not app.is_sales_persona('60000000-0000-4000-8000-000000000001'), 'trade: is not a sales persona');
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.my_profile_completion() ->> 'percent')::int, 11, 'trade: only the username counts at first');
select lives_ok($$ select public.profile_set_display_name('P60 trade') $$, 'trade: confirms display name');
select lives_ok($$ select public.profile_set_phone('EG', '1000000601', '+201000000601') $$, 'trade: saves phone');
select set_config('test.key_trade', public.avatar_request_upload('image/jpeg'), true);
select pg_temp.attest_owned_fixture();
select lives_ok(format($$ select public.avatar_confirm_upload(%L) $$, current_setting('test.key_trade')), 'trade: avatar ready');
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.my_profile_completion() -> 'missing') x), array['activities','availability','location','portfolio','years_experience'], 'trade: only the approved Installer profile items remain (20261024090000)');
select lives_ok($$ select public.individual_save_professional('installer_technician'::public.persona_type, 'P60 headline', 4::smallint, null, 'P60 bio', null, null, null, 'within_week') $$, 'trade: professional profile editor save is admitted');
select lives_ok($$ select public.user_trades_set(array['painting']) $$, 'trade: can declare an active trade');
select lives_ok($$ select public.user_service_areas_set('cairo', '[{"governorate_key":"cairo","city_key":null}]'::jsonb) $$, 'trade: sets a governorate');
select lives_ok($$ select public.portfolio_project_create('P60 project', null, null) $$, 'trade: adds a portfolio project');
select is((public.my_profile_completion() ->> 'percent')::int, 100, 'trade: reaches 100%');
select is(public.my_registration_state(), 'access_ready', 'trade: still access_ready');
reset role;

-- ===========================================================================
-- sales: registers as professional/sales
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'sales') $$, 'sales: registration account type is recorded');
select lives_ok($$ select public.profile_set_username('p60sales') $$, 'sales: username claimed');
select is(public.my_registration_state(), 'access_ready', 'sales: access_ready — not active_personal');
reset role;
select is((select status::text from public.users where id = '60000000-0000-4000-8000-000000000002'), 'pending_verification', 'sales: users.status is NOT activated (active_personal invariant untouched)');
select is((select count(*)::int from public.memberships where user_id = '60000000-0000-4000-8000-000000000002'), 0, 'sales: no membership is created');
select is((select count(*)::int from public.organizations where created_by = '60000000-0000-4000-8000-000000000002'), 0, 'sales: no organization is created');
select is((select primary_account_type::text from public.users where id = '60000000-0000-4000-8000-000000000002'), null, 'sales: the trust-reviewed canonical persona is NOT written');
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '60000000-0000-4000-8000-000000000002'), 'sales', 'sales: the choice is now the authoritative DECLARED persona');
select ok(app.is_professional_persona('60000000-0000-4000-8000-000000000002'), 'sales: app.is_professional_persona admits the account');
select is(app.effective_persona('60000000-0000-4000-8000-000000000002')::text, 'sales', 'sales: effective persona resolves to the choice');
select ok(app.is_sales_persona('60000000-0000-4000-8000-000000000002'), 'sales: app.is_sales_persona admits the account (user-level classification)');
select is((select count(*)::int from public.membership_capabilities c join public.memberships m on m.id = c.membership_id where m.user_id = '60000000-0000-4000-8000-000000000002'), 0, 'sales: NO Sales Rep / Sales Manager organization capability is granted');
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.my_profile_completion() ->> 'percent')::int, 13, 'sales: only the username counts at first');
select lives_ok($$ select public.profile_set_display_name('P60 sales') $$, 'sales: confirms display name');
select lives_ok($$ select public.profile_set_phone('EG', '1000000602', '+201000000602') $$, 'sales: saves phone');
select set_config('test.key_sales', public.avatar_request_upload('image/jpeg'), true);
select pg_temp.attest_owned_fixture();
select lives_ok(format($$ select public.avatar_confirm_upload(%L) $$, current_setting('test.key_sales')), 'sales: avatar ready');
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.my_profile_completion() -> 'missing') x), array['activities','bio','headline','years_experience'], 'sales: only professional items remain');
select lives_ok($$ select public.individual_save_professional('sales'::public.persona_type, 'P60 headline', 4::smallint, null, 'P60 bio') $$, 'sales: professional profile editor save is admitted');
select lives_ok($$ select public.user_activities_set(array['sales_rep']) $$, 'sales: can pick a Sales subtype (user-level label)');
reset role;
select is((select count(*)::int from public.memberships where user_id = '60000000-0000-4000-8000-000000000002'), 0, 'sales: choosing Sales Rep still creates no membership');
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.my_profile_completion() ->> 'percent')::int, 100, 'sales: reaches 100%');
select is(public.my_registration_state(), 'access_ready', 'sales: still access_ready');
reset role;

-- ===========================================================================
-- showroom: registers as business/showroom_dealer
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('business', 'showroom_dealer') $$, 'showroom: registration account type is recorded');
select lives_ok($$ select public.profile_set_username('p60showroom') $$, 'showroom: username claimed');
select is(public.my_registration_state(), 'access_ready', 'showroom: access_ready — not active_personal');
reset role;
select is((select status::text from public.users where id = '60000000-0000-4000-8000-000000000003'), 'pending_verification', 'showroom: users.status is NOT activated (active_personal invariant untouched)');
select is((select count(*)::int from public.memberships where user_id = '60000000-0000-4000-8000-000000000003'), 0, 'showroom: no membership is created');
select is((select count(*)::int from public.organizations where created_by = '60000000-0000-4000-8000-000000000003'), 0, 'showroom: no organization is created');
select is((select primary_account_type::text from public.users where id = '60000000-0000-4000-8000-000000000003'), null, 'showroom: the trust-reviewed canonical persona is NOT written');
select is((select selected_org_type::text from public.onboarding_progress where user_id = '60000000-0000-4000-8000-000000000003'), 'showroom_dealer', 'showroom: the choice stays the INTENDED organization type');
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '60000000-0000-4000-8000-000000000003'), null, 'showroom: no personal persona is declared for a business choice');
select ok(not app.is_professional_persona('60000000-0000-4000-8000-000000000003'), 'showroom: not a professional persona');
select ok(not app.has_personal_persona('60000000-0000-4000-8000-000000000003'), 'showroom: no Personal workspace is fabricated');
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((public.my_profile_completion() ->> 'percent')::int, 20, 'showroom: only the username counts at first');
select lives_ok($$ select public.profile_set_display_name('P60 showroom') $$, 'showroom: confirms display name');
select lives_ok($$ select public.profile_set_phone('EG', '1000000603', '+201000000603') $$, 'showroom: saves phone');
select set_config('test.key_showroom', public.avatar_request_upload('image/jpeg'), true);
select pg_temp.attest_owned_fixture();
select lives_ok(format($$ select public.avatar_confirm_upload(%L) $$, current_setting('test.key_showroom')), 'showroom: avatar ready');
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.my_profile_completion() -> 'missing') x), array['organization_setup'], 'showroom: only organization setup remains (reachable at /business/new)');
select is((public.my_profile_completion() ->> 'percent')::int, 80, 'showroom: 4 of 5 = 80% with zero organizations');
select throws_ok($$ select public.user_trades_set(array['painting']) $$, '42501', null, 'showroom: cannot declare trades');
select throws_ok($$ select public.user_activities_set(array['sales_rep']) $$, '22023', null, 'showroom: cannot take a persona subtype');
select set_config('test.draft_showroom', public.business_draft_save(p_legal_name => 'P60 showroom LLC', p_display_name => 'P60 showroom', p_org_type => 'showroom_dealer', p_primary_branch_name => 'HQ')::text, true);
select set_config('test.org_showroom', public.business_draft_submit(current_setting('test.draft_showroom')::uuid)::text, true);
select is((select org_type::text from public.organizations where id = current_setting('test.org_showroom')::uuid), 'showroom_dealer', 'showroom: the organization is created only by the explicit business flow, with the intended type');
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.my_profile_completion() -> 'missing') x), array['organization_activities','organization_address'], 'showroom: the owner is now asked for activities and the optional onboarding address');
select lives_ok(format($$ select public.organization_activities_set(%L, array['decor_showroom']) $$, current_setting('test.org_showroom')), 'showroom: sets an organization subtype');
select is((public.my_profile_completion() ->> 'percent')::int, 86, 'showroom: missing address still prevents profile completion');
select lives_ok(format($$ select public.branch_update_i18n(%L, null, null, '60 Profile Completion Street', null, 'Africa/Cairo') $$, (select id from public.branches where organization_id=current_setting('test.org_showroom')::uuid and deleted_at is null limit 1)), 'showroom: owner completes address through the authorized branch editor RPC');
select is((public.my_profile_completion() ->> 'percent')::int, 100, 'showroom: reaches 100%');
select is(public.my_registration_state(), 'active_personal', 'showroom: a REAL membership is what yields active_personal');
reset role;

-- ===========================================================================
-- supplier: registers as business/supplier
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000004","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('business', 'supplier') $$, 'supplier: registration account type is recorded');
select lives_ok($$ select public.profile_set_username('p60supplier') $$, 'supplier: username claimed');
select is(public.my_registration_state(), 'access_ready', 'supplier: access_ready — not active_personal');
reset role;
select is((select status::text from public.users where id = '60000000-0000-4000-8000-000000000004'), 'pending_verification', 'supplier: users.status is NOT activated (active_personal invariant untouched)');
select is((select count(*)::int from public.memberships where user_id = '60000000-0000-4000-8000-000000000004'), 0, 'supplier: no membership is created');
select is((select count(*)::int from public.organizations where created_by = '60000000-0000-4000-8000-000000000004'), 0, 'supplier: no organization is created');
select is((select primary_account_type::text from public.users where id = '60000000-0000-4000-8000-000000000004'), null, 'supplier: the trust-reviewed canonical persona is NOT written');
select is((select selected_org_type::text from public.onboarding_progress where user_id = '60000000-0000-4000-8000-000000000004'), 'supplier', 'supplier: the choice stays the INTENDED organization type');
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '60000000-0000-4000-8000-000000000004'), null, 'supplier: no personal persona is declared for a business choice');
select ok(not app.is_professional_persona('60000000-0000-4000-8000-000000000004'), 'supplier: not a professional persona');
select ok(not app.has_personal_persona('60000000-0000-4000-8000-000000000004'), 'supplier: no Personal workspace is fabricated');
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((public.my_profile_completion() ->> 'percent')::int, 20, 'supplier: only the username counts at first');
select lives_ok($$ select public.profile_set_display_name('P60 supplier') $$, 'supplier: confirms display name');
select lives_ok($$ select public.profile_set_phone('EG', '1000000604', '+201000000604') $$, 'supplier: saves phone');
select set_config('test.key_supplier', public.avatar_request_upload('image/jpeg'), true);
select pg_temp.attest_owned_fixture();
select lives_ok(format($$ select public.avatar_confirm_upload(%L) $$, current_setting('test.key_supplier')), 'supplier: avatar ready');
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.my_profile_completion() -> 'missing') x), array['organization_setup'], 'supplier: only organization setup remains (reachable at /business/new)');
select is((public.my_profile_completion() ->> 'percent')::int, 80, 'supplier: 4 of 5 = 80% with zero organizations');
select throws_ok($$ select public.user_trades_set(array['painting']) $$, '42501', null, 'supplier: cannot declare trades');
select throws_ok($$ select public.user_activities_set(array['sales_rep']) $$, '22023', null, 'supplier: cannot take a persona subtype');
select set_config('test.draft_supplier', public.business_draft_save(p_legal_name => 'P60 supplier LLC', p_display_name => 'P60 supplier', p_org_type => 'supplier', p_primary_branch_name => 'HQ')::text, true);
select set_config('test.org_supplier', public.business_draft_submit(current_setting('test.draft_supplier')::uuid)::text, true);
select is((select org_type::text from public.organizations where id = current_setting('test.org_supplier')::uuid), 'supplier', 'supplier: the organization is created only by the explicit business flow, with the intended type');
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.my_profile_completion() -> 'missing') x), array['organization_activities'], 'supplier: the owner is now asked for organization activities');
select lives_ok(format($$ select public.organization_activities_set(%L, array['distributor']) $$, current_setting('test.org_supplier')), 'supplier: sets an organization subtype');
select is((public.my_profile_completion() ->> 'percent')::int, 100, 'supplier: reaches 100%');
select is(public.my_registration_state(), 'active_personal', 'supplier: a REAL membership is what yields active_personal');
reset role;

-- ===========================================================================
-- manufacturer: registers as business/manufacturer
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000005","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('business', 'manufacturer') $$, 'manufacturer: registration account type is recorded');
select lives_ok($$ select public.profile_set_username('p60manufact') $$, 'manufacturer: username claimed');
select is(public.my_registration_state(), 'access_ready', 'manufacturer: access_ready — not active_personal');
reset role;
select is((select status::text from public.users where id = '60000000-0000-4000-8000-000000000005'), 'pending_verification', 'manufacturer: users.status is NOT activated (active_personal invariant untouched)');
select is((select count(*)::int from public.memberships where user_id = '60000000-0000-4000-8000-000000000005'), 0, 'manufacturer: no membership is created');
select is((select count(*)::int from public.organizations where created_by = '60000000-0000-4000-8000-000000000005'), 0, 'manufacturer: no organization is created');
select is((select primary_account_type::text from public.users where id = '60000000-0000-4000-8000-000000000005'), null, 'manufacturer: the trust-reviewed canonical persona is NOT written');
select is((select selected_org_type::text from public.onboarding_progress where user_id = '60000000-0000-4000-8000-000000000005'), 'manufacturer', 'manufacturer: the choice stays the INTENDED organization type');
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '60000000-0000-4000-8000-000000000005'), null, 'manufacturer: no personal persona is declared for a business choice');
select ok(not app.is_professional_persona('60000000-0000-4000-8000-000000000005'), 'manufacturer: not a professional persona');
select ok(not app.has_personal_persona('60000000-0000-4000-8000-000000000005'), 'manufacturer: no Personal workspace is fabricated');
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((public.my_profile_completion() ->> 'percent')::int, 20, 'manufacturer: only the username counts at first');
select lives_ok($$ select public.profile_set_display_name('P60 manufacturer') $$, 'manufacturer: confirms display name');
select lives_ok($$ select public.profile_set_phone('EG', '1000000605', '+201000000605') $$, 'manufacturer: saves phone');
select set_config('test.key_manufacturer', public.avatar_request_upload('image/jpeg'), true);
select pg_temp.attest_owned_fixture();
select lives_ok(format($$ select public.avatar_confirm_upload(%L) $$, current_setting('test.key_manufacturer')), 'manufacturer: avatar ready');
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.my_profile_completion() -> 'missing') x), array['organization_setup'], 'manufacturer: only organization setup remains (reachable at /business/new)');
select is((public.my_profile_completion() ->> 'percent')::int, 80, 'manufacturer: 4 of 5 = 80% with zero organizations');
select throws_ok($$ select public.user_trades_set(array['painting']) $$, '42501', null, 'manufacturer: cannot declare trades');
select throws_ok($$ select public.user_activities_set(array['sales_rep']) $$, '22023', null, 'manufacturer: cannot take a persona subtype');
select set_config('test.draft_manufacturer', public.business_draft_save(p_legal_name => 'P60 manufacturer LLC', p_display_name => 'P60 manufacturer', p_org_type => 'manufacturer', p_primary_branch_name => 'HQ')::text, true);
select set_config('test.org_manufacturer', public.business_draft_submit(current_setting('test.draft_manufacturer')::uuid)::text, true);
select is((select org_type::text from public.organizations where id = current_setting('test.org_manufacturer')::uuid), 'manufacturer', 'manufacturer: the organization is created only by the explicit business flow, with the intended type');
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.my_profile_completion() -> 'missing') x), array['organization_activities'], 'manufacturer: the owner is now asked for organization activities');
select lives_ok(format($$ select public.organization_activities_set(%L, array['paint_manufacturer']) $$, current_setting('test.org_manufacturer')), 'manufacturer: sets an organization subtype');
select is((public.my_profile_completion() ->> 'percent')::int, 100, 'manufacturer: reaches 100%');
select is(public.my_registration_state(), 'active_personal', 'manufacturer: a REAL membership is what yields active_personal');
reset role;

-- ===========================================================================
-- importer: registers as business/importer
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('business', 'importer') $$, 'importer: registration account type is recorded');
select lives_ok($$ select public.profile_set_username('p60importer') $$, 'importer: username claimed');
select is(public.my_registration_state(), 'access_ready', 'importer: access_ready — not active_personal');
reset role;
select is((select status::text from public.users where id = '60000000-0000-4000-8000-000000000006'), 'pending_verification', 'importer: users.status is NOT activated (active_personal invariant untouched)');
select is((select count(*)::int from public.memberships where user_id = '60000000-0000-4000-8000-000000000006'), 0, 'importer: no membership is created');
select is((select count(*)::int from public.organizations where created_by = '60000000-0000-4000-8000-000000000006'), 0, 'importer: no organization is created');
select is((select primary_account_type::text from public.users where id = '60000000-0000-4000-8000-000000000006'), null, 'importer: the trust-reviewed canonical persona is NOT written');
select is((select selected_org_type::text from public.onboarding_progress where user_id = '60000000-0000-4000-8000-000000000006'), 'importer', 'importer: the choice stays the INTENDED organization type');
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '60000000-0000-4000-8000-000000000006'), null, 'importer: no personal persona is declared for a business choice');
select ok(not app.is_professional_persona('60000000-0000-4000-8000-000000000006'), 'importer: not a professional persona');
select ok(not app.has_personal_persona('60000000-0000-4000-8000-000000000006'), 'importer: no Personal workspace is fabricated');
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000006","role":"authenticated"}';
select is((public.my_profile_completion() ->> 'percent')::int, 20, 'importer: only the username counts at first');
select lives_ok($$ select public.profile_set_display_name('P60 importer') $$, 'importer: confirms display name');
select lives_ok($$ select public.profile_set_phone('EG', '1000000606', '+201000000606') $$, 'importer: saves phone');
select set_config('test.key_importer', public.avatar_request_upload('image/jpeg'), true);
select pg_temp.attest_owned_fixture();
select lives_ok(format($$ select public.avatar_confirm_upload(%L) $$, current_setting('test.key_importer')), 'importer: avatar ready');
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.my_profile_completion() -> 'missing') x), array['organization_setup'], 'importer: only organization setup remains (reachable at /business/new)');
select is((public.my_profile_completion() ->> 'percent')::int, 80, 'importer: 4 of 5 = 80% with zero organizations');
select throws_ok($$ select public.user_trades_set(array['painting']) $$, '42501', null, 'importer: cannot declare trades');
select throws_ok($$ select public.user_activities_set(array['sales_rep']) $$, '22023', null, 'importer: cannot take a persona subtype');
select set_config('test.draft_importer', public.business_draft_save(p_legal_name => 'P60 importer LLC', p_display_name => 'P60 importer', p_org_type => 'importer', p_primary_branch_name => 'HQ')::text, true);
select set_config('test.org_importer', public.business_draft_submit(current_setting('test.draft_importer')::uuid)::text, true);
select is((select org_type::text from public.organizations where id = current_setting('test.org_importer')::uuid), 'importer', 'importer: the organization is created only by the explicit business flow, with the intended type');
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.my_profile_completion() -> 'missing') x), array['organization_activities'], 'importer: the owner is now asked for organization activities');
select lives_ok(format($$ select public.organization_activities_set(%L, array['paint_importer']) $$, current_setting('test.org_importer')), 'importer: sets an organization subtype');
select is((public.my_profile_completion() ->> 'percent')::int, 100, 'importer: reaches 100%');
select is(public.my_registration_state(), 'active_personal', 'importer: a REAL membership is what yields active_personal');
reset role;

-- ===========================================================================
-- An ESTABLISHED persona is never flipped by re-running account-type selection
-- ===========================================================================
update public.individual_onboarding set professional_completed_at = now()
 where user_id = '60000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.onboarding_select_account_type('professional', 'engineer') $$, '22023', 'this account type is not available yet', 'a Coming Soon persona cannot be freshly selected (Increment 13)');
reset role;
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '60000000-0000-4000-8000-000000000001'), 'installer_technician', 'a SUBMITTED declaration is not overwritten');
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('60000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p60-canon@example.test', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now());
update public.users set primary_account_type = 'engineer' where id = '60000000-0000-4000-8000-000000000009';
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'sales') $$, 'an Admin-applied engineer re-selects Sales');
reset role;
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '60000000-0000-4000-8000-000000000009'), null, 'a DIFFERENT canonical persona is never shadowed by a declared one');
select is(app.effective_persona('60000000-0000-4000-8000-000000000009')::text, 'engineer', 'the effective persona stays the canonical engineer');

-- ===========================================================================
-- A member WITHOUT org.manage is never handed the organization-activities item
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('60000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p60-member@example.test', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now());
insert into public.onboarding_progress (user_id, selected_track, selected_org_type, account_type_completed_at)
values ('60000000-0000-4000-8000-00000000000a', 'business', 'showroom_dealer', now());
insert into public.memberships (organization_id, user_id, status)
values (current_setting('test.org_showroom')::uuid, '60000000-0000-4000-8000-00000000000a', 'active');
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select ok(not ((public.my_profile_completion() -> 'missing') ? 'organization_activities'), 'an employee without org.manage is not asked for organization activities');
select ok(not ((public.my_profile_completion() -> 'missing') ? 'organization_setup'), 'and already has a business context');
reset role;

select * from finish();
rollback;
