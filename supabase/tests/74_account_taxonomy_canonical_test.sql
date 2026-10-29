-- pgTAP: the canonical account taxonomy (20261015090022 / 20261015090023).
--
-- Claims under test:
--   * Exactly the approved values exist: five personal personas and six business types. The retired
--     interior_designer / trainer / trainee personas and the wholesaler organization type are gone.
--   * Subtypes: Showroom 4, Supplier 2 (distributor + wholesaler), Manufacturer 2, Importer 2,
--     Engineer 2 (civil engineer, architect; the placeholder finishing retired by 20261029090002); Contractor, Craftsman and Personal carry none; Sales has staff roles only.
--   * The database refuses a subtype on the wrong account (trigger) as well as the RPCs do.
--   * Wholesaler is valid only under Supplier.
--   * The business registration track cannot open contractor_company or a retired value.
--   * The 14 active craftsman specialties are multi-select and persist.
--   * A Sales Team member's audience is exactly the active workspace's audience; never combined.
--   * Offer audiences follow the same taxonomy.

create extension if not exists pgtap;

begin;
select plan(48);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set orgC '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgM '9d000000-dddd-4ddd-8ddd-000000000002'
\set orgS '9f000000-ffff-4fff-8fff-000000000004'
\set hana   '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set sara   '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set delta  '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}'
\set engineer '{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}'
\set installer '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}'

-- A. The enums hold exactly the approved values ------------------------------------------------------
select is((select array_agg(e::text order by e::text) from unnest(enum_range(null::public.persona_type)) e),
  array['contractor','end_consumer','engineer','installer_technician','sales'],
  'personal personas are exactly contractor, end customer, engineer, craftsman and sales');
select is((select array_agg(e::text order by e::text) from unnest(enum_range(null::public.organization_type)) e),
  array['contractor_company','design_office','importer','manufacturer','showroom_dealer','supplier'],
  'business types are exactly the four public businesses plus the internal contractor and engineer businesses');
select throws_ok($$ select 'interior_designer'::public.persona_type $$, '22P02', null, 'interior_designer is no longer a value');
select throws_ok($$ select 'trainer'::public.persona_type $$, '22P02', null, 'trainer is no longer a value');
select throws_ok($$ select 'wholesaler'::public.organization_type $$, '22P02', null, 'wholesaler is no longer an organization type');

-- B. The subtype catalogue -------------------------------------------------------------------------------
select is((select array_agg(key order by sort_order) from public.activities where organization_type = 'showroom_dealer'),
  array['decor_showroom','paint_showroom','decor_and_paint_showroom','building_and_finishing_supplies_retailer'],
  'Showroom has exactly four subtypes (decoration, paint, decoration and paint, Mawan)');
select is((select array_agg(key order by sort_order) from public.activities where organization_type = 'supplier'),
  array['distributor','wholesaler'], 'Supplier has exactly two subtypes: distributor and wholesaler');
select is((select array_agg(key order by sort_order) from public.activities where organization_type = 'manufacturer'),
  array['paint_manufacturer','decor_manufacturer'], 'Manufacturer has exactly two subtypes');
select is((select array_agg(key order by sort_order) from public.activities where organization_type = 'importer'),
  array['decor_supplies_importer','paint_importer'], 'Importer has exactly two subtypes');
select is((select array_agg(key order by sort_order) from public.activities where persona_type = 'engineer' and is_active),
  array['civil_engineer','architect'], 'Engineer has exactly two active subtypes: civil engineer and architect');
select is((select count(*)::int from public.activities
            where organization_type in ('design_office','contractor_company')
               or persona_type in ('contractor','installer_technician','end_consumer')),
  0, 'Contractor, Craftsman, Personal and the internal businesses carry no business subtype');
select is((select array_agg(key order by sort_order) from public.activities where persona_type = 'sales'),
  array['sales_rep','sales_manager'], 'Sales Team carries internal staff roles only, not business subtypes');

-- C. The database refuses a subtype on the wrong account ----------------------------------------------
select throws_ok(format($f$insert into public.organization_activities (organization_id, activity_id)
    select %L::uuid, id from public.activities where key = 'distributor' $f$, :'orgC'),
  '23514', null, 'a Showroom cannot hold a Supplier subtype');
select throws_ok(format($f$insert into public.organization_activities (organization_id, activity_id)
    select %L::uuid, id from public.activities where key = 'wholesaler' $f$, :'orgC'),
  '23514', null, 'wholesaler is not valid under a Showroom');
select throws_ok(format($f$insert into public.organization_activities (organization_id, activity_id)
    select %L::uuid, id from public.activities where key = 'paint_importer' $f$, :'orgS'),
  '23514', null, 'a Supplier cannot hold an Importer subtype');
select throws_ok(format($f$insert into public.organization_activities (organization_id, activity_id)
    select %L::uuid, id from public.activities where key = 'paint_manufacturer' $f$, :'orgC'),
  '23514', null, 'a Showroom cannot hold a Manufacturer subtype');
delete from public.organization_activities where organization_id = :'orgS'::uuid;
select lives_ok(format($f$insert into public.organization_activities (organization_id, activity_id)
    select %L::uuid, id from public.activities where key = 'wholesaler' $f$, :'orgS'),
  'wholesaler is valid under a Supplier');
select throws_ok(format($f$update public.organizations set org_type = 'importer' where id = %L::uuid$f$, :'orgS'),
  '23514', null, 'an organization cannot change type while it holds subtypes of the old one');
select throws_ok(
  $$ insert into public.user_activities (user_id, activity_id)
     select '71000006-0000-4000-8000-000000000006'::uuid, id from public.activities where key = 'finishing' $$,
  '23514', null, 'a Craftsman cannot take the Engineer subtype');

