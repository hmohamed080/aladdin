-- pgTAP: Admin Organizations - one authoritative ORGANIZATION APPROVAL state
-- (20261116090001_admin_organizations_approval_state.sql).
--
-- Lifecycle status (organizations.status) and Approval (the decision on the organization application) are different things.
-- The directory (admin_organizations_list) and the detail page (admin_organization_detail) must show the SAME approval decision:
-- the newest request with subject_type = 'organization' AND verification_type = 'organization', ordered
-- submitted_at desc, created_at desc, id desc.
--
--   A. Authorization unchanged
--   B. Tab mapping and approval_state per lifecycle / is_verified / latest decision (incl. cancelled, archived, draft)
--   C. Rejected tab, counts, filters, zero-result scopes, pagination
--   D. Deterministic latest decision (equal timestamps, id tie-break; business requests ignored)
--   E. List and detail agree for every organization
--   F. Multiple organizations per owner; rejected -> abandon -> NEW application
--   G. Read-only: history is preserved
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
--
-- SCOPE: this file pins the READ rules on fixture rows that are inserted directly (organizations + verifications), so it can
-- cover every lifecycle / decision combination and tie-breaks. It does NOT drive the reject -> abandon -> new-application
-- workflow through the real RPCs: that is 138 (directory/detail after each real step) and 77 (the RPC rules themselves).
create extension if not exists pgtap;

begin;
select plan(48);

\set padmin   '55555555-5555-4555-8555-555555555555'
\set consumer '44444444-4444-4444-8444-444444444444'
\set owner1   '13700000-0000-4000-8000-0000000000a1'

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
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
-- Admin-side helpers: organizations directory scoped to the Rho probe organizations.
create function pg_temp.ol(p_status text, p_type text, p_sort text, p_page int, p_size int) returns jsonb language sql as $$
  select pg_temp.call_as('55555555-5555-4555-8555-555555555555',
    format('public.admin_organizations_list(%L, %L, %L::public.organization_type, %L, %s, %s)', 'Rho Probe', p_status, p_type, p_sort, p_page, p_size)) $$;
create function pg_temp.od(p_id uuid) returns jsonb language sql as $$
  select pg_temp.call_as('55555555-5555-4555-8555-555555555555', format('public.admin_organization_detail(%L)', p_id)) $$;
create function pg_temp.names(p jsonb) returns text[] language sql as $$
  select coalesce(array_agg(r ->> 'name' order by r ->> 'name'), '{}') from jsonb_array_elements(p -> 'rows') r $$;
create function pg_temp.row_of(p jsonb, p_name text) returns jsonb language sql as $$
  select r from jsonb_array_elements(p -> 'rows') r where r ->> 'name' = p_name $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures (all organizations are 'supplier'; registration dates are distinct so the default sort is stable)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values (:'owner1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rho-owner@probe.test', now(),
        '{"full_name":"Rho Owner"}', now(), now());

