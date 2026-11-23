-- pgTAP: M3 - organization identity changes, verified co-owners, branch governance
--        (20261015090032 / 90002 / 90003).
--
--   I. a verified organization's name/slug changes only through Admin review
--   C. a co-owner is recognised only through an Admin-verified record
--   B. branches: internal on creation, publicly verified only through review
--   R. registration: Contractor / Engineer stay Coming Soon
--
-- Every call is made as `authenticated` with the caller's own JWT claims.
create extension if not exists pgtap;

begin;
select plan(131);
-- rc2: this fixture activates / approves showrooms directly, bypassing the seller-readiness triggers PR #84 added
-- (showroom_activation_complete / showroom_product_publish_complete). They are disabled for this
-- transaction only (rolled back with it); the readiness rules themselves are asserted in tests 92-94.
alter table public.organizations disable trigger showroom_activation_complete;
alter table public.products disable trigger showroom_product_publish_complete;
alter table public.branches disable trigger showroom_live_address_required;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('78' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000078')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p78-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P78 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 8) n;

grant execute on function app.org_product_audience(uuid) to authenticated;

-- 1 founder of the approved Showroom   2 manager (org.manage + branch.manage), NOT the founder
-- 3 sales manager                      4 outsider            5 plain member
-- 6 founder of a PENDING organization  7 second co-owner candidate   8 verified co-owner candidate's colleague
\set u1 '{"sub":"78000001-0000-4000-8000-000000000078","role":"authenticated"}'
\set u2 '{"sub":"78000002-0000-4000-8000-000000000078","role":"authenticated"}'
\set u3 '{"sub":"78000003-0000-4000-8000-000000000078","role":"authenticated"}'
\set u4 '{"sub":"78000004-0000-4000-8000-000000000078","role":"authenticated"}'
\set u5 '{"sub":"78000005-0000-4000-8000-000000000078","role":"authenticated"}'
\set u6 '{"sub":"78000006-0000-4000-8000-000000000078","role":"authenticated"}'
\set u7 '{"sub":"78000007-0000-4000-8000-000000000078","role":"authenticated"}'
\set adm '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}'

create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated;

-- fixtures: the founder's Showroom is created the real way and approved by an Admin ---------------
select set_config('request.jwt.claims', :'u1', true);
insert into _ids select 'alpha', app.organization_create_owned('Alpha Showroom', 'showroom_dealer', 'en', 'Main');
select set_config('request.jwt.claims', :'u6', true);
insert into _ids select 'pend', app.organization_create_owned('Pending Co', 'supplier', 'en', 'HQ');

insert into public.memberships (user_id, organization_id, status, accepted_at)
select ('78' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000078')::uuid, (select id from _ids where k = 'alpha'), 'active', now()
from generate_series(2, 3) n;
insert into public.memberships (user_id, organization_id, status, accepted_at)
values ('78000005-0000-4000-8000-000000000078', (select id from _ids where k = 'alpha'), 'active', now()),
       ('78000007-0000-4000-8000-000000000078', (select id from _ids where k = 'alpha'), 'active', now());
insert into _ids select 'pbr', b.id from public.branches b where b.organization_id = (select id from _ids where k = 'pend') limit 1;
insert into public.membership_capabilities (membership_id, capability_key)
select m.id, c from public.memberships m,
  unnest(case m.user_id
    when '78000002-0000-4000-8000-000000000078'::uuid then array['org.manage','branch.manage','catalog.read']
    when '78000003-0000-4000-8000-000000000078'::uuid then array['sales.manage','sales.assign','catalog.read']
    when '78000005-0000-4000-8000-000000000078'::uuid then array['catalog.read']
    when '78000007-0000-4000-8000-000000000078'::uuid then array['org.manage','catalog.read'] end) c
where m.organization_id = (select id from _ids where k = 'alpha')
  and m.user_id in ('78000002-0000-4000-8000-000000000078','78000003-0000-4000-8000-000000000078',
                    '78000005-0000-4000-8000-000000000078','78000007-0000-4000-8000-000000000078');

set local role authenticated;
set local request.jwt.claims = :'u1';
insert into _ids select 'appl', public.organization_application_submit((select id from _ids where k = 'alpha'));
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'appl'));
select public.review_approve((select id from _ids where k = 'appl'), false);
reset role;
select is(app.org_product_audience((select id from _ids where k = 'alpha')), 'showroom_dealer', 'F0: the fixture Showroom is approved with its own audience');

