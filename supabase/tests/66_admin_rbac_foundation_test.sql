-- pgTAP: Admin Core 1A — dynamic RBAC foundation
-- (20260929100001_admin_rbac_foundation.sql; docs/admin/ADMIN_RBAC_ARCHITECTURE.md).
--
-- Every check here calls the database the way a hostile client would: as the
-- `authenticated` / `anon` Postgres roles with a forged-but-valid JWT `sub`,
-- invoking RPCs and tables DIRECTLY — never through a UI path.
--
--   A. Catalog + system-role matrix (Support is read-only — PD-004 / PD-012)
--   B. Legacy INSERT compatibility (mirror + audit + shim)
--   C. Legacy DELETE / revoke compatibility (the BEFORE-DELETE fix) + adoption
--   D. The bridge refuses UPDATE / TRUNCATE
--   E. Backfill of pre-existing grants: copied, audited, idempotent
--   F. Last-Super-Admin protection
--   G. Self-escalation / rank-escalation denial
--   H. Support / Moderator / Administrator / custom-role boundaries
--   I. Direct invocation surface (tables, internal helpers, anon)
--   J. Archived / disabled / suspended / inactive-permission deny access
--   K. Audit trail of RBAC mutations
--
-- Fixtures (seed): 55555555 "Platform Admin" holds a legacy `administrator`
-- grant (→ mirrored assignment). Every other staff role is granted INSIDE THIS
-- TRANSACTION ONLY; the whole file rolls back.
create extension if not exists pgtap;

begin;
select plan(114);

\set padmin   '55555555-5555-4555-8555-555555555555'
\set super1   '11111111-1111-4111-8111-111111111111'
\set super2   '22222222-2222-4222-8222-222222222222'
\set moder    '33333333-3333-4333-8333-333333333333'
\set supp     '44444444-4444-4444-8444-444444444444'
\set custom   '70000008-0000-4000-8000-000000000008'
\set plain    '70000009-0000-4000-8000-000000000009'
\set legacy   '71000011-0000-4000-8000-000000000011'
\set orgC     '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgN     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

