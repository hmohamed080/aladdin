-- ===========================================================================
-- STAGING-ONLY demo enrichment. Additive; never applied by `supabase db reset`.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The three seed files build one excellent demo world around Cairo Ceramics
-- Showroom — and leave eleven of the twenty-six accounts with nothing to show.
-- Impersonating every seeded user under RLS (the real policies, the real RPCs)
-- against a database holding ONLY the bundled seeds proves it:
--
--   * a-owner, a-cairo, b-owner, sara   → zero rows in every module
--   * 14 accounts landing on /home      → `onboarding_progress` and
--                                         `individual_onboarding` are EMPTY
--                                         repo-wide, so the personal home is a
--                                         blank profile at ~8% completeness
--   * a-cairo                           → holds only the legacy
--                                         `sales.opportunity.*` capabilities, so
--                                         the nav shows Customers / Leads /
--                                         Follow-ups and RLS returns nothing
--   * a-cairo, laila                    → salesperson affiliation panel is empty
--
-- This file closes every one of those gaps so no client demo can open on an
-- accidentally empty screen.
--
-- WHY IT IS NOT IN config.toml [db.seed].sql_paths
-- ------------------------------------------------
-- `supabase/seed.sql` is snapshot-asserted by the pgTAP suite (capability sets,
-- directory counts, membership and branch totals) and `seed-showroom-sales.sql`
-- is re-applied by the Playwright global setup. Adding rows to the local reset
-- path would break both. Keeping this file OUT of `sql_paths` means the local
-- world, the pgTAP suite and the E2E fixtures stay byte-for-byte what they were,
-- and only the staging bundle is enriched.
--
-- RULES OBSERVED
-- --------------
--   * No migration is edited and no historical seed file is edited.
--   * No RLS policy, grant, or security-definer function is touched. Every row
--     below is DATA; visibility is decided by the same policies as production.
--   * Capabilities are only ever GRANTED to demo memberships, exactly as the
--     product's own people-ops UI would grant them. No policy is widened.
--   * Every existing UUID and relationship is preserved. New rows use the
--     reserved `fa……` UUID prefix, which no seed file uses.
--   * Deterministic: fixed UUIDs, timestamps relative to load time.
--   * Synthetic only — no real people, companies, or contact details.
--
-- ONE ACCOUNT IS DELIBERATELY LEFT EMPTY: Nour Hegazy. She is the pending
-- invitation and the brand-new-user journey; giving her a finished profile would
-- delete the only demo of how an account comes into existence. See the manifest.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Capability repair — three memberships the seeds left unable to work
-- ---------------------------------------------------------------------------
-- Amina owns a supplier organization but holds no commerce or sales capability
-- at all, so her workspace has no reachable Buying or Selling section. Karim
-- holds `sales.opportunity.read/write`, which the Sprint-3 sales work superseded
-- by `sales.read` / `sales.write`: the nav (which still honours the legacy keys)
-- shows him Customers, Leads and Follow-ups, while the RLS policies — which do
-- not — return nothing. That is a dead end, and it is the single worst screen in
-- the demo. Nadia owns a design office with no way to request a price.
--
-- The legacy rows are left in place: they are real history, and removing them
-- would hide the compatibility case rather than demonstrate it.
insert into public.membership_capabilities (membership_id, capability_key)
select m.id, cap
from (values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1'::uuid)   -- Amina — Nile Finishing Supplies owner
) as m(id)
cross join unnest(array[
  'catalog.read','catalog.publish',
  'rfq.create','rfq.respond','quote.submit','quote.decide',
  'order.create','order.manage','project.read','project.write',
  'sales.read','sales.write','sales.assign','sales.manage',
  'verification.submit','verification.read'
]) as cap
on conflict on constraint uq_membership_capability do nothing;

-- Karim: the two CURRENT sales keys, matching his existing legacy pair. Nothing
-- broader — he stays a branch-limited salesperson, which is the point of him.
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.read'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.write')
on conflict on constraint uq_membership_capability do nothing;

-- Nadia: a design office BUYS. No `catalog.write` — she publishes nothing.
insert into public.membership_capabilities (membership_id, capability_key)
select m.id, cap
from (values
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3'::uuid)   -- Nadia — Delta Interiors Studio owner
) as m(id)
cross join unnest(array[
  'catalog.read','rfq.create','quote.decide','order.create',
  'project.read','project.write','verification.submit','verification.read'
]) as cap
on conflict on constraint uq_membership_capability do nothing;


-- ---------------------------------------------------------------------------
-- 2. Missing primary contacts
-- ---------------------------------------------------------------------------
-- seed.sql writes a verified primary contact for three of its five users; Karim
-- and the Platform Admin have none. Every other demo account has one, the
-- manifest claims one, and the account settings screen reads it.
insert into public.contacts (user_id, channel, value, is_primary, is_verified, verified_at)
values
  ('22222222-2222-4222-8222-222222222222', 'email', 'a-cairo@example.test', true, true, now()),
  ('55555555-5555-4555-8555-555555555555', 'email', 'admin@example.test',   true, true, now());