-- ===========================================================================
-- I. Organization identity
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'u1';
select throws_ok(format($q$update public.organizations set name = 'Renamed Directly' where id = %L$q$, (select id from _ids where k = 'alpha')),
  '42501', null, 'I1: an approved organization cannot rename itself by a direct update');
select throws_ok(format($q$update public.organizations set slug = 'sneaky' where id = %L$q$, (select id from _ids where k = 'alpha')),
  '42501', null, 'I2: nor change its public address');
select throws_ok(format($q$update public.organizations set org_type = 'supplier' where id = %L$q$, (select id from _ids where k = 'alpha')),
  '42501', null, 'I3: the business type is still immutable');
select throws_ok(format($q$select public.organization_update_i18n(%L, 'اسم جديد', null, null)$q$, (select id from _ids where k = 'alpha')),
  '22023', 'a verified organization name changes only through an identity change request',
  'I4: the profile RPC will not carry a verified name change');
select lives_ok(format($q$select public.organization_update_i18n(%L, null, null, 'Africa/Cairo')$q$, (select id from _ids where k = 'alpha')),
  'I5: ordinary profile fields (timezone) are still editable');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'organization_identity_change_request'
              and pg_get_function_arguments(p.oid) ~ 'org_type'), 0,
  'I6: the identity workflow has no business-type parameter');

set local request.jwt.claims = :'u5';
select throws_ok(format($q$select public.organization_identity_change_request(%L, 'Plain Member Name')$q$, (select id from _ids where k = 'alpha')),
  '42501', null, 'I7: a plain member cannot request a rename');
set local request.jwt.claims = :'u3';
select throws_ok(format($q$select public.organization_identity_change_request(%L, 'Sales Manager Name')$q$, (select id from _ids where k = 'alpha')),
  '42501', null, 'I8: nor a sales manager');
set local request.jwt.claims = :'u4';
select throws_ok(format($q$select public.organization_identity_change_request(%L, 'Outsider Name')$q$, (select id from _ids where k = 'alpha')),
  '42501', null, 'I9: nor an outsider');

set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.organization_identity_change_request(%L)$q$, (select id from _ids where k = 'alpha')),
  '22023', 'nothing to change', 'I10: a request that changes nothing is refused');
select throws_ok(format($q$select public.organization_identity_change_request(%L, null, null, null, 'Bad Slug!')$q$, (select id from _ids where k = 'alpha')),
  '22023', 'invalid public address', 'I11: an invalid public address is refused');
insert into _ids select 'ic1', public.organization_identity_change_request((select id from _ids where k = 'alpha'),
  'Alpha Showroom Group', 'مجموعة ألفا', null, 'alpha-group');
select isnt((select id from _ids where k = 'ic1'), null, 'I12: the owner files an identity change request');
select is((select name from public.organizations where id = (select id from _ids where k = 'alpha')), 'Alpha Showroom',
  'I13: the approved name stays public while the request is pending');
select is((select name_ar from public.organizations where id = (select id from _ids where k = 'alpha')), null,
  'I14: and no proposed value is applied early');
select is(app.org_is_approved((select id from _ids where k = 'alpha')), true, 'I15: the organization stays approved and operational');
select is(app.org_product_audience((select id from _ids where k = 'alpha')), 'showroom_dealer', 'I16: and keeps its audience');
select throws_ok(format($q$select public.organization_identity_change_request(%L, 'Another Name')$q$, (select id from _ids where k = 'alpha')),
  '22023', 'an identity change is already awaiting a decision', 'I17: a second simultaneous request is refused');
select is((select request_status from public.organization_identity_state((select id from _ids where k = 'alpha'))), 'pending_review',
  'I18: the owner sees the request as pending review');
select is((select proposed ->> 'name' from public.organization_identity_state((select id from _ids where k = 'alpha'))),
  'Alpha Showroom Group', 'I19: with its proposed value');

set local request.jwt.claims = :'u2';
select throws_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'ic1')),
  '42501', null, 'I20: a member cannot approve an identity change');

set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.review_start(%L)$q$, (select id from _ids where k = 'ic1')), 'I21: the existing Admin queue claims it');
select lives_ok(format($q$select public.review_reject(%L, 'Name does not match the licence.')$q$, (select id from _ids where k = 'ic1')),
  'I22: and rejects it');
