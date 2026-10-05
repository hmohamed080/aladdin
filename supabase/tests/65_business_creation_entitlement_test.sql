-- pgTAP: business creation is entitled AT THE DATABASE BOUNDARY
-- (20260928090001_business_creation_entitlement.sql).
--
-- Every assertion here calls the public RPCs DIRECTLY, as `authenticated`, with the
-- caller's own JWT claims — exactly what a signed-in user can do with their access
-- token, bypassing the Next.js page and server actions entirely.
--
-- ALLOWED: an open draft; first-business registration (business track + approved
--          type, no persona); an Engineer; the active owner of an approved type.
-- DENIED : installer_technician, sales, personal/end_consumer, contractor, a bare
--          member or manager, a revoked/suspended membership, a persona-holder who
--          spoofs the business registration intent.
-- ALSO   : an already-created draft stays idempotent and never makes a second org.
create extension if not exists pgtap;

begin;
select plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures (all verified). Persona is set directly as the postgres owner role.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('65' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000065')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p65-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P65 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 16) n;

-- 1 installer, 2 sales, 3 personal, 4 contractor, 5 engineer
update public.users set primary_account_type = 'installer_technician' where id = '65000001-0000-4000-8000-000000000065';
update public.users set primary_account_type = 'sales'                where id = '65000002-0000-4000-8000-000000000065';
update public.users set primary_account_type = 'end_consumer'         where id = '65000003-0000-4000-8000-000000000065';
update public.users set primary_account_type = 'contractor'           where id = '65000004-0000-4000-8000-000000000065';
update public.users set primary_account_type = 'engineer'             where id = '65000005-0000-4000-8000-000000000065';

-- An organization of an approved type, with: 6 = active OWNER, 7 = active MANAGER,
-- 8 = active plain MEMBER, 9 = REVOKED owner, 10 = SUSPENDED owner.
insert into public.organizations (id, name, org_type, status, created_by)
values ('65aaaaaa-0000-4000-8000-000000000065', 'P65 Showroom', 'showroom_dealer', 'active',
        '65000006-0000-4000-8000-000000000065');

insert into public.memberships (id, user_id, organization_id, status)
values
  ('65e00006-0000-4000-8000-000000000065', '65000006-0000-4000-8000-000000000065', '65aaaaaa-0000-4000-8000-000000000065', 'active'),
  ('65e00007-0000-4000-8000-000000000065', '65000007-0000-4000-8000-000000000065', '65aaaaaa-0000-4000-8000-000000000065', 'active'),
  ('65e00008-0000-4000-8000-000000000065', '65000008-0000-4000-8000-000000000065', '65aaaaaa-0000-4000-8000-000000000065', 'active'),
  ('65e00009-0000-4000-8000-000000000065', '65000009-0000-4000-8000-000000000065', '65aaaaaa-0000-4000-8000-000000000065', 'revoked'),
  ('65e00010-0000-4000-8000-000000000065', '65000010-0000-4000-8000-000000000065', '65aaaaaa-0000-4000-8000-000000000065', 'suspended');

insert into public.membership_capabilities (membership_id, capability_key)
values
  ('65e00006-0000-4000-8000-000000000065', 'org.manage'),
  ('65e00007-0000-4000-8000-000000000065', 'org.members.manage'),
  ('65e00009-0000-4000-8000-000000000065', 'org.manage'),
  ('65e00010-0000-4000-8000-000000000065', 'org.manage');

-- 11 first-business registrant: business track + approved type, NO persona.
-- 12 generic owner/manager registrant: business track, NO concrete type.
-- 13 contractor persona that has an OPEN draft already.
-- 14 installer who spoofs the registration intent through the public RPC.
-- 15 a user with no persona and no intent at all.
-- 16 an engineer used for the idempotent-retry check.
insert into public.onboarding_progress (user_id, selected_track, selected_org_type, account_type_completed_at, completed_at)
values
  ('65000011-0000-4000-8000-000000000065', 'business', 'supplier', now(), now()),
  ('65000012-0000-4000-8000-000000000065', 'business', null,       now(), now());
update public.users set primary_account_type = 'contractor' where id = '65000013-0000-4000-8000-000000000065';
insert into public.business_creation_drafts (id, user_id, display_name, org_type)
values ('65d00013-0000-4000-8000-000000000065', '65000013-0000-4000-8000-000000000065', 'P65 Open Draft', 'supplier');
update public.users set primary_account_type = 'installer_technician' where id = '65000014-0000-4000-8000-000000000065';
update public.users set primary_account_type = 'engineer'             where id = '65000016-0000-4000-8000-000000000065';

-- ---------------------------------------------------------------------------
-- The helper itself is internal: clients cannot call it.
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'app.can_create_or_complete_business(uuid)', 'execute'),
  'the entitlement helper is not callable by clients');
select ok(
  has_function_privilege('authenticated', 'public.business_draft_save(uuid,text,text,public.organization_type,text,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.business_draft_submit(uuid)', 'execute'),
  'the RPCs stay callable by authenticated — the authority is inside them');

-- The helper as the owner role: strict true/false, never NULL.
select is(app.can_create_or_complete_business('65000015-0000-4000-8000-000000000065'), false,
  'no persona, no intent, no membership: a strict false (never NULL)');
select is(app.can_create_or_complete_business('65000012-0000-4000-8000-000000000065'), false,
  'the generic owner/manager choice (no concrete type) is not an entitlement');

set local role authenticated;

