-- pgTAP: organization application lifecycle (20261015090029 / 20261015090030).
--
--   A. a REJECTED first application is abandoned and replaced; the rejection history is retained
--   B. after the first approval: exactly ONE additional application may be open at a time
--   C. security: org_type is not client-writable; the contractor guard does not trust a session setting
--   D. Contractor / Engineer operating models at registration (Contractor stays Coming Soon, Engineer is open)
--   E. a pending organization has no marketplace authority (catalog, requests, offers, RFQ, publish)
--
-- Every call is made as `authenticated` with the caller's own JWT claims.
create extension if not exists pgtap;

begin;
select plan(81);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('77' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000077')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p77-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P77 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 7) n;

-- 1,2 engineer applicants; 3 contractor persona; 4 fresh (no persona); 5 engineer persona; 6 contractor persona (registration)
update public.users set primary_account_type = 'engineer'   where id in
  ('77000001-0000-4000-8000-000000000077', '77000002-0000-4000-8000-000000000077', '77000005-0000-4000-8000-000000000077');
update public.users set primary_account_type = 'contractor' where id in
  ('77000003-0000-4000-8000-000000000077', '77000006-0000-4000-8000-000000000077');

grant execute on function app.org_product_audience(uuid) to authenticated;

\set u1 '{"sub":"77000001-0000-4000-8000-000000000077","role":"authenticated"}'
\set u2 '{"sub":"77000002-0000-4000-8000-000000000077","role":"authenticated"}'
\set u3 '{"sub":"77000003-0000-4000-8000-000000000077","role":"authenticated"}'
\set u4 '{"sub":"77000004-0000-4000-8000-000000000077","role":"authenticated"}'
\set u5 '{"sub":"77000005-0000-4000-8000-000000000077","role":"authenticated"}'
\set u6 '{"sub":"77000006-0000-4000-8000-000000000077","role":"authenticated"}'
\set adm '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}'
\set delta '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}'
\set orgS '9f000000-ffff-4fff-8fff-000000000004'

create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated;

-- ===========================================================================
-- A. Rejected FIRST application: abandon, keep history, replace
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'u1';

select is(public.my_organization_application_slot(), 'first_available', 'A1: a new applicant may open the first application');
select isnt(public.business_draft_save(p_legal_name => 'Nile Office LLC', p_display_name => 'Nile Office', p_org_type => 'design_office'), null,
  'A2: the first application opens');
insert into _ids select 'o1', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '77000001-0000-4000-8000-000000000077' and completed_at is null));
insert into _ids select 'a1', public.organization_application_submit((select id from _ids where k = 'o1'));
select is(public.my_organization_application_slot(), 'first_pending', 'A3: while the first is pending the slot is first_pending');

set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.review_start(%L)$q$, (select id from _ids where k = 'a1')), 'A4: reviewer claims it');
select lives_ok(format($q$select public.review_reject(%L, %L)$q$, (select id from _ids where k = 'a1'), 'Licence missing.'), 'A5: reviewer rejects it');

set local request.jwt.claims = :'u1';
select is((select application_status from public.my_organization_applications() where organization_id = (select id from _ids where k = 'o1')),
  'rejected', 'A6: the owner sees the rejection');
select is((select can_abandon from public.my_organization_applications() where organization_id = (select id from _ids where k = 'o1')),
  true, 'A7: and may abandon it');
select is(public.my_organization_application_slot(), 'first_rejected', 'A8: the slot reads first_rejected (not a second org)');
select throws_ok($$ select public.business_draft_save(p_legal_name => 'Replacement LLC', p_display_name => 'Replacement', p_org_type => 'design_office') $$,
  '42501', 'an organization application is not available right now',
  'A9: a replacement cannot be opened until the rejected one is abandoned');
select throws_ok(format($q$select public.organization_application_submit(%L)$q$, (select id from _ids where k = 'o1')),
  '22023', null, 'A10: a rejected application is final - it cannot be resubmitted');