reset role;
select is((select name from public.organizations where id = (select id from _ids where k = 'alpha')), 'Alpha Showroom',
  'I23: a rejection leaves the approved identity unchanged');
select is((select count(*)::int from public.audit_log where action = 'verification.rejected'
            and subject_id = (select id from _ids where k = 'ic1')), 1, 'I24: the rejection is in the audit history');
select is((select reason from public.verifications where id = (select id from _ids where k = 'ic1')),
  'Name does not match the licence.', 'I25: with the reason');

set local role authenticated;
set local request.jwt.claims = :'u1';
select is((select request_status || ':' || reason from public.organization_identity_state((select id from _ids where k = 'alpha'))),
  'rejected:Name does not match the licence.', 'I26: the owner sees the rejection reason');
insert into _ids select 'ic2', public.organization_identity_change_request((select id from _ids where k = 'alpha'),
  'Alpha Showroom Group', 'مجموعة ألفا', null, 'alpha-group');
select isnt((select id from _ids where k = 'ic2'), null, 'I27: after a rejection a new request can be filed');

set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'ic2'));
select public.review_request_changes((select id from _ids where k = 'ic2'), 'Send the licence number.');
set local request.jwt.claims = :'u1';
select is((select request_status from public.organization_identity_state((select id from _ids where k = 'alpha'))), 'needs_changes',
  'I28: needs-changes is reported to the owner');
insert into _ids select 'ic3', public.organization_identity_change_request((select id from _ids where k = 'alpha'),
  'Alpha Showroom Group', 'مجموعة ألفا', null, 'alpha-group');
select is((select count(*)::int from public.verifications where verification_type = 'organization_identity'
            and organization_id = (select id from _ids where k = 'alpha')
            and status in ('submitted', 'under_review', 'needs_more_info')), 1,
  'I29: a corrected request supersedes the old one - only one is ever open');
select lives_ok(format($q$select public.organization_identity_change_withdraw(%L)$q$, (select id from _ids where k = 'alpha')),
  'I30: the owner can withdraw a pending request');
select is((select name from public.organizations where id = (select id from _ids where k = 'alpha')), 'Alpha Showroom',
  'I31: withdrawing changes nothing');
insert into _ids select 'ic4', public.organization_identity_change_request((select id from _ids where k = 'alpha'),
  'Alpha Showroom Group', 'مجموعة ألفا', null, 'alpha-group');

set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'ic4'));
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'ic4')),
  'I32: Admin approval through the existing RPC');
reset role;
select is((select name || '|' || name_ar || '|' || slug from public.organizations where id = (select id from _ids where k = 'alpha')),
  'Alpha Showroom Group|مجموعة ألفا|alpha-group', 'I33: the approved identity is applied atomically by that same approval');
select is((select org_type::text from public.organizations where id = (select id from _ids where k = 'alpha')), 'showroom_dealer',
  'I34: the business type is untouched');
select is((select count(*)::int from public.audit_log where action = 'organization.identity_changed'
            and (metadata -> 'previous' ->> 'name') = 'Alpha Showroom' and (metadata -> 'proposed' ->> 'name') = 'Alpha Showroom Group'), 1,
  'I35: old and new values, reviewer and decision are audited');
select is(app.org_product_audience((select id from _ids where k = 'alpha')), 'showroom_dealer', 'I36: the organization remained operational throughout');

select throws_ok($$ insert into public.verifications (subject_type, organization_id, verification_type, status)
                   values ('organization', (select id from _ids where k = 'alpha'), 'organization_identity', 'submitted'),
                          ('organization', (select id from _ids where k = 'alpha'), 'organization_identity', 'submitted') $$,
  '23505', null, 'I37: the database itself forbids two simultaneous open requests');

set local role authenticated;
set local request.jwt.claims = :'u6';
select lives_ok(format($q$select public.organization_update_i18n(%L, 'اسم قيد المراجعة', 'Draft Name', null)$q$, (select id from _ids where k = 'pend')),
  'I38: an organization that is not yet approved still edits its own names');
select throws_ok(format($q$select public.organization_identity_change_request(%L, 'x2')$q$, (select id from _ids where k = 'pend')),
  '22023', null, 'I39: the review workflow is only for verified organizations');

-- ===========================================================================
-- C. Verified co-owners
-- ===========================================================================
reset role;
select is(app.can_create_or_complete_business('78000002-0000-4000-8000-000000000078'), false,
  'C1: an org.manage member of an approved Showroom is NOT thereby eligible to add a business');
