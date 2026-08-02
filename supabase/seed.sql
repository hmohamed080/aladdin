-- Supabase seed data — applied locally by `supabase db reset`.
--
-- Rules:
-- - Local development only. Synthetic, non-sensitive data ONLY (this file may
--   live in a public repo). No real customers, no PII.
-- - Use realistic Egyptian conventions (localities, EGP) with invented entities.
-- - Add seed rows alongside the migration that creates the table they populate.
--
-- Phase 1 (Identity & Multi-Tenancy) synthetic fixtures:
--   Org A "Nile Finishing Supplies" (supplier) with Cairo + Sheikh Zayed branches.
--   Org B "Delta Interiors Studio" (interior designer).
--   Users: A-owner, A-branch-limited (Cairo only), B-owner, an end consumer,
--   and a platform administrator. All UUIDs are fixed so pgTAP tests can target them.
-- These are SYNTHETIC LOCAL FIXTURES — not real people or companies.

-- ---------------------------------------------------------------------------
-- Auth users (the on_auth_user_created trigger bootstraps public.users + profiles)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'a-owner@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Amina (Org A Owner)","locale":"en"}'::jsonb, now(), now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'a-cairo@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Karim (Org A Cairo Staff)","locale":"ar"}'::jsonb, now(), now(), now()),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'b-owner@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Nadia (Org B Owner)","locale":"en"}'::jsonb, now(), now(), now()),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'consumer@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Omar (End Consumer)","locale":"en"}'::jsonb, now(), now(), now()),
  ('55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Platform Admin","locale":"en"}'::jsonb, now(), now(), now());

-- Set primary account types (bootstrap defaults everyone to end_consumer).
update public.users set primary_account_type = 'supplier',          status = 'active' where id = '11111111-1111-4111-8111-111111111111';
update public.users set primary_account_type = 'sales',             status = 'active' where id = '22222222-2222-4222-8222-222222222222';
update public.users set primary_account_type = 'interior_designer', status = 'active' where id = '33333333-3333-4333-8333-333333333333';
update public.users set primary_account_type = 'end_consumer',      status = 'active' where id = '44444444-4444-4444-8444-444444444444';
-- Platform staff hold a NORMAL account type; their authority comes solely from
-- the platform_role_grant below, never from primary_account_type (review B4).
update public.users set primary_account_type = 'end_consumer',      status = 'active' where id = '55555555-5555-4555-8555-555555555555';

-- Public-profile visibility is SERVER-CONTROLLED (Sprint 1.2). The seed runs as
-- the trusted (postgres) path, standing in for the approved upgrade/verification
-- workflow: it lists the two org owners as publicly discoverable professionals.
-- The Cairo sales staff (a professional account type) is deliberately left
-- `hidden` — a negative fixture proving that a non-consumer account type alone
-- does NOT make a profile publicly discoverable.
update public.profiles set public_profile_status = 'listed'
  where user_id in ('11111111-1111-4111-8111-111111111111',   -- A-owner (supplier)
                    '33333333-3333-4333-8333-333333333333');  -- B-owner (interior designer)

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, org_type, status, is_verified, primary_locale, created_by)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Nile Finishing Supplies', 'nile-finishing',
   'supplier', 'active', true, 'en', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Delta Interiors Studio', 'delta-interiors',
   'interior_designer', 'active', true, 'en', '33333333-3333-4333-8333-333333333333');

-- ---------------------------------------------------------------------------
-- Branches (Org A has two; Org B has none for this fixture)
-- ---------------------------------------------------------------------------
insert into public.branches (id, organization_id, name, is_active)
values
  ('c1111111-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cairo Branch', true),
  ('c2222222-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Sheikh Zayed Branch', true),
  -- Org B branch — used by isolation tests to prove Org A members never see it.
  ('cb333333-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Maadi Studio', true);

-- ---------------------------------------------------------------------------
-- Memberships
--   A-owner    -> Org A, active, org-wide (org.manage etc.)
--   A-branch   -> Org A, active, branch-limited to Cairo only (primary_branch_id
--                 is descriptive; access comes from membership_branch_access below)
--   B-owner    -> Org B, active, org-wide
-- ---------------------------------------------------------------------------
insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at)
values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'active', now()),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', '22222222-2222-4222-8222-222222222222',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc', 'active', now()),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', '33333333-3333-4333-8333-333333333333',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 'active', now());

-- Capabilities: owners get management + operational caps; branch staff get sales read/write only.
insert into public.membership_capabilities (membership_id, capability_key)
values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'org.manage'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'org.members.manage'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'branch.manage'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'catalog.write'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.opportunity.read'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.opportunity.write'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'org.manage'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'org.members.manage');

-- Branch assignment: the Cairo staff member is explicitly limited to the Cairo branch.
insert into public.membership_branch_access (membership_id, branch_id)
values
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'c1111111-cccc-4ccc-8ccc-cccccccccccc');

-- ---------------------------------------------------------------------------
-- Platform role grant — the documented server-side/DBA provisioning path
-- (seed runs as postgres, bypassing RLS; no ordinary-user write path exists).
-- ---------------------------------------------------------------------------
insert into public.platform_role_grants (user_id, role)
values ('55555555-5555-4555-8555-555555555555', 'administrator');

-- Primary contacts (one verified primary per user).
insert into public.contacts (user_id, channel, value, is_primary, is_verified, verified_at)
values
  ('11111111-1111-4111-8111-111111111111', 'email', 'a-owner@example.test', true, true, now()),
  ('33333333-3333-4333-8333-333333333333', 'email', 'b-owner@example.test', true, true, now()),
  ('44444444-4444-4444-8444-444444444444', 'email', 'consumer@example.test', true, true, now());