--   id suffix  name           lifecycle             is_verified  note
insert into public.organizations (id, name, org_type, status, is_verified, created_by, created_at) values
  ('13700000-0000-4000-8000-000000000001', 'Rho Probe 01 active approved',      'supplier', 'active',               true,  :'padmin', timestamptz '2026-03-01'),
  ('13700000-0000-4000-8000-000000000002', 'Rho Probe 02 pending open',         'supplier', 'pending_verification', false, :'padmin', timestamptz '2026-03-02'),
  ('13700000-0000-4000-8000-000000000003', 'Rho Probe 03 pending rejected',     'supplier', 'pending_verification', false, :'padmin', timestamptz '2026-03-03'),
  ('13700000-0000-4000-8000-000000000004', 'Rho Probe 04 pending no request',   'supplier', 'pending_verification', false, :'padmin', timestamptz '2026-03-04'),
  ('13700000-0000-4000-8000-000000000005', 'Rho Probe 05 suspended approved',   'supplier', 'suspended',            true,  :'padmin', timestamptz '2026-03-05'),
  ('13700000-0000-4000-8000-000000000006', 'Rho Probe 06 suspended rejected',   'supplier', 'suspended',            false, :'padmin', timestamptz '2026-03-06'),
  ('13700000-0000-4000-8000-000000000007', 'Rho Probe 07 archived cancelled',   'supplier', 'archived',             false, :'padmin', timestamptz '2026-03-07'),
  ('13700000-0000-4000-8000-000000000008', 'Rho Probe 08 draft',                'supplier', 'draft',                false, :'padmin', timestamptz '2026-03-08'),
  ('13700000-0000-4000-8000-000000000009', 'Rho Probe 09 pending tie rejected', 'supplier', 'pending_verification', false, :'padmin', timestamptz '2026-03-09'),
  ('13700000-0000-4000-8000-000000000010', 'Rho Probe 10 active legacy flag',   'supplier', 'active',               false, :'padmin', timestamptz '2026-03-10'),
  ('13700000-0000-4000-8000-000000000011', 'Rho Probe 11 pending tie cancelled','supplier', 'pending_verification', false, :'padmin', timestamptz '2026-03-11'),
  ('13700000-0000-4000-8000-000000000012', 'Rho Probe 12 new application',      'supplier', 'pending_verification', false, :'padmin', timestamptz '2026-03-12'),
  ('13700000-0000-4000-8000-000000000013', 'Rho Probe 13 pending needs info',   'supplier', 'pending_verification', false, :'padmin', timestamptz '2026-03-13'),
  ('13700000-0000-4000-8000-000000000014', 'Rho Probe 14 draft rejected',       'supplier', 'draft',                false, :'padmin', timestamptz '2026-03-14');

insert into public.verifications (id, subject_type, organization_id, verification_type, status, submitted_at, created_at) values
  -- 01: approved (applied state is represented by the organization row above)
  ('13700000-0000-4000-8000-0000000001b1', 'organization', '13700000-0000-4000-8000-000000000001', 'organization', 'approved',  timestamptz '2026-03-01', timestamptz '2026-03-01'),
  -- 02: open request
  ('13700000-0000-4000-8000-0000000002b1', 'organization', '13700000-0000-4000-8000-000000000002', 'organization', 'submitted',  timestamptz '2026-03-02', timestamptz '2026-03-02'),
  -- 03: rejected, followed by a NEWER business request that must be ignored
  ('13700000-0000-4000-8000-0000000003b1', 'organization', '13700000-0000-4000-8000-000000000003', 'organization', 'rejected',   timestamptz '2026-03-03', timestamptz '2026-03-03'),
  ('13700000-0000-4000-8000-0000000003b2', 'organization', '13700000-0000-4000-8000-000000000003', 'business',     'submitted',  timestamptz '2026-04-03', timestamptz '2026-04-03'),
  -- 05: approved earlier, suspended since
  ('13700000-0000-4000-8000-0000000005b1', 'organization', '13700000-0000-4000-8000-000000000005', 'organization', 'approved',  timestamptz '2026-03-05', timestamptz '2026-03-05'),
  -- 06: rejected, then suspended by an Admin
  ('13700000-0000-4000-8000-0000000006b1', 'organization', '13700000-0000-4000-8000-000000000006', 'organization', 'rejected',  timestamptz '2026-03-06', timestamptz '2026-03-06'),
  -- 07: the owner abandoned a rejected application: a cancelled request is the latest, the organization is archived
  ('13700000-0000-4000-8000-0000000007b1', 'organization', '13700000-0000-4000-8000-000000000007', 'organization', 'rejected',  timestamptz '2026-03-07', timestamptz '2026-03-07'),
  ('13700000-0000-4000-8000-0000000007b2', 'organization', '13700000-0000-4000-8000-000000000007', 'organization', 'cancelled', timestamptz '2026-03-17', timestamptz '2026-03-17'),
  -- 09 / 11: two decisions with IDENTICAL submitted_at and created_at: the higher id wins
  ('13700000-0000-4000-8000-0000000009b1', 'organization', '13700000-0000-4000-8000-000000000009', 'organization', 'cancelled', timestamptz '2026-03-09', timestamptz '2026-03-09'),
  ('13700000-0000-4000-8000-0000000009b2', 'organization', '13700000-0000-4000-8000-000000000009', 'organization', 'rejected',  timestamptz '2026-03-09', timestamptz '2026-03-09'),
  ('13700000-0000-4000-8000-0000000011b1', 'organization', '13700000-0000-4000-8000-000000000011', 'organization', 'rejected',  timestamptz '2026-03-11', timestamptz '2026-03-11'),
  ('13700000-0000-4000-8000-0000000011b2', 'organization', '13700000-0000-4000-8000-000000000011', 'organization', 'cancelled', timestamptz '2026-03-11', timestamptz '2026-03-11'),
  -- 12: the NEW application of the same owner as 03 / 07: open
  ('13700000-0000-4000-8000-0000000012b1', 'organization', '13700000-0000-4000-8000-000000000012', 'organization', 'submitted', timestamptz '2026-03-12', timestamptz '2026-03-12'),
  -- 14: a draft organization whose latest decision is rejected
  ('13700000-0000-4000-8000-0000000014b1', 'organization', '13700000-0000-4000-8000-000000000014', 'organization', 'rejected', timestamptz '2026-03-14', timestamptz '2026-03-14');