select is(app.application_slot('78000002-0000-4000-8000-000000000078'), 'first_available',
  'C2: and is not treated as owning an approved organization');
select is(app.can_create_or_complete_business('78000001-0000-4000-8000-000000000078'), true,
  'C3: the founder of an approved Showroom is eligible');

set local role authenticated;
set local request.jwt.claims = :'u4';
select throws_ok(format($q$select public.org_co_owner_request(%L, 'x')$q$, (select id from _ids where k = 'alpha')),
  '42501', null, 'C4: an outsider cannot claim co-ownership');
set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.org_co_owner_request(%L)$q$, (select id from _ids where k = 'alpha')),
  '22023', 'the organization founder is already its primary owner', 'C5: the founder is already the primary owner');
set local request.jwt.claims = :'u6';
select throws_ok(format($q$select public.org_co_owner_request(%L)$q$, (select id from _ids where k = 'pend')),
  '22023', 'only an approved organization can verify a co-owner', 'C6: a pending organization establishes nothing');

set local request.jwt.claims = :'u3';
insert into _ids select 'co_sales', public.org_co_owner_request((select id from _ids where k = 'alpha'), 'I am a partner');
select is((select relationship from public.my_co_owner_state() where organization_id = (select id from _ids where k = 'alpha')), 'member',
  'C7: filing a claim does not make a sales manager a co-owner');
select throws_ok(format($q$insert into public.org_co_owners (organization_id, user_id, verification_id) values (%L, %L, %L)$q$,
  (select id from _ids where k = 'alpha'), '78000003-0000-4000-8000-000000000078', (select id from _ids where k = 'co_sales')),
  '42501', null, 'C8: a member cannot write the co-owner record themselves');
select throws_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'co_sales')),
  '42501', null, 'C9: nor approve their own claim');

set local request.jwt.claims = :'u2';
insert into _ids select 'co_mgr', public.org_co_owner_request((select id from _ids where k = 'alpha'), 'Partner since 2019');
select throws_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'co_mgr')),
  '42501', null, 'C10: a manager cannot approve a colleague either');
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'co_sales'));
select lives_ok(format($q$select public.review_reject(%L, 'No evidence of partnership.')$q$, (select id from _ids where k = 'co_sales')),
  'C11: Admin rejects the sales manager''s claim');
select public.review_start((select id from _ids where k = 'co_mgr'));
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'co_mgr')),
  'C12: Admin verifies the genuine co-owner');
reset role;
select is((select count(*)::int from public.org_co_owners where user_id = '78000003-0000-4000-8000-000000000078'), 0,
  'C13: a rejected claim creates no co-owner record');
select is(app.is_verified_co_owner('78000002-0000-4000-8000-000000000078', (select id from _ids where k = 'alpha')), true,
  'C14: the verified co-owner is recognised');
select is((select count(*)::int from public.audit_log where action = 'organization.co_owner_verified'), 1, 'C15: the verification is audited');
select is(app.can_create_or_complete_business('78000002-0000-4000-8000-000000000078'), true,
  'C16: the verified co-owner is eligible to apply for their own organization');
select is(app.application_slot('78000002-0000-4000-8000-000000000078'), 'additional_available',
  'C17: through the additional-application slot');
select is(app.can_create_or_complete_business('78000003-0000-4000-8000-000000000078'), false,
  'C18: the sales manager is still not eligible');

set local role authenticated;
set local request.jwt.claims = :'u2';
select isnt(public.business_draft_save(p_legal_name => 'Bravo Showroom LLC', p_display_name => 'Bravo Showroom', p_org_type => 'showroom_dealer'), null,
  'C19: the verified co-owner opens their own application');
insert into _ids select 'bravo', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '78000002-0000-4000-8000-000000000078' and completed_at is null));
select is((select status::text from public.organizations where id = (select id from _ids where k = 'bravo')), 'pending_verification',
  'C20: the new organization is NOT approved');
select is(app.org_product_audience((select id from _ids where k = 'bravo')), null, 'C21: and has no business audience or capabilities');
select is((select created_by from public.organizations where id = (select id from _ids where k = 'bravo')),
  '78000002-0000-4000-8000-000000000078'::uuid, 'C22: it belongs to the co-owner, not to the founder');
select throws_ok($$ select public.business_draft_save(p_legal_name => 'Charlie LLC', p_display_name => 'Charlie', p_org_type => 'supplier') $$,
  '42501', 'an organization application is not available right now', 'C23: the one-open-application limit still applies to co-owners');
