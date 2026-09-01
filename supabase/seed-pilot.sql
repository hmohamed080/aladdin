-- ===========================================================================
-- Aladdin Pilot world (Sprint 11) — deterministic, CONNECTED demo data.
--
-- Applied by `supabase db reset` AFTER supabase/seed.sql (see config.toml
-- [db.seed].sql_paths). Kept SEPARATE so the pgTAP-pinned base fixtures in
-- seed.sql stay untouched. Everything here is SYNTHETIC (no real people).
--
-- Design rules that keep the base test suite green:
--   * Adds NOTHING to Org A / Org B or their memberships/branches/capabilities.
--   * All new organizations are is_verified = FALSE, so the public directory
--     count is unchanged (verification is exactly what the Admin queue shows).
--   * All new profiles stay public_profile_status = 'hidden'.
--   * Only the two admin-context global counts (memberships, branches) move —
--     reconciled in tests/06_admin_boundary_test.sql.
--
-- One coherent business story:
--   Cairo Ceramics Showroom (supplier, Org C) lists products →
--   Horizon Contracting (buyer, Org G) sends an RFQ → showroom quotes →
--   buyer accepts → order → active project. Org G also demonstrates people
--   operations (owner + manager + engineer + installer + a PENDING invite),
--   and Org D / Org E sit in the Admin verification queue.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Auth users (the bootstrap trigger creates public.users + profiles)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('70000001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'hana@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Hana Mansour","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'youssef@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Youssef Amin","locale":"ar"}'::jsonb, now(), now(), now()),
  ('70000003-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tarek@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Tarek Halim","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000004-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sara@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Sara Nabil","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000005-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'khaled@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Khaled Roushdy","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000006-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mostafa@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Mostafa Bakr","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000007-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'laila@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Laila Shafik","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000008-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'yasser@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Yasser Fouad","locale":"ar"}'::jsonb, now(), now(), now()),
  ('70000009-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ahmed@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Ahmed Sobhy","locale":"ar"}'::jsonb, now(), now(), now()),
  ('70000010-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'nour@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Nour Hegazy","locale":"en"}'::jsonb, now(), now(), now());

-- GoTrue token columns must be '' (not NULL) for local Email-OTP sign-in.
update auth.users set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  reauthentication_token = coalesce(reauthentication_token, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, '')
where id::text like '70000%';

-- PERSONAL personas only. The four business owners below (Showroom, Manufacturer,
-- Importer, Wholesaler) are BUSINESS-ONLY identities: their business classification
-- lives in `organizations.org_type`, and they hold NO personal persona at all
-- (`primary_account_type` stays null — Sprint 12). They still land and operate
-- normally, through their owner memberships. `status = 'active'` is what makes an
-- account usable; a persona is not required for that.
update public.users set primary_account_type = null,                   status = 'active' where id = '70000001-0000-4000-8000-000000000001';
update public.users set primary_account_type = 'sales',                status = 'active' where id = '70000002-0000-4000-8000-000000000002';
update public.users set primary_account_type = null,                   status = 'active' where id = '70000003-0000-4000-8000-000000000003';
update public.users set primary_account_type = null,                   status = 'active' where id = '70000004-0000-4000-8000-000000000004';
update public.users set primary_account_type = null,                   status = 'active' where id = '70000005-0000-4000-8000-000000000005';
-- Contractor is a PERSONAL persona (an individual professional), not a business
-- classification — Horizon Contracting's type lives on the organization.
update public.users set primary_account_type = 'contractor',           status = 'active' where id = '70000006-0000-4000-8000-000000000006';
update public.users set primary_account_type = 'sales',                status = 'active' where id = '70000007-0000-4000-8000-000000000007';
update public.users set primary_account_type = 'engineer',             status = 'active' where id = '70000008-0000-4000-8000-000000000008';
update public.users set primary_account_type = 'installer_technician', status = 'active' where id = '70000009-0000-4000-8000-000000000009';
-- Nour has not accepted her invite yet: keep her a pending-verification consumer
-- so my_registration_state resolves to the invitation path, not active_personal.
update public.users set primary_account_type = 'engineer' where id = '70000010-0000-4000-8000-000000000010';

-- ---------------------------------------------------------------------------
-- 2. Organizations (all is_verified = false; two of them pending review)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, org_type, status, is_verified, primary_locale, created_by)
values
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'Cairo Ceramics Showroom', 'cairo-ceramics',
   'showroom_dealer', 'active', false, 'en', '70000001-0000-4000-8000-000000000001'),
  ('9d000000-dddd-4ddd-8ddd-000000000002', 'Egypt Marble Manufacturing', 'egypt-marble',
   'manufacturer', 'pending_verification', false, 'en', '70000003-0000-4000-8000-000000000003'),
  ('9e000000-eeee-4eee-8eee-000000000003', 'Nile Import & Trade', 'nile-import',
   'importer', 'pending_verification', false, 'en', '70000004-0000-4000-8000-000000000004'),
  ('9f000000-ffff-4fff-8fff-000000000004', 'Delta Wholesale Supply', 'delta-wholesale',
   'wholesaler', 'active', false, 'en', '70000005-0000-4000-8000-000000000005'),
  -- A contracting BUSINESS is `contractor_company`; its owner is separately an
  -- individual `contractor` PERSONA (two enums since Sprint 13, never one value).
  ('9a000000-aaaa-4aaa-8aaa-000000000005', 'Horizon Contracting', 'horizon-contracting',
   'contractor_company', 'active', false, 'en', '70000006-0000-4000-8000-000000000006');

-- ---------------------------------------------------------------------------
-- 3. Branches (one per new org)
-- ---------------------------------------------------------------------------
insert into public.branches (id, organization_id, name, is_active)
values
  ('b0000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', 'Nasr City Showroom', true),
  ('b0000002-0000-4000-8000-000000000002', '9d000000-dddd-4ddd-8ddd-000000000002', '6th of October Plant', true),
  ('b0000003-0000-4000-8000-000000000003', '9e000000-eeee-4eee-8eee-000000000003', 'Alexandria Port Office', true),
  ('b0000004-0000-4000-8000-000000000004', '9f000000-ffff-4fff-8fff-000000000004', 'Tanta Depot', true),
  ('b0000005-0000-4000-8000-000000000005', '9a000000-aaaa-4aaa-8aaa-000000000005', 'New Cairo Office', true);