-- 13: more information requested (still open; this status requires a reason)
insert into public.verifications (id, subject_type, organization_id, verification_type, status, submitted_at, created_at, reason)
values ('13700000-0000-4000-8000-0000000013b1', 'organization', '13700000-0000-4000-8000-000000000013', 'organization', 'needs_more_info', timestamptz '2026-03-13', timestamptz '2026-03-13', 'please add the commercial register');

-- One owner holds several of these organizations (rejected, abandoned, and the new application).
insert into public.memberships (id, organization_id, user_id, status)
select ('13700000-0000-4000-8000-00000000c0' || lpad(n::text, 2, '0'))::uuid, ('13700000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, :'owner1', 'active'
from unnest(array[3, 7, 12]) n;
insert into public.membership_capabilities (membership_id, capability_key)
select ('13700000-0000-4000-8000-00000000c0' || lpad(n::text, 2, '0'))::uuid, 'org.manage' from unnest(array[3, 7, 12]) n;

create temp table _hist_before as select count(*) n, md5(string_agg(v.id::text || v.status::text, ',' order by v.id)) h
  from public.verifications v where v.organization_id::text like '13700000-0000-4000-8000-0000000000%';

-- ===========================================================================
-- A. Authorization unchanged
-- ===========================================================================
select is(pg_temp.state(:'consumer', 'public.admin_organizations_list()'), '42501', 'non-staff: organizations list refused');
select is(pg_temp.state(:'consumer', 'public.admin_organization_detail(''13700000-0000-4000-8000-000000000001'')'), '42501', 'non-staff: organization detail refused');
select is(pg_temp.state(:'padmin', 'public.admin_organizations_list()'), 'ok', 'Administrator: organizations list allowed');
select is(pg_temp.state(:'padmin', 'public.admin_organizations_list(null, ''bogus'')'), '22023', 'an unknown status filter is still refused');
select is(pg_temp.state(:'padmin', 'public.admin_organizations_list(null, ''rejected'')'), 'ok', 'the rejected status filter is accepted');
select is(
  (select array_agg(p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '') order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_organizations_list', 'admin_organization_detail')),
  array['true:search_path=""', 'true:search_path=""'], 'both reads stay SECURITY DEFINER with an empty search_path');
select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_organizations_list', 'admin_organization_detail')
     and has_function_privilege('anon', p.oid, 'execute')), 0, 'anon cannot execute either read');