select is(public.my_organization_application_slot(), 'additional_pending', 'C24: the slot reads additional_pending');

set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.org_co_owner_revoke(%L, %L, 'x')$q$, (select id from _ids where k = 'alpha'), '78000002-0000-4000-8000-000000000078'),
  '42501', null, 'C25: the founder cannot revoke a verified co-owner either - Admin only');
set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.org_co_owner_revoke(%L, %L, 'Partnership ended')$q$, (select id from _ids where k = 'alpha'), '78000002-0000-4000-8000-000000000078'),
  'C26: an Admin revokes the verified co-owner');
reset role;
select is(app.is_verified_co_owner('78000002-0000-4000-8000-000000000078', (select id from _ids where k = 'alpha')), false,
  'C27: a revoked relationship is no longer an eligibility basis');
select is(app.can_create_or_complete_business('78000002-0000-4000-8000-000000000078'), false,
  'C28: the revoked co-owner can no longer start a future application on that basis');
select is((select status::text from public.organizations where id = (select id from _ids where k = 'bravo')), 'pending_verification',
  'C29: revocation does not delete or alter the historical application');
select is((select status from public.org_co_owners where user_id = '78000002-0000-4000-8000-000000000078'), 'revoked',
  'C30: the record is kept as history');
select is(app.application_slot('78000002-0000-4000-8000-000000000078'), 'first_pending',
  'C31: the slot no longer counts the revoked organization as an approved base');

-- ===========================================================================
-- B. Branches
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'u1';
insert into _ids select 'br1', public.branch_create((select id from _ids where k = 'alpha'), 'Alexandria', null, 'Alexandria Branch', null, '12 Corniche', null, 'Africa/Cairo');
select isnt((select id from _ids where k = 'br1'), null, 'B1: an owner creates an internal branch under the approved organization');
set local request.jwt.claims = :'u3';
select throws_ok(format($q$select public.branch_create(%L, 'Sales Branch')$q$, (select id from _ids where k = 'alpha')),
  '42501', null, 'B2: a sales manager without branch.manage cannot');
set local request.jwt.claims = :'u5';
select throws_ok(format($q$select public.branch_create(%L, 'Plain Branch')$q$, (select id from _ids where k = 'alpha')),
  '42501', null, 'B3: nor a plain member');
set local request.jwt.claims = :'u4';
select throws_ok(format($q$select public.branch_create(%L, 'Outsider Branch')$q$, (select id from _ids where k = 'alpha')),
  '42501', null, 'B4: nor an outsider - a branch cannot be attached to another tenant');
set local request.jwt.claims = :'u6';
select throws_ok(format($q$select public.branch_create(%L, 'Pending Branch')$q$, (select id from _ids where k = 'pend')),
  '22023', 'an organization must be approved before it can add branches', 'B5: a pending organization cannot create branches');
set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.branch_create(%L, 'alexandria')$q$, (select id from _ids where k = 'alpha')),
  '23505', null, 'B6: a duplicate branch name is refused');
select throws_ok($$ insert into public.branches (organization_id, name) values ((select id from _ids where k = 'alpha'), 'Direct') $$,
  '42501', null, 'B7: branches cannot be inserted directly by a client');
select throws_ok(format($q$update public.branches set public_identity = '{"name":"fake"}'::jsonb, verified_at = now() where id = %L$q$, (select id from _ids where k = 'br1')),
  '42501', null, 'B8: a client cannot mark a branch verified');
reset role;
select is((select count(*)::int from public.organizations where org_type is not null and created_by = '78000001-0000-4000-8000-000000000078'), 1,
  'B9: branch creation did not create another organization');
select is(app.org_product_audience((select id from _ids where k = 'alpha')), 'showroom_dealer',
  'B10: the Showroom keeps exactly the Showroom audience regardless of its branches');
select is((select count(*)::int from public.audit_log where action = 'branch.created' and organization_id = (select id from _ids where k = 'alpha')), 2,
  'B11: creation is audited (the founding branch and the new one)');

set local role authenticated;
set local request.jwt.claims = :'u1';
select is((select count(*)::int from public.showroom_branches((select id from _ids where k = 'alpha')) where id = (select id from _ids where k = 'br1')),
  0, 'B12: a new (internal) branch is not in the public listing at all');