-- ---------------------------------------------------------------------------
-- 4. Memberships (9 active; Nour is a PENDING token invitation, not a member yet)
-- ---------------------------------------------------------------------------
insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at)
values
  ('50000001-0000-4000-8000-000000000001', '70000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', null, 'active', now()),
  ('50000002-0000-4000-8000-000000000002', '70000002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'active', now()),
  ('50000003-0000-4000-8000-000000000003', '70000003-0000-4000-8000-000000000003', '9d000000-dddd-4ddd-8ddd-000000000002', null, 'active', now()),
  ('50000004-0000-4000-8000-000000000004', '70000004-0000-4000-8000-000000000004', '9e000000-eeee-4eee-8eee-000000000003', null, 'active', now()),
  ('50000005-0000-4000-8000-000000000005', '70000005-0000-4000-8000-000000000005', '9f000000-ffff-4fff-8fff-000000000004', null, 'active', now()),
  ('50000006-0000-4000-8000-000000000006', '70000006-0000-4000-8000-000000000006', '9a000000-aaaa-4aaa-8aaa-000000000005', null, 'active', now()),
  ('50000007-0000-4000-8000-000000000007', '70000007-0000-4000-8000-000000000007', '9a000000-aaaa-4aaa-8aaa-000000000005', null, 'active', now()),
  ('50000008-0000-4000-8000-000000000008', '70000008-0000-4000-8000-000000000008', '9a000000-aaaa-4aaa-8aaa-000000000005', 'b0000005-0000-4000-8000-000000000005', 'active', now()),
  ('50000009-0000-4000-8000-000000000009', '70000009-0000-4000-8000-000000000009', '9a000000-aaaa-4aaa-8aaa-000000000005', 'b0000005-0000-4000-8000-000000000005', 'active', now());

-- Owners + the contractor buyer get the FULL delegatable set (so they can run
-- people-ops AND the full commerce workflow, and can delegate any subset).
insert into public.membership_capabilities (membership_id, capability_key)
select m.id, cap
from (values
  ('50000001-0000-4000-8000-000000000001'::uuid),  -- Hana (showroom owner / supplier side)
  ('50000003-0000-4000-8000-000000000003'::uuid),  -- Tarek (manufacturer owner)
  ('50000004-0000-4000-8000-000000000004'::uuid),  -- Sara (importer owner)
  ('50000005-0000-4000-8000-000000000005'::uuid),  -- Khaled (wholesaler owner)
  ('50000006-0000-4000-8000-000000000006'::uuid)   -- Mostafa (contractor owner / buyer side)
) as m(id)
cross join unnest(array[
  'org.manage','org.members.manage','branch.manage',
  'catalog.read','catalog.write','catalog.publish',
  'rfq.create','rfq.respond','quote.submit','quote.decide',
  'order.create','order.manage','project.read','project.write',
  'sales.read','sales.write','sales.assign','sales.manage',
  'verification.submit','verification.read'
]) as cap;

-- Youssef — a branch-scoped SALESPERSON (scoped CRM only).
insert into public.membership_capabilities (membership_id, capability_key) values
  ('50000002-0000-4000-8000-000000000002', 'sales.read'),
  ('50000002-0000-4000-8000-000000000002', 'sales.write');

-- Laila — ORGANIZATION MANAGER (people + relevant workflow, not full owner).
insert into public.membership_capabilities (membership_id, capability_key) values
  ('50000007-0000-4000-8000-000000000007', 'org.members.manage'),
  ('50000007-0000-4000-8000-000000000007', 'branch.manage'),
  ('50000007-0000-4000-8000-000000000007', 'catalog.read'),
  ('50000007-0000-4000-8000-000000000007', 'rfq.create'),
  ('50000007-0000-4000-8000-000000000007', 'quote.decide'),
  ('50000007-0000-4000-8000-000000000007', 'order.create'),
  ('50000007-0000-4000-8000-000000000007', 'project.read'),
  ('50000007-0000-4000-8000-000000000007', 'project.write');

-- Yasser — ENGINEER (projects + can raise buyer RFQs).
insert into public.membership_capabilities (membership_id, capability_key) values
  ('50000008-0000-4000-8000-000000000008', 'project.read'),
  ('50000008-0000-4000-8000-000000000008', 'project.write'),
  ('50000008-0000-4000-8000-000000000008', 'catalog.read'),
  ('50000008-0000-4000-8000-000000000008', 'rfq.create');

-- Ahmed — INSTALLER / TECHNICIAN (project execution).
insert into public.membership_capabilities (membership_id, capability_key) values
  ('50000009-0000-4000-8000-000000000009', 'project.read'),
  ('50000009-0000-4000-8000-000000000009', 'project.write');

-- Branch scope: Youssef -> Nasr City; Yasser + Ahmed -> New Cairo.
insert into public.membership_branch_access (membership_id, branch_id) values
  ('50000002-0000-4000-8000-000000000002', 'b0000001-0000-4000-8000-000000000001'),
  ('50000008-0000-4000-8000-000000000008', 'b0000005-0000-4000-8000-000000000005'),
  ('50000009-0000-4000-8000-000000000009', 'b0000005-0000-4000-8000-000000000005');

-- ---------------------------------------------------------------------------
-- 5. Primary contacts (verified email) for the new people
-- ---------------------------------------------------------------------------
insert into public.contacts (user_id, channel, value, is_primary, is_verified, verified_at)
values
  ('70000001-0000-4000-8000-000000000001', 'email', 'hana@example.test',    true, true, now()),
  ('70000002-0000-4000-8000-000000000002', 'email', 'youssef@example.test', true, true, now()),
  ('70000003-0000-4000-8000-000000000003', 'email', 'tarek@example.test',   true, true, now()),
  ('70000004-0000-4000-8000-000000000004', 'email', 'sara@example.test',    true, true, now()),
  ('70000005-0000-4000-8000-000000000005', 'email', 'khaled@example.test',  true, true, now()),
  ('70000006-0000-4000-8000-000000000006', 'email', 'mostafa@example.test', true, true, now()),
  ('70000007-0000-4000-8000-000000000007', 'email', 'laila@example.test',   true, true, now()),
  ('70000008-0000-4000-8000-000000000008', 'email', 'yasser@example.test',  true, true, now()),
  ('70000009-0000-4000-8000-000000000009', 'email', 'ahmed@example.test',   true, true, now()),
  ('70000010-0000-4000-8000-000000000010', 'email', 'nour@example.test',    true, true, now());

-- ---------------------------------------------------------------------------
-- 6. A PENDING invitation: Horizon Contracting -> Nour (accept-flow demo).
-- ---------------------------------------------------------------------------
insert into public.organization_invitations
  (organization_id, email, primary_branch_id, token, status, invited_by, expires_at)
values
  ('9a000000-aaaa-4aaa-8aaa-000000000005', 'nour@example.test',
   'b0000005-0000-4000-8000-000000000005',
   'pilotinvite000000000000000000nour01', 'pending',
   '70000006-0000-4000-8000-000000000006', now() + interval '14 days');

-- ---------------------------------------------------------------------------
-- 7. Connected commerce: Cairo Ceramics (supplier) -> Horizon (buyer)
-- ---------------------------------------------------------------------------
-- Products (published) in Cairo Ceramics Showroom.
insert into public.products (id, organization_id, name, sku, category, brand, short_description, unit, status, published_at, created_by)
values
  ('d1000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Porcelain Floor Tile 60×60', 'TILE-6060', 'finishing', 'NileCeramics',
   'Matte porcelain floor tile, first grade.', 'square_meter', 'published', now(), '70000001-0000-4000-8000-000000000001'),
  ('d1000002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Interior Wall Paint (White)', 'PAINT-WHT', 'finishing', 'DeltaCoat',
   'Washable matte interior emulsion, 20L.', 'liter', 'published', now(), '70000001-0000-4000-8000-000000000001'),
  ('d1000003-0000-4000-8000-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Marble Slab (Galala)', 'MRB-GAL', 'finishing', 'EgyptMarble',
   'Polished Galala marble slab.', 'square_meter', 'published', now(), '70000001-0000-4000-8000-000000000001');

-- RFQ: Horizon Contracting -> Cairo Ceramics (quoted).
insert into public.rfqs (id, requester_org_id, requester_branch_id, supplier_org_id, title, note, required_date, status, version, submitted_at, created_by)
values
  ('d2000001-0000-4000-8000-000000000001', '9a000000-aaaa-4aaa-8aaa-000000000005',
   'b0000005-0000-4000-8000-000000000005', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Finishing materials — New Cairo villa', 'Full floor + wall finishing for a 300 m² villa.',
   (now() + interval '30 days')::date, 'quoted', 1, now() - interval '5 days',
   '70000006-0000-4000-8000-000000000006');

insert into public.rfq_items (id, rfq_id, product_id, product_name, unit, quantity, note)
values
  ('d2100001-0000-4000-8000-000000000001', 'd2000001-0000-4000-8000-000000000001',
   'd1000001-0000-4000-8000-000000000001', 'Porcelain Floor Tile 60×60', 'square_meter', 500, 'Ground + first floor'),
  ('d2100002-0000-4000-8000-000000000002', 'd2000001-0000-4000-8000-000000000001',
   'd1000002-0000-4000-8000-000000000002', 'Interior Wall Paint (White)', 'liter', 100, 'Two coats');

-- Quotation from the supplier (ACCEPTED by the buyer).
insert into public.quotations (id, rfq_id, supplier_org_id, requester_org_id, note, validity_date, subtotal, total, status, version, submitted_at, decided_at, decided_by, created_by)
values
  ('d3000001-0000-4000-8000-000000000001', 'd2000001-0000-4000-8000-000000000001',
   '9c000000-cccc-4ccc-8ccc-000000000001', '9a000000-aaaa-4aaa-8aaa-000000000005',
   'Prices valid for 15 days. Delivery included within Cairo.', (now() + interval '15 days')::date,
   143000, 143000, 'accepted', 1, now() - interval '3 days', now() - interval '1 day',
   '70000006-0000-4000-8000-000000000006', '70000001-0000-4000-8000-000000000001');

insert into public.quotation_items (quotation_id, rfq_item_id, product_name, unit, quantity, unit_price)
values
  ('d3000001-0000-4000-8000-000000000001', 'd2100001-0000-4000-8000-000000000001', 'Porcelain Floor Tile 60×60', 'square_meter', 500, 250),
  ('d3000001-0000-4000-8000-000000000001', 'd2100002-0000-4000-8000-000000000002', 'Interior Wall Paint (White)', 'liter', 100, 180);

-- Order confirmed from the accepted quotation (in progress).
insert into public.orders (id, quotation_id, rfq_id, requester_org_id, supplier_org_id, requester_branch_id, title, note, subtotal, total, status, version, confirmed_at, started_at, created_by)
values
  ('d4000001-0000-4000-8000-000000000001', 'd3000001-0000-4000-8000-000000000001', 'd2000001-0000-4000-8000-000000000001',
   '9a000000-aaaa-4aaa-8aaa-000000000005', '9c000000-cccc-4ccc-8ccc-000000000001',
   'b0000005-0000-4000-8000-000000000005', 'Finishing materials — New Cairo villa',
   'Delivery included within Cairo.', 143000, 143000, 'in_progress', 1,
   now() - interval '1 day', now() - interval '12 hours', '70000006-0000-4000-8000-000000000006');

insert into public.order_items (order_id, product_name, unit, quantity, unit_price)
values
  ('d4000001-0000-4000-8000-000000000001', 'Porcelain Floor Tile 60×60', 'square_meter', 500, 250),
  ('d4000001-0000-4000-8000-000000000001', 'Interior Wall Paint (White)', 'liter', 100, 180);

-- Active execution project bridging buyer + supplier.
insert into public.projects (id, order_id, requester_org_id, executing_org_id, branch_id, title, location, description, start_date, target_date, status, version, activated_at, created_by)
values
  ('d5000001-0000-4000-8000-000000000001', 'd4000001-0000-4000-8000-000000000001',
   '9a000000-aaaa-4aaa-8aaa-000000000005', '9c000000-cccc-4ccc-8ccc-000000000001',
   'b0000005-0000-4000-8000-000000000005', 'New Cairo villa finishing',
   'New Cairo', 'Supply and delivery of finishing materials for the villa fit-out.',
   now()::date, (now() + interval '20 days')::date, 'active', 1, now() - interval '10 hours',
   '70000006-0000-4000-8000-000000000006');

-- ---------------------------------------------------------------------------
-- 8. Pending verifications for the Admin review queue
-- ---------------------------------------------------------------------------
insert into public.verifications (id, subject_type, organization_id, verification_type, status, submitted_at)
values
  ('d6000001-0000-4000-8000-000000000001', 'organization', '9d000000-dddd-4ddd-8ddd-000000000002', 'organization', 'submitted', now() - interval '2 days'),
  ('d6000002-0000-4000-8000-000000000002', 'organization', '9e000000-eeee-4eee-8eee-000000000003', 'organization', 'submitted', now() - interval '1 day');

-- ---------------------------------------------------------------------------
-- 9. Audit history for the Admin audit surface
-- ---------------------------------------------------------------------------
-- Everything above is inserted directly (not through the RPCs), so the trail the
-- RPCs would normally emit does not exist and /admin/audit opens empty — a Pilot
-- tester cannot review a screen with no rows. These entries retell exactly the
-- story seeded above (org + people setup, then the Cairo Ceramics → Horizon
-- commerce chain), with a real actor, target, and timestamp on each.
--
-- Deliberately avoids the four verification/profile actions pinned by
-- tests/13_audit_emission_test.sql, so the pgTAP fixtures stay exact.
insert into public.audit_log (actor_user_id, action, subject_type, subject_id, organization_id, metadata, created_at)
values
  -- Organization + people setup.
  ('70000001-0000-4000-8000-000000000001', 'organization.created', 'organization', '9c000000-cccc-4ccc-8ccc-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', '{"org_type":"showroom_dealer"}'::jsonb, now() - interval '30 days'),
  ('70000001-0000-4000-8000-000000000001', 'branch.created', 'branch', 'b0000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', '{"primary":true}'::jsonb, now() - interval '30 days'),
  ('70000006-0000-4000-8000-000000000006', 'organization.created', 'organization', '9a000000-aaaa-4aaa-8aaa-000000000005', '9a000000-aaaa-4aaa-8aaa-000000000005', '{"org_type":"contractor"}'::jsonb, now() - interval '28 days'),
  ('70000006-0000-4000-8000-000000000006', 'branch.created', 'branch', 'b0000005-0000-4000-8000-000000000005', '9a000000-aaaa-4aaa-8aaa-000000000005', '{"primary":true}'::jsonb, now() - interval '28 days'),
  ('70000006-0000-4000-8000-000000000006', 'membership.granted', 'user', '70000007-0000-4000-8000-000000000007', '9a000000-aaaa-4aaa-8aaa-000000000005', '{"via":"invitation"}'::jsonb, now() - interval '21 days'),
  ('70000006-0000-4000-8000-000000000006', 'membership.activated', 'user', '70000007-0000-4000-8000-000000000007', '9a000000-aaaa-4aaa-8aaa-000000000005', '{}'::jsonb, now() - interval '21 days'),
  ('70000007-0000-4000-8000-000000000007', 'membership.granted', 'user', '70000008-0000-4000-8000-000000000008', '9a000000-aaaa-4aaa-8aaa-000000000005', '{"via":"invitation"}'::jsonb, now() - interval '14 days'),
  ('70000007-0000-4000-8000-000000000007', 'membership.activated', 'user', '70000008-0000-4000-8000-000000000008', '9a000000-aaaa-4aaa-8aaa-000000000005', '{}'::jsonb, now() - interval '14 days'),
  -- Catalog.
  ('70000001-0000-4000-8000-000000000001', 'product.created', 'product', 'd1000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', '{}'::jsonb, now() - interval '12 days'),
  ('70000001-0000-4000-8000-000000000001', 'product.published', 'product', 'd1000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', '{}'::jsonb, now() - interval '12 days'),
  ('70000001-0000-4000-8000-000000000001', 'product.published', 'product', 'd1000002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', '{}'::jsonb, now() - interval '11 days'),
  -- The RFQ → quote → order → project chain.
  ('70000006-0000-4000-8000-000000000006', 'rfq.submitted', 'rfq', 'd2000001-0000-4000-8000-000000000001', '9a000000-aaaa-4aaa-8aaa-000000000005', '{}'::jsonb, now() - interval '5 days'),
  ('70000002-0000-4000-8000-000000000002', 'quotation.submitted', 'quotation', 'd3000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', '{"total":143000}'::jsonb, now() - interval '3 days'),
  ('70000006-0000-4000-8000-000000000006', 'quotation.accepted', 'quotation', 'd3000001-0000-4000-8000-000000000001', '9a000000-aaaa-4aaa-8aaa-000000000005', '{}'::jsonb, now() - interval '1 day'),
  ('70000006-0000-4000-8000-000000000006', 'order.created', 'order', 'd4000001-0000-4000-8000-000000000001', '9a000000-aaaa-4aaa-8aaa-000000000005', '{}'::jsonb, now() - interval '1 day'),
  ('70000001-0000-4000-8000-000000000001', 'order.started', 'order', 'd4000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', '{}'::jsonb, now() - interval '12 hours'),
  ('70000001-0000-4000-8000-000000000001', 'project.activated', 'project', 'd5000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', '{}'::jsonb, now() - interval '10 hours');

-- ===========================================================================
-- 10. SHOWROOM ACCEPTANCE WORLD (Sprint 14 completeness pass)
-- ===========================================================================
-- Sections 1–9 above model Cairo Ceramics Showroom purely as a SELLER (it quotes
-- Horizon Contracting). That left the acceptance account with an empty buying
-- side — no purchase requests, no incoming offers, no orders, no shortlist — and
-- three structurally empty directories, because every pilot organization was
-- `is_verified = false` (the public directory lists verified businesses only) and
-- every pilot profile was `hidden`.
--
-- This section makes the Showroom the workspace the product is actually tuned
-- for: a business that BUYS from distributors, SELLS to its own customers, and
-- executes delivery projects for both. Nothing here is display-only — every
-- figure on the dashboard and in Reports is an aggregate of these rows, read
-- through the same RLS-scoped views the module lists use.
--
-- Still deterministic (fixed UUIDs, relative timestamps), still synthetic, and
-- still additive: Org A / Org B and their memberships are untouched. The counts
-- that necessarily moved (public directory, memberships, branches) are
-- reconciled in the pgTAP suite.

-- ---------------------------------------------------------------------------
-- 10.1 Verification — a showroom must be able to SEE its network
-- ---------------------------------------------------------------------------
-- Egypt Marble and Nile Import stay `pending_verification` on purpose: they are
-- the Admin review queue, and keeping them out of the directory is what proves
-- verification gates discovery. Everything else in the pilot world is an
-- established business and is verified accordingly.
update public.organizations set is_verified = true
where id in ('9c000000-cccc-4ccc-8ccc-000000000001',   -- Cairo Ceramics Showroom
             '9f000000-ffff-4fff-8fff-000000000004',   -- Delta Wholesale Supply
             '9a000000-aaaa-4aaa-8aaa-000000000005');  -- Horizon Contracting

-- ---------------------------------------------------------------------------
-- 10.2 The distributors and institutions the showroom deals with
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('71000001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mahmoud@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Mahmoud Ezzat","locale":"en"}'::jsonb, now(), now(), now()),
  ('71000002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rania@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Rania Gamal","locale":"ar"}'::jsonb, now(), now(), now()),
  ('71000003-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fady@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Fady Riad","locale":"en"}'::jsonb, now(), now(), now()),
  ('71000004-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dina@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Dina Sherif","locale":"en"}'::jsonb, now(), now(), now()),
  ('71000005-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'hazem@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Hazem Lotfy","locale":"ar"}'::jsonb, now(), now(), now()),
  -- Listed professionals: the Technicians directory reads real people who chose
  -- to be discoverable, so it needs real people who chose to be discoverable.
  ('71000006-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sayed@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Sayed Abdel-Rahman","locale":"ar"}'::jsonb, now(), now(), now()),
  ('71000007-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'm-fathy@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Mahmoud Fathy","locale":"ar"}'::jsonb, now(), now(), now()),
  ('71000008-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ibrahim@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Ibrahim Nasr","locale":"ar"}'::jsonb, now(), now(), now()),
  ('71000009-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wael@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Wael Sobhy","locale":"ar"}'::jsonb, now(), now(), now()),
  ('71000010-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'heba@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Heba Kamal","locale":"en"}'::jsonb, now(), now(), now()),
  ('71000011-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'amr@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Amr Selim","locale":"en"}'::jsonb, now(), now(), now());

update auth.users set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  reauthentication_token = coalesce(reauthentication_token, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, '')
where id::text like '71000%';

-- Business owners are BUSINESS-ONLY identities (no personal persona) — their
-- classification lives on organizations.org_type. The six professionals below
-- are the opposite: a personal persona and no business at all.
update public.users set primary_account_type = null, status = 'active'
  where id in ('71000001-0000-4000-8000-000000000001','71000002-0000-4000-8000-000000000002',
               '71000003-0000-4000-8000-000000000003','71000004-0000-4000-8000-000000000004',
               '71000005-0000-4000-8000-000000000005');
update public.users set primary_account_type = 'installer_technician', status = 'active'
  where id in ('71000006-0000-4000-8000-000000000006','71000007-0000-4000-8000-000000000007',
               '71000008-0000-4000-8000-000000000008','71000009-0000-4000-8000-000000000009');
update public.users set primary_account_type = 'interior_designer', status = 'active'
  where id = '71000010-0000-4000-8000-000000000010';
update public.users set primary_account_type = 'engineer', status = 'active'
  where id = '71000011-0000-4000-8000-000000000011';

insert into public.contacts (user_id, channel, value, is_primary, is_verified, verified_at)
select id, 'email', email, true, true, now() from auth.users where id::text like '71000%';

insert into public.organizations (id, name, slug, org_type, status, is_verified, primary_locale, created_by)
values
  ('91000001-1111-4111-8111-000000000001', 'Alexandria Glass & Aluminium', 'alex-glass',
   'manufacturer', 'active', true, 'en', '71000001-0000-4000-8000-000000000001'),
  ('91000002-1111-4111-8111-000000000002', 'Suez Paints & Coatings', 'suez-paints',
   'supplier', 'active', true, 'ar', '71000002-0000-4000-8000-000000000002'),
  ('91000003-1111-4111-8111-000000000003', 'Cairo Sanitary Ware Trading', 'cairo-sanitary',
   'importer', 'active', true, 'en', '71000003-0000-4000-8000-000000000003'),
  ('91000004-1111-4111-8111-000000000004', 'New Cairo Design Studio', 'newcairo-design',
   'design_office', 'active', true, 'en', '71000004-0000-4000-8000-000000000004'),
  ('91000005-1111-4111-8111-000000000005', 'Zayed Home Showroom', 'zayed-home',
   'showroom_dealer', 'active', true, 'ar', '71000005-0000-4000-8000-000000000005');

insert into public.branches (id, organization_id, name, is_active)
values
  ('b1000001-0000-4000-8000-000000000001', '91000001-1111-4111-8111-000000000001', 'Amreya Plant', true),
  ('b1000002-0000-4000-8000-000000000002', '91000002-1111-4111-8111-000000000002', 'Suez Works', true),
  ('b1000003-0000-4000-8000-000000000003', '91000003-1111-4111-8111-000000000003', 'Obour Warehouse', true),
  ('b1000004-0000-4000-8000-000000000004', '91000004-1111-4111-8111-000000000004', 'Fifth Settlement Studio', true),
  ('b1000005-0000-4000-8000-000000000005', '91000005-1111-4111-8111-000000000005', 'Sheikh Zayed Showroom', true);

insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at)
values
  ('51000001-0000-4000-8000-000000000001', '71000001-0000-4000-8000-000000000001', '91000001-1111-4111-8111-000000000001', null, 'active', now()),
  ('51000002-0000-4000-8000-000000000002', '71000002-0000-4000-8000-000000000002', '91000002-1111-4111-8111-000000000002', null, 'active', now()),
  ('51000003-0000-4000-8000-000000000003', '71000003-0000-4000-8000-000000000003', '91000003-1111-4111-8111-000000000003', null, 'active', now()),
  ('51000004-0000-4000-8000-000000000004', '71000004-0000-4000-8000-000000000004', '91000004-1111-4111-8111-000000000004', null, 'active', now()),
  ('51000005-0000-4000-8000-000000000005', '71000005-0000-4000-8000-000000000005', '91000005-1111-4111-8111-000000000005', null, 'active', now());

insert into public.membership_capabilities (membership_id, capability_key)
select m.id, cap
from (values
  ('51000001-0000-4000-8000-000000000001'::uuid),
  ('51000002-0000-4000-8000-000000000002'::uuid),
  ('51000003-0000-4000-8000-000000000003'::uuid),
  ('51000004-0000-4000-8000-000000000004'::uuid),
  ('51000005-0000-4000-8000-000000000005'::uuid)
) as m(id)
cross join unnest(array[
  'org.manage','org.members.manage','branch.manage',
  'catalog.read','catalog.write','catalog.publish',
  'rfq.create','rfq.respond','quote.submit','quote.decide',
  'order.create','order.manage','project.read','project.write',
  'sales.read','sales.write','sales.assign','sales.manage',
  'verification.submit','verification.read'
]) as cap;

-- ---------------------------------------------------------------------------
-- 10.3 Listed professional profiles — the Technicians directory
-- ---------------------------------------------------------------------------
-- `headline` is the trade summary the directory shows; `bio` is the professional
-- summary on the row. Both are approved public columns of the hardened
-- profile_public_directory projection — nothing private is being exposed here.
update public.profiles p set
  public_profile_status = 'listed',
  headline = v.headline,
  bio = v.bio,
  languages = v.languages
from (values
  ('70000009-0000-4000-8000-000000000009'::uuid,
   'Ceramic and porcelain tiling',
   'Fifteen years fixing floor and wall tiling on residential fit-outs. Works to a finished-surface handover.',
   array['ar','en']),
  ('71000006-0000-4000-8000-000000000006'::uuid,
   'Marble and granite fixing',
   'Marble stairs, counters and thresholds. Cutting, polishing and on-site fixing.',
   array['ar']),
  ('71000007-0000-4000-8000-000000000007'::uuid,
   'Electrical installation and lighting',
   'Interior electrical works, distribution boards and decorative lighting installation.',
   array['ar']),
  ('71000008-0000-4000-8000-000000000008'::uuid,
   'Plumbing and sanitary fitting',
   'Water and drainage networks, sanitary ware and concealed cistern installation.',
   array['ar','en']),
  ('71000009-0000-4000-8000-000000000009'::uuid,
   'Gypsum board and false ceilings',
   'Suspended ceilings, cornices and gypsum partitions, including lighting cut-outs.',
   array['ar']),
  ('71000010-0000-4000-8000-000000000010'::uuid,
   'Residential interior design',
   'Apartment and villa interiors from concept to finishing schedule and site supervision.',
   array['en','ar']),
  ('71000011-0000-4000-8000-000000000011'::uuid,
   'Site and finishing engineering',
   'Finishing works supervision, quantity take-offs and contractor coordination.',
   array['en','ar'])
) as v(user_id, headline, bio, languages)
where p.user_id = v.user_id;

-- ---------------------------------------------------------------------------
-- 10.3b Canonical trades for the listed installers (D8, §4)
-- ---------------------------------------------------------------------------
-- THE HEADLINES ABOVE ARE PROSE, AND PROSE IS NOT A TAXONOMY. Each installer's
-- trade is written here ONCE, by hand, as an explicit user-id → trade-key pair.
-- The migration's own backfill maps only `prof_specialization` values that are
-- EXACTLY a seeded key; it deliberately parses nothing, so "Marble and granite
-- fixing" reaches it as a sentence and is left alone. This is where a human
-- resolves that sentence, in a form a reviewer can check line by line.
--
-- One trade each, primary, which is what these five personas actually are. A
-- second trade would be inventing a skill nobody stated, and the multi-trade
-- case is exercised by the editor rather than faked in a fixture.
--
-- DELIBERATELY UNMAPPED: Heba Kamal (interior designer) and the site engineer
-- above them. The Pilot vocabulary is finishing/construction INSTALLER trades;
-- `residential` and `site_supervision` are interior-design and engineering
-- specializations, and seeding a trade to cover them would be modelling two more
-- professions to make a fixture look full.
insert into public.user_trades (user_id, trade_id, is_primary)
select v.user_id, t.id, true
from (values
  -- 'Ceramic and porcelain tiling'
  ('70000009-0000-4000-8000-000000000009'::uuid, 'tiling'),
  -- 'Marble and granite fixing'
  ('71000006-0000-4000-8000-000000000006'::uuid, 'marble_granite'),
  -- 'Electrical installation and lighting'
  ('71000007-0000-4000-8000-000000000007'::uuid, 'electrical'),
  -- 'Plumbing and sanitary fitting'
  ('71000008-0000-4000-8000-000000000008'::uuid, 'plumbing'),
  -- 'Gypsum board and false ceilings'
  ('71000009-0000-4000-8000-000000000009'::uuid, 'gypsum_paint')
) as v(user_id, trade_key)
join public.trades t on t.key = v.trade_key
on conflict (user_id, trade_id) do nothing;

-- ---------------------------------------------------------------------------
-- 10.4 Distributor catalogues (published, with product imagery)
-- ---------------------------------------------------------------------------
-- image_ref points at a local demo swatch under /demo/products. Material swatches
-- rather than photographs: a finishing catalogue is a catalogue of SURFACES, and
-- they carry no licensing question, need no external host, and stay deterministic.
update public.products set image_ref = v.ref
from (values
  ('d1000001-0000-4000-8000-000000000001'::uuid, '/demo/products/porcelain-tile.svg'),
  ('d1000002-0000-4000-8000-000000000002'::uuid, '/demo/products/wall-paint.svg'),
  ('d1000003-0000-4000-8000-000000000003'::uuid, '/demo/products/marble-slab.svg')
) as v(id, ref)
where products.id = v.id;

insert into public.products (id, organization_id, name, sku, category, brand, short_description, unit, image_ref, status, published_at, created_by)
values
  -- The showroom's own shelf (it sells as well as buys).
  ('d7000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Ceramic Wall Tile 30x60', 'TILE-3060', 'finishing', 'NileCeramics',
   'Glazed ceramic wall tile for kitchens and bathrooms.', 'square_meter',
   '/demo/products/ceramic-wall.svg', 'published', now() - interval '9 days', '70000001-0000-4000-8000-000000000001'),

  -- Alexandria Glass & Aluminium (manufacturer)
  ('d7000002-0000-4000-8000-000000000002', '91000001-1111-4111-8111-000000000001',
   'Tempered Glass Partition 10mm', 'GLS-T10', 'construction', 'AlexGlass',
   'Clear tempered safety glass for interior partitions.', 'square_meter',
   '/demo/products/glass-panel.svg', 'published', now() - interval '60 days', '71000001-0000-4000-8000-000000000001'),
  ('d7000003-0000-4000-8000-000000000003', '91000001-1111-4111-8111-000000000001',
   'Aluminium Window Profile', 'ALU-WP', 'construction', 'AlexGlass',
   'Thermal-break aluminium profile for sliding windows.', 'linear_meter',
   '/demo/products/aluminium-profile.svg', 'published', now() - interval '58 days', '71000001-0000-4000-8000-000000000001'),

  -- Suez Paints & Coatings (supplier)
  ('d7000004-0000-4000-8000-000000000004', '91000002-1111-4111-8111-000000000002',
   'Interior Emulsion - Matte White', 'PNT-INT', 'finishing', 'SuezCoat',
   'Washable matte interior emulsion, low odour.', 'liter',
   '/demo/products/wall-paint.svg', 'published', now() - interval '75 days', '71000002-0000-4000-8000-000000000002'),
  ('d7000005-0000-4000-8000-000000000005', '91000002-1111-4111-8111-000000000002',
   'Exterior Weather Coat', 'PNT-EXT', 'finishing', 'SuezCoat',
   'Elastomeric exterior coating for facades.', 'liter',
   '/demo/products/wall-paint.svg', 'published', now() - interval '70 days', '71000002-0000-4000-8000-000000000002'),

  -- Cairo Sanitary Ware Trading (importer)
  ('d7000006-0000-4000-8000-000000000006', '91000003-1111-4111-8111-000000000003',
   'Ceramic Wash Basin', 'SAN-BSN', 'finishing', 'Aqualine',
   'Counter-top ceramic wash basin, white.', 'piece',
   '/demo/products/sanitary-basin.svg', 'published', now() - interval '50 days', '71000003-0000-4000-8000-000000000003'),
  ('d7000007-0000-4000-8000-000000000007', '91000003-1111-4111-8111-000000000003',
   'Concealed Cistern Set', 'SAN-CST', 'finishing', 'Aqualine',
   'In-wall cistern with dual-flush plate.', 'set',
   '/demo/products/sanitary-basin.svg', 'published', now() - interval '48 days', '71000003-0000-4000-8000-000000000003'),

  -- Delta Wholesale Supply (wholesaler)
  ('d7000008-0000-4000-8000-000000000008', '9f000000-ffff-4fff-8fff-000000000004',
   'Silicone Sealant - Neutral', 'SUP-SIL', 'supply', 'DeltaSupply',
   'Neutral-cure silicone for sanitary and glazing joints.', 'piece',
   '/demo/products/silicone-sealant.svg', 'published', now() - interval '40 days', '70000005-0000-4000-8000-000000000005'),
  ('d7000009-0000-4000-8000-000000000009', '9f000000-ffff-4fff-8fff-000000000004',
   'Gypsum Board 12.5mm', 'SUP-GYP', 'construction', 'DeltaSupply',
   'Standard gypsum board for partitions and ceilings.', 'piece',
   '/demo/products/gypsum-board.svg', 'published', now() - interval '38 days', '70000005-0000-4000-8000-000000000005'),
  ('d7000010-0000-4000-8000-000000000010', '9f000000-ffff-4fff-8fff-000000000004',
   'LED Strip 5m - Warm White', 'SUP-LED', 'interior_design', 'DeltaSupply',
   'Concealed cove lighting strip, 5 metre reel.', 'roll',
   '/demo/products/led-strip.svg', 'published', now() - interval '36 days', '70000005-0000-4000-8000-000000000005'),

  -- Egypt Marble Manufacturing (pending verification - visible in the catalogue,
  -- absent from the directory, which is exactly what verification should mean).
  ('d7000011-0000-4000-8000-000000000011', '9d000000-dddd-4ddd-8ddd-000000000002',
   'Galala Marble Slab', 'MRB-SLB', 'finishing', 'EgyptMarble',
   'Polished Galala marble slab, 2cm.', 'square_meter',
   '/demo/products/marble-slab.svg', 'published', now() - interval '80 days', '70000003-0000-4000-8000-000000000003'),

  -- Zayed Home Showroom (a peer showroom that also publishes)
  ('d7000012-0000-4000-8000-000000000012', '91000005-1111-4111-8111-000000000005',
   'SPC Click Flooring', 'SPC-CLK', 'finishing', 'ZayedHome',
   'Rigid-core SPC click flooring, water resistant.', 'square_meter',
   '/demo/products/spc-flooring.svg', 'published', now() - interval '30 days', '71000005-0000-4000-8000-000000000005'),
  ('d7000013-0000-4000-8000-000000000013', '91000005-1111-4111-8111-000000000005',
   'WPC Wall Cladding', 'WPC-CLD', 'interior_design', 'ZayedHome',
   'Slatted WPC wall cladding for feature walls.', 'square_meter',
   '/demo/products/wpc-cladding.svg', 'published', now() - interval '28 days', '71000005-0000-4000-8000-000000000005');

-- ---------------------------------------------------------------------------
-- 10.5 The showroom's shortlist (organization-owned, not per-person)
-- ---------------------------------------------------------------------------
insert into public.saved_products (organization_id, product_id, saved_by, note, created_at)
values
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'd7000002-0000-4000-8000-000000000002', '70000001-0000-4000-8000-000000000001', 'For the Fifth Settlement partition job - confirm the edge finish.', now() - interval '18 days'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'd7000004-0000-4000-8000-000000000004', '70000001-0000-4000-8000-000000000001', null, now() - interval '16 days'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'd7000006-0000-4000-8000-000000000006', '70000002-0000-4000-8000-000000000002', 'Client liked this basin on the Maadi visit.', now() - interval '12 days'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'd7000007-0000-4000-8000-000000000007', '70000002-0000-4000-8000-000000000002', null, now() - interval '12 days'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'd7000010-0000-4000-8000-000000000010', '70000001-0000-4000-8000-000000000001', 'Cove lighting option for the showroom refit.', now() - interval '9 days'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'd7000011-0000-4000-8000-000000000011', '70000001-0000-4000-8000-000000000001', null, now() - interval '7 days'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'd7000012-0000-4000-8000-000000000012', '70000002-0000-4000-8000-000000000002', 'Compare against our own porcelain before quoting.', now() - interval '4 days'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'd7000009-0000-4000-8000-000000000009', '70000001-0000-4000-8000-000000000001', null, now() - interval '2 days');

-- ---------------------------------------------------------------------------
-- 10.6 The showroom's BUYING chain — twelve requests over six months
-- ---------------------------------------------------------------------------
-- Spread across real time on purpose: the purchase-value trend, the funnel and
-- the "where your spend goes" ranking are aggregates of these rows, so a chain
-- that all happened today would render a chart with one point on it.
insert into public.rfqs (id, requester_org_id, requester_branch_id, supplier_org_id, title, note, required_date, status, version, submitted_at, closed_at, created_at, created_by)
values
  ('d8000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '91000002-1111-4111-8111-000000000002',
   'Emulsion paint - showroom refit', 'Matte white for the display walls.', (now() - interval '170 days')::date, 'closed', 3, now() - interval '185 days', now() - interval '178 days', now() - interval '186 days', '70000001-0000-4000-8000-000000000001'),
  ('d8000002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '91000001-1111-4111-8111-000000000001',
   'Glass partitions - Fifth Settlement villa', 'Tempered, polished edges.', (now() - interval '140 days')::date, 'closed', 3, now() - interval '155 days', now() - interval '148 days', now() - interval '156 days', '70000001-0000-4000-8000-000000000001'),
  ('d8000003-0000-4000-8000-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '9f000000-ffff-4fff-8fff-000000000004',
   'Consumables restock', 'Sealant and boards for the quarter.', (now() - interval '112 days')::date, 'closed', 3, now() - interval '125 days', now() - interval '118 days', now() - interval '126 days', '70000001-0000-4000-8000-000000000001'),
  ('d8000004-0000-4000-8000-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '9d000000-dddd-4ddd-8ddd-000000000002',
   'Galala marble - reception counters', 'Polished 2cm, cut to schedule.', (now() - interval '75 days')::date, 'closed', 3, now() - interval '95 days', now() - interval '88 days', now() - interval '96 days', '70000001-0000-4000-8000-000000000001'),
  ('d8000005-0000-4000-8000-000000000005', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '91000003-1111-4111-8111-000000000003',
   'Sanitary ware - Maadi package', 'Forty units, basin plus concealed cistern.', (now() - interval '46 days')::date, 'closed', 3, now() - interval '62 days', now() - interval '55 days', now() - interval '63 days', '70000002-0000-4000-8000-000000000002'),
  ('d8000006-0000-4000-8000-000000000006', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '9f000000-ffff-4fff-8fff-000000000004',
   'Gypsum boards - ceiling works', 'For the Nasr City ceiling package.', (now() + interval '5 days')::date, 'closed', 3, now() - interval '25 days', now() - interval '20 days', now() - interval '26 days', '70000001-0000-4000-8000-000000000001'),
  ('d8000007-0000-4000-8000-000000000007', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '91000002-1111-4111-8111-000000000002',
   'Exterior coating - Zayed facade', 'Elastomeric, sand colour.', (now() + interval '18 days')::date, 'closed', 3, now() - interval '10 days', now() - interval '6 days', now() - interval '11 days', '70000001-0000-4000-8000-000000000001'),
  -- Open: priced and waiting on a decision.
  ('d8000008-0000-4000-8000-000000000008', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '91000003-1111-4111-8111-000000000003',
   'Basins - New Cairo apartments', 'One hundred units, staged delivery.', (now() + interval '25 days')::date, 'quoted', 2, now() - interval '8 days', null, now() - interval '9 days', '70000002-0000-4000-8000-000000000002'),
  ('d8000009-0000-4000-8000-000000000009', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '91000001-1111-4111-8111-000000000001',
   'Aluminium profiles - shopfront', 'Thermal break, anodised.', (now() + interval '30 days')::date, 'quoted', 2, now() - interval '5 days', null, now() - interval '6 days', '70000001-0000-4000-8000-000000000001'),
  ('d8000010-0000-4000-8000-000000000010', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '9f000000-ffff-4fff-8fff-000000000004',
   'LED cove lighting - display area', 'Warm white, ninety reels.', (now() + interval '14 days')::date, 'quoted', 2, now() - interval '4 days', null, now() - interval '5 days', '70000001-0000-4000-8000-000000000001'),
  -- Out, not yet answered.
  ('d8000011-0000-4000-8000-000000000011', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '91000005-1111-4111-8111-000000000005',
   'SPC flooring - sample order', 'Two colours for the display corner.', (now() + interval '12 days')::date, 'submitted', 1, now() - interval '2 days', null, now() - interval '2 days', '70000002-0000-4000-8000-000000000002'),
  -- Still being written.
  ('d8000012-0000-4000-8000-000000000012', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '91000002-1111-4111-8111-000000000002',
   'Primer and sealer - scope pending', null, null, 'draft', 1, null, null, now() - interval '1 day', '70000001-0000-4000-8000-000000000001');

insert into public.rfq_items (id, rfq_id, product_id, product_name, unit, quantity, note)
values
  ('d8100001-0000-4000-8000-000000000001', 'd8000001-0000-4000-8000-000000000001', 'd7000004-0000-4000-8000-000000000004', 'Interior Emulsion - Matte White', 'liter', 600, 'Two coats over primer'),
  ('d8100002-0000-4000-8000-000000000002', 'd8000002-0000-4000-8000-000000000002', 'd7000002-0000-4000-8000-000000000002', 'Tempered Glass Partition 10mm', 'square_meter', 200, 'Polished edges'),
  ('d8100003-0000-4000-8000-000000000003', 'd8000003-0000-4000-8000-000000000003', 'd7000008-0000-4000-8000-000000000008', 'Silicone Sealant - Neutral', 'piece', 500, null),
  ('d8100004-0000-4000-8000-000000000004', 'd8000003-0000-4000-8000-000000000003', 'd7000009-0000-4000-8000-000000000009', 'Gypsum Board 12.5mm', 'piece', 900, null),
  ('d8100005-0000-4000-8000-000000000005', 'd8000004-0000-4000-8000-000000000004', 'd7000011-0000-4000-8000-000000000011', 'Galala Marble Slab', 'square_meter', 250, 'Cut to counter schedule'),
  ('d8100006-0000-4000-8000-000000000006', 'd8000005-0000-4000-8000-000000000005', 'd7000006-0000-4000-8000-000000000006', 'Ceramic Wash Basin', 'piece', 40, null),
  ('d8100007-0000-4000-8000-000000000007', 'd8000005-0000-4000-8000-000000000005', 'd7000007-0000-4000-8000-000000000007', 'Concealed Cistern Set', 'set', 40, null),
  ('d8100008-0000-4000-8000-000000000008', 'd8000006-0000-4000-8000-000000000006', 'd7000009-0000-4000-8000-000000000009', 'Gypsum Board 12.5mm', 'piece', 875, 'Ceiling package'),
  ('d8100009-0000-4000-8000-000000000009', 'd8000007-0000-4000-8000-000000000007', 'd7000005-0000-4000-8000-000000000005', 'Exterior Weather Coat', 'liter', 340, 'Sand colour'),
  ('d8100010-0000-4000-8000-000000000010', 'd8000008-0000-4000-8000-000000000008', 'd7000006-0000-4000-8000-000000000006', 'Ceramic Wash Basin', 'piece', 100, 'Staged over three deliveries'),
  ('d8100011-0000-4000-8000-000000000011', 'd8000009-0000-4000-8000-000000000009', 'd7000003-0000-4000-8000-000000000003', 'Aluminium Window Profile', 'linear_meter', 440, null),
  ('d8100012-0000-4000-8000-000000000012', 'd8000010-0000-4000-8000-000000000010', 'd7000010-0000-4000-8000-000000000010', 'LED Strip 5m - Warm White', 'roll', 90, null),
  ('d8100013-0000-4000-8000-000000000013', 'd8000011-0000-4000-8000-000000000011', 'd7000012-0000-4000-8000-000000000012', 'SPC Click Flooring', 'square_meter', 60, 'Two colours'),
  ('d8100014-0000-4000-8000-000000000014', 'd8000012-0000-4000-8000-000000000012', 'd7000004-0000-4000-8000-000000000004', 'Interior Emulsion - Matte White', 'liter', 120, 'Quantity to confirm');

-- Offers received. Totals equal the sum of their lines exactly (the RPCs derive
-- them; a seeded row must not disagree with its own items).
insert into public.quotations (id, rfq_id, supplier_org_id, requester_org_id, note, validity_date, subtotal, total, status, version, submitted_at, decided_at, decided_by, created_at, created_by)
values
  ('d9000001-0000-4000-8000-000000000001', 'd8000001-0000-4000-8000-000000000001', '91000002-1111-4111-8111-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', 'Delivery to Nasr City included.', (now() - interval '168 days')::date, 54000, 54000, 'accepted', 1, now() - interval '183 days', now() - interval '180 days', '70000001-0000-4000-8000-000000000001', now() - interval '184 days', '71000002-0000-4000-8000-000000000002'),
  ('d9000002-0000-4000-8000-000000000002', 'd8000002-0000-4000-8000-000000000002', '91000001-1111-4111-8111-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', 'Site survey before cutting.', (now() - interval '138 days')::date, 268000, 268000, 'accepted', 1, now() - interval '152 days', now() - interval '150 days', '70000001-0000-4000-8000-000000000001', now() - interval '153 days', '71000001-0000-4000-8000-000000000001'),
  ('d9000003-0000-4000-8000-000000000003', 'd8000003-0000-4000-8000-000000000003', '9f000000-ffff-4fff-8fff-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'Depot collection or delivery at cost.', (now() - interval '110 days')::date, 121000, 121000, 'accepted', 1, now() - interval '122 days', now() - interval '120 days', '70000001-0000-4000-8000-000000000001', now() - interval '123 days', '70000005-0000-4000-8000-000000000005'),
  ('d9000004-0000-4000-8000-000000000004', 'd8000004-0000-4000-8000-000000000004', '9d000000-dddd-4ddd-8ddd-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', 'Slab selection at the plant.', (now() - interval '78 days')::date, 415000, 415000, 'accepted', 1, now() - interval '92 days', now() - interval '90 days', '70000001-0000-4000-8000-000000000001', now() - interval '93 days', '70000003-0000-4000-8000-000000000003'),
  ('d9000005-0000-4000-8000-000000000005', 'd8000005-0000-4000-8000-000000000005', '91000003-1111-4111-8111-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001', 'Stock held for fourteen days.', (now() - interval '45 days')::date, 96400, 96400, 'accepted', 1, now() - interval '59 days', now() - interval '57 days', '70000001-0000-4000-8000-000000000001', now() - interval '60 days', '71000003-0000-4000-8000-000000000003'),
  ('d9000006-0000-4000-8000-000000000006', 'd8000006-0000-4000-8000-000000000006', '9f000000-ffff-4fff-8fff-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'Two deliveries, one week apart.', (now() + interval '4 days')::date, 87500, 87500, 'accepted', 1, now() - interval '23 days', now() - interval '21 days', '70000001-0000-4000-8000-000000000001', now() - interval '24 days', '70000005-0000-4000-8000-000000000005'),
  ('d9000007-0000-4000-8000-000000000007', 'd8000007-0000-4000-8000-000000000007', '91000002-1111-4111-8111-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', 'Colour matched to sample.', (now() + interval '20 days')::date, 61200, 61200, 'accepted', 1, now() - interval '8 days', now() - interval '7 days', '70000001-0000-4000-8000-000000000001', now() - interval '9 days', '71000002-0000-4000-8000-000000000002'),
  -- Waiting on the showroom's decision.
  ('d9000008-0000-4000-8000-000000000008', 'd8000008-0000-4000-8000-000000000008', '91000003-1111-4111-8111-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001', 'Price holds for the full hundred.', (now() + interval '11 days')::date, 132000, 132000, 'submitted', 1, now() - interval '3 days', null, null, now() - interval '4 days', '71000003-0000-4000-8000-000000000003'),
  ('d9000009-0000-4000-8000-000000000009', 'd8000009-0000-4000-8000-000000000009', '91000001-1111-4111-8111-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', 'Anodised finish, four week lead.', (now() + interval '16 days')::date, 74800, 74800, 'submitted', 1, now() - interval '2 days', null, null, now() - interval '3 days', '71000001-0000-4000-8000-000000000001'),
  -- Declined: the price did not work.
  ('d9000010-0000-4000-8000-000000000010', 'd8000010-0000-4000-8000-000000000010', '9f000000-ffff-4fff-8fff-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'Reels ex-stock.', (now() + interval '8 days')::date, 18900, 18900, 'rejected', 1, now() - interval '3 days', now() - interval '1 day', '70000001-0000-4000-8000-000000000001', now() - interval '4 days', '70000005-0000-4000-8000-000000000005');

insert into public.quotation_items (quotation_id, rfq_item_id, product_name, unit, quantity, unit_price)
values
  ('d9000001-0000-4000-8000-000000000001', 'd8100001-0000-4000-8000-000000000001', 'Interior Emulsion - Matte White', 'liter', 600, 90),
  ('d9000002-0000-4000-8000-000000000002', 'd8100002-0000-4000-8000-000000000002', 'Tempered Glass Partition 10mm', 'square_meter', 200, 1340),
  ('d9000003-0000-4000-8000-000000000003', 'd8100003-0000-4000-8000-000000000003', 'Silicone Sealant - Neutral', 'piece', 500, 62),
  ('d9000003-0000-4000-8000-000000000003', 'd8100004-0000-4000-8000-000000000004', 'Gypsum Board 12.5mm', 'piece', 900, 100),
  ('d9000004-0000-4000-8000-000000000004', 'd8100005-0000-4000-8000-000000000005', 'Galala Marble Slab', 'square_meter', 250, 1660),
  ('d9000005-0000-4000-8000-000000000005', 'd8100006-0000-4000-8000-000000000006', 'Ceramic Wash Basin', 'piece', 40, 1210),
  ('d9000005-0000-4000-8000-000000000005', 'd8100007-0000-4000-8000-000000000007', 'Concealed Cistern Set', 'set', 40, 1200),
  ('d9000006-0000-4000-8000-000000000006', 'd8100008-0000-4000-8000-000000000008', 'Gypsum Board 12.5mm', 'piece', 875, 100),
  ('d9000007-0000-4000-8000-000000000007', 'd8100009-0000-4000-8000-000000000009', 'Exterior Weather Coat', 'liter', 340, 180),
  ('d9000008-0000-4000-8000-000000000008', 'd8100010-0000-4000-8000-000000000010', 'Ceramic Wash Basin', 'piece', 100, 1320),
  ('d9000009-0000-4000-8000-000000000009', 'd8100011-0000-4000-8000-000000000011', 'Aluminium Window Profile', 'linear_meter', 440, 170),
  ('d9000010-0000-4000-8000-000000000010', 'd8100012-0000-4000-8000-000000000012', 'LED Strip 5m - Warm White', 'roll', 90, 210);

insert into public.orders (id, quotation_id, rfq_id, requester_org_id, supplier_org_id, requester_branch_id, title, note, subtotal, total, status, version, confirmed_at, started_at, completed_at, created_at, created_by)
values
  ('da000001-0000-4000-8000-000000000001', 'd9000001-0000-4000-8000-000000000001', 'd8000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', '91000002-1111-4111-8111-000000000002', 'b0000001-0000-4000-8000-000000000001', 'Emulsion paint - showroom refit', 'Delivery to Nasr City included.', 54000, 54000, 'completed', 3, now() - interval '180 days', now() - interval '178 days', now() - interval '170 days', now() - interval '180 days', '70000001-0000-4000-8000-000000000001'),
  ('da000002-0000-4000-8000-000000000002', 'd9000002-0000-4000-8000-000000000002', 'd8000002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', '91000001-1111-4111-8111-000000000001', 'b0000001-0000-4000-8000-000000000001', 'Glass partitions - Fifth Settlement villa', 'Site survey before cutting.', 268000, 268000, 'completed', 3, now() - interval '150 days', now() - interval '147 days', now() - interval '132 days', now() - interval '150 days', '70000001-0000-4000-8000-000000000001'),
  ('da000003-0000-4000-8000-000000000003', 'd9000003-0000-4000-8000-000000000003', 'd8000003-0000-4000-8000-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001', '9f000000-ffff-4fff-8fff-000000000004', 'b0000001-0000-4000-8000-000000000001', 'Consumables restock', null, 121000, 121000, 'completed', 3, now() - interval '120 days', now() - interval '119 days', now() - interval '112 days', now() - interval '120 days', '70000001-0000-4000-8000-000000000001'),
  ('da000004-0000-4000-8000-000000000004', 'd9000004-0000-4000-8000-000000000004', 'd8000004-0000-4000-8000-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', '9d000000-dddd-4ddd-8ddd-000000000002', 'b0000001-0000-4000-8000-000000000001', 'Galala marble - reception counters', 'Slab selection at the plant.', 415000, 415000, 'completed', 3, now() - interval '90 days', now() - interval '87 days', now() - interval '70 days', now() - interval '90 days', '70000001-0000-4000-8000-000000000001'),
  ('da000005-0000-4000-8000-000000000005', 'd9000005-0000-4000-8000-000000000005', 'd8000005-0000-4000-8000-000000000005', '9c000000-cccc-4ccc-8ccc-000000000001', '91000003-1111-4111-8111-000000000003', 'b0000001-0000-4000-8000-000000000001', 'Sanitary ware - Maadi package', 'Stock held for fourteen days.', 96400, 96400, 'completed', 3, now() - interval '57 days', now() - interval '55 days', now() - interval '44 days', now() - interval '57 days', '70000002-0000-4000-8000-000000000002'),
  ('da000006-0000-4000-8000-000000000006', 'd9000006-0000-4000-8000-000000000006', 'd8000006-0000-4000-8000-000000000006', '9c000000-cccc-4ccc-8ccc-000000000001', '9f000000-ffff-4fff-8fff-000000000004', 'b0000001-0000-4000-8000-000000000001', 'Gypsum boards - ceiling works', 'Two deliveries, one week apart.', 87500, 87500, 'in_progress', 2, now() - interval '21 days', now() - interval '18 days', null, now() - interval '21 days', '70000001-0000-4000-8000-000000000001'),
  ('da000007-0000-4000-8000-000000000007', 'd9000007-0000-4000-8000-000000000007', 'd8000007-0000-4000-8000-000000000007', '9c000000-cccc-4ccc-8ccc-000000000001', '91000002-1111-4111-8111-000000000002', 'b0000001-0000-4000-8000-000000000001', 'Exterior coating - Zayed facade', 'Colour matched to sample.', 61200, 61200, 'confirmed', 1, now() - interval '7 days', null, null, now() - interval '7 days', '70000001-0000-4000-8000-000000000001');

insert into public.order_items (order_id, product_name, unit, quantity, unit_price)
values
  ('da000001-0000-4000-8000-000000000001', 'Interior Emulsion - Matte White', 'liter', 600, 90),
  ('da000002-0000-4000-8000-000000000002', 'Tempered Glass Partition 10mm', 'square_meter', 200, 1340),
  ('da000003-0000-4000-8000-000000000003', 'Silicone Sealant - Neutral', 'piece', 500, 62),
  ('da000003-0000-4000-8000-000000000003', 'Gypsum Board 12.5mm', 'piece', 900, 100),
  ('da000004-0000-4000-8000-000000000004', 'Galala Marble Slab', 'square_meter', 250, 1660),
  ('da000005-0000-4000-8000-000000000005', 'Ceramic Wash Basin', 'piece', 40, 1210),
  ('da000005-0000-4000-8000-000000000005', 'Concealed Cistern Set', 'set', 40, 1200),
  ('da000006-0000-4000-8000-000000000006', 'Gypsum Board 12.5mm', 'piece', 875, 100),
  ('da000007-0000-4000-8000-000000000007', 'Exterior Weather Coat', 'liter', 340, 180);

-- Delivery work coming INTO the showroom (it is the requester on these).
insert into public.projects (id, order_id, requester_org_id, executing_org_id, branch_id, title, location, description, start_date, target_date, status, version, activated_at, completed_at, created_at, created_by)
values
  ('db000001-0000-4000-8000-000000000001', 'da000002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', '91000001-1111-4111-8111-000000000001', 'b0000001-0000-4000-8000-000000000001',
   'Glass partition installation - Fifth Settlement', 'Fifth Settlement, New Cairo', 'Survey, fabrication and installation of tempered glass partitions.',
   (now() - interval '147 days')::date, (now() - interval '130 days')::date, 'completed', 3, now() - interval '147 days', now() - interval '132 days', now() - interval '148 days', '70000001-0000-4000-8000-000000000001'),
  ('db000002-0000-4000-8000-000000000002', 'da000006-0000-4000-8000-000000000006', '9c000000-cccc-4ccc-8ccc-000000000001', '9f000000-ffff-4fff-8fff-000000000004', 'b0000001-0000-4000-8000-000000000001',
   'Ceiling board delivery - Nasr City', 'Nasr City, Cairo', 'Staged delivery of gypsum board for the ceiling package.',
   (now() - interval '18 days')::date, (now() + interval '6 days')::date, 'active', 2, now() - interval '18 days', null, now() - interval '21 days', '70000001-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- 10.7 The showroom's SELLING chain - work it delivers for its own customers
-- ---------------------------------------------------------------------------
insert into public.rfqs (id, requester_org_id, requester_branch_id, supplier_org_id, title, note, required_date, status, version, submitted_at, closed_at, created_at, created_by)
values
  ('dc000001-0000-4000-8000-000000000001', '91000004-1111-4111-8111-000000000004', 'b1000004-0000-4000-8000-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Porcelain flooring - Maadi apartment', 'Full apartment, 500 square metres.', (now() - interval '55 days')::date, 'closed', 3, now() - interval '75 days', now() - interval '68 days', now() - interval '76 days', '71000004-0000-4000-8000-000000000004'),
  ('dc000002-0000-4000-8000-000000000002', '91000005-1111-4111-8111-000000000005', 'b1000005-0000-4000-8000-000000000005', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Ceramic wall tile - display refresh', 'Two hundred square metres.', (now() + interval '21 days')::date, 'quoted', 2, now() - interval '6 days', null, now() - interval '7 days', '71000005-0000-4000-8000-000000000005'),
  ('dc000003-0000-4000-8000-000000000003', '91000004-1111-4111-8111-000000000004', 'b1000004-0000-4000-8000-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Marble - Fifth Settlement villa', 'Stairs and reception counters.', (now() + interval '40 days')::date, 'closed', 3, now() - interval '18 days', now() - interval '12 days', now() - interval '19 days', '71000004-0000-4000-8000-000000000004'),
  ('dc000004-0000-4000-8000-000000000004', '9a000000-aaaa-4aaa-8aaa-000000000005', 'b0000005-0000-4000-8000-000000000005', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Wall tile - Sheikh Zayed phase two', 'Awaiting your price.', (now() + interval '35 days')::date, 'submitted', 1, now() - interval '1 day', null, now() - interval '1 day', '70000006-0000-4000-8000-000000000006');

insert into public.rfq_items (id, rfq_id, product_id, product_name, unit, quantity, note)
values
  ('dc100001-0000-4000-8000-000000000001', 'dc000001-0000-4000-8000-000000000001', 'd1000001-0000-4000-8000-000000000001', 'Porcelain Floor Tile 60x60', 'square_meter', 500, null),
  ('dc100002-0000-4000-8000-000000000002', 'dc000002-0000-4000-8000-000000000002', 'd7000001-0000-4000-8000-000000000001', 'Ceramic Wall Tile 30x60', 'square_meter', 200, null),
  ('dc100003-0000-4000-8000-000000000003', 'dc000003-0000-4000-8000-000000000003', 'd1000003-0000-4000-8000-000000000003', 'Marble Slab (Galala)', 'square_meter', 150, 'Stairs plus counters'),
  ('dc100004-0000-4000-8000-000000000004', 'dc000004-0000-4000-8000-000000000004', 'd7000001-0000-4000-8000-000000000001', 'Ceramic Wall Tile 30x60', 'square_meter', 320, null);

insert into public.quotations (id, rfq_id, supplier_org_id, requester_org_id, note, validity_date, subtotal, total, status, version, submitted_at, decided_at, decided_by, created_at, created_by)
values
  ('dd000001-0000-4000-8000-000000000001', 'dc000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', '91000004-1111-4111-8111-000000000004', 'Includes delivery and offloading.', (now() - interval '58 days')::date, 182500, 182500, 'accepted', 1, now() - interval '72 days', now() - interval '70 days', '71000004-0000-4000-8000-000000000004', now() - interval '73 days', '70000002-0000-4000-8000-000000000002'),
  ('dd000002-0000-4000-8000-000000000002', 'dc000002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', '91000005-1111-4111-8111-000000000005', 'Ex-stock, collection from Nasr City.', (now() + interval '9 days')::date, 64300, 64300, 'submitted', 1, now() - interval '4 days', null, null, now() - interval '5 days', '70000002-0000-4000-8000-000000000002'),
  ('dd000003-0000-4000-8000-000000000003', 'dc000003-0000-4000-8000-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001', '91000004-1111-4111-8111-000000000004', 'Slab selection with the client.', (now() + interval '22 days')::date, 240000, 240000, 'accepted', 1, now() - interval '15 days', now() - interval '12 days', '71000004-0000-4000-8000-000000000004', now() - interval '16 days', '70000001-0000-4000-8000-000000000001');

insert into public.quotation_items (quotation_id, rfq_item_id, product_name, unit, quantity, unit_price)
values
  ('dd000001-0000-4000-8000-000000000001', 'dc100001-0000-4000-8000-000000000001', 'Porcelain Floor Tile 60x60', 'square_meter', 500, 365),
  ('dd000002-0000-4000-8000-000000000002', 'dc100002-0000-4000-8000-000000000002', 'Ceramic Wall Tile 30x60', 'square_meter', 200, 321.50),
  ('dd000003-0000-4000-8000-000000000003', 'dc100003-0000-4000-8000-000000000003', 'Marble Slab (Galala)', 'square_meter', 150, 1600);

insert into public.orders (id, quotation_id, rfq_id, requester_org_id, supplier_org_id, requester_branch_id, title, note, subtotal, total, status, version, confirmed_at, started_at, completed_at, created_at, created_by)
values
  ('de000001-0000-4000-8000-000000000001', 'dd000001-0000-4000-8000-000000000001', 'dc000001-0000-4000-8000-000000000001', '91000004-1111-4111-8111-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'b1000004-0000-4000-8000-000000000004', 'Porcelain flooring - Maadi apartment', 'Includes delivery and offloading.', 182500, 182500, 'completed', 3, now() - interval '70 days', now() - interval '68 days', now() - interval '52 days', now() - interval '70 days', '71000004-0000-4000-8000-000000000004'),
  ('de000002-0000-4000-8000-000000000002', 'dd000003-0000-4000-8000-000000000003', 'dc000003-0000-4000-8000-000000000003', '91000004-1111-4111-8111-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'b1000004-0000-4000-8000-000000000004', 'Marble - Fifth Settlement villa', 'Slab selection with the client.', 240000, 240000, 'confirmed', 1, now() - interval '12 days', null, null, now() - interval '12 days', '71000004-0000-4000-8000-000000000004');

insert into public.order_items (order_id, product_name, unit, quantity, unit_price)
values
  ('de000001-0000-4000-8000-000000000001', 'Porcelain Floor Tile 60x60', 'square_meter', 500, 365),
  ('de000002-0000-4000-8000-000000000002', 'Marble Slab (Galala)', 'square_meter', 150, 1600);

insert into public.projects (id, order_id, requester_org_id, executing_org_id, branch_id, title, location, description, start_date, target_date, status, version, activated_at, completed_at, created_at, created_by)
values
  ('df000001-0000-4000-8000-000000000001', 'de000001-0000-4000-8000-000000000001', '91000004-1111-4111-8111-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'b1000004-0000-4000-8000-000000000004',
   'Maadi apartment finishing', 'Maadi, Cairo', 'Supply and delivery of porcelain flooring for a full apartment fit-out.',
   (now() - interval '68 days')::date, (now() - interval '50 days')::date, 'completed', 3, now() - interval '68 days', now() - interval '52 days', now() - interval '69 days', '70000001-0000-4000-8000-000000000001'),
  ('df000002-0000-4000-8000-000000000002', 'de000002-0000-4000-8000-000000000002', '91000004-1111-4111-8111-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'b1000004-0000-4000-8000-000000000004',
   'Fifth Settlement villa - marble package', 'Fifth Settlement, New Cairo', 'Marble stairs and reception counters, cut and delivered to schedule.',
   (now() + interval '5 days')::date, (now() + interval '45 days')::date, 'planned', 1, null, null, now() - interval '12 days', '70000001-0000-4000-8000-000000000001');


-- ===========================================================================
-- 11. SUPPLY-SIDE ACCEPTANCE WORLD (Sprint 15)
-- ===========================================================================
-- Sections 1-10 built the world from the SHOWROOM's seat. Everything a
-- supply-side organization needs already existed as the far end of those same
-- records — but only the far end of a chain the showroom had already finished.
-- Reading Suez Paints' workspace, every request was closed, every quotation
-- decided, every order delivered. The supply side's three most important states
-- were therefore unreachable:
--
--   * a request SUBMITTED and not yet priced   — the work queue, and the only
--     number on the dashboard with a clock running on it;
--   * a quotation SENT and not yet decided     — value at stake;
--   * an order IN PROGRESS                     — something to fulfil today.
--
-- and each org had exactly ONE customer, so "top customers" was a bar chart with
-- one bar and the customer network was a list of one.
--
-- This section fixes that with the smallest addition that makes all three
-- workspaces demonstrable: no new organizations, no new people, no new branches
-- and no new memberships — only commerce between businesses that ALREADY exist,
-- plus one published and one draft product each so the catalogue module has both
-- of its states.
--
-- The three acceptance accounts, in manual-priority order:
--   1. Distributor   Rania Gamal   rania@example.test    Suez Paints & Coatings
--   2. Manufacturer  Mahmoud Ezzat mahmoud@example.test  Alexandria Glass & Aluminium
--   3. Importer      Fady Riad     fady@example.test     Cairo Sanitary Ware Trading
--
-- The Distributor deliberately gets the deepest queue: it is the primary
-- acceptance account and the one whose screens are reviewed first.
--
-- Dates are relative (now() - interval ...) exactly as above, so the trend line,
-- the funnel and the "waiting on you" states stay true whenever the seed is run.
-- Every quotation total equals the sum of its own items — the RPCs derive totals,
-- and a seeded row must never disagree with its own lines.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 11.1 One more published line and one DRAFT for each supply-side catalogue
-- ---------------------------------------------------------------------------
-- The draft is not filler: products.status is draft | published, and nothing in
-- sections 1-10 seeds a draft at all, so the Drafts tab, the "not visible to
-- buyers yet" tile and the publish action had no data to act on.
insert into public.products (id, organization_id, name, sku, category, brand, short_description, unit, image_ref, status, published_at, created_by)
values
  -- Alexandria Glass & Aluminium (manufacturer)
  ('d7000014-0000-4000-8000-000000000014', '91000001-1111-4111-8111-000000000001',
   'Glass Balustrade System', 'GLS-BAL', 'construction', 'AlexGlass',
   'Frameless glass balustrade with base channel, for stairs and terraces.', 'linear_meter',
   '/demo/products/glass-panel.svg', 'published', now() - interval '40 days', '71000001-0000-4000-8000-000000000001'),
  ('d7000015-0000-4000-8000-000000000015', '91000001-1111-4111-8111-000000000001',
   'Acoustic Double Glazing', 'GLS-ACS', 'construction', 'AlexGlass',
   'Laminated acoustic double-glazed unit for street-facing facades.', 'square_meter',
   '/demo/products/glass-panel.svg', 'draft', null, '71000001-0000-4000-8000-000000000001'),

  -- Suez Paints & Coatings (Distributor)
  ('d7000016-0000-4000-8000-000000000016', '91000002-1111-4111-8111-000000000002',
   'Epoxy Floor Coating', 'PNT-EPX', 'finishing', 'SuezCoat',
   'Two-part epoxy floor coating for workshops and service areas.', 'liter',
   '/demo/products/wall-paint.svg', 'published', now() - interval '52 days', '71000002-0000-4000-8000-000000000002'),
  ('d7000017-0000-4000-8000-000000000017', '91000002-1111-4111-8111-000000000002',
   'Anti-Rust Metal Primer', 'PNT-ARP', 'finishing', 'SuezCoat',
   'Zinc-phosphate primer for structural steel and joinery.', 'liter',
   '/demo/products/wall-paint.svg', 'draft', null, '71000002-0000-4000-8000-000000000002'),

  -- Cairo Sanitary Ware Trading (importer)
  ('d7000018-0000-4000-8000-000000000018', '91000003-1111-4111-8111-000000000003',
   'Imported Shower Mixer', 'SAN-MIX', 'supply', 'CairoSanitary',
   'Thermostatic shower mixer, chrome finish, imported.', 'piece',
   '/demo/products/sanitary-basin.svg', 'published', now() - interval '35 days', '71000003-0000-4000-8000-000000000003'),
  ('d7000019-0000-4000-8000-000000000019', '91000003-1111-4111-8111-000000000003',
   'Wall-Hung WC Pan', 'SAN-WHP', 'supply', 'CairoSanitary',
   'Rimless wall-hung pan with soft-close seat.', 'piece',
   '/demo/products/sanitary-basin.svg', 'draft', null, '71000003-0000-4000-8000-000000000003');

-- ---------------------------------------------------------------------------
-- 11.2 Requests waiting to be priced, from businesses that already exist
-- ---------------------------------------------------------------------------
-- Status submitted, with no quotation behind it. These are what the supply-side
-- dashboard's leading tile counts and what its work queue lists.
insert into public.rfqs (id, requester_org_id, requester_branch_id, supplier_org_id, title, note, required_date, status, version, submitted_at, closed_at, created_at, created_by)
values
  -- To Alexandria Glass & Aluminium (manufacturer)
  ('e1000001-0000-4000-8000-000000000001', '9a000000-aaaa-4aaa-8aaa-000000000005', 'b0000005-0000-4000-8000-000000000005', '91000001-1111-4111-8111-000000000001',
   'Glass partitions - New Cairo tower', 'Office floors 3 to 7. Tempered, polished edges.', (now() + interval '38 days')::date, 'submitted', 1, now() - interval '1 day', null, now() - interval '1 day', '70000006-0000-4000-8000-000000000006'),
  ('e1000002-0000-4000-8000-000000000002', '91000004-1111-4111-8111-000000000004', 'b1000004-0000-4000-8000-000000000004', '91000001-1111-4111-8111-000000000001',
   'Balustrade - villa staircase', 'Frameless, satin base channel.', (now() + interval '26 days')::date, 'submitted', 1, now() - interval '3 hours', null, now() - interval '3 hours', '71000004-0000-4000-8000-000000000004'),

  -- To Suez Paints & Coatings (Distributor - the deepest queue)
  ('e1000011-0000-4000-8000-000000000011', '91000005-1111-4111-8111-000000000005', 'b1000005-0000-4000-8000-000000000005', '91000002-1111-4111-8111-000000000002',
   'Emulsion - showroom repaint', 'Matte white, display walls and ceiling.', (now() + interval '15 days')::date, 'submitted', 1, now() - interval '4 hours', null, now() - interval '4 hours', '71000005-0000-4000-8000-000000000005'),
  ('e1000012-0000-4000-8000-000000000012', '9a000000-aaaa-4aaa-8aaa-000000000005', 'b0000005-0000-4000-8000-000000000005', '91000002-1111-4111-8111-000000000002',
   'Epoxy floor - workshop bays', 'Two coats over primed screed.', (now() + interval '22 days')::date, 'submitted', 1, now() - interval '1 day', null, now() - interval '1 day', '70000006-0000-4000-8000-000000000006'),
  ('e1000013-0000-4000-8000-000000000013', '91000004-1111-4111-8111-000000000004', 'b1000004-0000-4000-8000-000000000004', '91000002-1111-4111-8111-000000000002',
   'Weather coat - villa facade', 'Elastomeric, off-white.', (now() + interval '31 days')::date, 'submitted', 1, now() - interval '2 days', null, now() - interval '2 days', '71000004-0000-4000-8000-000000000004'),

  -- To Cairo Sanitary Ware Trading (importer)
  ('e1000021-0000-4000-8000-000000000021', '91000004-1111-4111-8111-000000000004', 'b1000004-0000-4000-8000-000000000004', '91000003-1111-4111-8111-000000000003',
   'Sanitary package - Maadi villa', 'Basins for six bathrooms.', (now() + interval '19 days')::date, 'submitted', 1, now() - interval '6 hours', null, now() - interval '6 hours', '71000004-0000-4000-8000-000000000004'),
  ('e1000022-0000-4000-8000-000000000022', '9a000000-aaaa-4aaa-8aaa-000000000005', 'b0000005-0000-4000-8000-000000000005', '91000003-1111-4111-8111-000000000003',
   'Shower mixers - hotel fit-out', 'One hundred and fifty rooms, staged delivery.', (now() + interval '45 days')::date, 'submitted', 1, now() - interval '2 days', null, now() - interval '2 days', '70000006-0000-4000-8000-000000000006');

-- ---------------------------------------------------------------------------
-- 11.3 Priced, waiting on the CUSTOMER's decision
-- ---------------------------------------------------------------------------
insert into public.rfqs (id, requester_org_id, requester_branch_id, supplier_org_id, title, note, required_date, status, version, submitted_at, closed_at, created_at, created_by)
values
  ('e1000003-0000-4000-8000-000000000003', '91000005-1111-4111-8111-000000000005', 'b1000005-0000-4000-8000-000000000005', '91000001-1111-4111-8111-000000000001',
   'Window profiles - showroom facade', 'Thermal break, anodised silver.', (now() + interval '33 days')::date, 'quoted', 2, now() - interval '6 days', null, now() - interval '7 days', '71000005-0000-4000-8000-000000000005'),
  ('e1000015-0000-4000-8000-000000000015', '9a000000-aaaa-4aaa-8aaa-000000000005', 'b0000005-0000-4000-8000-000000000005', '91000002-1111-4111-8111-000000000002',
   'Primer and emulsion - Nasr City block', 'Twelve apartments, handover finish.', (now() + interval '28 days')::date, 'quoted', 2, now() - interval '5 days', null, now() - interval '6 days', '70000006-0000-4000-8000-000000000006'),
  ('e1000023-0000-4000-8000-000000000023', '91000005-1111-4111-8111-000000000005', 'b1000005-0000-4000-8000-000000000005', '91000003-1111-4111-8111-000000000003',
   'Concealed cisterns - display units', 'For the bathroom display corner.', (now() + interval '20 days')::date, 'quoted', 2, now() - interval '4 days', null, now() - interval '5 days', '71000005-0000-4000-8000-000000000005');

-- ---------------------------------------------------------------------------
-- 11.4 Won and being fulfilled, plus one older completed chain for the trend
-- ---------------------------------------------------------------------------
insert into public.rfqs (id, requester_org_id, requester_branch_id, supplier_org_id, title, note, required_date, status, version, submitted_at, closed_at, created_at, created_by)
values
  ('e1000004-0000-4000-8000-000000000004', '9a000000-aaaa-4aaa-8aaa-000000000005', 'b0000005-0000-4000-8000-000000000005', '91000001-1111-4111-8111-000000000001',
   'Glazing package - Fifth Settlement', 'Survey before fabrication.', (now() + interval '24 days')::date, 'closed', 3, now() - interval '34 days', now() - interval '28 days', now() - interval '35 days', '70000006-0000-4000-8000-000000000006'),
  ('e1000016-0000-4000-8000-000000000016', '91000004-1111-4111-8111-000000000004', 'b1000004-0000-4000-8000-000000000004', '91000002-1111-4111-8111-000000000002',
   'Interior paint - Maadi apartments', 'Eight apartments, two coats.', (now() + interval '12 days')::date, 'closed', 3, now() - interval '30 days', now() - interval '24 days', now() - interval '31 days', '71000004-0000-4000-8000-000000000004'),
  ('e1000017-0000-4000-8000-000000000017', '91000005-1111-4111-8111-000000000005', 'b1000005-0000-4000-8000-000000000005', '91000002-1111-4111-8111-000000000002',
   'Exterior coat - Zayed branch', 'Facade refresh before opening.', (now() - interval '70 days')::date, 'closed', 3, now() - interval '98 days', now() - interval '92 days', now() - interval '99 days', '71000005-0000-4000-8000-000000000005'),
  ('e1000024-0000-4000-8000-000000000024', '9a000000-aaaa-4aaa-8aaa-000000000005', 'b0000005-0000-4000-8000-000000000005', '91000003-1111-4111-8111-000000000003',
   'Basins - New Cairo tower', 'Two hundred units, staged by floor.', (now() + interval '29 days')::date, 'closed', 3, now() - interval '26 days', now() - interval '20 days', now() - interval '27 days', '70000006-0000-4000-8000-000000000006');

insert into public.rfq_items (id, rfq_id, product_id, product_name, unit, quantity, note)
values
  ('e2000001-0000-4000-8000-000000000001', 'e1000001-0000-4000-8000-000000000001', 'd7000002-0000-4000-8000-000000000002', 'Tempered Glass Partition 10mm', 'square_meter', 320, 'Floors 3-7'),
  ('e2000002-0000-4000-8000-000000000002', 'e1000002-0000-4000-8000-000000000002', 'd7000014-0000-4000-8000-000000000014', 'Glass Balustrade System', 'linear_meter', 85, null),
  ('e2000003-0000-4000-8000-000000000003', 'e1000003-0000-4000-8000-000000000003', 'd7000003-0000-4000-8000-000000000003', 'Aluminium Window Profile', 'linear_meter', 260, 'Anodised silver'),
  ('e2000004-0000-4000-8000-000000000004', 'e1000004-0000-4000-8000-000000000004', 'd7000002-0000-4000-8000-000000000002', 'Tempered Glass Partition 10mm', 'square_meter', 480, null),

  ('e2000011-0000-4000-8000-000000000011', 'e1000011-0000-4000-8000-000000000011', 'd7000004-0000-4000-8000-000000000004', 'Interior Emulsion - Matte White', 'liter', 450, null),
  ('e2000012-0000-4000-8000-000000000012', 'e1000012-0000-4000-8000-000000000012', 'd7000016-0000-4000-8000-000000000016', 'Epoxy Floor Coating', 'liter', 900, 'Two coats'),
  ('e2000013-0000-4000-8000-000000000013', 'e1000013-0000-4000-8000-000000000013', 'd7000005-0000-4000-8000-000000000005', 'Exterior Weather Coat', 'liter', 260, 'Off-white'),
  ('e2000015-0000-4000-8000-000000000015', 'e1000015-0000-4000-8000-000000000015', 'd7000004-0000-4000-8000-000000000004', 'Interior Emulsion - Matte White', 'liter', 600, null),
  ('e2000016-0000-4000-8000-000000000016', 'e1000016-0000-4000-8000-000000000016', 'd7000004-0000-4000-8000-000000000004', 'Interior Emulsion - Matte White', 'liter', 1200, 'Eight apartments'),
  ('e2000017-0000-4000-8000-000000000017', 'e1000017-0000-4000-8000-000000000017', 'd7000005-0000-4000-8000-000000000005', 'Exterior Weather Coat', 'liter', 400, null),

  ('e2000021-0000-4000-8000-000000000021', 'e1000021-0000-4000-8000-000000000021', 'd7000006-0000-4000-8000-000000000006', 'Ceramic Wash Basin', 'piece', 24, 'Six bathrooms'),
  ('e2000022-0000-4000-8000-000000000022', 'e1000022-0000-4000-8000-000000000022', 'd7000018-0000-4000-8000-000000000018', 'Imported Shower Mixer', 'piece', 150, 'Staged delivery'),
  ('e2000023-0000-4000-8000-000000000023', 'e1000023-0000-4000-8000-000000000023', 'd7000007-0000-4000-8000-000000000007', 'Concealed Cistern Set', 'set', 30, null),
  ('e2000024-0000-4000-8000-000000000024', 'e1000024-0000-4000-8000-000000000024', 'd7000006-0000-4000-8000-000000000006', 'Ceramic Wash Basin', 'piece', 200, 'Staged by floor');

-- Quotations SENT by the supply side. Totals equal the sum of their own lines.
insert into public.quotations (id, rfq_id, supplier_org_id, requester_org_id, note, validity_date, subtotal, total, status, version, submitted_at, decided_at, decided_by, created_at, created_by)
values
  -- Out for decision (no decided_at, no decided_by).
  ('e3000003-0000-4000-8000-000000000003', 'e1000003-0000-4000-8000-000000000003', '91000001-1111-4111-8111-000000000001', '91000005-1111-4111-8111-000000000005', 'Anodised silver, four week lead.', (now() + interval '18 days')::date, 45500, 45500, 'submitted', 1, now() - interval '3 days', null, null, now() - interval '4 days', '71000001-0000-4000-8000-000000000001'),
  ('e3000015-0000-4000-8000-000000000015', 'e1000015-0000-4000-8000-000000000015', '91000002-1111-4111-8111-000000000002', '9a000000-aaaa-4aaa-8aaa-000000000005', 'Price holds for the full quantity.', (now() + interval '14 days')::date, 52800, 52800, 'submitted', 1, now() - interval '2 days', null, null, now() - interval '3 days', '71000002-0000-4000-8000-000000000002'),
  ('e3000023-0000-4000-8000-000000000023', 'e1000023-0000-4000-8000-000000000023', '91000003-1111-4111-8111-000000000003', '91000005-1111-4111-8111-000000000005', 'Ex-stock, collection from Obour.', (now() + interval '10 days')::date, 37500, 37500, 'submitted', 1, now() - interval '2 days', null, null, now() - interval '3 days', '71000003-0000-4000-8000-000000000003'),
  -- Accepted, and now orders.
  ('e3000004-0000-4000-8000-000000000004', 'e1000004-0000-4000-8000-000000000004', '91000001-1111-4111-8111-000000000001', '9a000000-aaaa-4aaa-8aaa-000000000005', 'Site survey included.', (now() - interval '26 days')::date, 628800, 628800, 'accepted', 1, now() - interval '31 days', now() - interval '28 days', '70000006-0000-4000-8000-000000000006', now() - interval '32 days', '71000001-0000-4000-8000-000000000001'),
  ('e3000016-0000-4000-8000-000000000016', 'e1000016-0000-4000-8000-000000000016', '91000002-1111-4111-8111-000000000002', '91000004-1111-4111-8111-000000000004', 'Delivery to site in two drops.', (now() - interval '22 days')::date, 103200, 103200, 'accepted', 1, now() - interval '27 days', now() - interval '24 days', '71000004-0000-4000-8000-000000000004', now() - interval '28 days', '71000002-0000-4000-8000-000000000002'),
  ('e3000017-0000-4000-8000-000000000017', 'e1000017-0000-4000-8000-000000000017', '91000002-1111-4111-8111-000000000002', '91000005-1111-4111-8111-000000000005', 'Colour matched on site.', (now() - interval '90 days')::date, 71200, 71200, 'accepted', 1, now() - interval '95 days', now() - interval '92 days', '71000005-0000-4000-8000-000000000005', now() - interval '96 days', '71000002-0000-4000-8000-000000000002'),
  ('e3000024-0000-4000-8000-000000000024', 'e1000024-0000-4000-8000-000000000024', '91000003-1111-4111-8111-000000000003', '9a000000-aaaa-4aaa-8aaa-000000000005', 'Stock held against the schedule.', (now() - interval '18 days')::date, 256000, 256000, 'accepted', 1, now() - interval '23 days', now() - interval '20 days', '70000006-0000-4000-8000-000000000006', now() - interval '24 days', '71000003-0000-4000-8000-000000000003');

insert into public.quotation_items (quotation_id, rfq_item_id, product_name, unit, quantity, unit_price)
values
  ('e3000003-0000-4000-8000-000000000003', 'e2000003-0000-4000-8000-000000000003', 'Aluminium Window Profile', 'linear_meter', 260, 175),
  ('e3000004-0000-4000-8000-000000000004', 'e2000004-0000-4000-8000-000000000004', 'Tempered Glass Partition 10mm', 'square_meter', 480, 1310),
  ('e3000015-0000-4000-8000-000000000015', 'e2000015-0000-4000-8000-000000000015', 'Interior Emulsion - Matte White', 'liter', 600, 88),
  ('e3000016-0000-4000-8000-000000000016', 'e2000016-0000-4000-8000-000000000016', 'Interior Emulsion - Matte White', 'liter', 1200, 86),
  ('e3000017-0000-4000-8000-000000000017', 'e2000017-0000-4000-8000-000000000017', 'Exterior Weather Coat', 'liter', 400, 178),
  ('e3000023-0000-4000-8000-000000000023', 'e2000023-0000-4000-8000-000000000023', 'Concealed Cistern Set', 'set', 30, 1250),
  ('e3000024-0000-4000-8000-000000000024', 'e2000024-0000-4000-8000-000000000024', 'Ceramic Wash Basin', 'piece', 200, 1280);

-- Orders the supply side must FULFIL. Three in progress and one completed, so
-- "orders to fulfil" and "orders completed" are both non-zero for the Distributor.
insert into public.orders (id, quotation_id, rfq_id, requester_org_id, supplier_org_id, requester_branch_id, title, note, subtotal, total, status, version, confirmed_at, started_at, completed_at, created_at, created_by)
values
  ('e5000004-0000-4000-8000-000000000004', 'e3000004-0000-4000-8000-000000000004', 'e1000004-0000-4000-8000-000000000004', '9a000000-aaaa-4aaa-8aaa-000000000005', '91000001-1111-4111-8111-000000000001', 'b0000005-0000-4000-8000-000000000005', 'Glazing package - Fifth Settlement', 'Site survey included.', 628800, 628800, 'in_progress', 2, now() - interval '28 days', now() - interval '25 days', null, now() - interval '28 days', '70000006-0000-4000-8000-000000000006'),
  ('e5000016-0000-4000-8000-000000000016', 'e3000016-0000-4000-8000-000000000016', 'e1000016-0000-4000-8000-000000000016', '91000004-1111-4111-8111-000000000004', '91000002-1111-4111-8111-000000000002', 'b1000004-0000-4000-8000-000000000004', 'Interior paint - Maadi apartments', 'Delivery to site in two drops.', 103200, 103200, 'in_progress', 2, now() - interval '24 days', now() - interval '21 days', null, now() - interval '24 days', '71000004-0000-4000-8000-000000000004'),
  ('e5000017-0000-4000-8000-000000000017', 'e3000017-0000-4000-8000-000000000017', 'e1000017-0000-4000-8000-000000000017', '91000005-1111-4111-8111-000000000005', '91000002-1111-4111-8111-000000000002', 'b1000005-0000-4000-8000-000000000005', 'Exterior coat - Zayed branch', 'Colour matched on site.', 71200, 71200, 'completed', 3, now() - interval '92 days', now() - interval '89 days', now() - interval '74 days', now() - interval '92 days', '71000005-0000-4000-8000-000000000005'),
  ('e5000024-0000-4000-8000-000000000024', 'e3000024-0000-4000-8000-000000000024', 'e1000024-0000-4000-8000-000000000024', '9a000000-aaaa-4aaa-8aaa-000000000005', '91000003-1111-4111-8111-000000000003', 'b0000005-0000-4000-8000-000000000005', 'Basins - New Cairo tower', 'Stock held against the schedule.', 256000, 256000, 'in_progress', 2, now() - interval '20 days', now() - interval '16 days', null, now() - interval '20 days', '70000006-0000-4000-8000-000000000006');

insert into public.order_items (order_id, product_name, unit, quantity, unit_price)
values
  ('e5000004-0000-4000-8000-000000000004', 'Tempered Glass Partition 10mm', 'square_meter', 480, 1310),
  ('e5000016-0000-4000-8000-000000000016', 'Interior Emulsion - Matte White', 'liter', 1200, 86),
  ('e5000017-0000-4000-8000-000000000017', 'Exterior Weather Coat', 'liter', 400, 178),
  ('e5000024-0000-4000-8000-000000000024', 'Ceramic Wash Basin', 'piece', 200, 1280);

-- Delivery work the supply side EXECUTES. This is what the fulfilment panel and
-- the Projects module show for a Distributor, Manufacturer or Importer — real
-- order and project state, and deliberately not carrier tracking, which has no
-- model here.
insert into public.projects (id, order_id, requester_org_id, executing_org_id, branch_id, title, location, description, start_date, target_date, status, version, activated_at, completed_at, created_at, created_by)
values
  ('e7000004-0000-4000-8000-000000000004', 'e5000004-0000-4000-8000-000000000004', '9a000000-aaaa-4aaa-8aaa-000000000005', '91000001-1111-4111-8111-000000000001', 'b0000005-0000-4000-8000-000000000005',
   'Glazing installation - Fifth Settlement tower', 'Fifth Settlement, New Cairo', 'Survey, fabrication and installation of tempered glass partitions across five office floors.',
   (now() - interval '25 days')::date, (now() + interval '20 days')::date, 'active', 2, now() - interval '25 days', null, now() - interval '28 days', '71000001-0000-4000-8000-000000000001'),
  ('e7000016-0000-4000-8000-000000000016', 'e5000016-0000-4000-8000-000000000016', '91000004-1111-4111-8111-000000000004', '91000002-1111-4111-8111-000000000002', 'b1000004-0000-4000-8000-000000000004',
   'Paint supply - Maadi apartments', 'Maadi, Cairo', 'Staged supply of interior emulsion for an eight-apartment handover.',
   (now() - interval '21 days')::date, (now() + interval '8 days')::date, 'active', 2, now() - interval '21 days', null, now() - interval '24 days', '71000002-0000-4000-8000-000000000002'),
  ('e7000024-0000-4000-8000-000000000024', 'e5000024-0000-4000-8000-000000000024', '9a000000-aaaa-4aaa-8aaa-000000000005', '91000003-1111-4111-8111-000000000003', 'b0000005-0000-4000-8000-000000000005',
   'Sanitary supply - New Cairo tower', 'New Cairo, Cairo', 'Staged delivery of imported basins, floor by floor.',
   (now() - interval '16 days')::date, (now() + interval '14 days')::date, 'active', 2, now() - interval '16 days', null, now() - interval '20 days', '71000003-0000-4000-8000-000000000003');

-- ===========================================================================
-- 12. INSTALLER JOBS DOMAIN (Increment 6)
-- ===========================================================================
-- The smallest fixture that makes the domain exercisable, and no more. Two
-- jobs and three capability grants — no applications, no assignments, no
-- progress. Those are LIFECYCLE, and a lifecycle state that arrives by INSERT
-- rather than through job_application_accept proves nothing about the authority
-- that is supposed to produce it. The pgTAP suite generates every one of them.
--
-- Both jobs belong to Horizon Contracting, which is a verified
-- contractor_company that already buys finishing work in this world — so the
-- opening is something that organization would plausibly post, not a row
-- invented to give the table a value.
-- ---------------------------------------------------------------------------

-- 12.1 Poster-side capabilities, split across two people ON PURPOSE.
--
-- Mostafa Bakr already holds org.manage, the blanket in-org unlock, so he needs
-- nothing here and reaches every job path through the fallback. Laila gets
-- job.post and NOT job.manage: she can author, publish and close an opening but
-- cannot decide who gets it. That split is the whole reason the two capabilities
-- are separate keys, and without a fixture holding exactly one of them the
-- difference is untested.
insert into public.membership_capabilities (membership_id, capability_key)
select m.id, v.capability_key
from (values
  ('70000007-0000-4000-8000-000000000007'::uuid, 'job.post')
) as v(user_id, capability_key)
join public.memberships m
  on m.user_id = v.user_id
 and m.organization_id = '9a000000-aaaa-4aaa-8aaa-000000000005'
on conflict do nothing;

-- 12.2 One OPEN opening and one DRAFT.
--
-- The draft exists to prove the negative: it must never appear in
-- open_job_opportunities, for anyone, however verified its poster is. A domain
-- whose fixtures are all discoverable cannot demonstrate that.
--
-- trade_id is resolved BY KEY, never hard-coded — public.trades.id is a
-- gen_random_uuid() default and differs on every reset.
insert into public.jobs (
  id, poster_org_id, poster_branch_id, title, description, trade_id,
  offered_amount, governorate, city, site_address,
  expected_duration_days, starts_on, status, version, published_at,
  created_by, created_at)
select v.id, '9a000000-aaaa-4aaa-8aaa-000000000005', 'b0000005-0000-4000-8000-000000000005',
       v.title, v.description, t.id, v.offered_amount,
       v.governorate, v.city, v.site_address, v.duration, v.starts_on,
       v.status::public.job_status, 1, v.published_at, v.created_by, v.created_at
from (values
  ('f1000001-0000-4000-8000-000000000001'::uuid,
   'Marble staircase cladding - Fifth Settlement',
   'Cladding a villa staircase from ground to first floor, including nosings and skirting. Materials supplied on site.',
   'marble_granite', 18000.00, 'Cairo', 'New Cairo', '12 Street 90, Fifth Settlement',
   14::smallint, (now() + interval '10 days')::date,
   'open', now() - interval '3 days',
   '70000006-0000-4000-8000-000000000006'::uuid, now() - interval '3 days'),
  ('f1000002-0000-4000-8000-000000000002'::uuid,
   'Bathroom sanitary fitting - Maadi handover',
   'Fitting basins, mixers and concealed cisterns across eight apartments ahead of handover.',
   'plumbing', 22500.00, 'Cairo', 'Maadi', '5 Road 9, Maadi',
   21::smallint, (now() + interval '25 days')::date,
   'draft', null,
   '70000006-0000-4000-8000-000000000006'::uuid, now() - interval '1 day')
) as v(id, title, description, trade_key, offered_amount, governorate, city,
       site_address, duration, starts_on, status, published_at, created_by, created_at)
join public.trades t on t.key = v.trade_key
on conflict (id) do nothing;
