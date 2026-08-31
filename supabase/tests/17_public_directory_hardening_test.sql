-- pgTAP: public-directory Advisor hardening (Sprint 4.2).
-- Proves the two directory objects are NO LONGER security-definer views, that the
-- privileged read lives in a locked-down SECURITY DEFINER function, that grants
-- are exact (SELECT only — no TRUNCATE/REFERENCES/TRIGGER), and that public
-- discovery + base-table privacy are preserved. Complements 08_public_discovery
-- (row/column visibility) — this file is the catalog/security contract.
create extension if not exists pgtap;

begin;
select plan(29);

-- --- 1. Neither directory is a security-definer view -----------------------
-- reloptions must contain security_invoker=on/true for BOTH views.
select ok(
  exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='organization_public_directory'
      and c.relkind='v'
      and (c.reloptions @> array['security_invoker=on'] or c.reloptions @> array['security_invoker=true'])
  ),
  'organization_public_directory is a security_invoker view (NOT a definer view)');
select ok(
  exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='profile_public_directory'
      and c.relkind='v'
      and (c.reloptions @> array['security_invoker=on'] or c.reloptions @> array['security_invoker=true'])
  ),
  'profile_public_directory is a security_invoker view (NOT a definer view)');

-- Adversarial inverse: neither view still carries security_invoker=false.
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and c.relname in ('organization_public_directory','profile_public_directory')
     and c.reloptions @> array['security_invoker=false']),
  0, 'no public directory view remains security_invoker=false');

-- --- 2. Both objects are still VIEWS with the exact approved columns --------
select columns_are(
  'public'::name, 'organization_public_directory'::name,
  array['id','name','slug','org_type','is_verified','primary_locale','locality_id','logo_media_id'],
  'organization_public_directory still exposes only approved public columns');
-- `persona` was added to the approved set in 20260816090001 (Sprint 14): the
-- Technicians directory must filter to installer/technician professionals, and the
-- persona is ALREADY the eligibility gate for appearing in this view at all, so
-- surfacing it publishes no new fact about a person. Everything private
-- (user_id, contacts, timestamps, deleted_at, verification) stays out.
--
-- The four PRACTICE columns were added in 20260831090002 (Installer Pilot
-- Increment 2): specialization, core services, years of experience and service
-- areas. Each is a value the professional wrote about their own practice in order
-- to be found, each was already visible to any workspace user through the trade
-- directory's filters, and the LISTING PREDICATE did not move — the same rows
-- return, with more columns.
--
-- The two AVAILABILITY columns were added in 20260831090004 (Increment 4, §8.4):
-- the self-declared flag and the timestamp of its last change. Both are shown so
-- a reader can judge the claim AND its age for themselves; neither filters or
-- gates anything, and the listing predicate again did not move — an unavailable
-- professional stays listed, because hiding them would be the platform deciding
-- that "not right now" means "not at all" (O3).
--
-- Still out, and asserted by name in 38_ and 40_: `prof_availability` — the
-- PRIVATE one-off lead-time preference, which is a different fact from the live
-- flag and must not be confused with it — plus travel radius, base address, the
-- secondary service list and every consumer_* answer.
select columns_are(
  'public'::name, 'profile_public_directory'::name,
  array['id','display_name','headline','bio','avatar_media_id','locality_id','languages','persona',
        'specialization','services','years_experience','service_areas',
        'available_for_work','availability_updated_at'],
  'profile_public_directory still exposes only approved display columns');

-- --- 3. The backing readers are SECURITY DEFINER, in `app`, search_path pinned
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='app' and p.proname='_organization_public_directory'),
  true, 'app._organization_public_directory() is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='app' and p.proname='_profile_public_directory'),
  true, 'app._profile_public_directory() is SECURITY DEFINER');
select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      unnest(p.proconfig) cfg
    where n.nspname='app' and p.proname='_organization_public_directory'
      and cfg like 'search_path=%'
  ),
  'app._organization_public_directory() pins search_path');