select is((select review_status from public.my_branches((select id from _ids where k = 'alpha')) where id = (select id from _ids where k = 'br1')),
  'none', 'B13: it is internal until verification is requested');
set local request.jwt.claims = :'u3';
select throws_ok(format($q$select public.branch_verification_request(%L)$q$, (select id from _ids where k = 'br1')),
  '42501', null, 'B14: a sales manager cannot request verification');
set local request.jwt.claims = :'u6';
select throws_ok(format($q$select public.branch_verification_request(%L)$q$, (select id from _ids where k = 'br1')),
  '22023', 'branch not found', 'B15: another tenant cannot use this branch id');
select throws_ok(format($q$select public.branch_update_i18n(%L, null, 'Hijack', null, null, null)$q$, (select id from _ids where k = 'br1')),
  '22023', 'branch not found', 'B16: nor edit it');
set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.branch_assign((select id from public.memberships where user_id = '78000005-0000-4000-8000-000000000078' limit 1), %L)$q$,
  (select id from _ids where k = 'pbr')),
  '42501', null, 'B17: staff cannot be assigned to another tenant''s branch');

insert into _ids select 'brv1', public.branch_verification_request((select id from _ids where k = 'br1'));
select is((select review_status from public.my_branches((select id from _ids where k = 'alpha')) where id = (select id from _ids where k = 'br1')),
  'pending_review', 'B18: the owner tracks the request as pending');
select is((select count(*)::int from public.showroom_branches((select id from _ids where k = 'alpha')) where id = (select id from _ids where k = 'br1')),
  0, 'B19: a pending request is still not in the public listing');
select throws_ok(format($q$select public.branch_verification_request(%L)$q$, (select id from _ids where k = 'br1')),
  '22023', 'a verification for this branch is already awaiting a decision', 'B20: a second simultaneous request is refused');

set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'brv1'));
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'brv1')), 'B21: Admin approves through the existing RPC');
set local request.jwt.claims = :'u1';
select is((select count(*)::int from public.showroom_branches((select id from _ids where k = 'alpha')) where id = (select id from _ids where k = 'br1')),
  1, 'B22: once approved the branch is in the public listing');
reset role;
select is((select count(*)::int from public.audit_log where action = 'branch.verified' and subject_id = (select id from _ids where k = 'br1')), 1,
  'B23: with its reviewer in the audit trail');
set local role authenticated;
set local request.jwt.claims = :'u1';

-- an amendment never reaches the public view until reviewed
select public.branch_update_i18n((select id from _ids where k = 'br1'), null, 'Alexandria Flagship', null, '99 New Road', null);
select is((select has_unreviewed_changes from public.my_branches((select id from _ids where k = 'alpha')) where id = (select id from _ids where k = 'br1')),
  true, 'B24: an edit to a verified branch is flagged as unreviewed');
select is((select name from public.showroom_branches((select id from _ids where k = 'alpha')) where id = (select id from _ids where k = 'br1')),
  'Alexandria', 'B25: the last approved public name stays visible');
insert into _ids select 'brv2', public.branch_verification_request((select id from _ids where k = 'br1'));
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'brv2'));
select public.review_reject((select id from _ids where k = 'brv2'), 'Address could not be confirmed.');
set local request.jwt.claims = :'u1';
select is((select review_status || ':' || review_reason from public.my_branches((select id from _ids where k = 'alpha')) where id = (select id from _ids where k = 'br1')),
  'rejected:Address could not be confirmed.', 'B26: a rejected amendment is reported with its reason');
select is((select (public_identity ->> 'address_en') from public.branches where id = (select id from _ids where k = 'br1')), '12 Corniche',
  'B27: and the approved public record is preserved');
select is((select count(*)::int from public.showroom_branches((select id from _ids where k = 'alpha')) where id = (select id from _ids where k = 'br1')),
  1, 'B28: the branch stays listed on its approved values');

insert into _ids select 'brv3', public.branch_verification_request((select id from _ids where k = 'br1'));
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'brv3'));
select public.review_approve((select id from _ids where k = 'brv3'), false);
set local request.jwt.claims = :'u1';
select is((select (public_identity ->> 'address_en') from public.branches where id = (select id from _ids where k = 'br1')), '99 New Road',
  'B29: an approved amendment replaces the public values');
reset role;
select is((select count(*)::int from public.audit_log where action = 'branch.verified' and subject_id = (select id from _ids where k = 'br1')
            and (metadata -> 'previous' ->> 'address_en') = '12 Corniche'), 1, 'B30: the previous approved values are kept in the audit trail');