-- ---------------------------------------------------------------------------
-- 3. Personal onboarding — the fix for 14 accounts that land on /home
-- ---------------------------------------------------------------------------
-- `/home` is driven almost entirely by `onboarding_progress` and
-- `individual_onboarding`, and the seeds write neither. Every personal account
-- therefore opens on a near-empty profile with a completeness meter reading ~8%,
-- which reads to a client as a broken account rather than a demo.
--
-- These rows are what the onboarding flow itself would have written. They are
-- not decoration: the completeness score is DERIVED from them on every read
-- (frontend/src/lib/profile/completeness.ts), the professional home renders its
-- specialisation, services, availability and service areas from them, and the
-- consumer home renders intent, interests, location and budget from them.
--
-- `completed_at` is stamped so the account reads as finished rather than
-- mid-flow. Phones follow the Egyptian mobile format the CHECK constraint
-- enforces (`^01[0125][0-9]{8}$`) and are synthetic throughout.
--
-- ONLY identities that ALREADY hold a personal persona appear below, and that is
-- load-bearing rather than tidy. `app.has_personal_persona()` returns true on ANY
-- of three signals — a canonical persona, a reached personal-onboarding terminal,
-- OR a selected personal track — so writing either of these rows for a
-- BUSINESS-ONLY identity (Amina, Hana, Tarek, Sara, Khaled, Mahmoud, Rania, Fady,
-- Dina, Hazem) would manufacture a Personal workspace for them. `my_workspaces()`
-- would start emitting a personal row, `resolveWorkContext` prefers Personal when
-- no cookie is set, and all ten would land on `/home` instead of their business
-- workspace — inventing exactly the "fake, empty Personal home" the account model
-- exists to prevent. Do not add them here.

insert into public.onboarding_progress
  (user_id, phone, selected_track, selected_persona, selected_org_type,
   profile_completed_at, contact_completed_at, account_type_completed_at, completed_at)
values
  -- seed.sql personal identities
  ('22222222-2222-4222-8222-222222222222', '01012000101', 'professional', 'sales',                null, now() - interval '210 days', now() - interval '210 days', now() - interval '210 days', now() - interval '210 days'),
  ('33333333-3333-4333-8333-333333333333', '01012000102', 'professional', 'interior_designer',    null, now() - interval '205 days', now() - interval '205 days', now() - interval '205 days', now() - interval '205 days'),
  ('44444444-4444-4444-8444-444444444444', '01012000103', 'consumer',      null,                  null, now() - interval '60 days',  now() - interval '60 days',  now() - interval '60 days',  now() - interval '60 days'),
  -- pilot world
  ('70000002-0000-4000-8000-000000000002', '01012000104', 'professional', 'sales',                null, now() - interval '150 days', now() - interval '150 days', now() - interval '150 days', now() - interval '150 days'),
  ('70000006-0000-4000-8000-000000000006', '01012000105', 'professional', 'contractor',           null, now() - interval '140 days', now() - interval '140 days', now() - interval '140 days', now() - interval '140 days'),
  ('70000007-0000-4000-8000-000000000007', '01012000106', 'professional', 'sales',                null, now() - interval '120 days', now() - interval '120 days', now() - interval '120 days', now() - interval '120 days'),
  ('70000008-0000-4000-8000-000000000008', '01012000107', 'professional', 'engineer',             null, now() - interval '110 days', now() - interval '110 days', now() - interval '110 days', now() - interval '110 days'),
  ('70000009-0000-4000-8000-000000000009', '01012000108', 'professional', 'installer_technician', null, now() - interval '100 days', now() - interval '100 days', now() - interval '100 days', now() - interval '100 days'),
  -- listed independent professionals
  ('71000006-0000-4000-8000-000000000006', '01012000109', 'professional', 'installer_technician', null, now() - interval '95 days',  now() - interval '95 days',  now() - interval '95 days',  now() - interval '95 days'),
  ('71000007-0000-4000-8000-000000000007', '01012000110', 'professional', 'installer_technician', null, now() - interval '90 days',  now() - interval '90 days',  now() - interval '90 days',  now() - interval '90 days'),
  ('71000008-0000-4000-8000-000000000008', '01012000111', 'professional', 'installer_technician', null, now() - interval '85 days',  now() - interval '85 days',  now() - interval '85 days',  now() - interval '85 days'),
  ('71000009-0000-4000-8000-000000000009', '01012000112', 'professional', 'installer_technician', null, now() - interval '80 days',  now() - interval '80 days',  now() - interval '80 days',  now() - interval '80 days'),
  ('71000010-0000-4000-8000-000000000010', '01012000113', 'professional', 'interior_designer',    null, now() - interval '75 days',  now() - interval '75 days',  now() - interval '75 days',  now() - interval '75 days'),
  ('71000011-0000-4000-8000-000000000011', '01012000114', 'professional', 'engineer',             null, now() - interval '70 days',  now() - interval '70 days',  now() - interval '70 days',  now() - interval '70 days');

-- The consumer track. Omar is the one B2C identity in the demo: a real stated
-- need, which is what the consultation-first journey is supposed to start from.
insert into public.individual_onboarding
  (user_id, consumer_intent, consumer_interests, consumer_governorate, consumer_city,
   consumer_budget, consumer_completed_at)
values
  ('44444444-4444-4444-8444-444444444444', 'renovate_apartment',
   array['flooring','kitchen','bathroom','lighting'], 'Cairo', 'New Cairo',
   '200k_500k', now() - interval '60 days');

-- The professional track. `prof_concrete_type` matches each account's canonical
-- persona; the CHECK constraint already forbids `end_consumer` here.
insert into public.individual_onboarding
  (user_id, prof_concrete_type, prof_years_experience, prof_specialization,
   prof_services, prof_additional_services, prof_availability, prof_service_areas,
   prof_offers_remote, prof_governorate, prof_city, prof_max_travel_km,
   professional_completed_at)