select lives_ok(format($q$select public.organization_application_abandon(%L)$q$, (select id from _ids where k = 'o1')),
  'A11: the owner abandons the rejected application');
select lives_ok(format($q$select public.organization_application_abandon(%L)$q$, (select id from _ids where k = 'o1')),
  'A12: abandoning again is idempotent');
reset role;
select is((select status::text from public.organizations where id = (select id from _ids where k = 'o1')), 'archived',
  'A13: the organization is archived, not deleted');
select is((select count(*)::int from public.verifications where organization_id = (select id from _ids where k = 'o1') and status = 'rejected'),
  1, 'A14: the rejected application record is preserved');
select is((select reviewer_id from public.verifications where organization_id = (select id from _ids where k = 'o1') and status = 'rejected'),
  '55555555-5555-4555-8555-555555555555'::uuid, 'A15: with its reviewer');
select is((select reason from public.verifications where organization_id = (select id from _ids where k = 'o1') and status = 'rejected'),
  'Licence missing.', 'A16: and its reason');
select is((select count(*)::int from public.verifications where organization_id = (select id from _ids where k = 'o1') and status = 'cancelled'),
  1, 'A17: a separate closing record is added');
select is((select count(*)::int from public.audit_log where action = 'organization.application_abandoned' and organization_id = (select id from _ids where k = 'o1')),
  1, 'A18: the abandonment is audited');
select is(app.org_is_approved((select id from _ids where k = 'o1')), false, 'A19: an abandoned organization never becomes operational');

set local role authenticated;
set local request.jwt.claims = :'u1';
select is((select application_status from public.my_organization_applications() where organization_id = (select id from _ids where k = 'o1')),
  'abandoned', 'A20: the owner sees it as abandoned');
select is((select reason from public.my_organization_applications() where organization_id = (select id from _ids where k = 'o1')),
  'Licence missing.', 'A21: and still sees the rejection reason');
select is((select count(*)::int from public.my_workspaces() where organization_id = (select id from _ids where k = 'o1')), 0,
  'A22: an abandoned application is not a workspace');
select throws_ok(format($q$select public.organization_application_submit(%L)$q$, (select id from _ids where k = 'o1')),
  '22023', null, 'A23: an abandoned application cannot be submitted');
select is(public.my_organization_application_slot(), 'first_available', 'A24: the first-application slot is free again');

select isnt(public.business_draft_save(p_legal_name => 'Nile Office (new) LLC', p_display_name => 'Nile Office (new)', p_org_type => 'design_office'), null,
  'A25: a replacement FIRST application opens');
insert into _ids select 'o1b', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '77000001-0000-4000-8000-000000000077' and completed_at is null));
select is(app.org_product_audience((select id from _ids where k = 'o1b')), null, 'A26: the replacement starts with no audience');
select is(public.my_organization_application_slot(), 'first_pending', 'A27: only one first application is active at a time');
insert into _ids select 'a1b', public.organization_application_submit((select id from _ids where k = 'o1b'));

set local request.jwt.claims = :'u2';
select throws_ok(format($q$select public.organization_application_abandon(%L)$q$, (select id from _ids where k = 'o1b')),
  '42501', null, 'A28: someone else cannot abandon it');
set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.organization_application_abandon(%L)$q$, (select id from _ids where k = 'o1b')),
  '22023', null, 'A29: an application awaiting a decision cannot be abandoned');

set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.review_start(%L)$q$, (select id from _ids where k = 'a1b')), 'A30: reviewer claims the replacement');
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'a1b')), 'A31: the replacement needs, and gets, full Admin approval');
reset role;
select is((select status::text from public.organizations where id = (select id from _ids where k = 'o1')), 'archived',
  'A32: approving the replacement never revives the abandoned organization');