set local role authenticated;
set local request.jwt.claims = :'u1';

select lives_ok(format($q$select public.branch_set_active(%L, false)$q$, (select id from _ids where k = 'br1')),
  'B31: a branch can be deactivated when another stays active');
select is((select count(*)::int from public.showroom_branches((select id from _ids where k = 'alpha')) where id = (select id from _ids where k = 'br1')), 0,
  'B32: a deactivated branch leaves the public view');
select throws_ok(format($q$select public.branch_set_active((select id from public.branches where organization_id = %L and is_active limit 1), false)$q$, (select id from _ids where k = 'alpha')),
  '22023', 'an organization keeps at least one active branch', 'B33: the last active branch cannot be deactivated');

set local request.jwt.claims = :'u6';
select is((select count(*)::int from public.showroom_branches((select id from _ids where k = 'pend'))), 0,
  'B34: a pending organization''s branches are not publicly listed');
select throws_ok(format($q$select public.branch_verification_request((select id from public.branches where organization_id = %L limit 1))$q$, (select id from _ids where k = 'pend')),
  '22023', 'an organization must be approved before its branches can be verified', 'B35: nor can they be put forward for verification');

-- ===========================================================================
-- D. M3 corrections: private until verified, no arbitrary limit, co-ownership across types
-- ===========================================================================
-- the public listing as someone OUTSIDE the organization sees it
set local role authenticated;
set local request.jwt.claims = :'u4';
select is((select count(*)::int from public.showroom_branches((select id from _ids where k = 'alpha'))), 0,
  'D1: an outsider sees no branch of this Showroom (the verified one was deactivated; the rest are internal)');
set local request.jwt.claims = :'u1';
select lives_ok(format($q$select public.branch_set_active(%L, true)$q$, (select id from _ids where k = 'br1')), 'D2: the verified branch is reactivated');
set local request.jwt.claims = :'u4';
select is((select count(*)::int from public.showroom_branches((select id from _ids where k = 'alpha'))), 1,
  'D3: an outsider sees ONLY the approved branch, not the founding branch or any internal one');
select is((select name from public.showroom_branches((select id from _ids where k = 'alpha')) limit 1), 'Alexandria'::text,
  'D4: with the approved snapshot name');
-- an internal branch edit never reaches the listing
set local request.jwt.claims = :'u1';
select public.branch_update_i18n((select id from _ids where k = 'br1'), null, 'Totally New', null, '1 Secret St', null);
set local request.jwt.claims = :'u4';
select is((select count(*)::int from public.showroom_branches((select id from _ids where k = 'alpha'))), 1,
  'D5: pending/unreviewed edits add nothing and the listing is unchanged');

-- revocation
set local request.jwt.claims = :'u1';
select throws_ok(format($q$select public.branch_verification_revoke(%L, 'x')$q$, (select id from _ids where k = 'br1')),
  '42501', null, 'D6: an organization cannot revoke its own verification state');
set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.branch_verification_revoke(%L, 'Closed down')$q$, (select id from _ids where k = 'br1')),
  'D7: a platform administrator revokes a public verification');
set local request.jwt.claims = :'u4';
select is((select count(*)::int from public.showroom_branches((select id from _ids where k = 'alpha'))), 0,
  'D8: a revoked branch leaves every public listing');
reset role;
select is((select count(*)::int from public.verifications where verification_type = 'branch_location'
            and metadata ->> 'branch_id' = (select id::text from _ids where k = 'br1') and status = 'approved'), 2,
  'D9: the historical approvals are preserved');
select is((select count(*)::int from public.audit_log where action = 'branch.verification_revoked'), 1, 'D10: the revocation is audited');

-- no arbitrary branch limit
set local role authenticated;
set local request.jwt.claims = :'u1';
select is((select count(*)::int from (select public.branch_create((select id from _ids where k = 'alpha'), 'Bulk ' || g) from generate_series(1, 105) g) x),
  105, 'D11: no hard-coded branch limit is imposed (105 branches created)');