-- ===========================================================================
-- B. Tab mapping and approval_state (one row per fixture)
-- ===========================================================================
create temp table _all as select pg_temp.ol(null, null, 'registered:asc', 1, 100) j;
select is(pg_temp.row_of((select j from _all), 'Rho Probe 01 active approved') ->> 'approval_state', 'approved', '01 active + is_verified: approved');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 01 active approved') ->> 'latest_verification_status', 'approved', '01 latest decision: approved');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 02 pending open') ->> 'approval_state', 'pending', '02 open request: pending');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 03 pending rejected') ->> 'approval_state', 'rejected', '03 latest organization decision rejected: rejected (a NEWER business request is ignored)');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 03 pending rejected') ->> 'latest_verification_status', 'rejected', '03 latest status ignores the business request');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 04 pending no request') ->> 'approval_state', 'pending', '04 pending lifecycle without any request: pending');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 05 suspended approved') ->> 'approval_state', 'approved', '05 suspended + approved: approval stays approved (lifecycle is separate)');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 06 suspended rejected') ->> 'approval_state', 'rejected', '06 suspended + rejected: approval stays rejected');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 07 archived cancelled') ->> 'approval_state', 'none', '07 archived after abandon (latest cancelled): none');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 08 draft') ->> 'approval_state', 'none', '08 draft: none');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 10 active legacy flag') ->> 'approval_state', 'approved', '10 active without is_verified: approved (status active is the approval)');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 13 pending needs info') ->> 'approval_state', 'pending', '13 needs_more_info is an open request: pending');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 14 draft rejected') ->> 'approval_state', 'rejected', '14 draft whose latest decision is rejected: approval rejected, but no tab');

-- ===========================================================================
-- C. Tabs, counts, filters, zero results, pagination (scoped to the Rho probes: 14 organizations)
-- ===========================================================================
select is(((select j from _all) -> 'counts'), jsonb_build_object('all', 14, 'pending', 5, 'verified', 2, 'suspended', 2, 'rejected', 2),
  'counts: pending 02,04,11,12,13; verified 01,10; suspended 05,06; rejected 03,09 (07,08,14 are listed under All only)');
select is(pg_temp.names(pg_temp.ol('rejected', null, 'registered:asc', 1, 100)),
  array['Rho Probe 03 pending rejected', 'Rho Probe 09 pending tie rejected'],
  'Rejected tab = pending_verification organizations whose latest decision is rejected');
select is(pg_temp.names(pg_temp.ol('pending', null, 'registered:asc', 1, 100)),
  array['Rho Probe 02 pending open', 'Rho Probe 04 pending no request', 'Rho Probe 11 pending tie cancelled', 'Rho Probe 12 new application', 'Rho Probe 13 pending needs info'],
  'Pending tab excludes the rejected ones');
select is(pg_temp.names(pg_temp.ol('verified', null, 'registered:asc', 1, 100)),
  array['Rho Probe 01 active approved', 'Rho Probe 10 active legacy flag'], 'Verified tab = lifecycle active');
select is(pg_temp.names(pg_temp.ol('suspended', null, 'registered:asc', 1, 100)),
  array['Rho Probe 05 suspended approved', 'Rho Probe 06 suspended rejected'], 'Suspended tab = lifecycle suspended (approval-independent)');
select is(
  ((select j from _all) -> 'counts' ->> 'pending')::int + ((select j from _all) -> 'counts' ->> 'verified')::int
  + ((select j from _all) -> 'counts' ->> 'suspended')::int + ((select j from _all) -> 'counts' ->> 'rejected')::int
  + (select count(*)::int from jsonb_array_elements((select j from _all) -> 'rows') r where r ->> 'status' in ('draft', 'archived')),
  14, 'tab counts + draft/archived organizations (listed under All only) = All');
select is(((select j from _all) ->> 'total')::int, 14, 'All lists draft and archived organizations too');
-- zero-result scopes
select is(pg_temp.ol('rejected', 'manufacturer', 'registered:asc', 1, 10) ->> 'total', '0', 'zero results: Rejected tab for a type with no organizations');
select is(pg_temp.ol('rejected', 'manufacturer', 'registered:asc', 1, 10) -> 'rows', '[]'::jsonb, 'zero results: empty rows array');
select is(pg_temp.ol('rejected', 'manufacturer', 'registered:asc', 1, 10) -> 'counts', jsonb_build_object('all', 0, 'pending', 0, 'verified', 0, 'suspended', 0, 'rejected', 0), 'zero results: every count is 0');
-- type filter keeps the counts scoped to the type
select is(pg_temp.ol(null, 'supplier', 'registered:asc', 1, 100) -> 'counts', (select j -> 'counts' from _all), 'type filter scopes the counts identically');
-- filter + pagination
select is(pg_temp.ol(null, null, 'registered:asc', 1, 10) ->> 'total', '14', 'pagination: total counts the whole filtered set, not the page');
select is(pg_temp.names(pg_temp.ol(null, null, 'registered:asc', 2, 10)), array['Rho Probe 11 pending tie cancelled', 'Rho Probe 12 new application', 'Rho Probe 13 pending needs info', 'Rho Probe 14 draft rejected'], 'pagination: page 2 holds the last four organizations');
select is(pg_temp.ol('rejected', null, 'registered:desc', 1, 100) -> 'rows' -> 0 ->> 'name', 'Rho Probe 09 pending tie rejected', 'sort desc applies inside the Rejected tab');
select is(pg_temp.ol('pending', null, 'registered:asc', 99, 10) ->> 'page', '1', 'an out-of-range page is clamped to the last page');