-- ===========================================================================
-- B. One additional application at a time
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'u2';
select isnt(public.business_draft_save(p_legal_name => 'Second Office LLC', p_display_name => 'Second Office', p_org_type => 'design_office'), null, 'B0: u2 opens a first application');
insert into _ids select 'o2', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '77000002-0000-4000-8000-000000000077' and completed_at is null));
insert into _ids select 'a2', public.organization_application_submit((select id from _ids where k = 'o2'));
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'a2'));
select public.review_approve((select id from _ids where k = 'a2'), false);

set local request.jwt.claims = :'u2';
select is(public.my_organization_application_slot(), 'additional_available', 'B1: with the first approved an additional application is available');
select isnt(public.business_draft_save(p_legal_name => 'Import Co LLC', p_display_name => 'Import Co', p_org_type => 'importer'), null, 'B2: the additional application opens');
insert into _ids select 'o3', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '77000002-0000-4000-8000-000000000077' and completed_at is null));
select is((select status::text from public.organizations where id = (select id from _ids where k = 'o3')), 'pending_verification',
  'B3: the additional organization starts pending (approval is not inherited)');
select is(public.my_organization_application_slot(), 'additional_pending', 'B4: a draft additional application occupies the slot');
select throws_ok($$ select public.business_draft_save(p_legal_name => 'Third LLC', p_display_name => 'Third', p_org_type => 'supplier') $$,
  '42501', 'an organization application is not available right now', 'B5: another cannot be opened while one is open');

insert into _ids select 'a3', public.organization_application_submit((select id from _ids where k = 'o3'));
select is(public.my_organization_application_slot(), 'additional_pending', 'B6: pending review still occupies the slot');

set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'a3'));
select public.review_request_changes((select id from _ids where k = 'a3'), 'Add a branch address.');
set local request.jwt.claims = :'u2';
select is(public.my_organization_application_slot(), 'additional_pending', 'B7: needs-changes still occupies the slot');
-- B3-D: sending an application back must be resubmittable (the guard keeps submitted_at immutable, so the resubmission keeps it).
create temp table _resub as select submitted_at as t0 from public.verifications where id = (select id from _ids where k = 'a3');
grant select on _resub to authenticated;
select lives_ok(format($q$select public.organization_application_submit(%L)$q$, (select id from _ids where k = 'o3')),
  'B7a: the applicant resubmits an application that needed changes');
select is((select status::text from public.verifications where id = (select id from _ids where k = 'a3')), 'submitted',
  'B7b: the same verification returns to the review queue');
select is((select submitted_at from public.verifications where id = (select id from _ids where k = 'a3')), (select t0 from _resub),
  'B7c: the original submission time is kept (immutable by the guard); the resubmission is in the audit trail');
-- the reviewer sends it back again so the abandon scenarios below start from needs-changes as before
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'a3'));
select public.review_request_changes((select id from _ids where k = 'a3'), 'Still missing a branch address.');
set local request.jwt.claims = :'u2';

select throws_ok($$ select public.business_draft_save(p_legal_name => 'Third LLC', p_display_name => 'Third', p_org_type => 'supplier') $$,
  '42501', null, 'B8: and blocks a further application');
select is(app.org_product_audience((select id from _ids where k = 'o2')), 'engineer',
  'B9: the approved office stays operational while the additional one is pending');
select is((select count(*)::int from public.my_workspaces() where kind = 'business' and is_approved), 1,
  'B10: exactly one approved workspace; the pending one is listed but not approved');

select lives_ok(format($q$select public.organization_application_abandon(%L)$q$, (select id from _ids where k = 'o3')),
  'B11: a needs-changes application can be abandoned');
select is(public.my_organization_application_slot(), 'additional_available', 'B12: which frees the slot');
select isnt(public.business_draft_save(p_legal_name => 'Supply Co LLC', p_display_name => 'Supply Co', p_org_type => 'supplier'), null, 'B13: a new additional application opens');
insert into _ids select 'o4', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '77000002-0000-4000-8000-000000000077' and completed_at is null));
insert into _ids select 'a4', public.organization_application_submit((select id from _ids where k = 'o4'));