-- co-ownership of an Engineering Office makes the person eligible to APPLY - and nothing else
reset role;
select set_config('request.jwt.claims', '{"sub":"78000008-0000-4000-8000-000000000078","role":"authenticated"}', true);
insert into _ids select 'beta', app.organization_create_owned('Beta Engineering Office', 'design_office', 'en', 'HQ');
set local role authenticated;
set local request.jwt.claims = '{"sub":"78000008-0000-4000-8000-000000000078","role":"authenticated"}';
insert into _ids select 'beta_appl', public.organization_application_submit((select id from _ids where k = 'beta'));
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'beta_appl'));
select public.review_approve((select id from _ids where k = 'beta_appl'), false);
reset role;
insert into public.memberships (user_id, organization_id, status, accepted_at)
values ('78000004-0000-4000-8000-000000000078', (select id from _ids where k = 'beta'), 'active', now()),
       ('78000005-0000-4000-8000-000000000078', (select id from _ids where k = 'beta'), 'active', now());
insert into public.membership_capabilities (membership_id, capability_key)
select m.id, 'org.manage' from public.memberships m where m.organization_id = (select id from _ids where k = 'beta')
  and m.user_id in ('78000004-0000-4000-8000-000000000078', '78000005-0000-4000-8000-000000000078');
select is(app.can_create_or_complete_business('78000004-0000-4000-8000-000000000078'), false,
  'D12: an unverified org.manage member of an Engineering Office is not eligible');
set local role authenticated;
set local request.jwt.claims = :'u4';
insert into _ids select 'co_beta', public.org_co_owner_request((select id from _ids where k = 'beta'), 'Partner');
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'co_beta'));
select public.review_approve((select id from _ids where k = 'co_beta'), false);
reset role;
select is(app.can_create_or_complete_business('78000004-0000-4000-8000-000000000078'), true,
  'D13: a VERIFIED co-owner of an Engineering Office is eligible to apply');
select is(app.can_create_or_complete_business('78000005-0000-4000-8000-000000000078'), false,
  'D14: their unverified colleague with the same capability is not');
set local role authenticated;
set local request.jwt.claims = :'u4';
select throws_ok($$ select public.business_draft_save(p_legal_name => 'Sneaky Contracting LLC', p_display_name => 'Sneaky Contracting', p_org_type => 'contractor_company') $$,
  '42501', 'this organization type cannot be self-assigned', 'D15: eligibility does not unlock a Contractor Organization');
select isnt(public.business_draft_save(p_legal_name => 'Gamma Showroom LLC', p_display_name => 'Gamma Showroom', p_org_type => 'showroom_dealer'), null,
  'D16: it does let them apply for an organization type they may request');
insert into _ids select 'gamma', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '78000004-0000-4000-8000-000000000078' and completed_at is null));
select is(app.org_product_audience((select id from _ids where k = 'gamma')), null, 'D17: the new organization is pending with no audience');
select is((select primary_account_type::text from public.users where id = '78000004-0000-4000-8000-000000000078') is distinct from 'engineer', true,
  'D18: co-ownership did not grant the Engineer persona');
reset role;
update public.memberships set status = 'suspended' where user_id = '78000004-0000-4000-8000-000000000078' and organization_id = (select id from _ids where k = 'beta');
select is(app.can_create_or_complete_business('78000004-0000-4000-8000-000000000078'), false,
  'D19: with the membership inactive the co-owner is not eligible');
select is(app.application_slot('78000004-0000-4000-8000-000000000078'), 'first_pending',
  'D20: and the co-ownership is no longer an approved base for the slot');
update public.memberships set status = 'active' where user_id = '78000004-0000-4000-8000-000000000078' and organization_id = (select id from _ids where k = 'beta');
select is(app.application_slot('78000004-0000-4000-8000-000000000078'), 'additional_pending', 'D21: a restored membership restores it');
set local role authenticated;
set local request.jwt.claims = :'adm';
select public.org_co_owner_revoke((select id from _ids where k = 'beta'), '78000004-0000-4000-8000-000000000078', 'ended');
reset role;
select is(app.application_slot('78000004-0000-4000-8000-000000000078'), 'first_pending',
  'D22: a revoked co-ownership is no longer an eligibility basis');
select is(app.can_create_or_complete_business('78000004-0000-4000-8000-000000000078'), false,
  'D23: and cannot start a future application');

-- ===========================================================================
-- R. Registration
-- ===========================================================================
reset role;
select ok(app.coming_soon_account_types() @> array['contractor', 'engineer']::text[],
  'R1: Contractor and Engineer registration stays Coming Soon');
select ok(not (app.coming_soon_account_types() @> array['showroom_dealer']::text[]),
  'R2: other account types are not blocked');

select * from finish();
rollback;
