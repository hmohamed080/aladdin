-- Sample data for reviewing Admin View-As (craftsman) on a NON-PRODUCTION database ONLY.
--
-- NOT part of the default seed and never run automatically. Run it by hand against an explicitly authorized
-- local / Test / Acceptance / Preview database that already holds the seed-pilot accounts:
--   71000006 (installer_technician "Sayed Abdel-Rahman")  — the craftsman being viewed
--   70000006 (contractor, owner of Horizon Contracting 9a000000-aaaa-4aaa-8aaa-000000000005) — the hiring company
-- It builds the work through the REAL job RPCs (create, publish, apply, accept, start, progress, complete, review), then adds
-- points, a portfolio project with files, a certificate and a secondary phone as plain rows (private files are placeholders;
-- the object keys are syntactically valid but point at nothing). Safe to run once; refuses to run twice.
--
-- Production guard: this script aborts unless the database is explicitly marked non-production.
--   alter database postgres set app.environment = 'preview';   -- (one-time, by the operator of that non-production database)
begin;

do $$
begin
  if coalesce(current_setting('app.environment', true), '') not in ('local', 'test', 'acceptance', 'preview') then
    raise exception 'seed-view-as-preview.sql refuses to run: app.environment must be local/test/acceptance/preview (got %)',
      coalesce(current_setting('app.environment', true), '<unset>');
  end if;
  if exists (select 1 from public.portfolio_projects where owner_user_id = '71000006-0000-4000-8000-000000000006' and title = 'Villa kitchen - New Cairo') then
    raise exception 'sample data already present';
  end if;
end $$;

\set poster '70000006-0000-4000-8000-000000000006'
\set craft  '71000006-0000-4000-8000-000000000006'
\set org    '9a000000-aaaa-4aaa-8aaa-000000000005'

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end; $$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end; $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated;

-- Job 1: completed and reviewed.
select pg_temp.act_as(:'poster');
select set_config('t.j1', public.job_create(:'org'::uuid, 'Marble staircase cladding - Fifth Settlement',
  (select key from public.trades where is_active order by sort_order limit 1), 9000::numeric, 'Full cladding, 18 steps.', 'Cairo', 'New Cairo', 'Street 9', 4::smallint)::text, true);
select public.job_publish(current_setting('t.j1')::uuid, 1);
select set_config('t.j2', public.job_create(:'org'::uuid, 'Bathroom tiling - Sheikh Zayed',
  (select key from public.trades where is_active order by sort_order limit 1), 6500::numeric, 'Two bathrooms, porcelain.', 'Giza', 'Sheikh Zayed', 'Compound 4', 6::smallint)::text, true);
select public.job_publish(current_setting('t.j2')::uuid, 1);
select pg_temp.as_dba();
select pg_temp.act_as(:'craft');
select set_config('t.a1', public.job_application_submit(current_setting('t.j1')::uuid, 'Available next week.')::text, true);
select set_config('t.a2', public.job_application_submit(current_setting('t.j2')::uuid, 'I can start Sunday.')::text, true);
select pg_temp.as_dba();
select pg_temp.act_as(:'poster');
select set_config('t.s1', public.job_application_accept(current_setting('t.a1')::uuid)::text, true);
select set_config('t.s2', public.job_application_accept(current_setting('t.a2')::uuid)::text, true);
select pg_temp.as_dba();
select pg_temp.act_as(:'craft');
select public.job_assignment_start(current_setting('t.s1')::uuid, 1);
select public.job_progress_add(current_setting('t.s1')::uuid, 100::smallint, 'wrap', 'Finished.');
select public.job_assignment_start(current_setting('t.s2')::uuid, 1);
select public.job_progress_add(current_setting('t.s2')::uuid, 45::smallint, 'halfway', 'First bathroom done.');
select pg_temp.as_dba();
select pg_temp.act_as(:'poster');
select public.job_assignment_complete(current_setting('t.s1')::uuid, (select version from public.job_assignments where id = current_setting('t.s1')::uuid));
select public.job_review_submit(current_setting('t.s1')::uuid, 5::smallint, 'Excellent finish, on time and tidy.');
select pg_temp.as_dba();

insert into public.points_ledger (user_id, event_type, points_delta, source_type, source_id) values
  (:'craft', 'referral.organization_approved', 100, 'referral', gen_random_uuid()),
  (:'craft', 'referral.organization_approved', 100, 'referral', gen_random_uuid());
insert into public.portfolio_projects (owner_user_id, title, location, description) values
  (:'craft', 'Villa kitchen - New Cairo', 'New Cairo', 'Full kitchen fit-out: porcelain floors and backsplash.');
insert into public.portfolio_items (owner_user_id, object_key, content_type, title, project_id, state)
  select :'craft', k, 'image/jpeg', t, (select id from public.portfolio_projects where owner_user_id = :'craft' and title = 'Villa kitchen - New Cairo'), 'ready'
    from (values ('d1000000-0000-4000-8000-000000000001.jpg', 'Before'), ('d1000000-0000-4000-8000-000000000002.jpg', 'After')) v(k, t);
insert into public.professional_certificates (owner_user_id, object_path, content_type, title, issuer, issued_on, expires_on, original_filename, state)
  values (:'craft', :'craft' || '/d2000000-0000-4000-8000-000000000001.pdf', 'application/pdf', 'Electrical safety', 'Egypt Safety Board', '2025-01-15', '2028-01-15', 'certificate.pdf', 'ready');
insert into public.secondary_phone_reservations (user_id, phone_e164, status, expires_at)
  values (:'craft', '+201000000999', 'active', now() + interval '10 days');

commit;