-- ===========================================================================
-- DENIED — direct RPC, as each caller
-- ===========================================================================
set local request.jwt.claims = '{"sub":"65000001-0000-4000-8000-000000000065","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '1. installer: business_draft_save is denied');
select throws_ok($$ select public.business_draft_submit(null) $$,
  '42501', null, '2. installer: business_draft_submit is denied');
select throws_ok($$ select public.business_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '2b. installer: the business_save wrapper is denied too');
select throws_ok($$ select public.business_submit() $$,
  '42501', null, '2c. installer: the business_submit wrapper is denied too');

set local request.jwt.claims = '{"sub":"65000002-0000-4000-8000-000000000065","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'showroom_dealer') $$,
  '42501', null, '3. sales: business_draft_save is denied');
select throws_ok($$ select public.business_draft_submit(null) $$,
  '42501', null, '3b. sales: business_draft_submit is denied');

set local request.jwt.claims = '{"sub":"65000003-0000-4000-8000-000000000065","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '4. personal / end_consumer: business_draft_save is denied');
select throws_ok($$ select public.business_draft_submit(null) $$,
  '42501', null, '4b. personal / end_consumer: business_draft_submit is denied');

set local request.jwt.claims = '{"sub":"65000004-0000-4000-8000-000000000065","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'importer') $$,
  '42501', null, '4c. contractor: business_draft_save is denied');
select throws_ok($$ select public.business_draft_submit(null) $$,
  '42501', null, '4d. contractor: business_draft_submit is denied');

-- 5. membership alone never grants creation.
set local request.jwt.claims = '{"sub":"65000007-0000-4000-8000-000000000065","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '5. an active MANAGER cannot create a new business');
set local request.jwt.claims = '{"sub":"65000008-0000-4000-8000-000000000065","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '5b. an active plain MEMBER cannot create a new business');

-- 11. a revoked / suspended membership grants nothing, even one that held org.manage.
set local request.jwt.claims = '{"sub":"65000009-0000-4000-8000-000000000065","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '11. a REVOKED owner membership grants no creation authority');
set local request.jwt.claims = '{"sub":"65000010-0000-4000-8000-000000000065","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '11b. a SUSPENDED owner membership grants no creation authority');

-- The generic choice carries no approved type; and intent cannot be spoken into
-- existence by a persona-holder through the public onboarding RPC.
set local request.jwt.claims = '{"sub":"65000012-0000-4000-8000-000000000065","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '12. the generic owner/manager choice (no concrete type) cannot open a draft');

set local request.jwt.claims = '{"sub":"65000014-0000-4000-8000-000000000065","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('business', 'supplier') $$,
  '14. (precondition) an installer can still write the registration intent through the public RPC');
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '14b. ...but a persona-holder cannot use that spoofed intent to open a business draft');

set local request.jwt.claims = '{"sub":"65000015-0000-4000-8000-000000000065","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '15. no persona, no intent, no organization: denied');

-- ===========================================================================
-- ALLOWED
-- ===========================================================================
-- 6. Engineer.
set local request.jwt.claims = '{"sub":"65000005-0000-4000-8000-000000000065","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'P65 Engineer Co', p_org_type => 'showroom_dealer') $$,
  '6. an Engineer may open a business draft');

-- 7. Active owner of an approved business type.
set local request.jwt.claims = '{"sub":"65000006-0000-4000-8000-000000000065","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'P65 Second Business', p_org_type => 'importer') $$,
  '7. the active owner of an approved business type may add another');

-- 8. First-business registration: business track + approved type + no org yet.
set local request.jwt.claims = '{"sub":"65000011-0000-4000-8000-000000000065","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'P65 First Business', p_org_type => 'supplier', p_primary_branch_name => 'HQ') $$,
  '8. first-business registration may open its draft');
select lives_ok($$ select public.business_draft_submit(null) $$,
  '8b. ...and create its first organization');
select is(
  (select count(*)::int from public.organizations where created_by = '65000011-0000-4000-8000-000000000065'),
  1, '8c. exactly one organization exists for the first-business registrant');

-- 9. An existing OPEN draft can be finished, whatever the persona.
set local request.jwt.claims = '{"sub":"65000013-0000-4000-8000-000000000065","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_draft_id => '65d00013-0000-4000-8000-000000000065', p_display_name => 'P65 Open Draft', p_org_type => 'supplier') $$,
  '9. an existing OPEN draft may still be updated');
select lives_ok($$ select public.business_draft_submit('65d00013-0000-4000-8000-000000000065') $$,
  '9b. ...and finished');

-- 10. A completed draft retried is idempotent and creates no second organization —
-- even after the caller has since lost their entitlement.
set local request.jwt.claims = '{"sub":"65000016-0000-4000-8000-000000000065","role":"authenticated"}';
select set_config('test.d16', public.business_draft_save(p_display_name => 'P65 Retry Co', p_org_type => 'manufacturer')::text, true);
select set_config('test.o16', public.business_draft_submit(current_setting('test.d16')::uuid)::text, true);
reset role;
update public.users set primary_account_type = 'end_consumer' where id = '65000016-0000-4000-8000-000000000065';
set local role authenticated;
set local request.jwt.claims = '{"sub":"65000016-0000-4000-8000-000000000065","role":"authenticated"}';
select is(public.business_draft_submit(current_setting('test.d16')::uuid)::text, current_setting('test.o16'),
  '10. retrying a completed draft returns the SAME organization (idempotent, even after losing the entitlement)');
select is(public.business_draft_submit(null)::text, current_setting('test.o16'),
  '10b. the no-argument retry also returns the same organization');
reset role;
select is((select count(*)::int from public.organizations where created_by = '65000016-0000-4000-8000-000000000065'),
  1, '10c. no accidental second organization was created');

select * from finish();
rollback;
