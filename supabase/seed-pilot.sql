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
   '{"display_name":"Hana (Cairo Ceramics Owner)","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'youssef@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Youssef (Ceramics Salesperson)","locale":"ar"}'::jsonb, now(), now(), now()),
  ('70000003-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tarek@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Tarek (Marble Manufacturing Owner)","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000004-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sara@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Sara (Import & Trade Owner)","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000005-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'khaled@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Khaled (Wholesale Supply Owner)","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000006-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mostafa@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Mostafa (Horizon Contracting Owner)","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000007-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'laila@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Laila (Horizon Org Manager)","locale":"en"}'::jsonb, now(), now(), now()),
  ('70000008-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'yasser@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Yasser (Site Engineer)","locale":"ar"}'::jsonb, now(), now(), now()),
  ('70000009-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ahmed@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Ahmed (Installer / Technician)","locale":"ar"}'::jsonb, now(), now(), now()),
  ('70000010-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'nour@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Nour (Invited Employee)","locale":"en"}'::jsonb, now(), now(), now());

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

-- Primary account types (bootstrap defaults everyone to end_consumer + pending).
update public.users set primary_account_type = 'showroom_dealer',      status = 'active' where id = '70000001-0000-4000-8000-000000000001';
update public.users set primary_account_type = 'sales',                status = 'active' where id = '70000002-0000-4000-8000-000000000002';
update public.users set primary_account_type = 'manufacturer',         status = 'active' where id = '70000003-0000-4000-8000-000000000003';
update public.users set primary_account_type = 'importer',             status = 'active' where id = '70000004-0000-4000-8000-000000000004';
update public.users set primary_account_type = 'wholesaler',           status = 'active' where id = '70000005-0000-4000-8000-000000000005';
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
  ('9a000000-aaaa-4aaa-8aaa-000000000005', 'Horizon Contracting', 'horizon-contracting',
   'contractor', 'active', false, 'en', '70000006-0000-4000-8000-000000000006');

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