values
  -- Karim Adel — branch salesperson at a finishing supplier.
  ('22222222-2222-4222-8222-222222222222', 'sales', 8, 'Finishing materials — technical sales',
   array['quotation_preparation','site_measurement','material_selection'], array['client_follow_up'],
   'full_time', array['Cairo','Nasr City','Heliopolis'], false, 'Cairo', 'Nasr City', 40,
   now() - interval '210 days'),
  -- Nadia Salem — interior designer who also owns Delta Interiors Studio.
  ('33333333-3333-4333-8333-333333333333', 'interior_designer', 12, 'Residential and boutique retail interiors',
   array['concept_design','finishing_schedule','site_supervision','3d_visualisation'], array['furniture_sourcing'],
   'full_time', array['Cairo','Maadi','New Cairo'], true, 'Cairo', 'Maadi', 60,
   now() - interval '205 days'),
  -- Youssef Amin — the showroom salesperson, the daily-active persona.
  ('70000002-0000-4000-8000-000000000002', 'sales', 6, 'Ceramic and porcelain retail sales',
   array['showroom_consultation','quotation_preparation','site_measurement'], array['delivery_coordination'],
   'full_time', array['Cairo','Nasr City','Heliopolis','Maadi'], false, 'Cairo', 'Nasr City', 35,
   now() - interval '150 days'),
  -- Mostafa Bakr — contractor persona, owns Horizon Contracting.
  ('70000006-0000-4000-8000-000000000006', 'contractor', 18, 'Residential finishing and fit-out',
   array['full_finishing','turnkey_fitout','renovation','site_management'], array['cost_estimation'],
   'full_time', array['Cairo','New Cairo','Sheikh Zayed'], false, 'Cairo', 'New Cairo', 80,
   now() - interval '140 days'),
  -- Laila Shafik — salesperson persona working as Horizon's manager.
  ('70000007-0000-4000-8000-000000000007', 'sales', 9, 'Contracting sales and client accounts',
   array['tender_preparation','client_accounts','quotation_preparation'], array['supplier_negotiation'],
   'full_time', array['Cairo','New Cairo'], true, 'Cairo', 'New Cairo', 50,
   now() - interval '120 days'),
  -- Yasser Fouad — site engineer inside Horizon.
  ('70000008-0000-4000-8000-000000000008', 'engineer', 11, 'Finishing works supervision',
   array['site_supervision','quantity_takeoff','quality_inspection'], array['contractor_coordination'],
   'full_time', array['Cairo','New Cairo','Fifth Settlement'], false, 'Cairo', 'New Cairo', 70,
   now() - interval '110 days'),
  -- Ahmed Sobhy — installer inside Horizon, ALSO publicly listed.
  ('70000009-0000-4000-8000-000000000009', 'installer_technician', 15, 'Ceramic and porcelain tiling',
   array['floor_tiling','wall_tiling','skirting','waterproofing'], array['surface_preparation'],
   'full_time', array['Cairo','New Cairo','Nasr City'], false, 'Cairo', 'New Cairo', 45,
   now() - interval '100 days'),
  -- The five independent listed professionals.
  ('71000006-0000-4000-8000-000000000006', 'installer_technician', 18, 'Marble and granite fixing',
   array['marble_stairs','counter_tops','thresholds','polishing'], array['stone_cutting'],
   'full_time', array['Cairo','Giza','6th of October'], false, 'Giza', '6th of October', 60,
   now() - interval '95 days'),
  ('71000007-0000-4000-8000-000000000007', 'installer_technician', 13, 'Electrical installation and lighting',
   array['interior_wiring','distribution_boards','decorative_lighting'], array['smart_switching'],
   'full_time', array['Cairo','Nasr City','Heliopolis'], false, 'Cairo', 'Heliopolis', 40,
   now() - interval '90 days'),
  ('71000008-0000-4000-8000-000000000008', 'installer_technician', 16, 'Plumbing and sanitary fitting',
   array['water_networks','drainage','sanitary_ware','concealed_cisterns'], array['leak_testing'],
   'full_time', array['Cairo','Maadi','New Cairo'], false, 'Cairo', 'Maadi', 50,
   now() - interval '85 days'),
  ('71000009-0000-4000-8000-000000000009', 'installer_technician', 10, 'Gypsum board and false ceilings',
   array['suspended_ceilings','cornices','gypsum_partitions','lighting_cutouts'], array['acoustic_panels'],
   'part_time', array['Cairo','Giza'], false, 'Cairo', 'Dokki', 35,
   now() - interval '80 days'),
  -- Heba Kamal — remote-capable, so the travel-radius item drops out of her
  -- completeness denominator rather than penalising her forever.
  ('71000010-0000-4000-8000-000000000010', 'interior_designer', 9, 'Residential interior design',
   array['concept_design','finishing_schedule','site_supervision','mood_boards'], array['procurement_support'],
   'full_time', array['Cairo','New Cairo','Sheikh Zayed'], true, 'Cairo', 'New Cairo', null,
   now() - interval '75 days'),
  ('71000011-0000-4000-8000-000000000011', 'engineer', 14, 'Site and finishing engineering',
   array['quantity_takeoff','site_supervision','contractor_coordination','cost_control'], array['tender_review'],
   'full_time', array['Cairo','Giza','New Cairo'], true, 'Cairo', 'Fifth Settlement', 65,
   now() - interval '70 days');

-- The five independent professionals carry a listed public profile from
-- seed-pilot section 10.3 but no display-name-adjacent detail beyond it; the two
-- seed.sql personal identities carry neither. Fill the profile columns the
-- personal home and the public directory both read.
update public.profiles p set
  headline = coalesce(p.headline, v.headline),
  bio = coalesce(p.bio, v.bio),
  languages = case when p.languages is null or cardinality(p.languages) = 0 then v.languages else p.languages end
