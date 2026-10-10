-- pgTAP: Admin Core Phase 1B-B — Users & Organizations operational workflows
-- (20260930100001..04; docs/admin/ADMIN_USER_ORG_OPERATIONS.md).
--
-- Called the way a hostile client would: as `authenticated` with a forged but
-- valid JWT `sub`, invoking the RPCs directly.
--
--   A. Permission catalog and role matrix
--   B. User suspension: authority, reason/actor/episode, audit, idempotency,
--      rank and self rules, enforcement, restore, data preserved
--   C. Last usable Super Admin
--   D. Organization suspension: authority, members unaffected, org writes
--      refused / reads kept, public catalog, jobs, orders, restore
--   E. Scope: scoped holders of the operational permissions cannot act
--   F. Admin Notes   G. Follow-ups   H. Cases
--   I. Duplicates (detect, suggest, link, no merge, provenance, idempotent)
--   J. Entity Timeline
--
-- Every fixture is created inside this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(108);

\set padmin   '55555555-5555-4555-8555-555555555555'
\set super1   '11111111-1111-4111-8111-111111111111'
\set super2   '22222222-2222-4222-8222-222222222222'
\set moder    '33333333-3333-4333-8333-333333333333'
\set consumer '44444444-4444-4444-8444-444444444444'
\set hana     '70000001-0000-4000-8000-000000000001'
\set youssef  '70000002-0000-4000-8000-000000000002'
\set supp     '68000000-0000-4000-8000-0000000000a1'
\set scoped   '68000000-0000-4000-8000-0000000000a2'
\set ureader  '68000000-0000-4000-8000-0000000000a3'
\set orgC     '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgJ     '9a000000-aaaa-4aaa-8aaa-000000000005'
\set jobJ     'f1000001-0000-4000-8000-000000000001'
\set installer '70000009-0000-4000-8000-000000000009'
\set dupC     '68000000-0000-4000-8000-0000000000d1'
\set dupB     '68000000-0000-4000-8000-0000000000d2'

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
  perform set_config('request.path', '', true);
