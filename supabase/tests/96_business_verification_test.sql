-- pgTAP: business verification (20261021090001 / 20261021090002).
--   A. activation does NOT grant the Verified badge; business verification is a separate request
--   B. documents: validation, owner-only upload into the private bucket, confirm, removal rules
--   C. tenant isolation: an outsider can neither read the state nor touch the documents
--   D. Admin authority: Support views the queue only; Moderator reviews and requests information;
--      only verification.approve approves/rejects; reasons are mandatory; own organization refused;
--      the generic review_* engine refuses a business request
--   E. resubmission rounds, approval -> badge everywhere, audit, notifications
--   F. delegated verification.approve (custom role) decides, and gates the organization application too
create extension if not exists pgtap;

begin;
select no_plan();

-- 1 owner (showroom) · 2 moderator · 3 support · 4 owner of a second org (design office) · 6 delegated approver
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('96' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000096')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p96-' || n || '@example.test', '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P96 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 6) n;
insert into public.platform_role_grants (user_id, role) values
  ('96000002-0000-4000-8000-000000000096', 'moderator'),
  ('96000003-0000-4000-8000-000000000096', 'support');
update public.users set primary_account_type = 'engineer' where id = '96000004-0000-4000-8000-000000000096';
insert into public.onboarding_progress (user_id, selected_track, selected_org_type, account_type_completed_at, completed_at)
values ('96000001-0000-4000-8000-000000000096', 'business', 'showroom_dealer', now(), now());

-- A delegated approver: a custom role (rank below Administrator) holding the review + approve permissions.
insert into public.admin_roles (key, name, description, rank, scope_type, is_system)
values ('bv_delegate_96', 'BV Delegate 96', 'test', 50, 'platform', false);
insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p from public.admin_roles r, unnest(array['organizations.read', 'organizations.verify', 'verification.approve']) p where r.key = 'bv_delegate_96';
insert into public.admin_role_assignments (user_id, role_id, scope_type)
select '96000006-0000-4000-8000-000000000096', r.id, 'platform' from public.admin_roles r where r.key = 'bv_delegate_96';

\set own '{"sub":"96000001-0000-4000-8000-000000000096","role":"authenticated"}'
\set mod '{"sub":"96000002-0000-4000-8000-000000000096","role":"authenticated"}'
\set sup '{"sub":"96000003-0000-4000-8000-000000000096","role":"authenticated"}'
\set out '{"sub":"96000004-0000-4000-8000-000000000096","role":"authenticated"}'
\set del '{"sub":"96000006-0000-4000-8000-000000000096","role":"authenticated"}'
\set adm '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}'

create temp table _ids (k text primary key, v text);
grant all on _ids to authenticated;

-- ---- permission catalog -------------------------------------------------------------------------
select ok(exists (select 1 from public.admin_permissions where key = 'verification.approve'), 'verification.approve is in the catalog');
select results_eq(
  $$select r.key from public.admin_roles r join public.admin_role_permissions rp on rp.role_id = r.id
     where rp.permission_key = 'verification.approve' and r.is_system order by r.key$$,
  $$values ('administrator'::text), ('super_admin'::text)$$,
  'only Super Admin and Administrator hold verification.approve by default');
select ok((select bool_and(is_locked) from public.admin_role_permissions where permission_key = 'verification.approve'
            and role_id in (select id from public.admin_roles where key in ('super_admin', 'administrator'))),
  'the default approvers cannot lose it');

-- ---- set up: an approved (active) showroom -------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'own';
select lives_ok($$select public.business_draft_save_v2(p_display_name => 'Showroom 96', p_legal_name => 'Showroom 96 LLC',
  p_org_type => 'showroom_dealer', p_governorate => 'cairo', p_city => 'maadi', p_contact_phone => '+201012345696',
  p_activity_type => 'decor_showroom', p_detailed_address => '96 Nile Street')$$, 'owner opens a showroom draft');
insert into _ids select 'o1', public.business_draft_submit_v2()::text;
reset role;
insert into public.verifications (id, subject_type, organization_id, verification_type, status, submitted_at)
values ('96a00001-0000-4000-8000-000000000096', 'organization', (select v::uuid from _ids where k = 'o1'), 'organization', 'submitted', now());
set local role authenticated;
set local request.jwt.claims = :'adm';
select lives_ok($$select public.review_start('96a00001-0000-4000-8000-000000000096')$$, 'administrator starts the application review');
select lives_ok($$select public.review_approve('96a00001-0000-4000-8000-000000000096', false)$$, 'administrator approves the application');
reset role;

-- A. activation is not verification
select is((select status::text || '/' || is_verified::text || '/' || (business_verified_at is null)::text
             from public.organizations where id = (select v::uuid from _ids where k = 'o1')),
  'active/true/true', 'A1: an approved application activates the organization but grants NO Verified badge');
select is((select count(*)::int from app._organization_public_directory() d where d.id = (select v::uuid from _ids where k = 'o1') and d.is_verified),
  0, 'A2: the public directory does not show it as verified');

set local role authenticated;
set local request.jwt.claims = :'own';
select is(public.my_business_verification((select v::uuid from _ids where k = 'o1')) ->> 'status', 'none', 'A3: owner sees no verification yet');
select is((public.my_business_verification((select v::uuid from _ids where k = 'o1')) ->> 'can_submit')::boolean, true, 'A4: owner may submit');
select throws_ok(format('select public.business_verification_submit(%L)', (select v from _ids where k = 'o1')), '22023',
  'at least one document is required', 'A5: a first submission needs a document');

-- B. documents
select throws_ok(format('select public.business_verification_document_request_upload(%L, %L, %L, 100, %L)', (select v from _ids where k = 'o1'), 'commercial_register', 'text/html', 'x.html'),
  '22023', null, 'B1: an unsupported content type is refused');
select throws_ok(format('select public.business_verification_document_request_upload(%L, %L, %L, 10485761, %L)', (select v from _ids where k = 'o1'), 'commercial_register', 'application/pdf', 'big.pdf'),
  '22023', null, 'B2: a document over 10 MB is refused');
select throws_ok(format('select public.business_verification_document_request_upload(%L, %L, %L, 100, %L)', (select v from _ids where k = 'o1'), 'passport_scan', 'application/pdf', 'x.pdf'),
  '22023', null, 'B3: an unknown document type is refused');
insert into _ids select 'k1', public.business_verification_document_request_upload((select v::uuid from _ids where k = 'o1'), 'commercial_register', 'application/pdf', 2048, '../../etc/Register.pdf');
select ok((select v from _ids where k = 'k1') ~ ('^' || (select v from _ids where k = 'o1') || '/[0-9a-f-]{36}\.pdf$'), 'B4: the key is <org>/<uuid>.pdf (never the file name)');
reset role;
select is((select file_name from public.business_verification_documents where object_key = (select v from _ids where k = 'k1')),
  '.. .. etc Register.pdf', 'B5: path separators are stripped from the display name');

set local role authenticated;
set local request.jwt.claims = :'out';
select throws_ok(format('select public.business_verification_document_confirm(%L)', (select v from _ids where k = 'k1')), 'P0002', null,
  'B6: nobody but the uploader can confirm a pending document');

-- C. an outsider cannot plant the object, read state or reserve an upload
set local request.jwt.claims = :'out';
select throws_ok(format($q$insert into storage.objects (bucket_id, name) values ('business-verification-documents', %L)$q$, (select v from _ids where k = 'k1')),
  '42501', null, 'C1: an outsider cannot upload into the reserved key');
select throws_ok(format('select public.my_business_verification(%L)', (select v from _ids where k = 'o1')), '42501', null, 'C2: an outsider cannot read the verification state');
select throws_ok(format('select public.business_verification_document_request_upload(%L, %L, %L, 100, %L)', (select v from _ids where k = 'o1'), 'other', 'application/pdf', 'x.pdf'),
  '42501', null, 'C3: an outsider cannot add a document');

set local request.jwt.claims = :'own';
select lives_ok(format($q$insert into storage.objects (bucket_id, name) values ('business-verification-documents', %L)$q$, (select v from _ids where k = 'k1')),
  'B7: the owner uploads into the reserved key');
select lives_ok(format('select public.business_verification_document_confirm(%L)', (select v from _ids where k = 'k1')), 'B8: the owner confirms the upload');
select is((select count(*)::int from storage.objects where bucket_id = 'business-verification-documents'), 1, 'B9: the owner can read its document');
-- a second draft document, then removed again
insert into _ids select 'k2', public.business_verification_document_request_upload((select v::uuid from _ids where k = 'o1'), 'tax_card', 'image/png', 1024, 'tax.png');
insert into storage.objects (bucket_id, name) values ('business-verification-documents', (select v from _ids where k = 'k2'));
select lives_ok(format('select public.business_verification_document_confirm(%L)', (select v from _ids where k = 'k2')), 'B10: a second document is attached');
select is(jsonb_array_length(public.my_business_verification((select v::uuid from _ids where k = 'o1')) -> 'drafts'), 2, 'B11: two draft documents are listed');
reset role;
insert into _ids select 'd2', id::text from public.business_verification_documents where object_key = (select v from _ids where k = 'k2');
set local role authenticated;
set local request.jwt.claims = :'own';
select is(public.business_verification_document_remove((select v::uuid from _ids where k = 'd2')), (select v from _ids where k = 'k2'), 'B12: a draft document can be removed');

set local request.jwt.claims = :'out';
select is((select count(*)::int from storage.objects where bucket_id = 'business-verification-documents'), 0, 'C4: an outsider sees no document object');
set local request.jwt.claims = :'sup';
select is((select count(*)::int from storage.objects where bucket_id = 'business-verification-documents'), 0, 'C5: Support (no organizations.verify) sees no document object');
set local request.jwt.claims = :'mod';
select is((select count(*)::int from storage.objects where bucket_id = 'business-verification-documents' and name = (select v from _ids where k = 'k1')), 1, 'C6: a Moderator reviewer can read the ready evidence');

-- E. submit
set local request.jwt.claims = :'own';
insert into _ids select 'v1', public.business_verification_submit((select v::uuid from _ids where k = 'o1'), 'Our commercial register')::text;
select is(public.my_business_verification((select v::uuid from _ids where k = 'o1')) ->> 'status', 'pending', 'E1: the request is pending');
select throws_ok(format('select public.business_verification_submit(%L)', (select v from _ids where k = 'o1')), '22023', null, 'E2: no second submission while one is in review');
reset role;
insert into _ids select 'd1', id::text from public.business_verification_documents where object_key = (select v from _ids where k = 'k1');
set local role authenticated;
set local request.jwt.claims = :'own';
select throws_ok(format('select public.business_verification_document_remove(%L)', (select v from _ids where k = 'd1')), '22023', null, 'E3: submitted evidence cannot be removed');
reset role;
select throws_ok(format($q$update public.business_verification_documents set file_name = 'x' where object_key = %L$q$, (select v from _ids where k = 'k1')),
  '23514', null, 'E4: submitted evidence is immutable even for a direct writer');

-- D. authority
set local role authenticated;
set local request.jwt.claims = :'adm';
select throws_ok(format('select public.review_start(%L)', (select v from _ids where k = 'v1')), '42501', null, 'D1: the generic review engine refuses a business request');
set local request.jwt.claims = :'sup';
select is((public.business_verification_queue(array['pending']) ->> 'total')::int >= 1, true, 'D2: Support can see the queue');
select throws_ok(format('select public.business_verification_detail(%L)', (select v from _ids where k = 'v1')), '42501', null, 'D3: Support cannot open the evidence');
select throws_ok(format('select public.business_verification_start_review(%L)', (select v from _ids where k = 'v1')), '42501', null, 'D4: Support cannot start a review');
set local request.jwt.claims = :'own';
select throws_ok(format('select public.business_verification_queue()'), '42501', null, 'D5: a business owner cannot read the Admin queue');
set local request.jwt.claims = :'mod';
select is(public.business_verification_detail((select v::uuid from _ids where k = 'v1')) -> 'organization' ->> 'name', 'Showroom 96', 'D6: a Moderator opens the evidence');
select is((public.business_verification_detail((select v::uuid from _ids where k = 'v1')) ->> 'can_decide')::boolean, false, 'D7: ...and is told it cannot decide');
select lives_ok(format('select public.business_verification_start_review(%L)', (select v from _ids where k = 'v1')), 'D8: a Moderator starts the review');
select throws_ok(format('select public.business_verification_approve(%L, %L)', (select v from _ids where k = 'v1'), 'looks fine'), '42501', null, 'D9: a Moderator cannot approve');
select throws_ok(format('select public.business_verification_reject(%L, %L)', (select v from _ids where k = 'v1'), 'no'), '42501', null, 'D10: a Moderator cannot reject');
select throws_ok(format('select public.business_verification_request_info(%L, %L)', (select v from _ids where k = 'v1'), '   '), '22023', null, 'D11: requesting information needs a reason');
select lives_ok(format('select public.business_verification_request_info(%L, %L)', (select v from _ids where k = 'v1'), 'Upload the tax card too'), 'D12: a Moderator requests more information');

-- E. resubmission
set local request.jwt.claims = :'own';
select is(public.my_business_verification((select v::uuid from _ids where k = 'o1')) ->> 'status', 'needs_info', 'E5: owner sees that information was requested');
select is(public.my_business_verification((select v::uuid from _ids where k = 'o1')) ->> 'reason', 'Upload the tax card too', 'E6: ...with the reviewer''s reason');
select throws_ok(format('select public.business_verification_submit(%L)', (select v from _ids where k = 'o1')), '22023', null, 'E7: a resubmission must answer with a document or a note');
select is(public.business_verification_submit((select v::uuid from _ids where k = 'o1'), 'The tax card is attached to the register')::text, (select v from _ids where k = 'v1'), 'E8: resubmission keeps the same request');
reset role;
select is((select count(*)::int from public.business_verification_submissions where verification_id = (select v::uuid from _ids where k = 'v1')), 2, 'E9: two submission rounds are kept');
select ok(exists (select 1 from public.notifications n where n.recipient_user_id = '96000001-0000-4000-8000-000000000096'
                    and n.event_type = 'verification.changes_requested' and n.deep_link = '/showroom/verification'), 'E10: the owner was notified');

-- E. approval
set local role authenticated;
set local request.jwt.claims = :'adm';
select throws_ok(format('select public.business_verification_approve(%L, %L)', (select v from _ids where k = 'v1'), ''), '22023', null, 'E11: approval needs a reason');
select lives_ok(format('select public.business_verification_approve(%L, %L)', (select v from _ids where k = 'v1'), 'Register and tax card match the legal name'), 'E12: an Administrator approves a resubmitted (pending) request directly');
reset role;
select is((select (business_verified_at is not null)::text || '/' || (business_verification_id = (select v::uuid from _ids where k = 'v1'))::text
             from public.organizations where id = (select v::uuid from _ids where k = 'o1')), 'true/true', 'E13: the badge source is set');
select is((select count(*)::int from app._organization_public_directory() d where d.id = (select v::uuid from _ids where k = 'o1') and d.is_verified), 1, 'E14: the public directory now shows it verified');
select is((select array_agg(action order by action) from public.audit_log where subject_id = (select v::uuid from _ids where k = 'v1')),
  array['business_verification.approved', 'business_verification.info_requested', 'business_verification.review_started',
        'business_verification.review_started', 'business_verification.submitted', 'business_verification.submitted'],
  'E15: every step is audited');
set local role authenticated;
set local request.jwt.claims = :'adm';
select ok((public.admin_organization_detail((select v::uuid from _ids where k = 'o1')) ->> 'business_verified_at') is not null,
  'E15b: the Admin organization detail carries the badge separately from approval');
reset role;
set local role authenticated;
set local request.jwt.claims = :'own';
select is(public.my_business_verification((select v::uuid from _ids where k = 'o1')) ->> 'status', 'verified', 'E16: owner sees Verified');
select throws_ok(format('select public.business_verification_submit(%L)', (select v from _ids where k = 'o1')), '22023', null, 'E17: a verified organization cannot submit again');
select throws_ok(format('select public.business_verification_reject(%L, %L)', (select v from _ids where k = 'v1'), 'x'), '42501', null, 'E18: the owner cannot decide');

select is((select count(*)::int from public.organizations o
             where o.business_verified_at is not null
               and not exists (select 1 from public.verifications v where v.id = o.business_verification_id
                                 and v.verification_type = 'business' and v.status = 'approved')),
  0, 'E19: no organization carries the badge without an approved business verification (no legacy backfill)');

-- F. a second organization: own-organization guard and the delegated approver
set local request.jwt.claims = :'out';
select isnt(public.business_draft_save(p_display_name => 'Office 96', p_legal_name => 'Office 96 LLC', p_org_type => 'design_office'), null, 'F0: a second owner opens a draft');
insert into _ids select 'o2', public.business_draft_submit((select id from public.business_creation_drafts where user_id = '96000004-0000-4000-8000-000000000096' and completed_at is null))::text;
insert into _ids select 'a2', public.organization_application_submit((select v::uuid from _ids where k = 'o2'))::text;
set local request.jwt.claims = :'mod';
select throws_ok(format('select public.review_start(%L)', (select v from _ids where k = 'a2')), '42501', null, 'F1: a Moderator cannot start an application review (approval gate)');
set local request.jwt.claims = :'del';
select throws_ok(format('select public.review_start(%L)', (select v from _ids where k = 'a2')), '42501', null,
  'F2: verification.approve does NOT grant organization activation (the application gate stays Administrator-only)');
set local request.jwt.claims = :'adm';
select lives_ok(format('select public.review_start(%L)', (select v from _ids where k = 'a2')), 'F3a: an Administrator starts the application review');
select lives_ok(format('select public.review_approve(%L, false)', (select v from _ids where k = 'a2')), 'F3: ...and approves (activates) the organization');
reset role;
select is((select (status::text || '/' || is_verified::text || '/' || (business_verified_at is null)::text) from public.organizations where id = (select v::uuid from _ids where k = 'o2')),
  'active/true/true', 'F3b: activation sets is_verified but never the Verified badge');
set local role authenticated;
set local request.jwt.claims = :'out';
insert into _ids select 'k3', public.business_verification_document_request_upload((select v::uuid from _ids where k = 'o2'), 'other', 'image/jpeg', 512, 'office.jpg');
insert into storage.objects (bucket_id, name) values ('business-verification-documents', (select v from _ids where k = 'k3'));
select lives_ok(format('select public.business_verification_document_confirm(%L)', (select v from _ids where k = 'k3')), 'F4: the second owner attaches a document');
insert into _ids select 'v2', public.business_verification_submit((select v::uuid from _ids where k = 'o2'))::text;
reset role;
insert into public.platform_role_grants (user_id, role) values ('96000004-0000-4000-8000-000000000096', 'moderator');
set local role authenticated;
set local request.jwt.claims = :'out';
select throws_ok(format('select public.business_verification_start_review(%L)', (select v from _ids where k = 'v2')), '42501', null, 'F5: a reviewer cannot review their own organization');
set local request.jwt.claims = :'own';
select is((select count(*)::int from storage.objects where bucket_id = 'business-verification-documents' and name = (select v from _ids where k = 'k3')), 0, 'F6: another organization''s owner cannot read this evidence');
set local request.jwt.claims = :'del';
select lives_ok(format('select public.business_verification_reject(%L, %L)', (select v from _ids where k = 'v2'), 'The photo does not show a legal document'), 'F7: the delegated approver rejects with a reason');
set local request.jwt.claims = :'out';
select is(public.my_business_verification((select v::uuid from _ids where k = 'o2')) ->> 'status', 'rejected', 'F8: the owner sees Rejected');
select is((public.my_business_verification((select v::uuid from _ids where k = 'o2')) ->> 'can_submit')::boolean, true, 'F9: ...and may start a new request');
select is(jsonb_array_length(public.my_business_verification((select v::uuid from _ids where k = 'o2')) -> 'requests'), 1, 'F10: the rejected request stays in the history');
reset role;
select is((select business_verified_at from public.organizations where id = (select v::uuid from _ids where k = 'o2')), null, 'F11: rejection grants no badge');

select * from finish();
rollback;
