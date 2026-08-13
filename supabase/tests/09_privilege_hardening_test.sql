-- pgTAP: privilege & identity hardening (Sprint 1.1 review B2/B3/B4/H1/H2/H3 + bootstrap).
-- Adversarial coverage that account type never confers platform authority, that a
-- client cannot self-verify an org or gain branch access from a descriptive field,
-- that security-definer helpers are not PUBLIC-executable, that audit metadata is
-- bounded, and that the profile bootstrap ignores hostile auth metadata.
create extension if not exists pgtap;

begin;
select plan(21);

-- ---- B2: no self-verification / trust forgery on org insert --------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ insert into public.organizations (name, org_type, created_by, is_verified)
     values ('Forged Co', 'supplier', '44444444-4444-4444-8444-444444444444', true) $$,
  '42501', null,
  'a client cannot set is_verified on insert (column not granted)');
-- id/status/is_verified are NOT in the client insert grant, so the client omits
-- them and they take their safe defaults (server-generated id, draft, unverified).
select lives_ok(
  $$ insert into public.organizations (name, org_type, created_by)
     values ('Legit Co', 'supplier', '44444444-4444-4444-8444-444444444444') $$,
  'a client can create an org with only the granted columns');
reset role;
select is(
  (select status::text from public.organizations
     where created_by = '44444444-4444-4444-8444-444444444444' and name = 'Legit Co'),
  'draft', 'a client-created org defaults to draft status');
select is(
  (select is_verified from public.organizations
     where created_by = '44444444-4444-4444-8444-444444444444' and name = 'Legit Co'),
  false, 'a client-created org defaults to unverified');

-- ---- B4: account type is not platform authority --------------------------
select throws_ok($$ select 'administrator'::public.persona_type $$, '22P02', null,
  'administrator is no longer a valid account_type (removed to end dual-authority)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(app.is_platform('administrator'), false,
  'an end-consumer holds no platform authority');
reset role;
update public.users set primary_account_type = 'sales'
  where id = '44444444-4444-4444-8444-444444444444';
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(app.is_platform('administrator'), false,
  'changing primary_account_type grants no platform authority');

-- ---- H1: security-definer helpers are not PUBLIC-executable ---------------
set local role anon;
set local request.jwt.claims = '';
select throws_ok($$ select app.is_platform('administrator'::public.platform_role) $$, '42501', null,
  'anon cannot execute app.is_platform (PUBLIC execute revoked)');
select throws_ok($$ select app.has_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'org.manage') $$,
  '42501', null, 'anon cannot execute app.has_capability');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$ select app.is_platform('administrator'::public.platform_role) $$,
  'authenticated may execute the tenancy helpers');

-- ---- B3: primary_branch_id grants NO branch access -----------------------
-- Remove the Cairo staff's explicit assignment; only the descriptive
-- primary_branch_id remains, and it must grant nothing.
reset role;
delete from public.membership_branch_access
  where membership_id = 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from app.current_branch_ids('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as b),
  0, 'primary_branch_id alone yields no branch authority');
select is((select count(*)::int from public.branches), 0,
  'a member with only a descriptive primary branch sees no branches');

-- ---- H2: audit metadata / subject_type are bounded -----------------------
reset role;
select throws_ok(
  $$ insert into public.audit_log (action, subject_type, metadata)
     values ('organization.created', 'organization', '[]'::jsonb) $$,
  '23514', null, 'audit metadata must be a JSON object (arrays rejected)');
select throws_ok(
  $$ insert into public.audit_log (action, subject_type, metadata)
     values ('organization.created', 'organization',
             jsonb_build_object('blob', repeat('a', 9000))) $$,
  '23514', null, 'oversized audit metadata is rejected');
select throws_ok(
  $$ insert into public.audit_log (action, subject_type)
     values ('organization.created', repeat('x', 65)) $$,
  '23514', null, 'an over-long subject_type is rejected');

-- ---- Profile bootstrap ignores hostile auth metadata ---------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('7a000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'attacker@example.test',
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object(
          'display_name', repeat('Z', 200),
          'locale', 'zz',
          'primary_account_type', 'engineer',
          'status', 'active',
          'is_verified', true,
          'role', 'administrator'
        ), now(), now(), now());
-- The bootstrap never records a persona at all (Sprint 12: the column has no
-- default), so an injected one is not merely overridden — there is nothing to
-- override. A persona exists only when the person explicitly claims one.
select is((select primary_account_type::text from public.users where id = '7a000000-0000-4000-8000-00000000000a'),
  null, 'bootstrap ignores injected primary_account_type (and records none)');
select is((select is_verified from public.users where id = '7a000000-0000-4000-8000-00000000000a'),
  false, 'bootstrap ignores injected is_verified');
select is((select locale from public.users where id = '7a000000-0000-4000-8000-00000000000a'),
  'en', 'bootstrap rejects an invalid injected locale');
select is((select char_length(display_name) from public.profiles where user_id = '7a000000-0000-4000-8000-00000000000a'),
  80, 'bootstrap truncates an over-long display name to the column limit');
select is((select count(*)::int from public.platform_role_grants where user_id = '7a000000-0000-4000-8000-00000000000a'),
  0, 'bootstrap never creates a platform-role grant from metadata');

-- ---- H3: slug must be normalized/url-safe --------------------------------
select throws_ok(
  $$ insert into public.organizations (name, org_type, slug, created_by)
     values ('Slug Co', 'supplier', 'Bad Slug!', '11111111-1111-4111-8111-111111111111') $$,
  '23514', null, 'a non-normalized org slug is rejected');

select * from finish();
rollback;