end;
$$;
-- Run one SQL expression as a user; its jsonb result, or {"sqlstate": ...}.
create function pg_temp.call_as(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.act_as(p_user);
  execute 'select to_jsonb((' || p_sql || '))' into r;
  perform pg_temp.as_dba();
  return r;
exception when others then
  perform pg_temp.as_dba();
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end;
$$;
create function pg_temp.state(p_user uuid, p_sql text) returns text language sql as $$
  select coalesce(pg_temp.call_as(p_user, p_sql) ->> 'sqlstate', 'ok') $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures: staff (Support, an org-scoped operator, a users.read-only role),
-- two Super Admins, and two duplicate organizations.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values (:'supp', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'supp68@probe.test', now(), '{"full_name":"Support 68"}', now(), now()),
       (:'scoped', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scoped68@probe.test', now(), '{"full_name":"Scoped 68"}', now(), now()),
       (:'ureader', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ureader68@probe.test', now(), '{"full_name":"Reader 68"}', now(), now());
insert into public.admin_role_assignments (user_id, role_id)
select :'supp', id from public.admin_roles where key = 'support';
insert into public.admin_role_assignments (user_id, role_id)
select :'moder', id from public.admin_roles where key = 'moderator';
insert into public.admin_roles (key, name, rank, scope_type) values
  ('probe68_org_operator', 'Probe org operator', 30, 'organization'),
  ('probe68_users_read', 'Probe users read', 20, 'platform');
insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p from public.admin_roles r,
  unnest(array['users.read', 'users.suspend', 'organizations.read', 'organizations.suspend', 'notes.read', 'notes.create']) p
where r.key = 'probe68_org_operator';
insert into public.admin_role_permissions (role_id, permission_key)
select id, 'users.read' from public.admin_roles where key = 'probe68_users_read';
insert into public.admin_role_assignments (user_id, role_id, scope_type, scope_organization_id)
select :'scoped', id, 'organization', :'orgC' from public.admin_roles where key = 'probe68_org_operator';
insert into public.admin_role_assignments (user_id, role_id)
select :'ureader', id from public.admin_roles where key = 'probe68_users_read';

select app.admin_bootstrap_super_admin(:'super1');

insert into public.organizations (id, name, org_type, status, created_by, source) values
  (:'dupC', 'Cairo  Ceramics-Showroom', 'showroom_dealer', 'active', :'padmin', 'self_created'),
  (:'dupB', 'Nile Imports Co', 'importer', 'active', :'padmin', 'self_created');

-- ===========================================================================
-- A. Permission catalog and role matrix
-- ===========================================================================
select is((select count(*)::int from public.admin_permissions
           where key in ('notes.read','notes.create','follow_ups.read','follow_ups.manage','cases.read','cases.create','duplicates.resolve')),
  7, 'the seven operational permissions exist');
select is((select count(*)::int from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id where r.key = 'super_admin'),
  (select count(*)::int from public.admin_permissions), 'Super Admin still holds every permission');
select ok(app.has_admin_permission('notes.create') is not null, 'has_admin_permission resolves the new keys');
select is((select array_agg(permission_key order by permission_key) from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
           where r.key = 'moderator' and permission_key in ('notes.create','follow_ups.manage','cases.create','duplicates.resolve')),
  array['cases.create','duplicates.resolve','follow_ups.manage','notes.create'], 'Moderator may operate notes, follow-ups, cases and duplicates');
select ok(not exists (select 1 from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
           where r.key = 'support' and permission_key !~ '\.read$'), 'Support stays read-only (PD-004)');

-- ===========================================================================
-- B. User suspension
-- ===========================================================================
select is(pg_temp.state(:'consumer', format('public.admin_user_suspend(%L, %L)', :'hana', 'x')), '42501', 'non-staff cannot suspend a user');
select is(pg_temp.state(:'supp', format('public.admin_user_suspend(%L, %L)', :'hana', 'x')), '42501', 'Support cannot suspend a user');
select is(pg_temp.state(:'ureader', format('public.admin_user_suspend(%L, %L)', :'hana', 'x')), '42501', 'users.read alone is not suspend authority');
select is(pg_temp.state(:'padmin', format('public.admin_user_suspend(%L, %L)', :'hana', '  ')), '22023', 'a reason is required');
select is(pg_temp.state(:'padmin', format('public.admin_user_suspend(%L, %L)', :'padmin', 'self')), '42501', 'nobody suspends their own account');
select is(pg_temp.state(:'moder', format('public.admin_user_suspend(%L, %L)', :'padmin', 'rank')), '42501',
  'a Moderator cannot suspend an Administrator (rank ceiling)');
select is(pg_temp.state(:'padmin', format('public.admin_user_suspend(%L, %L)', '00000000-0000-4000-8000-000000000000', 'x')), 'P0002', 'unknown user');

-- Hana owns organization C: the suspension must block her organization activity.
select is(pg_temp.call_as(:'hana', format('app.has_capability(%L, %L)', :'orgC', 'org.manage')), 'true'::jsonb,
  'before suspension Hana holds org.manage on C');
select is(pg_temp.call_as(:'padmin', format('public.admin_user_suspend(%L, %L)', :'hana', 'Fraud report under review')) ->> 'changed',
  'true', 'Administrator suspends Hana');
select is((select status::text from public.users where id = :'hana'), 'suspended', 'users.status is suspended');
select is((select row(reason, suspended_by, previous_status)::text from public.admin_suspensions where user_id = :'hana' and restored_at is null),
  row('Fraud report under review', :'padmin'::uuid, 'active')::text, 'the open episode records reason, actor and the status to restore');
select is(pg_temp.call_as(:'padmin', format('public.admin_user_suspend(%L, %L)', :'hana', 'again')) ->> 'changed',
  'false', 'suspending again is a no-op');
select is((select count(*)::int from public.audit_log where action = 'account.suspended' and subject_id = :'hana'), 1,
  'exactly one audit row — the retry wrote none');
select is((select metadata ->> 'status_before' || '>' || (metadata ->> 'status_after') from public.audit_log
           where action = 'account.suspended' and subject_id = :'hana'), 'active>suspended', 'the audit row carries before/after');
-- Enforcement
select is(pg_temp.call_as(:'hana', format('app.has_capability(%L, %L)', :'orgC', 'org.manage')), 'false'::jsonb,
  'a suspended account holds no organization capability');
select is(pg_temp.call_as(:'hana', format('app.is_org_member(%L)', :'orgC')), 'false'::jsonb, '... nor membership authority');
select is(pg_temp.state(:'hana', format('public.organization_update_i18n(%L, %L, %L, null)', :'orgC', 'x', 'y')), '42501',
  'a prohibited organization write is refused server-side');
select is(pg_temp.state(:'hana', 'app.require_verified_caller()'), '42501', 'the personal-RPC gate refuses a suspended account');
select is(pg_temp.call_as(:'hana', 'public.my_account_status()') ->> 'suspended', 'true', 'the account can read its own status');
select pg_temp.act_as(:'hana');
select set_config('request.path', '/profiles', true);
select throws_ok('select app.api_pre_request()', '42501', 'account suspended', 'the Data API pre-request hook refuses the suspended account');
select set_config('request.path', '/rpc/my_account_status', true);
select lives_ok('select app.api_pre_request()', '... except its own status read');
select pg_temp.as_dba();
select pg_temp.act_as(:'consumer');
select set_config('request.path', '/profiles', true);
select lives_ok('select app.api_pre_request()', 'an active account passes the pre-request hook');
select pg_temp.as_dba();
select is((select count(*)::int from public.memberships where user_id = :'hana' and status = 'active'), 1,
  'memberships are preserved');
select ok(exists (select 1 from public.profiles where user_id = :'hana'), 'the profile is preserved');
-- Restore
select is(pg_temp.call_as(:'padmin', format('public.admin_user_restore(%L, %L)', :'hana', 'Cleared')) ->> 'status',
  'active', 'restore returns the recorded previous status');
select is((select row(restored_by, restore_reason)::text from public.admin_suspensions where user_id = :'hana'),
  row(:'padmin'::uuid, 'Cleared')::text, 'the episode records who restored and why');
select is(pg_temp.call_as(:'padmin', format('public.admin_user_restore(%L)', :'hana')) ->> 'changed', 'false', 'restoring again is a no-op');
select is((select count(*)::int from public.audit_log where action = 'account.restored' and subject_id = :'hana'), 1, 'one restore audit row');
select is(pg_temp.call_as(:'hana', format('app.has_capability(%L, %L)', :'orgC', 'org.manage')), 'true'::jsonb,
  'after restore Hana holds her capabilities again');
select throws_ok(format($$update public.admin_suspensions set reason = 'rewritten' where user_id = %L$$, :'hana'),
  '42501', null, 'suspension history cannot be rewritten');
select throws_ok(format($$delete from public.admin_suspensions where user_id = %L$$, :'hana'),
  '42501', null, 'suspension history cannot be deleted');

-- ===========================================================================
-- C. Last usable Super Admin
-- ===========================================================================
select throws_ok(format($$update public.users set status = 'suspended' where id = %L$$, :'super1'),
  '42501', 'the last active Super Admin cannot be suspended', 'the only Super Admin cannot be suspended — even by the DBA');
select is(pg_temp.state(:'padmin', format('public.admin_user_suspend(%L, %L)', :'super1', 'x')), '42501',
  'an Administrator cannot suspend a Super Admin');
insert into public.admin_role_assignments (user_id, role_id)
select :'super2', id from public.admin_roles where key = 'super_admin';
select is(pg_temp.state(:'super1', format('public.admin_user_suspend(%L, %L)', :'super1', 'x')), '42501', 'a Super Admin cannot suspend themself');
select is(pg_temp.call_as(:'super1', format('public.admin_user_suspend(%L, %L)', :'super2', 'rotation')) ->> 'changed', 'true',
  'with two Super Admins, one may suspend the other');
select throws_ok(format($$update public.users set status = 'suspended' where id = %L$$, :'super1'),
  '42501', 'the last active Super Admin cannot be suspended', '... but then the remaining one is protected');
select is(pg_temp.call_as(:'super1', format('public.admin_user_restore(%L)', :'super2')) ->> 'changed', 'true', 'and restore works');

-- ===========================================================================
-- D. Organization suspension
-- ===========================================================================
select is(pg_temp.state(:'moder', format('public.admin_organization_suspend(%L, %L)', :'orgC', 'x')), '42501',
  'a Moderator cannot suspend an organization (organizations.suspend is Administrator-level)');
select is(pg_temp.state(:'consumer', format('public.admin_organization_suspend(%L, %L)', :'orgC', 'x')), '42501', 'non-staff cannot');
select is(pg_temp.state(:'padmin', format('public.admin_organization_suspend(%L, %L)', :'orgC', '')), '22023', 'a reason is required');
select is(pg_temp.call_as(:'consumer', format('(select count(*) from public.products where organization_id = %L)', :'orgC')), '4'::jsonb,
  'before: the public sees C''s four published products');
select is(pg_temp.call_as(:'padmin', format('public.admin_organization_suspend(%L, %L)', :'orgC', 'Counterfeit goods complaint')) ->> 'changed',
  'true', 'Administrator suspends organization C');
select is((select status::text from public.organizations where id = :'orgC'), 'suspended', 'organizations.status is suspended');
select is((select count(*)::int from public.memberships m join public.users u on u.id = m.user_id
           where m.organization_id = :'orgC' and m.status = 'active' and u.status = 'active'), 2,
  'members are NOT suspended — both memberships and accounts stay active');
select is(pg_temp.call_as(:'hana', format('app.has_capability(%L, %L)', :'orgC', 'catalog.write')), 'false'::jsonb,
  'a write capability of the suspended organization is withheld');
select is(pg_temp.call_as(:'hana', format('app.has_capability(%L, %L)', :'orgC', 'sales.read')), 'true'::jsonb,
  'its read capabilities are kept (existing records stay readable)');
select is(pg_temp.state(:'hana', format('public.organization_update_i18n(%L, %L, %L, null)', :'orgC', 'x', 'y')), '42501',
  'new organization activity is refused server-side');
select is(pg_temp.call_as(:'hana', 'public.my_account_status()') ->> 'suspended', 'false', 'the member''s own account is unaffected');
select is(pg_temp.call_as(:'consumer', format('(select count(*) from public.products where organization_id = %L)', :'orgC')), '0'::jsonb,
  'its published products leave the public catalog');
select is((select count(*)::int from public.products where organization_id = :'orgC' and status = 'published'), 4,
  '... hidden, not deleted or unpublished');
select is(pg_temp.call_as(:'hana', format('(select count(*) from public.products where organization_id = %L and status = ''published'')', :'orgC')), '4'::jsonb,
  'its own members still read them');
select throws_ok(format($$insert into public.orders (quotation_id, rfq_id, requester_org_id, supplier_org_id, title, created_by)
                         values (gen_random_uuid(), gen_random_uuid(), %L, %L, 'probe', %L)$$, :'orgJ', :'orgC', :'padmin'),
  '42501', 'this organization is currently suspended', 'no new order with a suspended supplier');
select throws_ok(format($$insert into public.orders (quotation_id, rfq_id, requester_org_id, supplier_org_id, title, created_by)
                         values (gen_random_uuid(), gen_random_uuid(), %L, %L, 'probe', %L)$$, :'orgJ', :'dupB', :'padmin'),
  '23503', null, 'an active supplier passes the suspension check (the probe then fails its foreign keys)');
select is(pg_temp.call_as(:'padmin', format('public.admin_organization_suspend(%L, %L)', :'orgJ', 'jobs probe')) ->> 'changed', 'true',
  'suspend the organization with an open job');
select throws_ok(format($$insert into public.job_applications (job_id, applicant_user_id) values (%L, %L)$$, :'jobJ', :'installer'),
  '42501', 'this organization is currently suspended', 'nobody can apply to a suspended organization''s job');
select is(pg_temp.call_as(:'padmin', format('public.admin_organization_restore(%L, %L)', :'orgC', 'Resolved')) ->> 'status', 'active',
  'restore returns the organization to its previous status');
select is(pg_temp.call_as(:'padmin', format('public.admin_organization_restore(%L)', :'orgC')) ->> 'changed', 'false', 'restoring again is a no-op');
select is((select count(*)::int from public.audit_log where subject_id = :'orgC' and action in ('organization.suspended', 'organization.restored')), 2,
  'one suspend and one restore audit row');
select is(pg_temp.call_as(:'hana', format('app.has_capability(%L, %L)', :'orgC', 'catalog.write')), 'true'::jsonb,
  'after restore the members can act again');

-- ===========================================================================
-- E. Scope
-- ===========================================================================
select is(pg_temp.state(:'scoped', format('public.admin_user_suspend(%L, %L)', :'youssef', 'x')), '42501',
  'an organization-scoped users.suspend cannot suspend a member of that organization');
select is(pg_temp.state(:'scoped', format('public.admin_organization_suspend(%L, %L)', :'orgC', 'x')), '42501',
  'an organization-scoped organizations.suspend cannot suspend even its own organization');
select is(pg_temp.state(:'scoped', format('public.admin_note_add(%L, %L, %L)', 'organization', :'orgC', 'x')), '42501',
  'an organization-scoped notes.create cannot write notes');

-- ===========================================================================
-- F. Admin Notes
-- ===========================================================================
select ok((pg_temp.call_as(:'moder', format('public.admin_note_add(%L, %L, %L)', 'user', :'consumer', 'Asked for ID documents.')) ->> 'sqlstate') is null,
  'a Moderator adds a user note');
select is(pg_temp.state(:'supp', format('public.admin_note_add(%L, %L, %L)', 'user', :'consumer', 'x')), '42501', 'Support cannot add notes');
select is(pg_temp.call_as(:'supp', format('public.admin_notes_list(%L, %L)', 'user', :'consumer')) -> 0 ->> 'body', 'Asked for ID documents.',
  'Support reads notes');
select is(pg_temp.state(:'ureader', format('public.admin_notes_list(%L, %L)', 'user', :'consumer')), '42501',
  'users.read alone does not read notes');
select is(pg_temp.state(:'consumer', format('public.admin_notes_list(%L, %L)', 'user', :'consumer')), '42501', 'non-staff cannot read notes — even about themselves');
select is(jsonb_array_length(pg_temp.call_as(:'padmin', format('public.admin_notes_list(%L, %L)', 'user', :'hana'))), 0,
  'a note on one user never appears on another (isolation)');
select is(pg_temp.state(:'padmin', format('public.admin_note_add(%L, %L, %L)', 'user', :'consumer', '   ')), '22023', 'an empty note is refused');
select throws_ok($$update public.admin_notes set body = 'edited'$$, '42501', 'Admin Notes are append-only', 'notes cannot be edited');

-- ===========================================================================
-- G. Follow-ups
-- ===========================================================================
select ok((pg_temp.call_as(:'moder', format('public.admin_follow_up_log(%L, %L, %L, %L, %L::timestamptz, %L)',
  'user', :'consumer', 'call', 'No answer', now() - interval '1 day', :'moder')) ->> 'sqlstate') is null, 'a Moderator logs a follow-up');
select ok((pg_temp.call_as(:'moder', format('public.admin_follow_up_log(%L, %L, %L, %L, %L::timestamptz)',
  'user', :'consumer', 'whatsapp', 'Sent reminder', now() + interval '2 days')) ->> 'sqlstate') is null, '... and another, due in the future');
select is((select array_agg(f ->> 'status' order by f ->> 'action_type') from jsonb_array_elements(
  pg_temp.call_as(:'padmin', format('public.admin_follow_ups_list(%L, %L)', 'user', :'consumer'))) f),
  array['overdue', 'open'], 'status is derived: past due = Overdue, future = Open');
select is(pg_temp.call_as(:'padmin', format('public.admin_follow_up_complete(%L)',
  (select id from public.admin_follow_ups where action_type = 'call' and user_id = :'consumer'))) ->> 'changed', 'true', 'complete a follow-up');
select is(pg_temp.call_as(:'padmin', format('public.admin_follow_up_complete(%L)',
  (select id from public.admin_follow_ups where action_type = 'call' and user_id = :'consumer'))) ->> 'changed', 'false', 'completing twice is a no-op');
select is((select f ->> 'status' from jsonb_array_elements(pg_temp.call_as(:'padmin', format('public.admin_follow_ups_list(%L, %L)', 'user', :'consumer'))) f
           where f ->> 'action_type' = 'call'), 'done', 'a completed follow-up is Done');
select is(pg_temp.state(:'moder', format('public.admin_follow_up_log(%L, %L, %L, %L, null, %L)', 'user', :'consumer', 'call', 'x', :'consumer')), '22023',
  'a non-staff person cannot be the assignee');
select is(pg_temp.state(:'moder', format('public.admin_follow_up_log(%L, %L, %L, %L, null, %L)', 'user', :'consumer', 'call', 'x', :'supp')), '22023',
  'Support (no follow_ups.manage) cannot be the assignee');
select is(pg_temp.state(:'supp', format('public.admin_follow_up_log(%L, %L, %L, %L)', 'user', :'consumer', 'call', 'x')), '42501', 'Support cannot log follow-ups');
select is(pg_temp.state(:'ureader', format('public.admin_follow_ups_list(%L, %L)', 'user', :'consumer')), '42501', 'users.read alone does not read follow-ups');

-- ===========================================================================
-- H. Cases
-- ===========================================================================
select ok((pg_temp.call_as(:'padmin', format('public.admin_case_create(%L, %L, %L, %L, %L, %L, %L)',
  'organization', :'orgC', 'Counterfeit listing', 'Reported by a buyer.', 'Buyer', '01000000000', 'buyer@example.test')) ->> 'sqlstate') is null,
  'an Administrator opens an internal case');
select is(pg_temp.call_as(:'supp', format('public.admin_cases_list(%L, %L)', 'organization', :'orgC')) -> 0 ->> 'title', 'Counterfeit listing', 'Support reads it');
select is(pg_temp.state(:'supp', format('public.admin_case_create(%L, %L, %L, %L)', 'organization', :'orgC', 't', 'd')), '42501', 'Support cannot open a case');
select is(pg_temp.state(:'consumer', format('public.admin_cases_list(%L, %L)', 'organization', :'orgC')), '42501', 'non-staff cannot read cases');
select is(pg_temp.state(:'padmin', format('public.admin_case_create(%L, %L, %L, %L, null, null, %L)', 'organization', :'orgC', 't', 'd', 'not-an-email')), '22023',
  'an invalid contact email is refused');
select ok(not exists (select 1 from public.audit_log where action = 'admin_case.created' and metadata::text like '%buyer@example.test%'),
  'the audit row does not copy contact data');

-- ===========================================================================
-- I. Duplicates
-- ===========================================================================
select is((select c ->> 'signal' from jsonb_array_elements(pg_temp.call_as(:'padmin', format('public.admin_organization_duplicates(%L)', :'orgC')) -> 'candidates') c
           where c ->> 'id' = :'dupC'), 'same_name', 'an identical normalized name is suggested as a candidate');
select is(pg_temp.state(:'supp', format('public.admin_organization_link_duplicate(%L, %L, %L)', :'dupC', :'orgC', 'x')), '42501', 'Support cannot resolve duplicates');
select is(pg_temp.state(:'padmin', format('public.admin_organization_link_duplicate(%L, %L, %L)', :'dupC', :'orgC', '')), '22023', 'a reason is required');
select is(pg_temp.call_as(:'moder', format('public.admin_organization_link_duplicate(%L, %L, %L)', :'dupC', :'orgC', 'Same showroom registered twice')) ->> 'changed',
  'true', 'a Moderator links the duplicate to the existing organization');
select is(pg_temp.call_as(:'moder', format('public.admin_organization_link_duplicate(%L, %L, %L)', :'dupC', :'orgC', 'again')) ->> 'changed',
  'false', 'repeating the same link is a no-op');
select is((select count(*)::int from public.audit_log where action = 'organization.duplicate_linked' and subject_id = :'dupC'), 1, 'one audit row for the link');
select is((select row(status, deleted_at is null, source)::text from public.organizations where id = :'dupC'), row('active', true, 'self_created')::text,
  'no automatic merge: the duplicate keeps its status, record and provenance');
select is((select provenance -> 'duplicate' ->> 'source' || '|' || (provenance -> 'canonical' ->> 'id') from public.organization_duplicate_resolutions where duplicate_org_id = :'dupC'),
  'self_created|' || :'orgC', 'the resolution keeps a provenance snapshot of both records');
select is(pg_temp.state(:'moder', format('public.admin_organization_dismiss_duplicate(%L, %L, %L)', :'dupC', :'orgC', 'x')), '23505',
  'a pair resolved one way cannot be silently re-resolved another way');
select is(pg_temp.state(:'moder', format('public.admin_organization_link_duplicate(%L, %L, %L)', :'orgC', :'dupB', 'chain')), '22023',
  'no chains: the existing record of others cannot itself be linked away');
select is(jsonb_array_length(pg_temp.call_as(:'padmin', format('public.admin_organization_duplicates(%L)', :'orgC')) -> 'candidates'), 0, 'a resolved pair is no longer suggested');
select throws_ok($$delete from public.organization_duplicate_resolutions$$, '42501', 'duplicate resolutions are append-only', 'resolutions cannot be deleted');

-- ===========================================================================
-- J. Entity Timeline
-- ===========================================================================
select is((select array_agg(distinct e ->> 'kind' order by e ->> 'kind') from jsonb_array_elements(
  pg_temp.call_as(:'padmin', format('public.admin_entity_timeline(%L, %L)', 'user', :'hana'))) e),
  array['membership_joined', 'registered', 'restored', 'suspended'], 'a user timeline combines registration, membership and the suspension episode');
select is((select array_agg(distinct e ->> 'kind' order by e ->> 'kind') from jsonb_array_elements(
  pg_temp.call_as(:'padmin', format('public.admin_entity_timeline(%L, %L)', 'organization', :'orgC'))) e),
  array['case_opened', 'duplicate_linked', 'member_joined', 'registered', 'restored', 'suspended'], 'an organization timeline combines its history');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.call_as(:'padmin', format('public.admin_entity_timeline(%L, %L)', 'user', :'consumer'))) e
                  where e ->> 'kind' = 'note_added' and not (e -> 'data' ? 'body')), 'notes appear without their body');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.call_as(:'ureader', format('public.admin_entity_timeline(%L, %L)', 'user', :'consumer'))) e
                      where e ->> 'kind' in ('note_added', 'follow_up_logged', 'follow_up_completed', 'case_opened')),
  'a caller without notes/follow-up/case read sees none of those entries');
select is(pg_temp.state(:'consumer', format('public.admin_entity_timeline(%L, %L)', 'user', :'consumer')), '42501', 'non-staff cannot read a timeline');

select * from finish();
rollback;
