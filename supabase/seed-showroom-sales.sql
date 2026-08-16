-- ===========================================================================
-- Cairo Ceramics Showroom - sales book (Sprint 14 completeness pass).
--
-- Applied by `supabase db reset` AFTER seed.sql and seed-pilot.sql, which own the
-- organizations, memberships and branches these rows hang off.
--
-- SEPARATE FILE ON PURPOSE. The local E2E global setup truncates the four sales
-- tables before every run so the sales suite starts from a known-clean state.
-- When this lived inside seed-pilot.sql that truncate silently deleted the
-- showroom sales book for good: the dashboard pipeline panels and the Reports
-- pipeline section went empty for anyone doing manual UAT after an E2E run, and
-- only a full `db reset` brought them back. Keeping it in its own file lets the
-- E2E setup re-apply exactly this section after truncating, from the SAME source
-- of truth as the reset path.
--
-- Everything here is SYNTHETIC and deterministic (fixed UUIDs, relative dates).
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 10.8 The showroom's sales book - a showroom sells to walk-in customers too
-- ---------------------------------------------------------------------------
insert into public.customers (id, organization_id, branch_id, display_name, customer_type, primary_phone, email, preferred_language, location_summary, source, assigned_membership_id, status, created_by, created_at)
values
  ('ca000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'Mona Adel', 'individual', '01001234567', 'mona.adel@example.test', 'ar', 'Nasr City, Cairo', 'walk_in', '50000002-0000-4000-8000-000000000002', 'active', '70000002-0000-4000-8000-000000000002', now() - interval '48 days'),
  ('ca000002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'Sherif Group for Contracting', 'company', '01002345678', 'procurement@sherifgroup.example.test', 'ar', 'Heliopolis, Cairo', 'referral', '50000002-0000-4000-8000-000000000002', 'active', '70000002-0000-4000-8000-000000000002', now() - interval '36 days'),
  ('ca000003-0000-4000-8000-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'Rasha Ibrahim', 'individual', '01003456789', null, 'ar', 'New Cairo', 'whatsapp', '50000001-0000-4000-8000-000000000001', 'active', '70000001-0000-4000-8000-000000000001', now() - interval '24 days'),
  ('ca000004-0000-4000-8000-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'Nile View Developments', 'company', '01004567890', 'info@nileview.example.test', 'en', 'Sheikh Zayed', 'website', '50000001-0000-4000-8000-000000000001', 'active', '70000001-0000-4000-8000-000000000001', now() - interval '17 days'),
  ('ca000005-0000-4000-8000-000000000005', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'Tamer Fouad', 'individual', '01005678901', null, 'ar', 'Maadi, Cairo', 'phone', '50000002-0000-4000-8000-000000000002', 'active', '70000002-0000-4000-8000-000000000002', now() - interval '9 days');

insert into public.leads (id, organization_id, branch_id, customer_id, title, source, status, stage, assigned_membership_id, priority, next_follow_up_at, lost_reason, closed_at, version, created_by, created_at, updated_at)
values
  ('cb000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'ca000001-0000-4000-8000-000000000001', 'Bathroom retile - Nasr City apartment', 'walk_in', 'active', 'qualified', '50000002-0000-4000-8000-000000000002', 'normal', now() + interval '2 days', null, null, 2, '70000002-0000-4000-8000-000000000002', now() - interval '20 days', now() - interval '3 days'),
  ('cb000002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'ca000002-0000-4000-8000-000000000002', 'Tile package - Heliopolis tower', 'referral', 'active', 'proposal_pending', '50000002-0000-4000-8000-000000000002', 'high', now() + interval '1 day', null, null, 3, '70000002-0000-4000-8000-000000000002', now() - interval '30 days', now() - interval '2 days'),
  ('cb000003-0000-4000-8000-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'ca000003-0000-4000-8000-000000000003', 'Kitchen and bathroom finishing', 'whatsapp', 'active', 'contacted', '50000001-0000-4000-8000-000000000001', 'normal', now() - interval '1 day', null, null, 2, '70000001-0000-4000-8000-000000000001', now() - interval '15 days', now() - interval '5 days'),
  ('cb000004-0000-4000-8000-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'ca000004-0000-4000-8000-000000000004', 'Sheikh Zayed compound - phase one supply', 'website', 'active', 'decision_pending', '50000001-0000-4000-8000-000000000001', 'urgent', now() + interval '3 days', null, null, 4, '70000001-0000-4000-8000-000000000001', now() - interval '16 days', now() - interval '1 day'),
  ('cb000005-0000-4000-8000-000000000005', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'ca000005-0000-4000-8000-000000000005', 'Maadi villa - marble stairs', 'phone', 'won', 'decision_pending', '50000002-0000-4000-8000-000000000002', 'normal', null, null, now() - interval '4 days', 5, '70000002-0000-4000-8000-000000000002', now() - interval '8 days', now() - interval '4 days'),
  ('cb000006-0000-4000-8000-000000000006', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'ca000001-0000-4000-8000-000000000001', 'Balcony tiling - small job', 'walk_in', 'lost', 'contacted', '50000002-0000-4000-8000-000000000002', 'low', null, 'Client chose a cheaper local supplier.', now() - interval '6 days', 4, '70000002-0000-4000-8000-000000000002', now() - interval '14 days', now() - interval '6 days');

insert into public.follow_up_tasks (id, organization_id, branch_id, lead_id, customer_id, assigned_membership_id, title, description, due_at, status, priority, completed_at, version, created_by, created_at)
values
  -- Overdue on the owner's desk - the dashboard leads with these.
  ('cc000001-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000003-0000-4000-8000-000000000003', null, '50000001-0000-4000-8000-000000000001', 'Call Rasha back with the tile options', 'She asked for two alternatives in the same price band.', now() - interval '2 days', 'open', 'high', null, 1, '70000001-0000-4000-8000-000000000001', now() - interval '5 days'),
  ('cc000002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', null, 'ca000004-0000-4000-8000-000000000004', '50000001-0000-4000-8000-000000000001', 'Send the phase-one quantities to Nile View', null, now() - interval '1 day', 'open', 'urgent', null, 1, '70000001-0000-4000-8000-000000000001', now() - interval '4 days'),
  -- Due today.
  ('cc000003-0000-4000-8000-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000004-0000-4000-8000-000000000004', null, '50000001-0000-4000-8000-000000000001', 'Confirm the Sheikh Zayed delivery window', null, date_trunc('day', now()) + interval '15 hours', 'open', 'high', null, 1, '70000001-0000-4000-8000-000000000001', now() - interval '3 days'),
  -- The salesperson's queue.
  ('cc000004-0000-4000-8000-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000002-0000-4000-8000-000000000002', null, '50000002-0000-4000-8000-000000000002', 'Walk the Heliopolis client through the proposal', null, now() + interval '1 day', 'open', 'high', null, 1, '70000002-0000-4000-8000-000000000002', now() - interval '2 days'),
  ('cc000005-0000-4000-8000-000000000005', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000001-0000-4000-8000-000000000001', null, '50000002-0000-4000-8000-000000000002', 'Take the bathroom measurements', null, now() + interval '2 days', 'open', 'normal', null, 1, '70000002-0000-4000-8000-000000000002', now() - interval '3 days'),
  ('cc000006-0000-4000-8000-000000000006', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000005-0000-4000-8000-000000000005', null, '50000002-0000-4000-8000-000000000002', 'Collect the deposit for the marble stairs', null, now() - interval '5 days', 'completed', 'normal', now() - interval '4 days', 2, '70000002-0000-4000-8000-000000000002', now() - interval '7 days');

insert into public.sales_activities (organization_id, branch_id, lead_id, customer_id, actor_membership_id, activity_type, summary, occurred_at, created_by)
values
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000005-0000-4000-8000-000000000005', 'ca000005-0000-4000-8000-000000000005', '50000002-0000-4000-8000-000000000002', 'status_change', 'Marked the Maadi villa lead as won.', now() - interval '4 days', '70000002-0000-4000-8000-000000000002'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000004-0000-4000-8000-000000000004', 'ca000004-0000-4000-8000-000000000004', '50000001-0000-4000-8000-000000000001', 'meeting', 'Site visit at the Sheikh Zayed compound with the developer.', now() - interval '1 day', '70000001-0000-4000-8000-000000000001'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000002-0000-4000-8000-000000000002', 'ca000002-0000-4000-8000-000000000002', '50000002-0000-4000-8000-000000000002', 'call', 'Discussed grout colour and delivery staging for the tower.', now() - interval '2 days', '70000002-0000-4000-8000-000000000002'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000003-0000-4000-8000-000000000003', 'ca000003-0000-4000-8000-000000000003', '50000001-0000-4000-8000-000000000001', 'note', 'Client wants a matte finish; sent two options from the showroom shelf.', now() - interval '5 days', '70000001-0000-4000-8000-000000000001'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000001-0000-4000-8000-000000000001', 'ca000001-0000-4000-8000-000000000001', '50000002-0000-4000-8000-000000000002', 'follow_up', 'Agreed to measure the bathroom on site this week.', now() - interval '3 days', '70000002-0000-4000-8000-000000000002'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000006-0000-4000-8000-000000000006', 'ca000001-0000-4000-8000-000000000001', '50000002-0000-4000-8000-000000000002', 'status_change', 'Closed the balcony job as lost - price.', now() - interval '6 days', '70000002-0000-4000-8000-000000000002'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', null, 'ca000004-0000-4000-8000-000000000004', '50000001-0000-4000-8000-000000000001', 'note', 'Developer asked for a phased supply schedule across three buildings.', now() - interval '7 days', '70000001-0000-4000-8000-000000000001'),
  ('9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', 'cb000002-0000-4000-8000-000000000002', 'ca000002-0000-4000-8000-000000000002', '50000002-0000-4000-8000-000000000002', 'assignment_change', 'Lead assigned to Youssef Amin.', now() - interval '28 days', '70000002-0000-4000-8000-000000000002');