-- D. The RPCs agree --------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'hana';
select throws_ok(format($f$select public.organization_activities_set(%L::uuid, array['wholesaler'])$f$, :'orgC'),
  '22023', null, 'the RPC refuses wholesaler for a Showroom');
select lives_ok(format($f$select public.organization_activities_set(%L::uuid, array['decor_and_paint_showroom'])$f$, :'orgC'),
  'and accepts a Showroom subtype');
set local request.jwt.claims = :'delta';
select lives_ok(format($f$select public.organization_activities_set(%L::uuid, array['distributor','wholesaler'])$f$, :'orgS'),
  'a Supplier may be both distributor and wholesaler');
set local request.jwt.claims = :'engineer';
select lives_ok($$ select public.user_activities_set(array['civil_engineer']) $$, 'an Engineer may take Civil engineer');
select throws_ok($$ select public.user_activities_set(array['finishing']) $$, '22023', null, 'the retired Finishing is no longer offered');
select throws_ok($$ select public.user_activities_set(array['sales_rep']) $$, '22023', null, 'an Engineer cannot take a Sales staff role');

-- E. Registration: the business track is limited to approved businesses ------------------------------
set local request.jwt.claims = :'installer';
select throws_ok($$ select public.onboarding_select_account_type('business', 'contractor_company') $$,
  '22023', null, 'contractor_company is not a public business registration choice');
select throws_ok($$ select public.onboarding_select_account_type('business', 'wholesaler') $$,
  '22023', null, 'wholesaler is not a registration choice (it is a Supplier subtype)');
select throws_ok($$ select public.onboarding_select_account_type('professional', 'interior_designer') $$,
  '22023', null, 'interior_designer is not a registration choice');
select throws_ok($$ select public.onboarding_select_account_type('professional', 'trainer') $$,
  '22023', null, 'trainer is not a registration choice');

-- F. Retired values cannot be written ---------------------------------------------------------------------
reset role;
select throws_ok($$ update public.users set primary_account_type = 'interior_designer' where id = '70000010-0000-4000-8000-000000000010' $$,
  '22P02', null, 'no user can be given a retired persona');
select throws_ok($$ update public.organizations set org_type = 'wholesaler' where id = '9f000000-ffff-4fff-8fff-000000000004' $$,
  '22P02', null, 'no organization can be typed wholesaler');

-- G. Craftsman: 14 active specialties, multi-select ---------------------------------------------------------
select is((select count(*)::int from public.trades where is_active), 14, 'exactly fourteen craftsman specialties are active');
select is((select count(*)::int from public.trades where not is_active), 7, 'the seven retired specialties are kept inactive, not deleted');
set local role authenticated;
set local request.jwt.claims = :'installer';
select lives_ok($$ select public.user_trades_set(array['painting','decorative_paints','epoxy_flooring','door_installation'], 'painting') $$,
  'a craftsman can practise several specialties at once');
reset role;
select is((select count(*)::int from public.user_trades where user_id = '71000006-0000-4000-8000-000000000006'), 4,
  'all four selected specialties persist');
set local role authenticated;
set local request.jwt.claims = :'installer';
select throws_ok($$ select public.user_trades_set(array['plumbing'], 'plumbing') $$, '22023', null,
  'a retired specialty cannot be newly selected');

-- H. Sales Team inherits the ACTIVE workspace audience only -------------------------------------------------
set local request.jwt.claims = :'sara';
select is(app.viewer_product_audience(:'orgC'::uuid), 'showroom_dealer', 'a Sales Team member in a showroom workspace has the showroom audience');
select is(app.viewer_product_audience(null), null, 'with no workspace, Sales Team has no audience of its own');
select throws_ok(format($f$select app.viewer_product_audience(%L::uuid)$f$, :'orgM'), '42501', null,
  'a workspace the member does not belong to grants nothing, so audiences are never combined');
select is((select count(*)::int from public.activities a where a.key = 'sales_rep' and a.persona_type = 'sales'), 1,
  'Sales staff roles stay internal activity rows, not audiences');
select is((select count(*)::int from public.product_audience_types where code ilike '%sales%'), 0,
  'Sales Team is not a product audience');

-- I. Offer audiences follow the same taxonomy -------------------------------------------------------------
reset role;
select is((select count(*)::int from public.offer_audience_types where code in ('wholesaler','interior_designer')), 0,
  'offer audiences no longer name wholesaler or interior_designer');
select is((select count(*)::int from public.product_audience_types), 8, 'there are still exactly eight product audiences');
select is((select array_agg(code order by sort_order) from public.product_audience_types),
  array['showroom_dealer','supplier','manufacturer','importer','contractor','engineer','installer_technician','end_consumer'],
  'in the approved order: showroom, supplier, manufacturer, importer, contractor, engineer, craftsman, end customer');
select ok(not exists (select 1 from public.product_audiences pa where pa.audience not in (select code from public.product_audience_types)),
  'every stored product audience is one of the eight');
select is((select count(*)::int from public.users where primary_account_type::text not in ('contractor','end_consumer','engineer','installer_technician','sales')), 0,
  'every user holds a supported account type');

-- J. contractor_company cannot be self-assigned ---------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'hana';
select throws_ok($$ select public.business_draft_save(null, 'Probe LLC', 'Probe', 'contractor_company'::public.organization_type, null, null, null, null) $$,
  null, null, 'a business draft cannot be opened as a contractor company');
select throws_ok(format($f$ update public.organizations set org_type = 'contractor_company' where id = %L::uuid $f$, :'orgC'),
  null, null, 'a signed-in caller cannot turn an organization into a contractor company');
reset role;

select * from finish();
rollback;