select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      unnest(p.proconfig) cfg
    where n.nspname='app' and p.proname='_profile_public_directory'
      and cfg like 'search_path=%'
  ),
  'app._profile_public_directory() pins search_path');
-- The readers live in the NON-exposed `app` schema (not the Data API surface).
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where p.proname in ('_organization_public_directory','_profile_public_directory') and n.nspname='app'),
  2, 'both directory readers live in the non-exposed app schema');

-- --- 4. PUBLIC cannot execute the internal readers; the intended roles can --
select ok(not has_function_privilege('public', 'app._organization_public_directory()', 'execute'),
  'PUBLIC cannot execute app._organization_public_directory()');
select ok(not has_function_privilege('public', 'app._profile_public_directory()', 'execute'),
  'PUBLIC cannot execute app._profile_public_directory()');
select ok(has_function_privilege('anon', 'app._organization_public_directory()', 'execute'),
  'anon can execute app._organization_public_directory() (for the invoker view)');
select ok(has_function_privilege('authenticated', 'app._profile_public_directory()', 'execute'),
  'authenticated can execute app._profile_public_directory()');

-- --- 5. Directory-object grants are EXACTLY SELECT for anon/authenticated ---
-- No TRUNCATE / REFERENCES / TRIGGER (a default-privilege regression check).
select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
   from information_schema.role_table_grants
   where table_schema='public' and table_name='organization_public_directory' and grantee='anon'),
  'SELECT', 'anon holds ONLY SELECT on organization_public_directory (no TRUNCATE/REFERENCES/TRIGGER)');
select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
   from information_schema.role_table_grants
   where table_schema='public' and table_name='profile_public_directory' and grantee='anon'),
  'SELECT', 'anon holds ONLY SELECT on profile_public_directory (no TRUNCATE/REFERENCES/TRIGGER)');
select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
   from information_schema.role_table_grants
   where table_schema='public' and table_name='organization_public_directory' and grantee='authenticated'),
  'SELECT', 'authenticated holds ONLY SELECT on organization_public_directory');
select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
   from information_schema.role_table_grants
   where table_schema='public' and table_name='profile_public_directory' and grantee='authenticated'),
  'SELECT', 'authenticated holds ONLY SELECT on profile_public_directory');

-- --- 6. anon STILL has no direct access to the sensitive base tables -------
select ok(not has_table_privilege('anon', 'public.organizations', 'select'),
  'anon still cannot SELECT the base organizations table');
select ok(not has_table_privilege('anon', 'public.profiles', 'select'),
  'anon still cannot SELECT the base profiles table');
select ok(not has_table_privilege('anon', 'public.users', 'select'),
  'anon still cannot SELECT the base users table');
select ok(not has_table_privilege('anon', 'public.branches', 'select'),
  'anon still cannot SELECT the base branches table');
select ok(not has_table_privilege('anon', 'public.memberships', 'select'),
  'anon still cannot SELECT the base memberships table');

-- --- 7. End-to-end: discovery still works, base tables still denied --------
set local role anon;
set local request.jwt.claims = '';
select is((select count(*)::int from public.organization_public_directory), 10,
  'anon still discovers every active+verified org through the hardened view');
-- Sprint 12: the seeded supplier owner is a business-only identity, so the
-- interior designer is the single listed PERSONAL professional.
-- 8 = the base interior designer plus the Sprint-14 trades and consultants who
-- chose to be discoverable. Business owners are business-only identities and are
-- never listed here.
select is((select count(*)::int from public.profile_public_directory), 8,
  'anon still discovers the listed personal professional profiles through the hardened view');
select is((select count(*)::int from public.profile_public_directory where display_name like 'Karim%'),
  0, 'a hidden professional is still absent after hardening');
select throws_ok('select count(*) from public.organizations', '42501', null,
  'anon still cannot read the base organizations table directly');
select throws_ok('select count(*) from public.profiles', '42501', null,
  'anon still cannot read the base profiles table directly');
select throws_ok('select count(*) from public.users', '42501', null,
  'anon still cannot read the base users table directly');
reset role;

select * from finish();
rollback;