set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'a4'));
select public.review_reject((select id from _ids where k = 'a4'), 'Not eligible.');
set local request.jwt.claims = :'u2';
select is(public.my_organization_application_slot(), 'additional_available', 'B14: a rejected additional application does not occupy the slot');
select isnt(public.business_draft_save(p_legal_name => 'Mfg Co LLC', p_display_name => 'Mfg Co', p_org_type => 'manufacturer'), null, 'B15: so another may open');
insert into _ids select 'o5', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '77000002-0000-4000-8000-000000000077' and completed_at is null));
insert into _ids select 'a5', public.organization_application_submit((select id from _ids where k = 'o5'));
select throws_ok(format($q$select public.organization_application_submit(%L)$q$, (select id from _ids where k = 'o4')),
  '22023', null, 'B16: the rejected additional application cannot be resubmitted to take a second slot');

set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'a5'));
select public.review_approve((select id from _ids where k = 'a5'), false);
set local request.jwt.claims = :'u2';
select is(public.my_organization_application_slot(), 'additional_available', 'B17: after a final approval another may be submitted');
select is((select count(*)::int from public.my_workspaces() where kind = 'business' and is_approved), 2,
  'B18: both approved organizations are workspaces; audiences are never combined');
select is(app.org_product_audience((select id from _ids where k = 'o5')), 'manufacturer', 'B19: each carries its own audience');

-- ===========================================================================
-- C. Security
-- ===========================================================================
select throws_ok(format($q$update public.organizations set org_type = 'supplier' where id = %L$q$, (select id from _ids where k = 'o2')),
  '42501', null, 'C1: an owner cannot retype an APPROVED organization to take another audience');
select throws_ok(format($q$update public.organizations set org_type = 'showroom_dealer' where id = %L$q$, (select id from _ids where k = 'o4')),
  '42501', null, 'C2: nor a pending one');
select throws_ok($$ insert into public.organizations (name, org_type) values ('Evil', 'contractor_company') $$,
  '42501', null, 'C3: a client cannot insert a contractor_company');
select throws_ok(format($q$update public.organizations set deleted_at = now() where id = %L$q$, (select id from _ids where k = 'o4')),
  '42501', null, 'C3b: an owner cannot soft-delete an application to free the one-open slot');
select lives_ok($$ select set_config('app.org_application', 'on', false) $$, 'C4: a client can set an arbitrary session setting...');
select throws_ok($$ select public.business_draft_save(p_legal_name => 'Evil LLC', p_display_name => 'Evil', p_org_type => 'contractor_company') $$,
  '42501', 'this organization type cannot be self-assigned', 'C5: ...and it grants nothing (the guard does not trust it)');

-- ===========================================================================
-- D. Contractor / Engineer operating models
-- ===========================================================================
set local request.jwt.claims = :'u3';
select isnt(public.business_draft_save(p_legal_name => 'Horizon Contracting LLC', p_display_name => 'Horizon Contracting', p_org_type => 'contractor_company'), null,
  'D1: a Contractor can apply for a Contractor Organization');
insert into _ids select 'o6', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '77000003-0000-4000-8000-000000000077' and completed_at is null));
select is(app.org_product_audience((select id from _ids where k = 'o6')), null, 'D2: a pending Contractor Organization has no audience');
insert into _ids select 'a6', public.organization_application_submit((select id from _ids where k = 'o6'));
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'a6'));
select public.review_approve((select id from _ids where k = 'a6'), false);
select is(app.org_product_audience((select id from _ids where k = 'o6')), 'contractor', 'D3: once approved it carries the Contractor audience');

set local request.jwt.claims = :'u4';
select throws_ok($$ select public.onboarding_select_account_type('business', 'contractor_company') $$,
  '22023', 'this account type is not available yet', 'D4: registering a new Contractor Organization stays Coming Soon');
