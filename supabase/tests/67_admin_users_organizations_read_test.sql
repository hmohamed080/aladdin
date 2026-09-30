-- pgTAP: Admin Core Phase 1B-A — Users & Organizations production read contracts
-- (20260930090001_admin_users_organizations_read.sql;
--  docs/admin/ADMIN_USERS_ORGS_READ_AUDIT.md).
--
-- Called the way a hostile client would: as `authenticated` / `anon` with a
-- forged-but-valid JWT `sub`, invoking the RPCs directly.
--
--   A. Access + scope boundary (platform-scoped read required; scoped roles refused)
--   B. Users directory: total, pagination, clamping, sort both keys, deterministic ties
--   C. Users search / filters (AND semantics), private-field boundary
--   D. Organizations directory
--   E. Details (valid / nonexistent / deleted)
--   F. Nested sensitive panels keep their own permission (points.read, audit.read)
--   G. Profile completion: one formula for the user and for Admin
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(75);

\set padmin   '55555555-5555-4555-8555-555555555555'
\set consumer '44444444-4444-4444-8444-444444444444'
\set aowner   '11111111-1111-4111-8111-111111111111'
\set orgC     '9c000000-cccc-4ccc-8ccc-000000000001'
\set scoped   '67000000-0000-4000-8000-0000000000f1'
\set ureader  '67000000-0000-4000-8000-0000000000f2'
\set moder    '67000000-0000-4000-8000-0000000000f3'
\set alias    '67000000-0000-4000-8000-0000000000f4'

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
-- Run one SQL expression as a user; return its jsonb result or the SQLSTATE.
create function pg_temp.call_as(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.act_as(p_user);
  execute 'select (' || p_sql || ')::jsonb' into r;
  perform pg_temp.as_dba();
  return r;
exception when others then
  perform pg_temp.as_dba();
  return jsonb_build_object('sqlstate', sqlstate);
end;
$$;
create function pg_temp.state(p_user uuid, p_sql text) returns text language sql as $$
  select coalesce(pg_temp.call_as(p_user, p_sql) ->> 'sqlstate', 'ok') $$;
-- Admin-side helpers (Platform Admin is the seeded administrator).
create function pg_temp.ul(p_args text) returns jsonb language sql as $$
  select pg_temp.call_as('55555555-5555-4555-8555-555555555555', 'public.admin_users_list(' || p_args || ')') $$;
create function pg_temp.ol(p_args text) returns jsonb language sql as $$
  select pg_temp.call_as('55555555-5555-4555-8555-555555555555', 'public.admin_organizations_list(' || p_args || ')') $$;
create function pg_temp.ids(p jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((r ->> 'id')::uuid order by o), '{}') from jsonb_array_elements(p -> 'rows') with ordinality t(r, o) $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- 25 "Zeta Probe" users with controlled registration times, including ties.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select ('67000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'zp' || lpad(g::text, 2, '0') || '@probe.test', now(),
       jsonb_build_object('full_name', 'Zeta Probe ' || lpad(g::text, 2, '0')), now(), now()
from generate_series(1, 25) g;
update public.profiles set display_name = 'Zeta Probe ' || right(user_id::text, 2)
where user_id::text like '67000000-0000-4000-8000-0000000000__' and user_id::text ~ '\d\d$';
-- Registration: every group of three shares one timestamp (ties on purpose).
update public.users u set created_at = timestamptz '2026-01-01' + (((right(u.id::text, 2))::int - 1) / 3) * interval '1 day'
where u.id::text like '67000000-0000-4000-8000-0000000000__' and right(u.id::text, 2) ~ '^\d\d$';
-- Completion varies: phone on 1..10, display-name confirmation on 1..5.
update public.profiles set phone_e164 = '+2010670000' || right(user_id::text, 2)
where user_id::text like '67000000-0000-4000-8000-0000000000__' and right(user_id::text, 2) ~ '^\d\d$'
  and right(user_id::text, 2)::int <= 10;
update public.profiles set display_name_confirmed_at = now()
where user_id::text like '67000000-0000-4000-8000-0000000000__' and right(user_id::text, 2) ~ '^\d\d$'
  and right(user_id::text, 2)::int <= 5;
update public.profiles set display_name_ar = 'زيتا اختبار سبعة' where user_id = '67000000-0000-4000-8000-000000000007';
-- Persona / governorate / status / verification variety.
update public.users set primary_account_type = 'engineer'
where id in ('67000000-0000-4000-8000-000000000001', '67000000-0000-4000-8000-000000000002', '67000000-0000-4000-8000-000000000003');
insert into public.individual_onboarding (user_id, prof_governorate, prof_city)
values ('67000000-0000-4000-8000-000000000001', 'giza', 'Sheikh Zayed'),
       ('67000000-0000-4000-8000-000000000002', 'cairo', 'New Cairo'),
       ('67000000-0000-4000-8000-000000000004', 'giza', null);
update public.users set status = 'suspended'
where id in ('67000000-0000-4000-8000-000000000020', '67000000-0000-4000-8000-000000000021');
insert into public.verifications (subject_type, user_id, verification_type, status, submitted_at, decided_at, reason)
values ('user', '67000000-0000-4000-8000-000000000011', 'identity', 'rejected', now(), now(), 'unreadable document');

-- An Installer phone account: its auth email is a login alias, never a contact.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values (:'alias', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p201067000044@craftsman-login.aladdin.invalid', now(), '{"full_name":"Zeta Alias Probe"}', now(), now());
update public.profiles set display_name = 'Zeta Alias Probe' where user_id = :'alias';

-- Staff fixtures: an org-scoped reader, a platform users.read-only role, a Moderator.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values (:'scoped', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scoped@probe.test', now(), '{"full_name":"Scoped Reader"}', now(), now()),
       (:'ureader', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ureader@probe.test', now(), '{"full_name":"Users Reader"}', now(), now()),
       (:'moder', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'moder@probe.test', now(), '{"full_name":"Probe Moderator"}', now(), now());
insert into public.admin_roles (key, name, rank, scope_type) values
  ('probe_org_reader', 'Probe org reader', 20, 'organization'),
  ('probe_user_reader', 'Probe user reader', 20, 'user'),
  ('probe_users_only', 'Probe users only', 20, 'platform');
insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p from public.admin_roles r, unnest(array['users.read', 'organizations.read']) p
where r.key in ('probe_org_reader', 'probe_user_reader');
insert into public.admin_role_permissions (role_id, permission_key)
select id, 'users.read' from public.admin_roles where key = 'probe_users_only';
insert into public.admin_role_assignments (user_id, role_id, scope_type, scope_organization_id)
select :'scoped', id, 'organization', :'orgC' from public.admin_roles where key = 'probe_org_reader';
insert into public.admin_role_assignments (user_id, role_id, scope_type, scope_user_id)
select :'scoped', id, 'user', :'aowner' from public.admin_roles where key = 'probe_user_reader';
insert into public.admin_role_assignments (user_id, role_id)
select :'ureader', id from public.admin_roles where key = 'probe_users_only';
insert into public.admin_role_assignments (user_id, role_id)
select :'moder', id from public.admin_roles where key = 'moderator';

-- 12 "Qoppa Probe" organizations with ties, one deleted, one Arabic-named.
insert into public.organizations (id, name, org_type, status, created_by, created_at)
select ('67000000-0000-4000-8000-00000000a0' || lpad(g::text, 2, '0'))::uuid,
       'Qoppa Probe ' || lpad(g::text, 2, '0'),
       (case when g <= 6 then 'supplier' else 'importer' end)::public.organization_type,
       (case when g % 4 = 0 then 'pending_verification' else 'active' end)::public.org_status,
       :'padmin',
       timestamptz '2026-02-01' + ((g - 1) / 2) * interval '1 day'
from generate_series(1, 12) g;
update public.organizations set name_ar = 'كوبا تجربة' where id = '67000000-0000-4000-8000-00000000a003';
update public.organizations set deleted_at = now() where id = '67000000-0000-4000-8000-00000000a012';

-- ===========================================================================
-- A. Access + scope boundary
-- ===========================================================================
set local role anon;
select throws_ok($$select public.admin_users_list()$$, '42501', null, 'anon cannot execute admin_users_list');
reset role;
select is(pg_temp.state(:'consumer', 'public.admin_users_list()'), '42501', 'non-staff: users list refused');
select is(pg_temp.state(:'consumer', 'public.admin_organizations_list()'), '42501', 'non-staff: organizations list refused');
select is(pg_temp.state(:'consumer', format('public.admin_user_detail(%L)', :'aowner')), '42501', 'non-staff: user detail refused');
select is(pg_temp.state(:'consumer', format('public.admin_organization_detail(%L)', :'orgC')), '42501', 'non-staff: organization detail refused');
select is(pg_temp.state(:'padmin', 'public.admin_users_list()'), 'ok', 'Administrator (platform users.read): users list allowed');
select is(pg_temp.state(:'padmin', 'public.admin_organizations_list()'), 'ok', 'Administrator (platform organizations.read): organizations list allowed');
select is(pg_temp.state(:'ureader', 'public.admin_users_list()'), 'ok', 'a custom platform role holding only users.read reads the users directory');
select is(pg_temp.state(:'ureader', 'public.admin_organizations_list()'), '42501', '... but not the organizations directory (no organizations.read)');
select is(pg_temp.state(:'scoped', 'public.admin_users_list()'), '42501',
  'SCOPE: an organization-scoped users.read does NOT open the global users directory');
select is(pg_temp.state(:'scoped', 'public.admin_organizations_list()'), '42501',
  'SCOPE: an organization-scoped organizations.read does NOT open the global organizations directory');
select is(pg_temp.state(:'scoped', format('public.admin_organization_detail(%L)', :'orgC')), '42501',
  'SCOPE: not even the organization it is scoped to, through the global detail read');
select is(pg_temp.state(:'scoped', format('public.admin_user_detail(%L)', :'aowner')), '42501',
  'SCOPE: a user-scoped users.read does not open the global user detail read');
select is(pg_temp.state(:'padmin', format('app.profile_completion(%L)', :'aowner')), '42501',
  'the arbitrary-user completion helper is not callable by clients, even staff');
select is(pg_temp.state(:'padmin', $$to_jsonb(app.user_facing_email('x@y.z'))$$), '42501',
  'internal helpers are not client-callable');

-- ===========================================================================
-- B. Users directory — totals, pagination, ordering
-- ===========================================================================
select is((pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:desc', 1, 10$$) ->> 'total')::int, 25,
  'total counts the FULL matching set');
select is(jsonb_array_length(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:desc', 1, 10$$) -> 'rows'), 10,
  'page 1 returns exactly the page size');
select is(jsonb_array_length(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:desc', 3, 10$$) -> 'rows'), 5,
  'the last page returns the remainder');
select is((pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:desc', 99, 10$$) ->> 'page')::int, 3,
  'a page beyond the end is clamped to the last page');
select is(
  pg_temp.ids(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:desc', 1, 10$$))
  || pg_temp.ids(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:desc', 2, 10$$))
  || pg_temp.ids(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:desc', 3, 10$$)),
  (select array_agg(u.id order by u.created_at desc, u.id) from public.users u join public.profiles p on p.user_id = u.id
   where p.display_name like 'Zeta Probe %'),
  'Registered newest→oldest across all pages: no duplicate, no skip, ties broken by id');
select is(
  pg_temp.ids(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:asc', 1, 25$$)),
  (select array_agg(u.id order by u.created_at asc, u.id) from public.users u join public.profiles p on p.user_id = u.id
   where p.display_name like 'Zeta Probe %'),
  'Registered oldest→newest, ties broken by id');
select is(
  pg_temp.ids(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'completeness:desc', 1, 10$$))
  || pg_temp.ids(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'completeness:desc', 2, 10$$))
  || pg_temp.ids(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'completeness:desc', 3, 10$$)),
  (select array_agg(u.id order by (app.profile_completion(u.id) ->> 'percent')::int desc, u.id)
   from public.users u join public.profiles p on p.user_id = u.id where p.display_name like 'Zeta Probe %'),
  'Profile Completion high→low across all pages, ties broken by id');
select is(
  pg_temp.ids(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'completeness:asc', 1, 25$$)),
  (select array_agg(u.id order by (app.profile_completion(u.id) ->> 'percent')::int asc, u.id)
   from public.users u join public.profiles p on p.user_id = u.id where p.display_name like 'Zeta Probe %'),
  'Profile Completion low→high, ties broken by id');
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'completeness:desc', 1, 25$$) -> 'rows') r
   where (r ->> 'completion')::int is distinct from (app.profile_completion((r ->> 'id')::uuid) ->> 'percent')::int),
  0, 'every row''s completion is the real formula''s value');
select ok(
  (select count(distinct (r ->> 'completion')::int) from jsonb_array_elements(pg_temp.ul($$'Zeta Probe', null, null, null, null, 'completeness:desc', 1, 25$$) -> 'rows') r) >= 3,
  'the fixture mix yields several distinct completion values (the sort is meaningful)');
select is(
  (pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:desc', 1, 25$$) -> 'rows' -> 0 ->> 'id')::uuid,
  (pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:desc', 1, 25$$) -> 'rows' -> 0 ->> 'id')::uuid,
  'the same query twice returns the same first row (stable)');

-- ===========================================================================
-- C. Search / filters / private-field boundary
-- ===========================================================================
select is((pg_temp.ul($$'zp07@probe.test', null, null, null, null, 'registered:desc', 1, 10$$) ->> 'total')::int, 1,
  'search matches the account email');
select is((pg_temp.ul($$'01067000003', null, null, null, null, 'registered:desc', 1, 10$$) -> 'rows' -> 0 ->> 'id'),
  '67000000-0000-4000-8000-000000000003', 'search by Egyptian national phone matches the canonical E.164 number');
select is((pg_temp.ul($$'٠١٠٦٧٠٠٠٠٠٣', null, null, null, null, 'registered:desc', 1, 10$$) ->> 'total')::int, 1,
  'search by Arabic-Indic digits matches the same phone');
select is((pg_temp.ul($$'زيتا اختبار', null, null, null, null, 'registered:desc', 1, 10$$) -> 'rows' -> 0 ->> 'id'),
  '67000000-0000-4000-8000-000000000007', 'search matches the Arabic display name');
select is((pg_temp.ul($$'%', null, null, null, null, 'registered:desc', 1, 10$$) ->> 'total')::int, 0,
  'LIKE wildcards in a search term are literal');
select is((pg_temp.ul($$'craftsman-login', null, null, null, null, 'registered:desc', 1, 10$$) ->> 'total')::int, 0,
  'the Installer login alias is not searchable');
select is((pg_temp.ul($$'Zeta Alias Probe', null, null, null, null, 'registered:desc', 1, 10$$) -> 'rows' -> 0 -> 'email'),
  'null'::jsonb, 'the Installer login alias is never returned as an email');
select is((pg_temp.ul($$'Zeta Probe', null, 'engineer', null, null, 'registered:desc', 1, 10$$) ->> 'total')::int, 3,
  'persona filter');
select is((pg_temp.ul($$'Zeta Probe', null, 'engineer', null, 'giza', 'registered:desc', 1, 10$$) ->> 'total')::int, 1,
  'search + two filters combine with AND');
select is((pg_temp.ul($$'Zeta Probe', null, null, null, 'giza', 'registered:desc', 1, 10$$) ->> 'total')::int, 2,
  'governorate filter over the full set');
select is((pg_temp.ul($$'Zeta Probe', 'suspended', null, null, null, 'registered:desc', 1, 10$$) ->> 'total')::int, 2,
  'status tab filter');
select is((pg_temp.ul($$'Zeta Probe', 'suspended', null, null, null, 'registered:desc', 1, 10$$) -> 'counts' ->> 'all')::int, 25,
  'tab counts ignore the active tab (so every tab keeps its own count)');
select is((pg_temp.ul($$'Zeta Probe', null, null, 'rejected', null, 'registered:desc', 1, 10$$) -> 'rows' -> 0 -> 'flags'),
  '["verification_issue"]'::jsonb, 'verification filter + the real verification_issue flag');
select is((pg_temp.ul($$'Zeta Probe', null, null, null, null, 'registered:desc', 1, 10$$) -> 'counts' ->> 'rejected')::int, 1,
  'rejected tab count');
select is((pg_temp.ul($$null, null, null, null, null, 'registered:desc', 1, 10$$) ->> 'total')::int,
  (select count(*)::int from public.users), 'clearing search and filters restores the full total');
select is(pg_temp.ul($$null, null, null, null, null, 'name:desc', 1, 10$$) ->> 'sqlstate', '22023', 'unknown sort refused');
select is(pg_temp.ul($$null, null, null, null, null, 'registered:desc', 1, 7$$) ->> 'sqlstate', '22023', 'unapproved page size refused');
select is(pg_temp.ul($$null, null, null, null, null, 'registered:desc', 0, 10$$) ->> 'sqlstate', '22023', 'page 0 refused');
select is(pg_temp.ul($$null, 'deleted', null, null, null, 'registered:desc', 1, 10$$) ->> 'sqlstate', '22023', 'unknown status tab refused');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.ul($$'Zeta Probe 01', null, null, null, null, 'registered:desc', 1, 10$$) -> 'rows' -> 0) k),
  array['account_type','city','completion','created_at','display_name','display_name_ar','display_name_en','email',
        'flags','governorate','id','is_verified','latest_verification_status','organization','organization_count',
        'phone','profile_id','public_profile_available','status','username','verification_state'],
  'a directory row carries exactly the approved fields — no auth metadata');
select is((pg_temp.ul($$'Zeta Probe 01', null, null, null, null, 'registered:desc', 1, 10$$) -> 'rows' -> 0 ->> 'profile_id')::uuid,
  (select id from public.profiles where user_id = '67000000-0000-4000-8000-000000000001'),
  'View on Platform receives the PROFILE id, not the user id');
select is((pg_temp.ul($$'Zeta Probe 01', null, null, null, null, 'registered:desc', 1, 10$$) -> 'rows' -> 0 ->> 'public_profile_available')::boolean,
  false, 'no public page is claimed for an unlisted profile');

-- ===========================================================================
-- D. Organizations directory
-- ===========================================================================
select is((pg_temp.ol($$'Qoppa Probe', null, null, 'registered:desc', 1, 10$$) ->> 'total')::int, 11,
  'organization total counts the full set and excludes the deleted one');
select is(jsonb_array_length(pg_temp.ol($$'Qoppa Probe', null, null, 'registered:desc', 2, 10$$) -> 'rows'), 1,
  'organization page 2 holds the remainder');
select is(
  pg_temp.ids(pg_temp.ol($$'Qoppa Probe', null, null, 'registered:desc', 1, 10$$))
  || pg_temp.ids(pg_temp.ol($$'Qoppa Probe', null, null, 'registered:desc', 2, 10$$)),
  (select array_agg(id order by created_at desc, id) from public.organizations where name like 'Qoppa Probe %' and deleted_at is null),
  'organizations newest→oldest across pages, ties broken by id');
select is(
  pg_temp.ids(pg_temp.ol($$'Qoppa Probe', null, null, 'registered:asc', 1, 25$$)),
  (select array_agg(id order by created_at asc, id) from public.organizations where name like 'Qoppa Probe %' and deleted_at is null),
  'organizations oldest→newest, ties broken by id');
select is((pg_temp.ol($$'كوبا', null, null, 'registered:desc', 1, 10$$) -> 'rows' -> 0 ->> 'id'),
  '67000000-0000-4000-8000-00000000a003', 'organization search matches the Arabic name');
select is((pg_temp.ol($$'Qoppa Probe', null, 'importer', 'registered:desc', 1, 10$$) ->> 'total')::int, 5,
  'organization type filter (deleted importer excluded)');
select is((pg_temp.ol($$'Qoppa Probe', 'pending', 'supplier', 'registered:desc', 1, 10$$) ->> 'total')::int, 1,
  'search + status tab + type combine with AND');
select is((pg_temp.ol($$'Qoppa Probe', 'pending', null, 'registered:desc', 1, 10$$) -> 'counts' ->> 'all')::int, 11,
  'organization tab counts ignore the active tab');
select is(pg_temp.ol($$null, null, null, 'completeness:desc', 1, 10$$) ->> 'sqlstate', '22023',
  'organizations have no completion formula, so that sort is refused');
select is((pg_temp.ol($$null, null, null, 'registered:desc', 1, 10$$) ->> 'total')::int,
  (select count(*)::int from public.organizations where deleted_at is null), 'clearing restores the full organization total');
select is(
  (select r -> 'owner' ->> 'user_id' from jsonb_array_elements(pg_temp.ol($$'Cairo Ceramics', null, null, 'registered:desc', 1, 10$$) -> 'rows') r
   where r ->> 'id' = '9c000000-cccc-4ccc-8ccc-000000000001'),
  (select m.user_id::text from public.memberships m join public.membership_capabilities c on c.membership_id = m.id
   where m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001' and m.status = 'active' and c.capability_key = 'org.manage'
   order by m.created_at, m.id limit 1),
  'owner = the first active org.manage member');

-- ===========================================================================
-- E. Details
-- ===========================================================================
select is(pg_temp.call_as(:'padmin', $$public.admin_user_detail('00000000-0000-4000-8000-000000000000')$$), null,
  'nonexistent user → NULL');
select is(pg_temp.call_as(:'padmin', $$public.admin_organization_detail('00000000-0000-4000-8000-000000000000')$$), null,
  'nonexistent organization → NULL');
select is(pg_temp.call_as(:'padmin', $$public.admin_organization_detail('67000000-0000-4000-8000-00000000a012')$$), null,
  'deleted organization → NULL');
select is(pg_temp.call_as(:'padmin', format('public.admin_user_detail(%L)', :'aowner')) ->> 'email', 'a-owner@example.test',
  'valid user detail returns the account email');
select is(pg_temp.call_as(:'padmin', format('public.admin_user_detail(%L)', :'alias')) -> 'email', 'null'::jsonb,
  'user detail never returns the Installer login alias');
select is(jsonb_array_length(pg_temp.call_as(:'padmin', format('public.admin_user_detail(%L)', :'aowner')) -> 'memberships'),
  (select count(*)::int from public.memberships m join public.organizations o on o.id = m.organization_id and o.deleted_at is null
   where m.user_id = :'aowner'), 'user detail lists the real memberships');
select ok(not (pg_temp.call_as(:'padmin', format('public.admin_user_detail(%L)', :'aowner')) ?| array['points', 'audit', 'ledger']),
  'user detail carries no Points or Audit data (those panels keep their own permission)');
select is(jsonb_array_length(pg_temp.call_as(:'padmin', format('public.admin_organization_detail(%L)', :'orgC')) -> 'branches'),
  (select count(*)::int from public.branches where organization_id = :'orgC' and deleted_at is null),
  'organization detail lists the real branches');

-- ===========================================================================
-- F. Nested sensitive panels
-- ===========================================================================
select is(pg_temp.state(:'ureader', format('public.admin_user_detail(%L)', :'aowner')), 'ok',
  'users.read alone opens the user detail');
select pg_temp.act_as(:'ureader');
select is((select count(*)::int from public.audit_log), 0, 'users.read alone reads no audit rows (audit.read required)');
select is((select count(*)::int from public.points_ledger where user_id <> :'ureader'), 0,
  'users.read alone reads no one else''s Points ledger (points.read required)');
select pg_temp.as_dba();
select pg_temp.act_as(:'moder');
select is((select count(*)::int from public.audit_log), 0, 'Moderator (no audit.read) reads no audit rows');
select pg_temp.as_dba();
select pg_temp.act_as(:'padmin');
select ok((select count(*) from public.audit_log) > 0, 'Administrator (audit.read) reads audit rows');
select pg_temp.as_dba();

-- ===========================================================================
-- G. One completion formula
-- ===========================================================================
select is(pg_temp.call_as('67000000-0000-4000-8000-000000000001', 'public.my_profile_completion()'),
  app.profile_completion('67000000-0000-4000-8000-000000000001'),
  'my_profile_completion() is exactly app.profile_completion(self)');
select is((pg_temp.ul($$'Zeta Probe 01', null, null, null, null, 'registered:desc', 1, 10$$) -> 'rows' -> 0 ->> 'completion')::int,
  (app.profile_completion('67000000-0000-4000-8000-000000000001') ->> 'percent')::int,
  'the Admin directory shows the same percentage the user sees');
select is(pg_temp.call_as(:'padmin', format('public.admin_user_detail(%L)', '67000000-0000-4000-8000-000000000001')) -> 'completion' -> 'missing',
  app.profile_completion('67000000-0000-4000-8000-000000000001') -> 'missing',
  'the Admin detail lists the same missing items the user sees');

select * from finish();
rollback;