-- Act as a user: `authenticated` role + JWT sub (what PostgREST does).
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
-- Back to the test superuser (fixture setup / inspection).
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
-- Run SQL; return 'ok' or 'SQLSTATE: message' — to assert a call got PAST an
-- authorization guard (it may still fail on its own not-found check).
create function pg_temp.outcome(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba(), pg_temp.outcome(text) to authenticated, anon;

-- Fixture lookup (runs as its owner: `authenticated` rightly cannot read admin_roles).
create function pg_temp.role_id(p_key text) returns uuid language sql security definer as $$
  select id from public.admin_roles where key = p_key $$;
grant execute on function pg_temp.role_id(text) to authenticated;
create function pg_temp.perm(p_user uuid, p_perm text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.act_as(p_user);
  v := app.has_admin_permission(p_perm);
  perform pg_temp.as_dba();
  return v;
end;
$$;
create function pg_temp.active_role_count(p_user uuid) returns int language sql as $$
  select count(*)::int from public.admin_role_assignments where user_id = p_user and is_active $$;

-- ===========================================================================
-- A. Catalog + system-role matrix
-- ===========================================================================
select is((select count(*)::int from public.admin_roles where is_system), 4,
  'four system roles are seeded');
select is((select array_agg(key order by rank desc) from public.admin_roles where is_system),
  array['super_admin','administrator','moderator','support'], 'system roles in rank order');
select is(
  (select array_agg(rp.permission_key order by rp.permission_key)
   from public.admin_role_permissions rp where rp.role_id = pg_temp.role_id('support')),
  array['organizations.read','points.read','referrals.read','users.read'],
  'Support is READ-ONLY: no verify / approve / adjust / reverse / manage permission (PD-004)');
select ok(not exists (
    select 1 from public.admin_role_permissions
    where role_id = pg_temp.role_id('moderator') and permission_key in ('points.adjust','points.reverse')),
  'Points adjust/reverse are NOT Moderator-level (PD-012)');
select ok(exists (
    select 1 from public.admin_role_permissions
    where role_id = pg_temp.role_id('administrator') and permission_key = 'points.adjust'),
  'Points adjust IS Administrator-level (PD-012)');
select ok(not exists (
    select 1 from public.admin_role_permissions
    where role_id = pg_temp.role_id('administrator') and permission_key = 'roles.manage'),
  'only Super Admin manages roles');
select is(
  (select count(*)::int from public.admin_role_permissions where role_id = pg_temp.role_id('super_admin')),
  (select count(*)::int from public.admin_permissions),
  'Super Admin holds every permission');
select ok(not exists (
    select 1 from public.admin_role_permissions
    where role_id = pg_temp.role_id('super_admin') and not is_locked),
  'every Super Admin permission is locked');

-- ===========================================================================
-- B. Legacy INSERT compatibility
-- ===========================================================================
select ok(exists (
    select 1 from public.admin_role_assignments a join public.platform_role_grants g on g.id = a.legacy_grant_id
    where a.user_id = :'padmin' and a.role_id = pg_temp.role_id('administrator') and a.is_active),
  'the seeded legacy administrator grant is mirrored into an active linked assignment');

select lives_ok(
  format($$insert into public.platform_role_grants (user_id, role, granted_by) values (%L, 'moderator', %L)$$,
         :'moder', :'padmin'),
  'legacy INSERT of a moderator grant still works');
select ok(exists (
    select 1 from public.admin_role_assignments a join public.platform_role_grants g on g.id = a.legacy_grant_id
    where a.user_id = :'moder' and a.role_id = pg_temp.role_id('moderator') and a.is_active and a.assigned_by = :'padmin'),
  'legacy INSERT creates an active, linked moderator assignment (assigned_by carried over)');
select ok(exists (
    select 1 from public.audit_log
    where action = 'admin_role.assigned' and metadata->>'target_user_id' = :'moder'
      and metadata->>'source' = 'legacy_platform_role_grant' and metadata ? 'legacy_grant_id'),
  'legacy INSERT is audited with its source and legacy grant id');
select ok(pg_temp.perm(:'moder', 'referrals.approve'), 'the mirrored moderator now holds referrals.approve');
select ok(not pg_temp.perm(:'moder', 'points.adjust'), 'but not points.adjust');

select pg_temp.act_as(:'moder');
select ok(app.is_platform('moderator'), 'compat shim: is_platform(moderator) true for a moderator');
select ok(not app.is_platform('administrator'), 'compat shim: is_platform(administrator) false for a moderator');
select pg_temp.as_dba();

select lives_ok(
  format($$insert into public.platform_role_grants (user_id, role) values (%L, 'support')$$, :'supp'),
  'legacy INSERT of a support grant');

-- ===========================================================================
-- C. Legacy DELETE / revoke compatibility
-- ===========================================================================
select set_config('test.moder_asg',
  (select id::text from public.admin_role_assignments where user_id = :'moder' and is_active), true);

select lives_ok(
  format($$delete from public.platform_role_grants where user_id = %L and role = 'moderator'$$, :'moder'),
  'legacy DELETE of the moderator grant');
select ok(exists (
    select 1 from public.admin_role_assignments
    where id = current_setting('test.moder_asg')::uuid and not is_active
      and deactivation_kind = 'legacy_revoked' and deactivated_at is not null),
  'legacy DELETE DEACTIVATES the linked assignment (fires BEFORE the ON DELETE SET NULL FK action)');
select is(pg_temp.active_role_count(:'moder'), 0, 'the revoked moderator holds no active assignment');
select ok(not pg_temp.perm(:'moder', 'referrals.approve'), 'the revoked moderator lost referrals.approve');
select pg_temp.act_as(:'moder');
select ok(not app.is_platform('support'), 'compat shim: the revoked moderator is no longer staff at all');
select pg_temp.as_dba();
select ok(exists (
    select 1 from public.audit_log
    where action = 'admin_role.unassigned' and subject_id = current_setting('test.moder_asg')::uuid
      and metadata->>'source' = 'legacy_platform_role_grant'),
  'legacy DELETE is audited as admin_role.unassigned');
select is(
  (select legacy_grant_id from public.admin_role_assignments where id = current_setting('test.moder_asg')::uuid),
  null::uuid, 'the FK action still nulls the link afterwards (row kept for history)');

-- Adoption: a grant for a role already held through RBAC links to it, and
-- deleting that grant then revokes it — one assignment, never two authorities.
select pg_temp.as_dba();
insert into public.admin_role_assignments (user_id, role_id, scope_type)
values (:'legacy', pg_temp.role_id('support'), 'platform');
insert into public.platform_role_grants (user_id, role) values (:'legacy', 'support');
select is(pg_temp.active_role_count(:'legacy'), 1,
  'a legacy grant ADOPTS an equivalent existing assignment instead of duplicating it');
delete from public.platform_role_grants where user_id = :'legacy';
select is(pg_temp.active_role_count(:'legacy'), 0, 'deleting the adopting grant revokes the adopted assignment');

-- ===========================================================================
-- D. The bridge refuses UPDATE / TRUNCATE
-- ===========================================================================
select throws_ok(
  format($$update public.platform_role_grants set role = 'administrator' where user_id = %L$$, :'supp'),
  '42501', null, 'UPDATE on the legacy bridge is refused (would desync the mirror)');
select throws_ok($$truncate public.platform_role_grants cascade$$,
  '42501', null, 'TRUNCATE ... CASCADE on the legacy bridge is refused (would skip the mirror and wipe every assignment)');

-- ===========================================================================
-- E. Backfill of pre-existing grants
-- ===========================================================================
-- Simulate a grant that existed BEFORE the migration: bypass the mirror.
alter table public.platform_role_grants disable trigger trg_platform_role_grants_mirror_insert;
insert into public.platform_role_grants (user_id, role, granted_by, created_at)
values (:'custom', 'support', :'padmin', '2026-01-15 10:00+00');
alter table public.platform_role_grants enable trigger trg_platform_role_grants_mirror_insert;
select is(pg_temp.active_role_count(:'custom'), 0, 'pre-existing grant has no assignment yet');

select is(app.admin_backfill_legacy_grants(), 1, 'backfill copies exactly the one unlinked grant');
select ok(exists (
    select 1 from public.admin_role_assignments
    where user_id = :'custom' and is_active and legacy_grant_id is not null
      and assigned_by = :'padmin' and created_at = '2026-01-15 10:00+00'),
  'the copy keeps the original granter and grant time');
select ok(exists (
    select 1 from public.audit_log
    where action = 'admin_role.assigned' and metadata->>'source' = 'legacy_backfill'
      and metadata->>'target_user_id' = :'custom'
      and metadata->>'original_granted_by' = :'padmin'
      and metadata ? 'original_granted_at' and metadata ? 'legacy_grant_id'
      and actor_user_id is null),
  'the backfilled copy has its own audit row with provenance (no human actor)');
select is(app.admin_backfill_legacy_grants(), 0, 'backfill is idempotent');

-- ===========================================================================
-- F. Last-Super-Admin protection
-- ===========================================================================
select lives_ok(format($$select app.admin_bootstrap_super_admin(%L)$$, :'super1'),
  'DBA bootstrap of the first Super Admin');
select throws_ok(format($$select app.admin_bootstrap_super_admin(%L)$$, :'super2'),
  '42501', null, 'bootstrap refuses once a Super Admin exists');

select throws_ok(
  format($$update public.admin_role_assignments set is_active = false, deactivated_at = now(),
           deactivation_kind = 'unassigned' where user_id = %L$$, :'super1'),
  '42501', null, 'the last Super Admin cannot be deactivated — even by the DBA path');
select throws_ok(
  format($$delete from public.admin_role_assignments where user_id = %L$$, :'super1'),
  '42501', null, 'the last Super Admin assignment cannot be deleted');
select throws_ok(
  format($$update public.admin_role_assignments set role_id = %L where user_id = %L$$,
         pg_temp.role_id('administrator'), :'super1'),
  '42501', null, 'the last Super Admin cannot be demoted');

-- Make super2 existing staff (support), then super1 promotes them to Super Admin.
insert into public.platform_role_grants (user_id, role) values (:'super2', 'support');
select pg_temp.act_as(:'super1');
select lives_ok(format($$select public.admin_staff_change_role(%L, %L, 'second super')$$,
  :'super2', pg_temp.role_id('super_admin')), 'a Super Admin can make another Super Admin');
select throws_ok(format($$select public.admin_staff_set_disabled(%L, true, 'self')$$, :'super1'),
  '42501', null, 'a Super Admin cannot disable themselves');
select pg_temp.act_as(:'super2');
select lives_ok(format($$select public.admin_staff_set_disabled(%L, true, 'rotation')$$, :'super1'),
  'with two Super Admins, one may disable the other');
select pg_temp.as_dba();
select throws_ok(
  format($$update public.admin_role_assignments set is_active = false, deactivated_at = now(),
           deactivation_kind = 'unassigned' where user_id = %L and is_active$$, :'super2'),
  '42501', null, 'the now-last Super Admin is protected again');
select pg_temp.act_as(:'super2');
select lives_ok(format($$select public.admin_staff_set_disabled(%L, false, 'back')$$, :'super1'),
  'a disabled Super Admin can be restored');
select pg_temp.as_dba();
select is((select count(*)::int from public.admin_role_assignments
           where role_id = pg_temp.role_id('super_admin') and is_active), 2, 'two active Super Admins again');

-- ===========================================================================
-- G. Self-escalation / rank-escalation denial
-- ===========================================================================
-- Platform Admin = administrator (rank 80, holds admin_staff.manage, not roles.manage).
select pg_temp.act_as(:'padmin');
select throws_ok(format($$select public.admin_staff_change_role(%L, %L)$$, :'padmin', pg_temp.role_id('super_admin')),
  '42501', null, 'an Administrator cannot promote THEMSELF to Super Admin');
select throws_ok(format($$select public.admin_staff_assign_role(%L, %L)$$, :'padmin', pg_temp.role_id('moderator')),
  '42501', null, 'nobody can add roles to themselves, even lower ones');
select throws_ok(format($$select public.admin_staff_change_role(%L, %L)$$, :'supp', pg_temp.role_id('super_admin')),
  '42501', null, 'an Administrator cannot grant Super Admin to someone else');
select throws_ok(format($$select public.admin_staff_change_role(%L, %L)$$, :'supp', pg_temp.role_id('administrator')),
  '42501', null, 'an Administrator cannot grant their OWN rank (peer creation)');
select throws_ok(format($$select public.admin_staff_set_disabled(%L, true, 'coup')$$, :'super1'),
  '42501', null, 'an Administrator cannot disable a Super Admin');
select throws_ok(
  $$select public.admin_role_create('Shadow', '', 50, 'platform', array['users.read'])$$,
  '42501', null, 'an Administrator cannot create roles (no roles.manage)');
select lives_ok(format($$select public.admin_staff_change_role(%L, %L, 'promotion')$$, :'supp', pg_temp.role_id('moderator')),
  'an Administrator CAN promote Support → Moderator (below own rank, perms held)');
select pg_temp.as_dba();

select pg_temp.act_as(:'super1');
select throws_ok($$select public.admin_role_create('Second Top', '', 100, 'platform', array['users.read'])$$,
  '42501', null, 'no custom role can reach rank 100');
select throws_ok(format($$select public.admin_role_update(%L, 'Super Admin', '', 100, array['users.read'])$$,
  pg_temp.role_id('super_admin')), '42501', null, 'the Super Admin role is not editable');
select throws_ok(format($$select public.admin_role_update(%L, 'Moderator', %L, 60, array['users.read'])$$,
  pg_temp.role_id('moderator'), 'Trust-and-safety reviewer: verification, referral and review moderation decisions.'),
  '42501', null, 'core (locked) permissions of a system role cannot be removed');
select throws_ok($$select public.admin_role_create('Bogus', '', 10, 'platform', array['nuke.everything'])$$,
  '22023', null, 'unknown permission keys are rejected');
-- A custom rank-70 staff manager WITHOUT verify permissions.
select set_config('test.staffmgr', public.admin_role_create(
  'Staff Coordinator', 'Manages junior staff', 70, 'platform',
  array['admin_staff.read','admin_staff.manage','users.read'], 'test')::text, true);
select lives_ok(format($$select public.admin_staff_change_role(%L, %L)$$, :'custom', current_setting('test.staffmgr')),
  'Super Admin assigns the custom Staff Coordinator role');
select pg_temp.as_dba();

select pg_temp.act_as(:'custom');
select throws_ok(format($$select public.admin_staff_change_role(%L, %L)$$, :'supp', pg_temp.role_id('support')),
  '42501', null,
  'a lower-ranked target whose current role carries permissions the actor lacks is not manageable');
select throws_ok(format($$select public.admin_staff_assign_role(%L, %L)$$, :'super2', pg_temp.role_id('support')),
  '42501', null, 'a rank-70 coordinator cannot touch a Super Admin');
select throws_ok(
  format($$select public.admin_role_update(%L, 'Staff Coordinator', 'x', 70, array['admin_staff.read','admin_staff.manage','users.read','points.adjust'])$$,
         current_setting('test.staffmgr')),
  '42501', null, 'a staff manager cannot edit (escalate) their own role');
select pg_temp.as_dba();

-- ===========================================================================
-- H. Support / Moderator / Administrator / custom-role boundaries (direct RPCs)
-- ===========================================================================
-- Fresh Support holder (the earlier one was promoted in G).
insert into public.platform_role_grants (user_id, role) values (:'plain', 'support');

select pg_temp.act_as(:'plain');
select ok(app.has_admin_permission('users.read'), 'Support: users.read');
select throws_ok($$select public.review_start(gen_random_uuid())$$, '42501', null,
  'Support: verification decisions DENIED (PD-004)');
select throws_ok($$select public.apply_organization_verification(gen_random_uuid())$$, '42501', null,
  'Support: organization verification DENIED');
select throws_ok($$select public.showroom_referral_reject(gen_random_uuid(), 'x')$$, '42501', null,
  'Support: Sales referral decisions DENIED');
select throws_ok($$select public.network_referral_reject(gen_random_uuid(), 'x')$$, '42501', null,
  'Support: Network referral decisions DENIED');
select throws_ok(format($$select public.adjust_points(%L, 10, 'x', null)$$, :'plain'), '42501', null,
  'Support: Points adjust DENIED (PD-012)');
select throws_ok($$select public.reverse_points_entry(gen_random_uuid(), 'x')$$, '42501', null,
  'Support: Points reverse DENIED (PD-012)');
select throws_ok($$select public.job_review_moderate(gen_random_uuid(), 'suppress', 'x')$$, '42501', null,
  'Support: job-review moderation DENIED');
select throws_ok($$select * from public.admin_rbac_staff()$$, '42501', null, 'Support: Admin Staff roster DENIED');
select throws_ok($$select * from public.admin_rbac_roles()$$, '42501', null, 'Support: Roles DENIED');
select pg_temp.as_dba();

select pg_temp.act_as(:'supp');  -- now a Moderator (promoted in G)
select unalike(pg_temp.outcome($$select public.network_referral_reject(gen_random_uuid(), 'x')$$),
  '42501%', 'Moderator: gets PAST the referral-decision guard');
select unalike(pg_temp.outcome($$select public.review_start(gen_random_uuid())$$),
  '42501%', 'Moderator: gets PAST the verification-decision guard');
select throws_ok(format($$select public.adjust_points(%L, 10, 'x', null)$$, :'plain'), '42501', null,
  'Moderator: Points adjust DENIED (Administrator-level)');
select throws_ok($$select * from public.admin_rbac_staff()$$, '42501', null, 'Moderator: Admin Staff roster DENIED');
select pg_temp.as_dba();

select pg_temp.act_as(:'padmin');
select unalike(pg_temp.outcome($$select public.reverse_points_entry(gen_random_uuid(), 'x')$$),
  '42501%', 'Administrator: gets PAST the Points-reverse guard');
select lives_ok($$select * from public.admin_rbac_staff()$$, 'Administrator: reads the Admin Staff roster');
select lives_ok($$select * from public.admin_rbac_roles()$$, 'Administrator: reads roles');
select pg_temp.as_dba();

-- Custom platform role: points.read only.
select pg_temp.act_as(:'super1');
select set_config('test.auditor', public.admin_role_create(
  'Points Auditor', '', 30, 'platform', array['points.read'])::text, true);
select lives_ok(format($$select public.admin_staff_assign_role(%L, %L)$$, :'moder', current_setting('test.auditor')),
  'custom Points Auditor assigned (target has staff history)');
-- Custom ORGANIZATION-scoped role.
select set_config('test.orgviewer', public.admin_role_create(
  'Org Viewer', '', 20, 'organization', array['organizations.read'])::text, true);
select lives_ok(format($$select public.admin_staff_assign_role(%L, %L, 'organization', %L)$$,
  :'moder', current_setting('test.orgviewer'), :'orgC'), 'org-scoped custom role assigned on org C');
select throws_ok(format($$select public.admin_staff_assign_role(%L, %L, 'platform', null)$$,
  :'moder', current_setting('test.orgviewer')), '22023', null, 'a scoped role cannot be assigned platform-wide');
select pg_temp.as_dba();

select ok(pg_temp.perm(:'moder', 'points.read'), 'custom role: points.read granted');
select ok(not pg_temp.perm(:'moder', 'points.adjust'), 'custom role: points.adjust NOT granted');
select ok(not pg_temp.perm(:'moder', 'organizations.read'),
  'a scoped assignment never leaks into PLATFORM-wide authority');
select pg_temp.act_as(:'moder');
select ok(app.has_admin_permission('organizations.read', :'orgC'), 'scoped role: authority inside org C');
select ok(not app.has_admin_permission('organizations.read', :'orgN'), 'scoped role: no authority in another org');
select pg_temp.as_dba();

-- ===========================================================================
-- I. Direct invocation surface
-- ===========================================================================
select pg_temp.act_as(:'padmin');
select throws_ok($$select * from public.admin_role_assignments$$, '42501', null,
  'even staff cannot read the assignments table directly');
select throws_ok(format($$insert into public.admin_role_assignments (user_id, role_id) values (%L, %L)$$,
  :'padmin', pg_temp.role_id('super_admin')), '42501', null, 'no direct INSERT into assignments');
select throws_ok(format($$insert into public.admin_role_permissions (role_id, permission_key) values (%L, 'roles.manage')$$,
  pg_temp.role_id('administrator')), '42501', null, 'no direct INSERT into the role→permission map');
select throws_ok(format($$insert into public.platform_role_grants (user_id, role) values (%L, 'administrator')$$, :'plain'),
  '42501', null, 'no client write path into the legacy bridge');
select throws_ok(format($$select app.admin_bootstrap_super_admin(%L)$$, :'padmin'), '42501', null,
  'the Super Admin bootstrap is not client-callable');
select throws_ok($$select app.admin_backfill_legacy_grants()$$, '42501', null, 'the backfill is not client-callable');
select throws_ok($$select app.admin_rank_of(gen_random_uuid())$$, '42501', null,
  'internal rank probe is not client-callable');
select pg_temp.as_dba();

set local role anon;
select throws_ok($$select public.admin_my_access()$$, '42501', null, 'anon cannot call admin RPCs');
select throws_ok($$select app.has_admin_permission('users.read')$$, '42501', null, 'anon cannot call the check');
select pg_temp.as_dba();

select pg_temp.act_as(:'plain');
select is((public.admin_my_access())->'permissions',
  '["organizations.read", "points.read", "referrals.read", "users.read"]'::jsonb,
  'admin_my_access reports exactly the caller''s own effective permissions');
select pg_temp.as_dba();

-- ===========================================================================
-- J. Archived / disabled / suspended / inactive permission deny access
-- ===========================================================================
select pg_temp.act_as(:'super1');
select lives_ok(format($$select public.admin_role_set_archived(%L, true, 'retire')$$, current_setting('test.auditor')),
  'archive the custom Points Auditor role');
select pg_temp.as_dba();
select ok(not pg_temp.perm(:'moder', 'points.read'), 'archived role: its holders lose its permissions immediately');
select pg_temp.act_as(:'super1');
select throws_ok(format($$select public.admin_staff_assign_role(%L, %L)$$, :'custom', current_setting('test.auditor')),
  '42501', null, 'an archived role cannot be assigned');
select throws_ok(format($$select public.admin_role_set_archived(%L, true)$$, pg_temp.role_id('moderator')),
  '42501', null, 'system roles cannot be archived');
select lives_ok(format($$select public.admin_role_set_archived(%L, false)$$, current_setting('test.auditor')),
  'restore the custom role');
select pg_temp.as_dba();
select ok(pg_temp.perm(:'moder', 'points.read'), 'restored role: permissions return');

select pg_temp.act_as(:'padmin');
select lives_ok(format($$select public.admin_staff_set_disabled(%L, true, 'leave')$$, :'plain'),
  'Administrator disables a Support member');
select pg_temp.as_dba();
select ok(not pg_temp.perm(:'plain', 'users.read'), 'disabled staff: no permission');
select pg_temp.act_as(:'plain');
select ok(not app.is_admin_staff(), 'disabled staff: not staff (console door closed)');
select ok(not app.is_platform('support'), 'disabled staff: compat shim also denies');
select pg_temp.as_dba();
select throws_ok(format($$select public.admin_staff_set_disabled(%L, true, '   ')$$, :'supp'),
  '42501', null, 'disable requires permission first (DBA has no JWT)');

update public.users set status = 'suspended' where id = :'padmin';
select ok(not pg_temp.perm(:'padmin', 'users.read'), 'a suspended account holds no Admin authority');
update public.users set status = 'active' where id = :'padmin';
select ok(pg_temp.perm(:'padmin', 'users.read'), 'reactivated account regains it');

update public.admin_permissions set is_active = false where key = 'audit.read';
select ok(not pg_temp.perm(:'padmin', 'audit.read'), 'an inactive permission is denied to every role');
update public.admin_permissions set is_active = true where key = 'audit.read';

-- ===========================================================================
-- K. Audit trail of RBAC mutations
-- ===========================================================================
select ok(exists (select 1 from public.audit_log where action = 'admin_role.created'
                  and actor_user_id = :'super1' and metadata->>'name' = 'Points Auditor'),
  'role creation is audited with its actor');
select ok(exists (select 1 from public.audit_log where action = 'admin_role.archived'
                  and actor_user_id = :'super1' and metadata->>'reason' = 'retire'),
  'role archive is audited with its reason');
select ok(exists (select 1 from public.audit_log where action = 'admin_role.assignment_changed'
                  and actor_user_id = :'padmin' and metadata->>'target_user_id' = :'supp'),
  'role change is audited with actor and target');
select ok(exists (select 1 from public.audit_log where action = 'admin_staff.disabled'
                  and actor_user_id = :'padmin' and metadata->>'reason' = 'leave'),
  'staff disable is audited with its reason');
select ok(exists (select 1 from public.audit_log where action = 'admin_staff.restored'
                  and actor_user_id = :'super2'),
  'staff restore is audited');
select ok(exists (select 1 from public.audit_log where action = 'admin_role.assigned'
                  and metadata->>'source' = 'dba_bootstrap'),
  'Super Admin bootstrap is audited');

select * from finish();
rollback;
