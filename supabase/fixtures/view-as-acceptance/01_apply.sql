-- Admin View-As review fixture: ONE synthetic craftsman + ONE synthetic hiring company, for a NON-PRODUCTION (Acceptance) database.
--
-- NOT a migration, NOT part of any seed, never run automatically. The owner approves running it separately; see
-- docs/admin/ADMIN_VIEW_AS_PREVIEW_DEPLOYMENT_PLAN.md and supabase/fixtures/view-as-acceptance/README.md.
--
-- Properties
--   * Atomic: one DO block = one transaction. Any failure leaves nothing behind.
--   * Idempotent: if the fixture craftsman already exists it does nothing (and says so).
--   * Scoped: every row hangs off the reserved ids 7fa0xxxx-... / the marker below; 03_cleanup.sql removes exactly those.
--   * Synthetic: addresses use the reserved `.invalid` TLD (can never receive mail); the accounts have NO password, so nobody can
--     sign in as them (the Admin only views). No contact rows, no invitation, no OTP, no WhatsApp, no email is created or sent.
--     (email_confirmed_at is set only because the job functions require a verified caller.)
--   * Not public: the craftsman keeps the default (hidden) public-profile status. Nothing is listed.
--   * Private media: the portfolio/certificate rows are metadata only. The object keys point at nothing, and nothing is uploaded.
--
-- Refuses to run if the database says it is production, or if it holds an implausible number of users for a review database.
do $fixture$
declare
  c_craft  constant uuid := '7fa00001-0000-4000-8000-0000000000c1';
  c_poster constant uuid := '7fa00002-0000-4000-8000-0000000000c2';
  c_org    constant uuid := '7fa000a1-aaaa-4aaa-8aaa-0000000000a1';
  c_member constant uuid := '7fa000b1-0000-4000-8000-0000000000b1';
  c_marker constant text := 'admin-view-as-fixture-2026-11';
  v_env  text := coalesce(current_setting('app.environment', true), '');
  v_trade text;
  j1 uuid; j2 uuid; a1 uuid; a2 uuid; s1 uuid; s2 uuid; proj uuid;
begin
  if v_env = 'production' then
    raise exception 'view-as fixture refuses to run: app.environment is production';
  end if;
  if (select count(*) from public.users) > 500 then
    raise exception 'view-as fixture refuses to run: this does not look like a small review database';
  end if;
  if exists (select 1 from auth.users where id = c_craft) then
    raise notice 'view-as fixture already present: nothing to do';
    return;
  end if;
  if not pg_has_role(current_user, 'authenticated', 'member') then
    raise exception 'run this as a role that may SET ROLE authenticated (the job functions are exercised as real users)';
  end if;
  select key into v_trade from public.trades where is_active order by sort_order limit 1;

  -- Accounts: no password (nobody can sign in), reserved .invalid addresses. email_confirmed_at is set only because the job
  -- functions require a "verified" caller; it sends nothing and creates no contact row.
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new,
                          email_change_token_current, reauthentication_token, phone_change, phone_change_token)
  values
    (c_craft, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewas-craftsman@fixture.invalid', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     jsonb_build_object('display_name', 'View-As Test Craftsman', 'locale', 'en', 'fixture', c_marker), now(), now(), '', '', '', '', '', '', '', ''),
    (c_poster, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewas-company@fixture.invalid', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     jsonb_build_object('display_name', 'View-As Test Company Owner', 'locale', 'en', 'fixture', c_marker), now(), now(), '', '', '', '', '', '', '', '');

  update public.users set primary_account_type = 'installer_technician', status = 'active' where id = c_craft;
  update public.users set primary_account_type = 'contractor',           status = 'active' where id = c_poster;

  -- is_verified is required by job_publish (job_poster_is_discoverable). Every job is accepted before this block ends, so none is
  -- left open; 02_verify.sql proves it.
  insert into public.organizations (id, name, slug, org_type, status, is_verified, primary_locale, created_by)
  values (c_org, 'View-As Test Contracting (fixture)', 'viewas-fixture-contracting', 'contractor_company', 'active', true, 'en', c_poster);
  insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at)
  values (c_member, c_poster, c_org, null, 'active', now());
  -- The two job capabilities the review flow needs: post an opening and decide who gets it.
  insert into public.membership_capabilities (membership_id, capability_key) values (c_member, 'job.post'), (c_member, 'job.manage');

  update public.profiles set
    headline = 'Marble and granite fixing (test data)',
    bio = 'Synthetic profile created for the Admin View-As review. Not a real person.',
    languages = array['en']
  where user_id = c_craft;

  -- Work history through the REAL job functions, acting as each user (no direct writes to the job tables).
  perform set_config('request.jwt.claims', json_build_object('sub', c_poster, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j1 := public.job_create(c_org, 'Marble staircase cladding (test)', v_trade, 9000::numeric, 'Synthetic job for the View-As review.', 'Cairo', 'New Cairo', 'Test street 9', 4::smallint);
  perform public.job_publish(j1, 1);
  j2 := public.job_create(c_org, 'Bathroom tiling (test)', v_trade, 6500::numeric, 'Synthetic job for the View-As review.', 'Giza', 'Sheikh Zayed', 'Test compound 4', 6::smallint);
  perform public.job_publish(j2, 1);
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', c_craft, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  a1 := public.job_application_submit(j1, 'Available next week.');
  a2 := public.job_application_submit(j2, 'I can start Sunday.');
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', c_poster, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  s1 := public.job_application_accept(a1);
  s2 := public.job_application_accept(a2);
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', c_craft, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.job_assignment_start(s1, 1);
  perform public.job_progress_add(s1, 100::smallint, 'wrap', 'Finished.');
  perform public.job_assignment_start(s2, 1);
  perform public.job_progress_add(s2, 45::smallint, 'halfway', 'First bathroom done.');
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', c_poster, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.job_assignment_complete(s1, (select version from public.job_assignments where id = s1));
  perform public.job_review_submit(s1, 5::smallint, 'Excellent finish, on time and tidy. (test data)');
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- Plain rows: points, a portfolio project with two private-file placeholders, a certificate and a secondary phone.
  insert into public.points_ledger (user_id, event_type, points_delta, source_type, source_id) values
    (c_craft, 'referral.organization_approved', 100, 'referral', gen_random_uuid()),
    (c_craft, 'referral.organization_approved', 100, 'referral', gen_random_uuid());
  insert into public.portfolio_projects (owner_user_id, title, location, description)
  values (c_craft, 'Villa kitchen (test)', 'New Cairo', 'Synthetic project. Its files are placeholders.')
  returning id into proj;
  insert into public.portfolio_items (owner_user_id, object_key, content_type, title, project_id, state) values
    (c_craft, '7fa0d001-0000-4000-8000-000000000001.jpg', 'image/jpeg', 'Before', proj, 'ready'),
    (c_craft, '7fa0d001-0000-4000-8000-000000000002.jpg', 'image/jpeg', 'After',  proj, 'ready');
  insert into public.professional_certificates (owner_user_id, object_path, content_type, title, issuer, issued_on, expires_on, original_filename, state)
  values (c_craft, c_craft || '/7fa0d002-0000-4000-8000-000000000001.pdf', 'application/pdf', 'Electrical safety (test)', 'Test Safety Board', '2025-01-15', '2028-01-15', 'certificate.pdf', 'ready');
  insert into public.secondary_phone_reservations (user_id, phone_e164, status, expires_at)
  values (c_craft, '+201000000999', 'active', now() + interval '10 days');

  raise notice 'view-as fixture created: craftsman %, company owner %, organization %', c_craft, c_poster, c_org;
end
$fixture$;