from (values
  ('22222222-2222-4222-8222-222222222222'::uuid,
   'Finishing materials — technical sales',
   'Eight years advising contractors and homeowners on floor and wall finishing, from measurement to delivery.',
   array['ar','en']),
  ('33333333-3333-4333-8333-333333333333'::uuid,
   'Residential and boutique retail interiors',
   'Twelve years designing apartment, villa and small retail interiors, from concept through finishing schedule and site supervision.',
   array['en','ar']),
  ('70000002-0000-4000-8000-000000000002'::uuid,
   'Ceramic and porcelain retail sales',
   'Showroom consultation, take-offs and quotations for tiling packages of any size.',
   array['ar','en']),
  ('70000006-0000-4000-8000-000000000006'::uuid,
   'Residential finishing and fit-out',
   'Eighteen years running finishing and turnkey fit-out projects across Greater Cairo.',
   array['ar','en']),
  ('70000007-0000-4000-8000-000000000007'::uuid,
   'Contracting sales and client accounts',
   'Tender preparation and client account management for a residential finishing contractor.',
   array['ar','en']),
  ('70000008-0000-4000-8000-000000000008'::uuid,
   'Finishing works supervision',
   'Site supervision, quantity take-offs and quality inspection on residential finishing packages.',
   array['en','ar'])
) as v(user_id, headline, bio, languages)
where p.user_id = v.user_id;