select lives_ok($$ select public.onboarding_select_account_type('business', 'design_office') $$,
  'D5: registering a new Engineering Office is open with the Engineer account (20261128090007)');
select lives_ok($$ select public.onboarding_select_account_type('business', 'showroom_dealer') $$, 'D6: other business types register as before');
set local request.jwt.claims = :'u6';
select lives_ok($$ select public.onboarding_select_account_type('business', 'contractor_company') $$,
  'D7: an existing Contractor may choose the organization operating model');
set local request.jwt.claims = :'u5';
select lives_ok($$ select public.onboarding_select_account_type('business', 'design_office') $$,
  'D8: an existing Engineer may choose the Engineering Office operating model');
select throws_ok($$ select public.business_draft_save(p_legal_name => 'Cheat LLC', p_display_name => 'Cheat', p_org_type => 'contractor_company') $$,
  '42501', null, 'D9: an Engineer cannot take a contractor company');

-- ===========================================================================
-- E. A pending organization has no marketplace authority
-- ===========================================================================
set local request.jwt.claims = :'delta';
insert into _ids select 'pd', public.own_product_create(:'orgS'::uuid, 'Pending test tile', 'P77-1', 'wallpaper', 'roll');
select public.product_audiences_set((select id from _ids where k = 'pd'),
  array['showroom_dealer','supplier','manufacturer','importer','contractor','engineer','installer_technician','end_consumer']);
select lives_ok(format($q$select public.set_product_published(%L, true, 1)$q$, (select id from _ids where k = 'pd')),
  'E0: an approved supplier publishes a product to all audiences');

-- u2's approved office (o2) vs its pending organization (o4 is rejected-pending; use a fresh pending one)
set local request.jwt.claims = :'u2';
select isnt(public.business_draft_save(p_legal_name => 'Pending Co LLC', p_display_name => 'Pending Co', p_org_type => 'showroom_dealer'), null, 'E1: u2 opens another application');
insert into _ids select 'o7', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '77000002-0000-4000-8000-000000000077' and completed_at is null));

select is((select count(*)::int from public.catalog_products((select id from _ids where k = 'o2')) where id = (select id from _ids where k = 'pd')),
  1, 'E2: the approved office sees the supplier''s product');
select is((select count(*)::int from public.catalog_products((select id from _ids where k = 'o7')) where id = (select id from _ids where k = 'pd')),
  0, 'E3: the pending organization sees no other organization''s product');
select is(jsonb_array_length(public.offers_feed((select id from _ids where k = 'o7'))), 0, 'E4: nor any offer');
select is((select count(*)::int from public.purchase_requests_discover((select id from _ids where k = 'o7'))), 0,
  'E5: nor any shared purchase request');
select throws_ok(format($q$select public.purchase_request_save(%L, null, null, 'Pending business request', null, null, false, '[]'::jsonb)$q$, (select id from _ids where k = 'o7')),
  '42501', null, 'E6: it cannot author a business purchase request');
select throws_ok(format($q$select public.purchase_request_response_save(%L, gen_random_uuid(), null, null, '[]'::jsonb)$q$, (select id from _ids where k = 'o7')),
  '42501', null, 'E7: it cannot submit a quotation response as that business');
select throws_ok(format($q$select public.create_rfq(%L, %L, 'x')$q$, (select id from _ids where k = 'o7'), :'orgS'),
  '42501', null, 'E8: it cannot issue a business RFQ');
select isnt(public.own_product_create((select id from _ids where k = 'o7'), 'My draft', 'P77-2', 'wallpaper', 'roll'), null,
  'E9: it can still prepare a draft product');
select throws_ok(format($q$select public.set_product_published((select id from public.products where organization_id = %L limit 1), true, 1)$q$, (select id from _ids where k = 'o7')),
  '42501', null, 'E10: but cannot publish it');

reset role;
select * from finish();
rollback;