-- ===========================================================================
-- D. Deterministic latest decision
-- ===========================================================================
select is(pg_temp.row_of((select j from _all), 'Rho Probe 09 pending tie rejected') ->> 'latest_verification_status', 'rejected',
  'equal submitted_at and created_at: the higher id (rejected) is the latest');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 11 pending tie cancelled') ->> 'latest_verification_status', 'cancelled',
  'equal timestamps with the ids reversed: the higher id (cancelled) is the latest');
-- ... and the tab follows it: 11's latest is cancelled, so it is Pending, not Rejected
select is(pg_temp.row_of((select j from _all), 'Rho Probe 11 pending tie cancelled') ->> 'approval_state', 'pending', '11 latest cancelled on a pending lifecycle: pending');

-- ===========================================================================
-- E. List and detail agree for every organization
-- ===========================================================================
select is(
  (select count(*)::int from jsonb_array_elements((select j from _all) -> 'rows') r
    where pg_temp.od((r ->> 'id')::uuid) ->> 'approval_state' is distinct from r ->> 'approval_state'
       or pg_temp.od((r ->> 'id')::uuid) ->> 'latest_verification_status' is distinct from r ->> 'latest_verification_status'),
  0, 'detail approval_state and latest_verification_status equal the directory row for all 14 organizations');
select is(pg_temp.od('13700000-0000-4000-8000-000000000003') ->> 'approval_state', 'rejected', 'the rejected organization shows rejected on its detail page');
select is(jsonb_array_length(pg_temp.od('13700000-0000-4000-8000-000000000003') -> 'verifications'), 2, 'the detail history still lists every request (the rejected one and the business one)');
select is(pg_temp.od('13700000-0000-4000-8000-000000000099'), null::jsonb, 'a nonexistent organization still returns NULL');

-- ===========================================================================
-- F. One owner, several organizations; rejected -> abandon -> NEW application
-- ===========================================================================
select is(
  (select count(distinct r -> 'owner' ->> 'user_id')::int from jsonb_array_elements((select j from _all) -> 'rows') r
    where r ->> 'name' in ('Rho Probe 03 pending rejected', 'Rho Probe 07 archived cancelled', 'Rho Probe 12 new application')),
  1, 'the three organizations share one owner');
select is(
  (select array_agg(r ->> 'approval_state' order by r ->> 'name') from jsonb_array_elements((select j from _all) -> 'rows') r
    where r ->> 'name' in ('Rho Probe 03 pending rejected', 'Rho Probe 07 archived cancelled', 'Rho Probe 12 new application')),
  array['rejected', 'none', 'pending'],
  'the same owner: the rejected application stays rejected, the abandoned one is none, the new application is pending');
select is(pg_temp.row_of((select j from _all), 'Rho Probe 07 archived cancelled') ->> 'status', 'archived', 'the abandoned application is archived (lifecycle) ...');
select is(pg_temp.names(pg_temp.ol('rejected', null, 'registered:asc', 1, 100)) @> array['Rho Probe 07 archived cancelled'], false, '... and is NOT in the Rejected tab');

-- ===========================================================================
-- G. Read-only: the decision history is untouched
-- ===========================================================================
select is((select md5(string_agg(v.id::text || v.status::text, ',' order by v.id)) from public.verifications v where v.organization_id::text like '13700000-0000-4000-8000-0000000000%'),
  (select h from _hist_before), 'the verification history is byte-identical after all reads');
select is((select count(*)::int from public.verifications v where v.organization_id::text like '13700000-0000-4000-8000-0000000000%'), 15, 'no request was added or removed');

select * from finish();
rollback;