-- ---------------------------------------------------------------------------
-- 4. Nile Finishing Supplies (Org A) — a supplier with something to sell
-- ---------------------------------------------------------------------------
-- Org A is the FIRST organization in the product's history and the one the pgTAP
-- suite is built on, which is exactly why the later demo work grew around it
-- instead of into it — leaving its owner and its salesperson with an empty
-- workspace. Everything below is additive and lives only in the staging bundle.
--
-- The branch split is the point: two customers and two leads sit in Cairo
-- (Karim's branch), two in Sheikh Zayed (which he must not see). Signing in as
-- Amina and then as Karim shows the same screen returning different rows —
-- tenant and branch isolation demonstrated rather than asserted.

insert into public.products (id, organization_id, name, sku, category, brand, short_description, unit, image_ref, status, published_at, created_by)
values
  ('fa100001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'Porcelain Floor Tile 80x80', 'NFS-P8080', 'finishing', 'NileFinish',
   'Rectified matte porcelain floor tile, first grade.', 'square_meter',
   '/demo/products/porcelain-tile.svg', 'published', now() - interval '120 days', '11111111-1111-4111-8111-111111111111'),
  ('fa100002-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'Skirting Profile — Aluminium', 'NFS-SKIRT', 'finishing', 'NileFinish',
   'Anodised aluminium skirting for tiled floors.', 'linear_meter',
   '/demo/products/aluminium-profile.svg', 'published', now() - interval '110 days', '11111111-1111-4111-8111-111111111111'),
  ('fa100003-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'Tile Adhesive — Grey 25kg', 'NFS-ADH25', 'supply', 'NileFinish',
   'Cement-based tile adhesive for interior floors and walls.', 'bag',
   '/demo/products/silicone-sealant.svg', 'published', now() - interval '105 days', '11111111-1111-4111-8111-111111111111');

-- Cairo branch (c1111111) — Karim's slice.
insert into public.customers (id, organization_id, branch_id, display_name, customer_type, primary_phone, email, preferred_language, location_summary, source, assigned_membership_id, status, created_by, created_at)
values
  ('fa200001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc',
   'Hala Mounir', 'individual', '01021000001', null, 'ar', 'Nasr City, Cairo', 'walk_in',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'active', '22222222-2222-4222-8222-222222222222', now() - interval '40 days'),
  ('fa200002-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc',
   'Cairo Fit-Out Works', 'company', '01021000002', 'orders@cairofitout.example.test', 'ar', 'Heliopolis, Cairo', 'referral',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'active', '22222222-2222-4222-8222-222222222222', now() - interval '28 days'),
  -- Sheikh Zayed branch (c2222222) — deliberately OUTSIDE Karim's scope.
  ('fa200003-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc',
   'Zayed Gardens Compound', 'company', '01021000003', 'procurement@zayedgardens.example.test', 'en', 'Sheikh Zayed', 'website',
   'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'active', '11111111-1111-4111-8111-111111111111', now() - interval '22 days'),
  ('fa200004-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc',
   'Sherine Adly', 'individual', '01021000004', null, 'ar', 'Sheikh Zayed', 'phone',
   'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'active', '11111111-1111-4111-8111-111111111111', now() - interval '11 days');

insert into public.leads (id, organization_id, branch_id, customer_id, title, source, status, stage, assigned_membership_id, priority, next_follow_up_at, lost_reason, closed_at, version, created_by, created_at, updated_at)
values
  ('fa300001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc', 'fa200001-0000-4000-8000-000000000001',
   'Apartment floor tiling — Nasr City', 'walk_in', 'active', 'qualified', 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'normal',
   now() + interval '2 days', null, null, 2, '22222222-2222-4222-8222-222222222222', now() - interval '35 days', now() - interval '4 days'),
  ('fa300002-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc', 'fa200002-0000-4000-8000-000000000002',
   'Office fit-out — flooring package', 'referral', 'active', 'proposal_pending', 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'high',
   now() + interval '1 day', null, null, 3, '22222222-2222-4222-8222-222222222222', now() - interval '25 days', now() - interval '2 days'),
  ('fa300003-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc', 'fa200003-0000-4000-8000-000000000003',
   'Compound phase two — tile supply', 'website', 'active', 'decision_pending', 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'urgent',
   now() + interval '3 days', null, null, 4, '11111111-1111-4111-8111-111111111111', now() - interval '20 days', now() - interval '1 day'),
  ('fa300004-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc', 'fa200004-0000-4000-8000-000000000004',
   'Villa skirting and adhesive', 'phone', 'won', 'decision_pending', 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'normal',
   null, null, now() - interval '3 days', 5, '11111111-1111-4111-8111-111111111111', now() - interval '10 days', now() - interval '3 days');

insert into public.follow_up_tasks (id, organization_id, branch_id, lead_id, customer_id, assigned_membership_id, title, description, due_at, status, priority, completed_at, version, created_by, created_at)
values
  -- Karim's queue: one overdue, one due today. Overdue work is what a sales
  -- cockpit must lead with, so the demo needs some.
  ('fa400001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc', 'fa300001-0000-4000-8000-000000000001', null,
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'Send Hala the 80x80 sample photos', 'She asked for two shades in the same price band.',
   now() - interval '2 days', 'open', 'high', null, 1, '22222222-2222-4222-8222-222222222222', now() - interval '6 days'),
  ('fa400002-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc', 'fa300002-0000-4000-8000-000000000002', null,
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'Walk Cairo Fit-Out through the proposal', null,
   date_trunc('day', now()) + interval '14 hours', 'open', 'urgent', null, 1, '22222222-2222-4222-8222-222222222222', now() - interval '3 days'),
  -- Amina's queue, on the branch Karim cannot see.
  ('fa400003-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc', 'fa300003-0000-4000-8000-000000000003', null,
   'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'Confirm phase-two quantities with the compound', null,
   now() + interval '2 days', 'open', 'high', null, 1, '11111111-1111-4111-8111-111111111111', now() - interval '5 days'),
  ('fa400004-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc', 'fa300004-0000-4000-8000-000000000004', null,
   'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'Collect the deposit for the villa order', null,
   now() - interval '4 days', 'completed', 'normal', now() - interval '3 days', 2, '11111111-1111-4111-8111-111111111111', now() - interval '8 days');

insert into public.sales_activities (organization_id, branch_id, lead_id, customer_id, actor_membership_id, activity_type, summary, occurred_at, created_by)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc', 'fa300001-0000-4000-8000-000000000001', 'fa200001-0000-4000-8000-000000000001', 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'call', 'Discussed 80x80 versus 60x60 for a small apartment.', now() - interval '6 days', '22222222-2222-4222-8222-222222222222'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-cccc-4ccc-8ccc-cccccccccccc', 'fa300002-0000-4000-8000-000000000002', 'fa200002-0000-4000-8000-000000000002', 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'meeting', 'Site visit at the Heliopolis office floor.', now() - interval '4 days', '22222222-2222-4222-8222-222222222222'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc', 'fa300003-0000-4000-8000-000000000003', 'fa200003-0000-4000-8000-000000000003', 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'note', 'Compound wants a phased schedule across two buildings.', now() - interval '7 days', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c2222222-cccc-4ccc-8ccc-cccccccccccc', 'fa300004-0000-4000-8000-000000000004', 'fa200004-0000-4000-8000-000000000004', 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'status_change', 'Marked the villa skirting job as won.', now() - interval '3 days', '11111111-1111-4111-8111-111111111111');


-- ---------------------------------------------------------------------------
-- 5. Delta Interiors Studio (Org B) — the buyer half, and Org A's counterparty
-- ---------------------------------------------------------------------------
-- One chain fixes two accounts. Nadia's design office issues a purchase request
-- to Amina's supplier, Amina prices it, Nadia accepts, and the order becomes a
-- delivery project — so Org A gains an inbound RFQ and Org B gains its entire
-- buying side from the same four records, each read from both ends under RLS.
--
-- Cross-organization on purpose: it is the only place in the demo world where
-- the two pgTAP base organizations transact, which is also the cleanest proof
-- that a shared record is visible to exactly its two parties and nobody else.

insert into public.rfqs (id, requester_org_id, requester_branch_id, supplier_org_id, title, note, required_date, status, version, submitted_at, closed_at, created_at, created_by)
values
  ('fa500001-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cb333333-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'Floor tiling — Maadi duplex', 'Full duplex, 240 square metres, rectified porcelain.', (now() + interval '20 days')::date,
   'closed', 3, now() - interval '30 days', now() - interval '24 days', now() - interval '31 days', '33333333-3333-4333-8333-333333333333'),
  -- Still open, so her Purchase Requests screen has both an answered and an
  -- unanswered row rather than one uniform state.
  ('fa500002-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cb333333-cccc-4ccc-8ccc-cccccccccccc', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Wall tile — boutique retail fit-out', 'Two hundred square metres, matte finish.', (now() + interval '28 days')::date,
   'submitted', 1, now() - interval '3 days', null, now() - interval '3 days', '33333333-3333-4333-8333-333333333333');

insert into public.rfq_items (id, rfq_id, product_id, product_name, unit, quantity, note)
values
  ('fa600001-0000-4000-8000-000000000001', 'fa500001-0000-4000-8000-000000000001', 'fa100001-0000-4000-8000-000000000001', 'Porcelain Floor Tile 80x80', 'square_meter', 240, 'Both levels'),
  ('fa600002-0000-4000-8000-000000000002', 'fa500001-0000-4000-8000-000000000001', 'fa100002-0000-4000-8000-000000000002', 'Skirting Profile — Aluminium', 'linear_meter', 180, null),
  ('fa600003-0000-4000-8000-000000000003', 'fa500001-0000-4000-8000-000000000001', 'fa100003-0000-4000-8000-000000000003', 'Tile Adhesive — Grey 25kg', 'bag', 120, null),
  ('fa600004-0000-4000-8000-000000000004', 'fa500002-0000-4000-8000-000000000002', 'd7000001-0000-4000-8000-000000000001', 'Ceramic Wall Tile 30x60', 'square_meter', 200, 'Matte only');

-- 240 × 420 + 180 × 95 + 120 × 180 = 100 800 + 17 100 + 21 600 = 139 500.
-- The RPCs derive the total from the lines; a seeded row must not disagree with
-- its own items, or Reports and the detail screen will quietly contradict.
insert into public.quotations (id, rfq_id, supplier_org_id, requester_org_id, note, validity_date, subtotal, total, status, version, submitted_at, decided_at, decided_by, created_at, created_by)
values
  ('fa700001-0000-4000-8000-000000000001', 'fa500001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'Delivery to Maadi included. Prices valid for twenty days.', (now() + interval '18 days')::date,
   139500, 139500, 'accepted', 1, now() - interval '27 days', now() - interval '24 days',
   '33333333-3333-4333-8333-333333333333', now() - interval '28 days', '11111111-1111-4111-8111-111111111111');

insert into public.quotation_items (quotation_id, rfq_item_id, product_name, unit, quantity, unit_price)
values
  ('fa700001-0000-4000-8000-000000000001', 'fa600001-0000-4000-8000-000000000001', 'Porcelain Floor Tile 80x80', 'square_meter', 240, 420),
  ('fa700001-0000-4000-8000-000000000001', 'fa600002-0000-4000-8000-000000000002', 'Skirting Profile — Aluminium', 'linear_meter', 180, 95),
  ('fa700001-0000-4000-8000-000000000001', 'fa600003-0000-4000-8000-000000000003', 'Tile Adhesive — Grey 25kg', 'bag', 120, 180);

insert into public.orders (id, quotation_id, rfq_id, requester_org_id, supplier_org_id, requester_branch_id, title, note, subtotal, total, status, version, confirmed_at, started_at, completed_at, created_at, created_by)
values
  ('fa800001-0000-4000-8000-000000000001', 'fa700001-0000-4000-8000-000000000001', 'fa500001-0000-4000-8000-000000000001',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cb333333-cccc-4ccc-8ccc-cccccccccccc',
   'Floor tiling — Maadi duplex', 'Delivery to Maadi included.', 139500, 139500, 'in_progress', 2,
   now() - interval '24 days', now() - interval '20 days', null, now() - interval '24 days', '33333333-3333-4333-8333-333333333333');

insert into public.order_items (order_id, product_name, unit, quantity, unit_price)
values
  ('fa800001-0000-4000-8000-000000000001', 'Porcelain Floor Tile 80x80', 'square_meter', 240, 420),
  ('fa800001-0000-4000-8000-000000000001', 'Skirting Profile — Aluminium', 'linear_meter', 180, 95),
  ('fa800001-0000-4000-8000-000000000001', 'Tile Adhesive — Grey 25kg', 'bag', 120, 180);

insert into public.projects (id, order_id, requester_org_id, executing_org_id, branch_id, title, location, description, start_date, target_date, status, version, activated_at, completed_at, created_at, created_by)
values
  ('fa900001-0000-4000-8000-000000000001', 'fa800001-0000-4000-8000-000000000001',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cb333333-cccc-4ccc-8ccc-cccccccccccc',
   'Maadi duplex — floor tiling supply', 'Maadi, Cairo',
   'Staged supply of porcelain flooring, skirting and adhesive for a duplex fit-out.',
   (now() - interval '20 days')::date, (now() + interval '10 days')::date, 'active', 2,
   now() - interval '20 days', null, now() - interval '24 days', '11111111-1111-4111-8111-111111111111');

-- A shortlist gives the studio's Saved screen something to hold, and it is the
-- organization that owns it — not the person who saved it.
insert into public.saved_products (organization_id, product_id, saved_by, note, created_at)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'd7000012-0000-4000-8000-000000000012', '33333333-3333-4333-8333-333333333333', 'SPC option for the rental units — check the wear layer.', now() - interval '14 days'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'd7000006-0000-4000-8000-000000000006', '33333333-3333-4333-8333-333333333333', null, now() - interval '9 days'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'fa100001-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'What we specified on the Maadi duplex.', now() - interval '5 days');


-- ---------------------------------------------------------------------------
-- 6. Nile Import & Trade (Sara) — an importer with a catalogue and an open offer
-- ---------------------------------------------------------------------------
-- Sara owned an organization with no products, no requests, no offers and no
-- orders: the emptiest workspace in the seed. Her organization stays
-- `pending_verification` — it is half of the Admin review queue, and an
-- unverified business that trades normally while staying out of the public
-- directory is precisely what verification is supposed to mean.

insert into public.products (id, organization_id, name, sku, category, brand, short_description, unit, image_ref, status, published_at, created_by)
values
  ('fa100004-0000-4000-8000-000000000004', '9e000000-eeee-4eee-8eee-000000000003',
   'Imported Porcelain — Large Format', 'NIT-LF120', 'finishing', 'NileImport',
   'Large-format imported porcelain, 120x120, rectified.', 'square_meter',
   '/demo/products/porcelain-tile.svg', 'published', now() - interval '95 days', '70000004-0000-4000-8000-000000000004'),
  ('fa100005-0000-4000-8000-000000000005', '9e000000-eeee-4eee-8eee-000000000003',
   'Imported Shower Mixer Set', 'NIT-MIX', 'finishing', 'NileImport',
   'Thermostatic shower mixer with rain head, chrome.', 'set',
   '/demo/products/sanitary-basin.svg', 'published', now() - interval '88 days', '70000004-0000-4000-8000-000000000004');

insert into public.rfqs (id, requester_org_id, requester_branch_id, supplier_org_id, title, note, required_date, status, version, submitted_at, closed_at, created_at, created_by)
values
  -- Closed and delivered — gives her Reports a completed value to chart.
  ('fa500003-0000-4000-8000-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '9e000000-eeee-4eee-8eee-000000000003',
   'Large-format porcelain — display wall', 'For the Nasr City showroom refit.', (now() - interval '40 days')::date,
   'closed', 3, now() - interval '65 days', now() - interval '58 days', now() - interval '66 days', '70000001-0000-4000-8000-000000000001'),
  -- Open, priced, and waiting on Hana — the same record appears in her Offers
  -- list as "awaiting decision" and in Hana's as "decide".
  ('fa500004-0000-4000-8000-000000000004', '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001', '9e000000-eeee-4eee-8eee-000000000003',
   'Shower mixer sets — New Cairo apartments', 'Sixty sets, staged delivery.', (now() + interval '22 days')::date,
   'quoted', 2, now() - interval '7 days', null, now() - interval '8 days', '70000002-0000-4000-8000-000000000002');

insert into public.rfq_items (id, rfq_id, product_id, product_name, unit, quantity, note)
values
  ('fa600005-0000-4000-8000-000000000005', 'fa500003-0000-4000-8000-000000000003', 'fa100004-0000-4000-8000-000000000004', 'Imported Porcelain — Large Format', 'square_meter', 180, 'Display wall and floor'),
  ('fa600006-0000-4000-8000-000000000006', 'fa500004-0000-4000-8000-000000000004', 'fa100005-0000-4000-8000-000000000005', 'Imported Shower Mixer Set', 'set', 60, 'Staged over two deliveries');

insert into public.quotations (id, rfq_id, supplier_org_id, requester_org_id, note, validity_date, subtotal, total, status, version, submitted_at, decided_at, decided_by, created_at, created_by)
values
  ('fa700002-0000-4000-8000-000000000002', 'fa500003-0000-4000-8000-000000000003', '9e000000-eeee-4eee-8eee-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Ex-Alexandria port, cleared. Delivery to Nasr City included.', (now() - interval '45 days')::date,
   167400, 167400, 'accepted', 1, now() - interval '62 days', now() - interval '60 days',
   '70000001-0000-4000-8000-000000000001', now() - interval '63 days', '70000004-0000-4000-8000-000000000004'),
  ('fa700003-0000-4000-8000-000000000003', 'fa500004-0000-4000-8000-000000000004', '9e000000-eeee-4eee-8eee-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001',
   'Price holds for the full sixty sets. Four-week lead time.', (now() + interval '14 days')::date,
   126000, 126000, 'submitted', 1, now() - interval '4 days', null, null,
   now() - interval '5 days', '70000004-0000-4000-8000-000000000004');

insert into public.quotation_items (quotation_id, rfq_item_id, product_name, unit, quantity, unit_price)
values
  ('fa700002-0000-4000-8000-000000000002', 'fa600005-0000-4000-8000-000000000005', 'Imported Porcelain — Large Format', 'square_meter', 180, 930),
  ('fa700003-0000-4000-8000-000000000003', 'fa600006-0000-4000-8000-000000000006', 'Imported Shower Mixer Set', 'set', 60, 2100);

insert into public.orders (id, quotation_id, rfq_id, requester_org_id, supplier_org_id, requester_branch_id, title, note, subtotal, total, status, version, confirmed_at, started_at, completed_at, created_at, created_by)
values
  ('fa800002-0000-4000-8000-000000000002', 'fa700002-0000-4000-8000-000000000002', 'fa500003-0000-4000-8000-000000000003',
   '9c000000-cccc-4ccc-8ccc-000000000001', '9e000000-eeee-4eee-8eee-000000000003', 'b0000001-0000-4000-8000-000000000001',
   'Large-format porcelain — display wall', 'Cleared and delivered.', 167400, 167400, 'completed', 3,
   now() - interval '60 days', now() - interval '57 days', now() - interval '44 days', now() - interval '60 days', '70000001-0000-4000-8000-000000000001');

insert into public.order_items (order_id, product_name, unit, quantity, unit_price)
values
  ('fa800002-0000-4000-8000-000000000002', 'Imported Porcelain — Large Format', 'square_meter', 180, 930);

insert into public.projects (id, order_id, requester_org_id, executing_org_id, branch_id, title, location, description, start_date, target_date, status, version, activated_at, completed_at, created_at, created_by)
values
  ('fa900002-0000-4000-8000-000000000002', 'fa800002-0000-4000-8000-000000000002',
   '9c000000-cccc-4ccc-8ccc-000000000001', '9e000000-eeee-4eee-8eee-000000000003', 'b0000001-0000-4000-8000-000000000001',
   'Showroom display wall — import delivery', 'Nasr City, Cairo',
   'Clearance and staged delivery of large-format imported porcelain.',
   (now() - interval '57 days')::date, (now() - interval '42 days')::date, 'completed', 3,
   now() - interval '57 days', now() - interval '44 days', now() - interval '58 days', '70000004-0000-4000-8000-000000000004');


-- ---------------------------------------------------------------------------
-- 7. Personal verification spread
-- ---------------------------------------------------------------------------
-- Every professional in the seed reads `not verified`, so the trust state looks
-- like a bug rather than a state machine. These four give the demo one account in
-- each meaningful outcome — approved, submitted, needs-more-info, and (by
-- omission, Mahmoud Fathy) never submitted — and give the Admin queue individual
-- professionals to review alongside the two organizations already waiting.
--
-- `grants_public_listing` is only legal for a professional verification, and it
-- is what the approved case is claiming: the platform vouched for the trade.
insert into public.verifications
  (id, subject_type, user_id, verification_type, requested_account_type,
   grants_public_listing, status, reviewer_id, reason, submitted_at, decided_at, applied_at)
values
  -- Approved: Sayed and Yasser carry the verified badge.
  ('faa00001-0000-4000-8000-000000000001', 'user', '71000006-0000-4000-8000-000000000006', 'professional', 'installer_technician',
   true, 'approved', '55555555-5555-4555-8555-555555555555', null,
   now() - interval '70 days', now() - interval '64 days', now() - interval '64 days'),
  ('faa00002-0000-4000-8000-000000000002', 'user', '70000008-0000-4000-8000-000000000008', 'professional', 'engineer',
   true, 'approved', '55555555-5555-4555-8555-555555555555', null,
   now() - interval '55 days', now() - interval '50 days', now() - interval '50 days'),
  -- Awaiting review: shows up in the Admin queue, and as `pending` on his home.
  ('faa00003-0000-4000-8000-000000000003', 'user', '71000008-0000-4000-8000-000000000008', 'professional', 'installer_technician',
   true, 'submitted', null, null, now() - interval '6 days', null, null),
  -- Needs more info: the reason is required by CHECK, and showing it to the
  -- professional is the difference between an actionable state and a dead end.
  ('faa00004-0000-4000-8000-000000000004', 'user', '71000009-0000-4000-8000-000000000009', 'professional', 'installer_technician',
   true, 'needs_more_info', '55555555-5555-4555-8555-555555555555',
   'Please upload a clearer photo of your national ID and one completed-project reference.',
   now() - interval '20 days', now() - interval '15 days', null);


-- ---------------------------------------------------------------------------
-- 8. Salesperson affiliation — the panel that was empty for two accounts
-- ---------------------------------------------------------------------------
-- `/home` shows a salesperson their showroom affiliation. Youssef's resolves
-- from his ACTIVE showroom membership, but Karim's and Laila's organizations are
-- a supplier and a contractor company, so their panel had nothing in any of its
-- three lists. These give each of them one real, pending record — and both are
-- live workflows an owner or admin can act on during a demo.

-- Karim has asked to be affiliated with Cairo Ceramics Showroom. Pending, so
-- Hana can approve it live from her people screen.
insert into public.organization_join_requests
  (id, user_id, organization_id, requested_branch_id, note, status, created_at)
values
  ('fab00001-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   '9c000000-cccc-4ccc-8ccc-000000000001', 'b0000001-0000-4000-8000-000000000001',
   'I sell finishing materials in Nasr City and would like to work the showroom floor as well.',
   'pending', now() - interval '5 days');

-- Laila has referred a showroom that is not on the platform yet. Submitted, so
-- it sits in the platform review queue rather than resolving to an organization
-- (the CHECK constraint enforces that pairing).
insert into public.organization_referrals
  (id, referred_by, legal_name, display_name, org_type, description, governorate, city,
   primary_branch_name, status, created_at)
values
  ('fab00002-0000-4000-8000-000000000002', '70000007-0000-4000-8000-000000000007',
   'Obour Ceramics Centre', 'Obour Ceramics', 'showroom_dealer',
   'Family-run tile and sanitary showroom on the Obour ring road; supplies most of our east Cairo sites.',
   'Qalyubia', 'Obour City', 'Obour Main Showroom', 'submitted', now() - interval '9 days');


-- ---------------------------------------------------------------------------
-- 9. Audit trail for the chains added above
-- ---------------------------------------------------------------------------
-- Everything here is inserted directly rather than through the RPCs, so the
-- trail those RPCs would have emitted does not exist. The Admin audit surface
-- already retells the Cairo Ceramics → Horizon story (seed-pilot section 9);
-- without these entries the two new chains would be invisible there, and a row
-- in Orders with no corresponding audit line reads as a data-integrity problem.
insert into public.audit_log (actor_user_id, action, subject_type, subject_id, organization_id, metadata, created_at)
values
  -- Nile Finishing Supplies ← Delta Interiors Studio.
  ('11111111-1111-4111-8111-111111111111', 'product.published', 'product', 'fa100001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}'::jsonb, now() - interval '120 days'),
  ('33333333-3333-4333-8333-333333333333', 'rfq.submitted', 'rfq', 'fa500001-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{}'::jsonb, now() - interval '30 days'),
  ('11111111-1111-4111-8111-111111111111', 'quotation.submitted', 'quotation', 'fa700001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"total":139500}'::jsonb, now() - interval '27 days'),
  ('33333333-3333-4333-8333-333333333333', 'quotation.accepted', 'quotation', 'fa700001-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{}'::jsonb, now() - interval '24 days'),
  ('33333333-3333-4333-8333-333333333333', 'order.created', 'order', 'fa800001-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{}'::jsonb, now() - interval '24 days'),
  ('11111111-1111-4111-8111-111111111111', 'order.started', 'order', 'fa800001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}'::jsonb, now() - interval '20 days'),
  ('11111111-1111-4111-8111-111111111111', 'project.activated', 'project', 'fa900001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}'::jsonb, now() - interval '20 days'),
  -- Cairo Ceramics ← Nile Import & Trade.
  ('70000004-0000-4000-8000-000000000004', 'product.published', 'product', 'fa100004-0000-4000-8000-000000000004', '9e000000-eeee-4eee-8eee-000000000003', '{}'::jsonb, now() - interval '95 days'),
  ('70000001-0000-4000-8000-000000000001', 'rfq.submitted', 'rfq', 'fa500003-0000-4000-8000-000000000003', '9c000000-cccc-4ccc-8ccc-000000000001', '{}'::jsonb, now() - interval '65 days'),
  ('70000004-0000-4000-8000-000000000004', 'quotation.submitted', 'quotation', 'fa700002-0000-4000-8000-000000000002', '9e000000-eeee-4eee-8eee-000000000003', '{"total":167400}'::jsonb, now() - interval '62 days'),
  ('70000001-0000-4000-8000-000000000001', 'quotation.accepted', 'quotation', 'fa700002-0000-4000-8000-000000000002', '9c000000-cccc-4ccc-8ccc-000000000001', '{}'::jsonb, now() - interval '60 days'),
  ('70000004-0000-4000-8000-000000000004', 'quotation.submitted', 'quotation', 'fa700003-0000-4000-8000-000000000003', '9e000000-eeee-4eee-8eee-000000000003', '{"total":126000}'::jsonb, now() - interval '4 days');
