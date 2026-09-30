-- ===========================================================================
-- Admin Core — Phase 1A: Dynamic RBAC foundation (PD-008 approved 2026-09-29,
-- PD-016; BL-018). Design + cutover: docs/admin/ADMIN_RBAC_ARCHITECTURE.md.
--
-- WHAT THIS DOES
--   1. Adds the DB-backed permission catalog, roles, role→permission map and
--      scoped role assignments (admin_permissions / admin_roles /
--      admin_role_permissions / admin_role_assignments).
--   2. Seeds the system roles (Super Admin · Administrator · Moderator ·
--      Support) and the `resource.action` catalog.
--   3. Makes the assignments the SINGLE source of platform authority:
--        • app.has_admin_permission(...)  — the canonical check
--        • app.is_platform(...)           — REDEFINED over the new model so
--          every not-yet-converted call site keeps working with no gap
--        • platform_role_grants           — kept as a write-only COMPATIBILITY
--          input: a trigger mirrors every legacy grant into an assignment of
--          the equivalent system role. Nothing reads it for authorization.
--   4. Re-tiers every sensitive RPC from "any staff" (is_platform('support'))
--      to a specific permission (PD-004 / PD-012), by surgically replacing the
--      ONE guard line in the LIVE function body (asserted to match exactly once).
--   5. Converts the Admin-domain cross-tenant RLS read policies to permissions.
--   6. Adds audited, rank-checked RBAC RPCs for the Admin Staff / Roles /
--      Permissions UI, and a DBA-only Super Admin bootstrap.
--
-- INTENTIONAL ACCESS CHANGES (documented in the architecture doc §7):
--   • Legacy `support` holders lose every sensitive mutation (verification
--     decisions, referral decisions, Points adjust/reverse) and verification
--     DOCUMENT reads — PD-004's "no sensitive action at the lowest tier".
--     No seeded/staging account holds `support` today.
--   • Points adjust/reverse become Administrator-level (PD-012).
--   Everything a legacy `moderator`/`administrator` could do, they still can.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------
-- `department` is representable but NOT assignable yet: no departments/teams
-- domain table exists, and a scope id with no real foreign key would be a
-- fake reference. The CHECK constraints below reject it until that domain lands.
create type public.admin_scope_type as enum ('platform', 'organization', 'branch', 'department', 'user');
create type public.admin_role_status as enum ('active', 'archived');
create type public.admin_deactivation_kind as enum ('unassigned', 'role_changed', 'staff_disabled', 'legacy_revoked');

-- ---------------------------------------------------------------------------
-- 2. Permission catalog — system-defined; there is no write path for it.
-- ---------------------------------------------------------------------------
create table public.admin_permissions (
  key         text primary key,
  resource    text not null,
  action      text not null,
  description text not null,
  is_active   boolean not null default true,
  is_system   boolean not null default true,
  sort_order  int not null,
  created_at  timestamptz not null default now(),
  constraint ck_admin_permissions_key_shape
    check (key ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$' and key = resource || '.' || action),
  constraint uq_admin_permissions_resource_action unique (resource, action)
);
comment on table public.admin_permissions is 'Admin RBAC permission catalog (`resource.action`). System-defined, migration-only. The frontend reads it through admin_rbac_permissions(); it keeps no second definition.';

insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('users.read',             'users',         'read',     'View user accounts, profiles and their verification status.', 10),
  ('users.verify',           'users',         'verify',   'Decide user verification requests and apply professional upgrades / listing.', 11),
  ('users.suspend',          'users',         'suspend',  'Suspend and restore user accounts (PD-010; no write path yet).', 12),
  ('organizations.read',     'organizations', 'read',     'View organizations, branches and memberships.', 20),
  ('organizations.verify',   'organizations', 'verify',   'Decide organization verification requests and apply them.', 21),
  ('organizations.suspend',  'organizations', 'suspend',  'Suspend and restore organizations (PD-011; no write path yet).', 22),
  ('referrals.read',         'referrals',     'read',     'View Sales and Network referral queues.', 30),
  ('referrals.approve',      'referrals',     'approve',  'Approve or reject Sales and Network referrals.', 31),
  ('job_reviews.moderate',   'job_reviews',   'moderate', 'Suppress or restore published job reviews.', 35),
  ('points.read',            'points',        'read',     'View the Points ledger and balances.', 40),
  ('points.adjust',          'points',        'adjust',   'Issue manual Points credits/debits (PD-012).', 41),
  ('points.reverse',         'points',        'reverse',  'Reverse a Points ledger entry (PD-012).', 42),
  ('audit.read',             'audit',         'read',     'Read the platform audit trail.', 50),
  ('analytics.read',         'analytics',     'read',     'View Admin analytics.', 60),
  ('admin_staff.read',       'admin_staff',   'read',     'View Admin Staff and their role assignments.', 70),
  ('admin_staff.manage',     'admin_staff',   'manage',   'Assign, change, remove and disable/restore Admin Staff roles (below own rank).', 71),
  ('roles.read',             'roles',         'read',     'View roles and the permission catalog.', 80),
  ('roles.manage',           'roles',         'manage',   'Create, edit, archive and restore roles (below own rank).', 81);

-- ---------------------------------------------------------------------------
-- 3. Roles
-- ---------------------------------------------------------------------------
create table public.admin_roles (
  id          uuid primary key default extensions.gen_random_uuid(),
  key         text not null,
  name        text not null,
  description text not null default '',
  rank        int not null,
  scope_type  public.admin_scope_type not null default 'platform',
  is_system   boolean not null default false,
  status      public.admin_role_status not null default 'active',
  created_by  uuid references public.users (id) on delete set null,
  updated_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  constraint uq_admin_roles_key unique (key),
  constraint ck_admin_roles_key_shape check (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  constraint ck_admin_roles_name check (char_length(btrim(name)) between 1 and 80),
  constraint ck_admin_roles_description check (char_length(description) <= 500),
  constraint ck_admin_roles_rank check (rank between 1 and 100),
  -- Rank 100 is reserved for the Super Admin system role: no custom role can
  -- ever reach the top of the hierarchy.
  constraint ck_admin_roles_custom_rank check (is_system or rank < 100),
  constraint ck_admin_roles_system_platform check (not is_system or scope_type = 'platform'),
  constraint ck_admin_roles_system_active check (not is_system or status = 'active'),
  constraint ck_admin_roles_archived_at check ((status = 'archived') = (archived_at is not null)),
  constraint ck_admin_roles_department_deferred check (scope_type <> 'department')
);
comment on table public.admin_roles is 'Admin RBAC roles. System roles (is_system) are seeded, platform-scoped, never archived, and keep their core (locked) permissions. Custom roles are created through admin_role_create().';
create unique index uq_admin_roles_name_ci on public.admin_roles (lower(btrim(name)));

insert into public.admin_roles (key, name, description, rank, scope_type, is_system) values
  ('super_admin',   'Super Admin',   'Full platform authority, including role and Admin Staff management.', 100, 'platform', true),
  ('administrator', 'Administrator', 'Operational authority across users, organizations, referrals, Points, audit and analytics; manages Admin Staff below its rank.', 80, 'platform', true),
  ('moderator',     'Moderator',     'Trust-and-safety reviewer: verification, referral and review moderation decisions.', 60, 'platform', true),
  ('support',       'Support',       'Read-only help-desk access to users, organizations, referrals and Points.', 40, 'platform', true);

-- ---------------------------------------------------------------------------
-- 4. Role → permission map
-- ---------------------------------------------------------------------------
create table public.admin_role_permissions (
  role_id        uuid not null references public.admin_roles (id) on delete cascade,
  permission_key text not null references public.admin_permissions (key) on delete restrict,
  is_locked      boolean not null default false,
  granted_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (role_id, permission_key)
);
comment on table public.admin_role_permissions is 'Which permissions a role holds. is_locked marks a CORE permission of a system role: it can never be removed (trigger-enforced for every writer, including the DBA path).';
create index ix_admin_role_permissions_permission on public.admin_role_permissions (permission_key);

-- System role matrix (docs/admin/ADMIN_RBAC_ARCHITECTURE.md §4).
insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, p.key,
  case r.key
    -- Super Admin is entirely locked: it must always be able to repair access.
    when 'super_admin'   then true
    when 'administrator' then p.key in ('users.read', 'organizations.read', 'admin_staff.read', 'roles.read')
    when 'moderator'     then p.key in ('users.read', 'organizations.read')
    when 'support'       then p.key in ('users.read', 'organizations.read')
  end
from public.admin_roles r
cross join public.admin_permissions p
where
  r.key = 'super_admin'
  or (r.key = 'administrator' and p.key <> 'roles.manage')
  or (r.key = 'moderator' and p.key in (
        'users.read', 'users.verify', 'users.suspend',
        'organizations.read', 'organizations.verify',
        'referrals.read', 'referrals.approve',
        'job_reviews.moderate', 'points.read'))
  or (r.key = 'support' and p.key in (
        'users.read', 'organizations.read', 'referrals.read', 'points.read'));

-- ---------------------------------------------------------------------------
-- 5. Role assignments (scoped)
-- ---------------------------------------------------------------------------
create table public.admin_role_assignments (
  id                    uuid primary key default extensions.gen_random_uuid(),
  user_id               uuid not null references public.users (id) on delete cascade,
  role_id               uuid not null references public.admin_roles (id) on delete restrict,
  scope_type            public.admin_scope_type not null default 'platform',
  scope_organization_id uuid references public.organizations (id) on delete cascade,
  scope_branch_id       uuid references public.branches (id) on delete cascade,
  scope_user_id         uuid references public.users (id) on delete cascade,
  is_active             boolean not null default true,
  -- Compatibility phase: the platform_role_grants row this assignment mirrors.
  legacy_grant_id       uuid references public.platform_role_grants (id) on delete set null,
  assigned_by           uuid references public.users (id) on delete set null,
  deactivated_by        uuid references public.users (id) on delete set null,
  deactivated_at        timestamptz,
  deactivation_kind     public.admin_deactivation_kind,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ck_admin_role_assignments_scope_shape check (
    (scope_type = 'platform'     and scope_organization_id is null     and scope_branch_id is null     and scope_user_id is null)
    or (scope_type = 'organization' and scope_organization_id is not null and scope_branch_id is null     and scope_user_id is null)
    or (scope_type = 'branch'       and scope_organization_id is not null and scope_branch_id is not null and scope_user_id is null)
    or (scope_type = 'user'         and scope_organization_id is null     and scope_branch_id is null     and scope_user_id is not null)
  ),
  constraint ck_admin_role_assignments_active_shape check (
    (is_active and deactivated_at is null and deactivation_kind is null)
    or (not is_active and deactivated_at is not null and deactivation_kind is not null)
  ),
  constraint uq_admin_role_assignments_legacy_grant unique (legacy_grant_id)
);
comment on table public.admin_role_assignments is 'Admin RBAC: who holds which role at which scope. THE single source of platform authority. Rows are never deleted by the app — removal/disable deactivates (kept for history).';

create unique index uq_admin_role_assignments_active on public.admin_role_assignments (
  user_id, role_id, scope_type,
  coalesce(scope_organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(scope_branch_id,       '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(scope_user_id,         '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active;
-- The authorization hot path: "the caller's active assignments".
create index ix_admin_role_assignments_user_active on public.admin_role_assignments (user_id) where is_active;
create index ix_admin_role_assignments_role on public.admin_role_assignments (role_id);

-- ---------------------------------------------------------------------------
-- 6. Invariant triggers (fire for EVERY writer — RPC, migration, DBA)
-- ---------------------------------------------------------------------------
-- Locked (core) permissions are immutable; only system roles may carry them.
create or replace function app.admin_role_permissions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.is_locked then
    -- A cascade from deleting the role itself is the only exception, and no
    -- role-delete path exists; a direct row delete/update is always refused.
    if tg_op = 'DELETE' and not exists (select 1 from public.admin_roles r where r.id = old.role_id) then
      return old;
    end if;
    raise exception 'core permission % of this role is locked', old.permission_key using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.is_locked
     and not exists (select 1 from public.admin_roles r where r.id = new.role_id and r.is_system) then
    raise exception 'only system roles carry locked permissions' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trg_admin_role_permissions_guard
  before insert or update or delete on public.admin_role_permissions
  for each row execute function app.admin_role_permissions_guard();

-- System roles: identity (key/name/rank/scope/system flag) is immutable.
create or replace function app.admin_roles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'roles are archived, never deleted' using errcode = '42501';
  end if;
  if old.is_system and (
       new.key <> old.key or new.name <> old.name or new.rank <> old.rank
       or new.scope_type <> old.scope_type or new.is_system <> old.is_system
       or new.description <> old.description) then
    raise exception 'system role identity is immutable' using errcode = '42501';
  end if;
  if not old.is_system and new.is_system then
    raise exception 'a custom role cannot become a system role' using errcode = '42501';
  end if;
  if new.scope_type <> old.scope_type then
    raise exception 'a role''s scope type cannot change once created' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_admin_roles_guard
  before update or delete on public.admin_roles
  for each row execute function app.admin_roles_guard();

-- Assignment shape: the assignment's scope must match the role's scope type,
-- and a branch scope must belong to the stated organization.
create or replace function app.admin_role_assignments_shape_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role_scope public.admin_scope_type;
begin
  select r.scope_type into v_role_scope from public.admin_roles r where r.id = new.role_id;
  if v_role_scope is distinct from new.scope_type then
    raise exception 'assignment scope must match the role scope (%)', v_role_scope using errcode = '23514';
  end if;
  if new.scope_type = 'branch' and not exists (
       select 1 from public.branches b
       where b.id = new.scope_branch_id and b.organization_id = new.scope_organization_id) then
    raise exception 'branch scope does not belong to the stated organization' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_admin_role_assignments_shape_guard
  before insert or update on public.admin_role_assignments
  for each row execute function app.admin_role_assignments_shape_guard();

-- The last active Super Admin can never be removed, disabled or demoted — by
-- anyone, through any path. The advisory lock serializes concurrent removals so
-- two sessions cannot each remove "one of two" and leave zero.
create or replace function app.admin_last_super_admin_guard()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_super uuid;
begin
  select r.id into v_super from public.admin_roles r where r.key = 'super_admin';
  if old.role_id <> v_super or not old.is_active then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.is_active and new.role_id = v_super and new.scope_type = 'platform' then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('aladdin.admin_rbac.super_admin'));
  if not exists (
    select 1 from public.admin_role_assignments a
    join public.users u on u.id = a.user_id
    where a.role_id = v_super and a.is_active and a.scope_type = 'platform'
      and u.status not in ('suspended', 'deactivated')) then
    raise exception 'the last active Super Admin cannot be removed' using errcode = '42501';
  end if;
  return null;
end;
$$;

create trigger trg_admin_last_super_admin_guard
  after update or delete on public.admin_role_assignments
  for each row execute function app.admin_last_super_admin_guard();

-- ---------------------------------------------------------------------------
-- 7. Authorization helpers — THE canonical checks
-- ---------------------------------------------------------------------------
-- Internal: a user's effective PLATFORM rank (0 = not staff). Not granted to
-- clients: letting any caller probe another user's authority would be a leak.
create or replace function app.admin_rank_of(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(r.rank), 0)
  from public.admin_role_assignments a
  join public.admin_roles r on r.id = a.role_id
  join public.users u on u.id = a.user_id
  where a.user_id = p_user_id
    and a.is_active and a.scope_type = 'platform'
    and r.status = 'active'
    and u.status not in ('suspended', 'deactivated');
$$;

-- Internal: a user's effective PLATFORM permissions.
create or replace function app.admin_permissions_of(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct rp.permission_key order by rp.permission_key), '{}')
  from public.admin_role_assignments a
  join public.admin_roles r on r.id = a.role_id
  join public.admin_role_permissions rp on rp.role_id = r.id
  join public.admin_permissions p on p.key = rp.permission_key
  join public.users u on u.id = a.user_id
  where a.user_id = p_user_id
    and a.is_active and a.scope_type = 'platform'
    and r.status = 'active' and p.is_active
    and u.status not in ('suspended', 'deactivated');
$$;

-- THE canonical permission check for the calling user.
--
-- With no context, only PLATFORM-scoped assignments count — a scoped assignment
-- can never leak into platform-wide authority. With a context, an assignment
-- scoped to that organization / branch / user also matches (a branch context
-- also matches an assignment on the branch's organization). Deny by default:
-- inactive assignment, archived role, inactive permission, or a suspended /
-- deactivated account all yield false.
create or replace function app.has_admin_permission(
  p_permission      text,
  p_organization_id uuid default null,
  p_branch_id       uuid default null,
  p_user_id         uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_role_assignments a
    join public.admin_roles r on r.id = a.role_id
    join public.admin_role_permissions rp on rp.role_id = r.id and rp.permission_key = p_permission
    join public.admin_permissions p on p.key = rp.permission_key
    join public.users u on u.id = a.user_id
    where a.user_id = (select auth.uid())
      and a.is_active and r.status = 'active' and p.is_active
      and u.status not in ('suspended', 'deactivated')
      and (
        a.scope_type = 'platform'
        or (a.scope_type = 'organization' and a.scope_organization_id is not null
            and a.scope_organization_id = coalesce(p_organization_id,
                  (select b.organization_id from public.branches b where b.id = p_branch_id)))
        or (a.scope_type = 'branch' and a.scope_branch_id = p_branch_id)
        or (a.scope_type = 'user' and a.scope_user_id = p_user_id)
      )
  );
$$;

-- Caller holds ANY active platform assignment (the Admin console door).
create or replace function app.is_admin_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.admin_rank_of((select auth.uid())) > 0;
$$;

-- Verification decisions: organization subjects need organizations.verify,
-- user subjects need users.verify. An unknown id falls through to "holds
-- either", so the caller then gets the RPC's own not-found error, not a lie.
create or replace function app.can_review_verification(p_verification_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (select v.subject_type from public.verifications v where v.id = p_verification_id)
    when 'organization' then app.has_admin_permission('organizations.verify')
    when 'user'         then app.has_admin_permission('users.verify')
    else app.has_admin_permission('users.verify') or app.has_admin_permission('organizations.verify')
  end;
$$;

-- Legacy tier of a rank — used ONLY for the compatibility shim below and for
-- the informational audit_log.actor_role column.
create or replace function app.admin_legacy_tier(p_rank int)
returns public.platform_role
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rank >= 80 then 'administrator'::public.platform_role
    when p_rank >= 60 then 'moderator'::public.platform_role
    when p_rank >= 1  then 'support'::public.platform_role
  end;
$$;

-- COMPATIBILITY SHIM. Every call site not yet converted to a named permission
-- keeps its exact previous meaning, now resolved through the new model:
--   'support'       → any active platform staff (all remaining callers)
--   'moderator'     → platform rank ≥ 60
--   'administrator' → platform rank ≥ 80
-- New code must call app.has_admin_permission() instead.
create or replace function app.is_platform(p_role public.platform_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.admin_rank_of((select auth.uid())) >= case p_role
    when 'support'       then 1
    when 'moderator'     then 60
    when 'administrator' then 80
  end;
$$;
comment on function app.is_platform(public.platform_role) is 'DEPRECATED compatibility shim over admin_role_assignments (Admin Core 1A). support = any staff; moderator/administrator = rank floors 60/80. Use app.has_admin_permission().';

-- audit_log.actor_role is informational ("recorded, not trusted for authz");
-- derive it from the new model so RBAC-assigned staff are labelled too.
create or replace function app.record_audit_event(
  p_action          text,
  p_subject_type    text,
  p_subject_id      uuid,
  p_organization_id uuid,
  p_metadata        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role  public.platform_role;
  v_id    uuid;
begin
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'audit metadata must be a JSON object';
  end if;
  -- Legacy tier of the actor's platform rank (null for ordinary users) — recorded, not trusted for authz.
  v_role := app.admin_legacy_tier(app.admin_rank_of(v_actor));

  insert into public.audit_log (actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata)
  values (v_actor, v_role, p_action, p_subject_type, p_subject_id, p_organization_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  if p_organization_id is not null and p_action = any(app.activity_event_types()) then
    insert into public.organization_activity_events (
      organization_id, audit_log_id, actor_user_id, event_type,
      subject_type, subject_id, params)
    values (
      p_organization_id, v_id, v_actor, p_action,
      p_subject_type, p_subject_id, app.activity_event_params(p_action, p_metadata));
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Audit vocabulary for RBAC events
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint ck_audit_action_known;
alter table public.audit_log add constraint ck_audit_action_known check (action in (
  'organization.created',
  'membership.granted', 'membership.activated', 'membership.role_changed',
  'membership.suspended', 'membership.revoked',
  'branch.created', 'branch.assignment_changed',
  'platform_role.granted', 'platform_role.revoked', 'platform.override_used',
  'account.upgrade_requested',
  'verification.review_started', 'verification.changes_requested',
  'verification.approved', 'verification.rejected',
  'account.type_changed', 'profile.listed', 'profile.hidden',
  'customer.created', 'customer.updated',
  'lead.created', 'lead.assigned', 'lead.reassigned', 'lead.stage_changed',
  'lead.won', 'lead.lost', 'lead.reopened', 'lead.archived',
  'followup.created', 'followup.reassigned', 'followup.completed', 'followup.reopened',
  'customer.reassigned', 'lead.details_changed',
  'onboarding.completed',
  'onboarding.consumer_completed', 'onboarding.professional_submitted',
  'onboarding.organization_created',
  'product.created', 'product.updated', 'product.published', 'product.unpublished',
  'rfq.created', 'rfq.submitted', 'rfq.updated', 'rfq.cancelled', 'rfq.closed',
  'quotation.created', 'quotation.updated', 'quotation.submitted',
  'quotation.accepted', 'quotation.rejected',
  'order.created', 'order.started', 'order.completed', 'order.cancelled',
  'project.created', 'project.activated', 'project.completed',
  'organization.verified',
  'affiliation.requested', 'affiliation.cancelled',
  'affiliation.approved', 'affiliation.rejected',
  'referral.submitted', 'referral.approved', 'referral.rejected',
  'conversation.opened',
  'points.adjusted', 'points.reversed',
  'job.created', 'job.updated', 'job.published', 'job.closed', 'job.cancelled',
  'job.application.submitted', 'job.application.withdrawn',
  'job.application.accepted', 'job.application.rejected',
  'job.assignment.started', 'job.assignment.progress_updated',
  'job.assignment.completed', 'job.assignment.cancelled',
  'job.review.submitted', 'job.review.suppressed', 'job.review.restored',
  'network_referral.submitted', 'network_referral.joined',
  'network_referral.approved', 'network_referral.rejected', 'network_referral.cancelled',
  'profile.username_set', 'profile.phone_set', 'profile.avatar_set',
  'organization.activities_set', 'user.activities_set',
  -- Admin Core 1A — RBAC.
  'admin_role.created', 'admin_role.updated', 'admin_role.permissions_changed',
  'admin_role.archived', 'admin_role.restored',
  'admin_role.assigned', 'admin_role.unassigned', 'admin_role.assignment_changed',
  'admin_staff.disabled', 'admin_staff.restored'
));

-- ---------------------------------------------------------------------------
-- 9. Legacy grants → assignments (backfill + compatibility mirror)
-- ---------------------------------------------------------------------------
-- Backfill: every legacy grant not yet linked to an assignment becomes one, and
-- each copy gets its own audit row so migrated authority has provenance (who
-- originally granted it, when, and that it arrived via the 1A backfill — not a
-- new grant). actor_user_id is null: no human performed the copy. Idempotent:
-- an already-linked grant is skipped, so a re-run copies (and audits) nothing.
-- DBA/migration-only (no grant); a function so pgTAP can exercise this exact path.
create or replace function app.admin_backfill_legacy_grants()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with copied as (
    insert into public.admin_role_assignments (user_id, role_id, scope_type, legacy_grant_id, assigned_by, created_at)
    select g.user_id, r.id, 'platform', g.id, g.granted_by, g.created_at
    from public.platform_role_grants g
    join public.admin_roles r on r.key = g.role::text
    where not exists (select 1 from public.admin_role_assignments x where x.legacy_grant_id = g.id)
    returning id, user_id, role_id, legacy_grant_id, assigned_by, created_at
  )
  select count(app.record_audit_event('admin_role.assigned', 'admin_role_assignment', c.id, null,
    jsonb_build_object(
      'target_user_id', c.user_id, 'role_key', r.key, 'scope_type', 'platform',
      'source', 'legacy_backfill', 'legacy_grant_id', c.legacy_grant_id,
      'original_granted_by', c.assigned_by, 'original_granted_at', c.created_at)))::int
  into v_n
  from copied c
  join public.admin_roles r on r.id = c.role_id;
  return v_n;
end;
$$;

select app.admin_backfill_legacy_grants();

create or replace function app.mirror_platform_role_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role uuid;
  v_id   uuid;
begin
  if tg_op = 'INSERT' then
    select r.id into v_role from public.admin_roles r where r.key = new.role::text;
    -- An equivalent active assignment may already exist (made through RBAC):
    -- adopt it instead of duplicating.
    update public.admin_role_assignments a set legacy_grant_id = new.id
    where a.user_id = new.user_id and a.role_id = v_role and a.scope_type = 'platform'
      and a.is_active and a.legacy_grant_id is null
    returning a.id into v_id;
    if v_id is null then
      insert into public.admin_role_assignments (user_id, role_id, scope_type, legacy_grant_id, assigned_by)
      values (new.user_id, v_role, 'platform', new.id, new.granted_by)
      returning id into v_id;
    end if;
    perform app.record_audit_event('admin_role.assigned', 'admin_role_assignment', v_id, null,
      jsonb_build_object('target_user_id', new.user_id, 'role_key', new.role::text,
                         'scope_type', 'platform', 'source', 'legacy_platform_role_grant',
                         'legacy_grant_id', new.id));
    return new;
  end if;

  -- DELETE. This MUST run BEFORE the row is gone: admin_role_assignments.legacy_grant_id
  -- is ON DELETE SET NULL, and that FK action is an internal AFTER trigger
  -- ("RI_ConstraintTrigger_…") that sorts — and therefore fires — ahead of any
  -- user AFTER trigger, erasing the link before an AFTER trigger could follow it.
  -- Every linked active assignment is revoked (a loop, not a single-row RETURNING).
  for v_id in
    update public.admin_role_assignments a
    set is_active = false, deactivated_at = now(), deactivation_kind = 'legacy_revoked',
        deactivated_by = (select auth.uid())
    where a.legacy_grant_id = old.id and a.is_active
    returning a.id
  loop
    perform app.record_audit_event('admin_role.unassigned', 'admin_role_assignment', v_id, null,
      jsonb_build_object('target_user_id', old.user_id, 'role_key', old.role::text,
                         'source', 'legacy_platform_role_grant', 'legacy_grant_id', old.id));
  end loop;
  return old;
end;
$$;

create trigger trg_platform_role_grants_mirror_insert
  after insert on public.platform_role_grants
  for each row execute function app.mirror_platform_role_grant();

create trigger trg_platform_role_grants_mirror_delete
  before delete on public.platform_role_grants
  for each row execute function app.mirror_platform_role_grant();

-- The bridge accepts only INSERT (grant) and DELETE (revoke) — the two shapes
-- the mirror understands. An UPDATE would silently desync the legacy row from
-- its assignment, and TRUNCATE skips row triggers (and, with CASCADE, would wipe
-- every assignment), so both are refused for every writer.
create or replace function app.platform_role_grants_bridge_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform_role_grants is a compatibility bridge: % is not allowed; use the Admin RBAC RPCs', tg_op
    using errcode = '42501';
end;
$$;

create trigger trg_platform_role_grants_no_update
  before update on public.platform_role_grants
  for each row execute function app.platform_role_grants_bridge_guard();

create trigger trg_platform_role_grants_no_truncate
  before truncate on public.platform_role_grants
  for each statement execute function app.platform_role_grants_bridge_guard();

comment on table public.platform_role_grants is 'DEPRECATED compatibility bridge (Admin Core 1A). NOT an authority source: NOTHING reads it for authorization. INSERT mirrors into admin_role_assignments (after-insert trigger); DELETE revokes the linked assignment (before-delete trigger, ahead of the ON DELETE SET NULL FK action). Retirement plan: docs/admin/ADMIN_RBAC_ARCHITECTURE.md §6.';

-- ---------------------------------------------------------------------------
-- 10. Re-tier sensitive RPCs to named permissions (surgical guard swap)
-- ---------------------------------------------------------------------------
-- Rewrites ONE exact guard substring in the LIVE definition and re-creates the
-- function (CREATE OR REPLACE keeps owner, grants, SECURITY DEFINER and
-- search_path). Refuses unless the needle occurs exactly once, so a body that
-- has drifted can never be half-converted silently.
create function pg_temp.retier(p_fn regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  v_n   int;
begin
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> 1 then
    raise exception 'retier %: expected exactly one "%", found %', p_fn, p_old, v_n;
  end if;
  execute replace(v_def, p_old, p_new);
end;
$$;

select pg_temp.retier('public.review_start(uuid)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.can_review_verification(p_verification_id) then');
select pg_temp.retier('public.review_request_changes(uuid,text)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.can_review_verification(p_verification_id) then');
select pg_temp.retier('public.review_reject(uuid,text)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.can_review_verification(p_verification_id) then');
select pg_temp.retier('public.review_approve(uuid,boolean)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.can_review_verification(p_verification_id) then');
select pg_temp.retier('public.apply_account_upgrade(uuid)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''users.verify'') then');
select pg_temp.retier('public.set_profile_hidden(uuid)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''users.verify'') then');
select pg_temp.retier('public.apply_organization_verification(uuid)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''organizations.verify'') then');
select pg_temp.retier('public.admin_showroom_referrals_list(boolean)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''referrals.read'') then');
select pg_temp.retier('public.admin_network_referrals_list(boolean)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''referrals.read'') then');
select pg_temp.retier('public.showroom_referral_approve(uuid,uuid)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''referrals.approve'') then');
select pg_temp.retier('public.showroom_referral_reject(uuid,text)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''referrals.approve'') then');
select pg_temp.retier('public.network_referral_approve(uuid,uuid)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''referrals.approve'') then');
select pg_temp.retier('public.network_referral_reject(uuid,text)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''referrals.approve'') then');
select pg_temp.retier('public.adjust_points(uuid,integer,text,uuid)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''points.adjust'') then');
select pg_temp.retier('public.reverse_points_entry(uuid,text)'::regprocedure,
  'if not app.is_platform(''support'') then', 'if not app.has_admin_permission(''points.reverse'') then');
select pg_temp.retier('public.job_review_moderate(uuid,text,text)'::regprocedure,
  'if not app.is_platform(''moderator'') then', 'if not app.has_admin_permission(''job_reviews.moderate'') then');

-- ---------------------------------------------------------------------------
-- 11. Admin-domain cross-tenant READ policies → named permissions
--     (commerce / jobs / trades reads stay on the is_platform('support') shim
--      until their Admin modules are wired — see architecture doc §9)
-- ---------------------------------------------------------------------------
alter policy users_select_platform on public.users
  using ((select app.has_admin_permission('users.read')));
alter policy profiles_select_platform on public.profiles
  using ((select app.has_admin_permission('users.read')));
alter policy organizations_select_platform on public.organizations
  using ((select app.has_admin_permission('organizations.read')));
alter policy branches_select_platform on public.branches
  using ((select app.has_admin_permission('organizations.read')));
alter policy memberships_select_platform on public.memberships
  using ((select app.has_admin_permission('organizations.read')));
alter policy platform_role_grants_select_admin on public.platform_role_grants
  using ((select app.has_admin_permission('admin_staff.read')));
alter policy audit_log_select_admin on public.audit_log
  using ((select app.has_admin_permission('audit.read')));
alter policy points_ledger_select_platform on public.points_ledger
  using ((select app.has_admin_permission('points.read')));
alter policy ojr_select_platform on public.organization_join_requests
  using ((select app.has_admin_permission('referrals.read')));
alter policy ref_select_platform on public.organization_referrals
  using ((select app.has_admin_permission('referrals.read')));
alter policy netref_select_platform on public.network_referrals
  using ((select app.has_admin_permission('referrals.read')));
alter policy verifications_select_subject on public.verifications
  using (
    (subject_type = 'user' and user_id = (select auth.uid()))
    or (subject_type = 'organization' and app.has_capability(organization_id, 'verification.read'))
    or (subject_type = 'user' and (select app.has_admin_permission('users.read')))
    or (subject_type = 'organization' and (select app.has_admin_permission('organizations.read')))
  );
-- Identity/business documents: reviewers only (was: any staff).
alter policy verification_documents_select on public.verification_documents
  using (exists (
    select 1 from public.verifications v
    where v.id = verification_id
      and (
        (v.subject_type = 'user' and v.user_id = (select auth.uid()))
        or (v.subject_type = 'organization' and app.has_capability(v.organization_id, 'verification.read'))
        or (v.subject_type = 'user' and (select app.has_admin_permission('users.verify')))
        or (v.subject_type = 'organization' and (select app.has_admin_permission('organizations.verify')))
      )
  ));

-- ---------------------------------------------------------------------------
-- 12. RBAC RPCs (read models + audited, rank-checked mutations)
-- ---------------------------------------------------------------------------
-- Shared precondition for every RBAC RPC: raise the SAME code/message shape the
-- rest of the platform uses, so the UI maps it to "not authorized".
create or replace function app.admin_require(p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not app.has_admin_permission(p_permission) then
    raise exception 'admin permission % required', p_permission using errcode = '42501';
  end if;
end;
$$;

-- Everything the caller needs to render the console: rank, roles, permissions.
create or replace function public.admin_my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_staff',    app.admin_rank_of((select auth.uid())) > 0,
    'rank',        app.admin_rank_of((select auth.uid())),
    'permissions', to_jsonb(app.admin_permissions_of((select auth.uid()))),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'is_system', r.is_system, 'rank', r.rank)
                       order by r.rank desc)
      from public.admin_role_assignments a
      join public.admin_roles r on r.id = a.role_id
      join public.users u on u.id = a.user_id
      where a.user_id = (select auth.uid()) and a.is_active and a.scope_type = 'platform' and r.status = 'active'
        and u.status not in ('suspended', 'deactivated')
    ), '[]'::jsonb));
$$;

create or replace function public.admin_rbac_permissions()
returns table (key text, resource text, action text, description text, sort_order int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.admin_require('roles.read');
  return query
    select p.key, p.resource, p.action, p.description, p.sort_order
    from public.admin_permissions p
    where p.is_active
    order by p.sort_order;
end;
$$;

create or replace function public.admin_rbac_roles()
returns table (
  id uuid, key text, name text, description text, rank int,
  scope_type public.admin_scope_type, is_system boolean, status public.admin_role_status,
  staff_count int, permissions text[], locked_permissions text[],
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.admin_require('roles.read');
  return query
    select r.id, r.key, r.name, r.description, r.rank, r.scope_type, r.is_system, r.status,
      (select count(distinct a.user_id)::int from public.admin_role_assignments a
        where a.role_id = r.id and a.is_active),
      coalesce((select array_agg(rp.permission_key order by rp.permission_key)
        from public.admin_role_permissions rp where rp.role_id = r.id), '{}'),
      coalesce((select array_agg(rp.permission_key order by rp.permission_key)
        from public.admin_role_permissions rp where rp.role_id = r.id and rp.is_locked), '{}'),
      r.created_at, r.updated_at
    from public.admin_roles r
    order by r.status, r.rank desc, r.name;
end;
$$;

-- The Admin Staff roster. Email comes from the person's verified email contact
-- (never the raw auth identifier); last_sign_in_at is Supabase Auth's own
-- record of the last successful sign-in — a real fact, not an invented one.
create or replace function public.admin_rbac_staff()
returns table (
  user_id uuid, display_name text, email text, account_status public.user_status,
  is_active boolean, first_assigned_at timestamptz, last_sign_in_at timestamptz,
  assignments jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.admin_require('admin_staff.read');
  return query
    select s.user_id,
      coalesce(pr.display_name, ''),
      (select c.value from public.contacts c
        where c.user_id = s.user_id and c.channel = 'email' and c.is_verified
        order by c.is_primary desc, c.created_at limit 1),
      u.status,
      bool_or(a.is_active),
      min(a.created_at),
      au.last_sign_in_at,
      jsonb_agg(jsonb_build_object(
        'id', a.id, 'role_id', r.id, 'role_key', r.key, 'role_name', r.name,
        'is_system', r.is_system, 'rank', r.rank, 'role_status', r.status,
        'scope_type', a.scope_type,
        'scope_organization_id', a.scope_organization_id,
        'scope_organization_name', o.name,
        'scope_branch_id', a.scope_branch_id,
        'scope_user_id', a.scope_user_id,
        'is_active', a.is_active, 'created_at', a.created_at,
        'deactivated_at', a.deactivated_at, 'deactivation_kind', a.deactivation_kind)
        order by a.is_active desc, r.rank desc)
    from (select distinct a0.user_id from public.admin_role_assignments a0) s
    join public.users u on u.id = s.user_id
    join public.admin_role_assignments a on a.user_id = s.user_id
    join public.admin_roles r on r.id = a.role_id
    left join public.organizations o on o.id = a.scope_organization_id
    left join public.profiles pr on pr.user_id = s.user_id
    left join auth.users au on au.id = s.user_id
    group by s.user_id, pr.display_name, u.status, au.last_sign_in_at
    order by bool_or(a.is_active) desc, min(a.created_at);
end;
$$;

-- Authority context of the caller, shared by every mutation below.
create or replace function app.admin_actor()
returns table (user_id uuid, rank int, permissions text[], is_super boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()),
         app.admin_rank_of((select auth.uid())),
         app.admin_permissions_of((select auth.uid())),
         app.admin_rank_of((select auth.uid())) >= 100;
$$;

-- A role the actor may hand out / edit: strictly below the actor's rank (a
-- Super Admin may also act on Super Admin), and every permission it carries is
-- one the actor holds — so no role edit or assignment can ever escalate.
create or replace function app.admin_can_wield_role(p_role_id uuid, p_actor_rank int, p_actor_perms text[], p_actor_super boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_roles r
    where r.id = p_role_id
      and (r.rank < p_actor_rank or p_actor_super)
      and not exists (
        select 1 from public.admin_role_permissions rp
        where rp.role_id = r.id and not (rp.permission_key = any(p_actor_perms))));
$$;

create or replace function app.admin_clean_reason(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(coalesce(p_reason, '')), 500), '');
$$;

-- Validates a permission set for a role edit; returns the de-duplicated array.
create or replace function app.admin_validate_permission_set(p_permissions text[], p_actor_perms text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_set text[] := coalesce((select array_agg(distinct x order by x) from unnest(p_permissions) x where x is not null), '{}');
  v_bad text;
begin
  select x into v_bad from unnest(v_set) x
  where not exists (select 1 from public.admin_permissions p where p.key = x and p.is_active) limit 1;
  if v_bad is not null then
    raise exception 'unknown permission %', v_bad using errcode = '22023';
  end if;
  select x into v_bad from unnest(v_set) x where not (x = any(p_actor_perms)) limit 1;
  if v_bad is not null then
    raise exception 'cannot grant permission % you do not hold', v_bad using errcode = '42501';
  end if;
  return v_set;
end;
$$;

create or replace function public.admin_role_create(
  p_name        text,
  p_description text,
  p_rank        int,
  p_scope_type  public.admin_scope_type,
  p_permissions text[],
  p_reason      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a      record;
  v_set  text[];
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_key  text;
  v_n    int := 1;
  v_id   uuid;
begin
  perform app.admin_require('roles.manage');
  select * into a from app.admin_actor();
  if v_name = '' then
    raise exception 'a role name is required' using errcode = '22023';
  end if;
  if p_rank is null or p_rank < 1 or p_rank >= a.rank or p_rank >= 100 then
    raise exception 'role rank must be below your own rank (%)', a.rank using errcode = '42501';
  end if;
  if p_scope_type is null or p_scope_type = 'department' then
    raise exception 'unsupported role scope' using errcode = '22023';
  end if;
  v_set := app.admin_validate_permission_set(p_permissions, a.permissions);

  v_base := left(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 40);
  if v_base !~ '^[a-z]' then v_base := 'role_' || v_base; end if;
  v_base := trim(both '_' from v_base);
  if char_length(v_base) < 2 then v_base := 'custom_role'; end if;
  v_key := v_base;
  while exists (select 1 from public.admin_roles r where r.key = v_key) loop
    v_n := v_n + 1;
    v_key := v_base || '_' || v_n;
  end loop;

  insert into public.admin_roles (key, name, description, rank, scope_type, is_system, created_by, updated_by)
  values (v_key, v_name, btrim(coalesce(p_description, '')), p_rank, p_scope_type, false, a.user_id, a.user_id)
  returning id into v_id;

  insert into public.admin_role_permissions (role_id, permission_key, granted_by)
  select v_id, x, a.user_id from unnest(v_set) x;

  perform app.record_audit_event('admin_role.created', 'admin_role', v_id, null,
    jsonb_build_object('role_key', v_key, 'name', v_name, 'rank', p_rank,
                       'scope_type', p_scope_type, 'permissions', to_jsonb(v_set),
                       'reason', app.admin_clean_reason(p_reason)));
  return v_id;
exception
  when unique_violation then
    raise exception 'a role with this name already exists' using errcode = '23505';
end;
$$;

create or replace function public.admin_role_update(
  p_role_id     uuid,
  p_name        text,
  p_description text,
  p_rank        int,
  p_permissions text[],
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  r        public.admin_roles%rowtype;
  v_old    text[];
  v_locked text[];
  v_set    text[];
  v_added  text[];
  v_removed text[];
  v_name   text := btrim(coalesce(p_name, ''));
  v_desc   text := btrim(coalesce(p_description, ''));
begin
  perform app.admin_require('roles.manage');
  select * into a from app.admin_actor();
  select * into r from public.admin_roles where id = p_role_id for update;
  if not found then
    raise exception 'role not found' using errcode = '42501';
  end if;
  if r.key = 'super_admin' then
    raise exception 'the Super Admin role is locked' using errcode = '42501';
  end if;
  if r.rank >= a.rank then
    raise exception 'you can only edit roles below your own rank' using errcode = '42501';
  end if;
  if r.is_system and (v_name <> r.name or v_desc <> r.description or p_rank <> r.rank) then
    raise exception 'system role identity is immutable' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'a role name is required' using errcode = '22023';
  end if;
  if p_rank is null or p_rank < 1 or p_rank >= a.rank then
    raise exception 'role rank must be below your own rank (%)', a.rank using errcode = '42501';
  end if;

  select coalesce(array_agg(rp.permission_key order by rp.permission_key), '{}'),
         coalesce(array_agg(rp.permission_key order by rp.permission_key) filter (where rp.is_locked), '{}')
    into v_old, v_locked
  from public.admin_role_permissions rp where rp.role_id = r.id;

  v_set := coalesce((select array_agg(distinct x order by x) from unnest(p_permissions) x where x is not null), '{}');
  if exists (select 1 from unnest(v_locked) x where not (x = any(v_set))) then
    raise exception 'core permissions of a system role cannot be removed' using errcode = '42501';
  end if;
  v_added   := coalesce((select array_agg(x order by x) from unnest(v_set) x where not (x = any(v_old))), '{}');
  v_removed := coalesce((select array_agg(x order by x) from unnest(v_old) x where not (x = any(v_set))), '{}');
  -- Every CHANGED permission must be one the actor holds (validates existence too).
  perform app.admin_validate_permission_set(v_added || v_removed, a.permissions);

  if v_name <> r.name or v_desc <> r.description or p_rank <> r.rank then
    update public.admin_roles
    set name = v_name, description = v_desc, rank = p_rank, updated_by = a.user_id, updated_at = now()
    where id = r.id;
    perform app.record_audit_event('admin_role.updated', 'admin_role', r.id, null,
      jsonb_build_object('role_key', r.key,
        'before', jsonb_build_object('name', r.name, 'description', r.description, 'rank', r.rank),
        'after',  jsonb_build_object('name', v_name, 'description', v_desc, 'rank', p_rank),
        'reason', app.admin_clean_reason(p_reason)));
  end if;

  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    delete from public.admin_role_permissions
    where role_id = r.id and permission_key = any(v_removed);
    insert into public.admin_role_permissions (role_id, permission_key, granted_by)
    select r.id, x, a.user_id from unnest(v_added) x;
    update public.admin_roles set updated_by = a.user_id, updated_at = now() where id = r.id;
    perform app.record_audit_event('admin_role.permissions_changed', 'admin_role', r.id, null,
      jsonb_build_object('role_key', r.key, 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed),
                         'reason', app.admin_clean_reason(p_reason)));
  end if;
exception
  when unique_violation then
    raise exception 'a role with this name already exists' using errcode = '23505';
end;
$$;

create or replace function public.admin_role_set_archived(
  p_role_id  uuid,
  p_archived boolean,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  r public.admin_roles%rowtype;
  v_holders int;
begin
  perform app.admin_require('roles.manage');
  select * into a from app.admin_actor();
  select * into r from public.admin_roles where id = p_role_id for update;
  if not found then
    raise exception 'role not found' using errcode = '42501';
  end if;
  if r.is_system then
    raise exception 'system roles cannot be archived' using errcode = '42501';
  end if;
  if r.rank >= a.rank then
    raise exception 'you can only archive roles below your own rank' using errcode = '42501';
  end if;
  if (r.status = 'archived') = p_archived then
    return;
  end if;
  select count(distinct user_id)::int into v_holders
  from public.admin_role_assignments where role_id = r.id and is_active;

  update public.admin_roles
  set status = case when p_archived then 'archived'::public.admin_role_status else 'active'::public.admin_role_status end,
      archived_at = case when p_archived then now() end,
      updated_by = a.user_id, updated_at = now()
  where id = r.id;

  perform app.record_audit_event(
    case when p_archived then 'admin_role.archived' else 'admin_role.restored' end,
    'admin_role', r.id, null,
    jsonb_build_object('role_key', r.key, 'active_holders', v_holders,
                       'reason', app.admin_clean_reason(p_reason)));
end;
$$;

-- Target-side authority: the actor may manage a staff member only if that
-- member's current platform rank is below the actor's (Super Admins may manage
-- anyone except themselves). Nobody manages their own assignments.
create or replace function app.admin_require_manageable_target(p_target uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a record;
begin
  select * into a from app.admin_actor();
  if p_target = a.user_id then
    raise exception 'you cannot change your own Admin roles' using errcode = '42501';
  end if;
  if not exists (select 1 from public.admin_role_assignments x where x.user_id = p_target) then
    -- Onboarding a brand-new staff member is the Invitation sub-phase; only
    -- existing Admin Staff are eligible here.
    raise exception 'target is not an existing Admin Staff member' using errcode = '42501';
  end if;
  if app.admin_rank_of(p_target) >= a.rank and not a.is_super then
    raise exception 'you can only manage staff below your own rank' using errcode = '42501';
  end if;
end;
$$;

-- Resolves (scope_type, scope_id) into the assignment's scope columns.
create or replace function app.admin_resolve_scope(p_scope_type public.admin_scope_type, p_scope_id uuid,
  out o_org uuid, out o_branch uuid, out o_user uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  case p_scope_type
    when 'platform' then
      if p_scope_id is not null then
        raise exception 'platform scope takes no scope id' using errcode = '22023';
      end if;
    when 'organization' then
      select o.id into o_org from public.organizations o where o.id = p_scope_id and o.deleted_at is null;
      if o_org is null then raise exception 'scope organization not found' using errcode = '22023'; end if;
    when 'branch' then
      select b.id, b.organization_id into o_branch, o_org from public.branches b
      where b.id = p_scope_id and b.deleted_at is null;
      if o_branch is null then raise exception 'scope branch not found' using errcode = '22023'; end if;
    when 'user' then
      select u.id into o_user from public.users u where u.id = p_scope_id;
      if o_user is null then raise exception 'scope user not found' using errcode = '22023'; end if;
    else
      raise exception 'unsupported assignment scope' using errcode = '22023';
  end case;
end;
$$;

create or replace function public.admin_staff_assign_role(
  p_user_id    uuid,
  p_role_id    uuid,
  p_scope_type public.admin_scope_type default 'platform',
  p_scope_id   uuid default null,
  p_reason     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a   record;
  r   public.admin_roles%rowtype;
  s   record;
  v_id uuid;
begin
  perform app.admin_require('admin_staff.manage');
  select * into a from app.admin_actor();
  perform app.admin_require_manageable_target(p_user_id);
  select * into r from public.admin_roles where id = p_role_id;
  if not found or r.status <> 'active' then
    raise exception 'role is not assignable' using errcode = '42501';
  end if;
  if not app.admin_can_wield_role(r.id, a.rank, a.permissions, a.is_super) then
    raise exception 'you cannot assign a role at or above your own authority' using errcode = '42501';
  end if;
  if r.scope_type <> coalesce(p_scope_type, 'platform') then
    raise exception 'assignment scope must match the role scope (%)', r.scope_type using errcode = '22023';
  end if;
  select * into s from app.admin_resolve_scope(r.scope_type, p_scope_id);

  insert into public.admin_role_assignments (user_id, role_id, scope_type,
    scope_organization_id, scope_branch_id, scope_user_id, assigned_by)
  values (p_user_id, r.id, r.scope_type, s.o_org, s.o_branch, s.o_user, a.user_id)
  returning id into v_id;

  perform app.record_audit_event('admin_role.assigned', 'admin_role_assignment', v_id, s.o_org,
    jsonb_build_object('target_user_id', p_user_id, 'role_key', r.key, 'scope_type', r.scope_type,
                       'scope_id', p_scope_id, 'reason', app.admin_clean_reason(p_reason)));
  return v_id;
exception
  when unique_violation then
    raise exception 'this role is already assigned at this scope' using errcode = '23505';
end;
$$;

-- "Change role": replace the target's active PLATFORM assignment(s) with one
-- assignment of a platform role, atomically.
create or replace function public.admin_staff_change_role(
  p_user_id uuid,
  p_role_id uuid,
  p_reason  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a      record;
  r      public.admin_roles%rowtype;
  v_from jsonb;
  v_id   uuid;
begin
  perform app.admin_require('admin_staff.manage');
  select * into a from app.admin_actor();
  perform app.admin_require_manageable_target(p_user_id);
  select * into r from public.admin_roles where id = p_role_id;
  if not found or r.status <> 'active' or r.scope_type <> 'platform' then
    raise exception 'role is not assignable' using errcode = '42501';
  end if;
  if not app.admin_can_wield_role(r.id, a.rank, a.permissions, a.is_super) then
    raise exception 'you cannot assign a role at or above your own authority' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.admin_role_assignments x
    where x.user_id = p_user_id and x.is_active and x.scope_type = 'platform' and x.role_id <> r.id
      and not app.admin_can_wield_role(x.role_id, a.rank, a.permissions, a.is_super)) then
    raise exception 'the current role is above your authority' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(ro.key order by ro.rank desc), '[]') into v_from
  from public.admin_role_assignments x join public.admin_roles ro on ro.id = x.role_id
  where x.user_id = p_user_id and x.is_active and x.scope_type = 'platform';

  update public.admin_role_assignments
  set is_active = false, deactivated_at = now(), deactivated_by = a.user_id, deactivation_kind = 'role_changed'
  where user_id = p_user_id and is_active and scope_type = 'platform' and role_id <> r.id;

  select x.id into v_id from public.admin_role_assignments x
  where x.user_id = p_user_id and x.is_active and x.role_id = r.id and x.scope_type = 'platform';
  if v_id is null then
    insert into public.admin_role_assignments (user_id, role_id, scope_type, assigned_by)
    values (p_user_id, r.id, 'platform', a.user_id)
    returning id into v_id;
  end if;

  perform app.record_audit_event('admin_role.assignment_changed', 'admin_role_assignment', v_id, null,
    jsonb_build_object('target_user_id', p_user_id, 'before', jsonb_build_object('roles', v_from),
                       'after', jsonb_build_object('roles', jsonb_build_array(r.key)),
                       'reason', app.admin_clean_reason(p_reason)));
  return v_id;
end;
$$;

-- Move a scoped (non-platform) assignment to another scope target of the same
-- type. Changing scope TYPE means a different role, so it is a role change.
create or replace function public.admin_assignment_change_scope(
  p_assignment_id uuid,
  p_scope_id      uuid,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  x public.admin_role_assignments%rowtype;
  s record;
begin
  perform app.admin_require('admin_staff.manage');
  select * into a from app.admin_actor();
  select * into x from public.admin_role_assignments where id = p_assignment_id for update;
  if not found or not x.is_active then
    raise exception 'assignment not found' using errcode = '42501';
  end if;
  perform app.admin_require_manageable_target(x.user_id);
  if not app.admin_can_wield_role(x.role_id, a.rank, a.permissions, a.is_super) then
    raise exception 'you cannot manage a role at or above your own authority' using errcode = '42501';
  end if;
  if x.scope_type = 'platform' then
    raise exception 'a platform assignment has no scope to change' using errcode = '22023';
  end if;
  select * into s from app.admin_resolve_scope(x.scope_type, p_scope_id);

  update public.admin_role_assignments
  set scope_organization_id = s.o_org, scope_branch_id = s.o_branch, scope_user_id = s.o_user
  where id = x.id;

  perform app.record_audit_event('admin_role.assignment_changed', 'admin_role_assignment', x.id, s.o_org,
    jsonb_build_object('target_user_id', x.user_id, 'scope_type', x.scope_type,
      'before', jsonb_build_object('organization_id', x.scope_organization_id, 'branch_id', x.scope_branch_id, 'user_id', x.scope_user_id),
      'after',  jsonb_build_object('organization_id', s.o_org, 'branch_id', s.o_branch, 'user_id', s.o_user),
      'reason', app.admin_clean_reason(p_reason)));
exception
  when unique_violation then
    raise exception 'this role is already assigned at this scope' using errcode = '23505';
end;
$$;

create or replace function public.admin_staff_unassign(
  p_assignment_id uuid,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  x public.admin_role_assignments%rowtype;
  v_role_key text;
begin
  perform app.admin_require('admin_staff.manage');
  select * into a from app.admin_actor();
  select * into x from public.admin_role_assignments where id = p_assignment_id for update;
  if not found or not x.is_active then
    raise exception 'assignment not found' using errcode = '42501';
  end if;
  perform app.admin_require_manageable_target(x.user_id);
  if not app.admin_can_wield_role(x.role_id, a.rank, a.permissions, a.is_super) then
    raise exception 'you cannot manage a role at or above your own authority' using errcode = '42501';
  end if;
  select r.key into v_role_key from public.admin_roles r where r.id = x.role_id;

  update public.admin_role_assignments
  set is_active = false, deactivated_at = now(), deactivated_by = a.user_id, deactivation_kind = 'unassigned'
  where id = x.id;

  perform app.record_audit_event('admin_role.unassigned', 'admin_role_assignment', x.id, x.scope_organization_id,
    jsonb_build_object('target_user_id', x.user_id, 'role_key', v_role_key, 'scope_type', x.scope_type,
                       'reason', app.admin_clean_reason(p_reason)));
end;
$$;

-- Disable = deactivate every active assignment (kept for restore); restore =
-- reactivate exactly those. A reason is required for disabling.
create or replace function public.admin_staff_set_disabled(
  p_user_id  uuid,
  p_disabled boolean,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  v_roles jsonb;
begin
  perform app.admin_require('admin_staff.manage');
  select * into a from app.admin_actor();
  perform app.admin_require_manageable_target(p_user_id);

  if p_disabled then
    if app.admin_clean_reason(p_reason) is null then
      raise exception 'a reason is required' using errcode = '22023';
    end if;
    if exists (select 1 from public.admin_role_assignments x
               where x.user_id = p_user_id and x.is_active
                 and not app.admin_can_wield_role(x.role_id, a.rank, a.permissions, a.is_super)) then
      raise exception 'you cannot manage a role at or above your own authority' using errcode = '42501';
    end if;
    select coalesce(jsonb_agg(r.key), '[]') into v_roles
    from public.admin_role_assignments x join public.admin_roles r on r.id = x.role_id
    where x.user_id = p_user_id and x.is_active;
    if v_roles = '[]'::jsonb then
      raise exception 'staff member is already disabled' using errcode = '22023';
    end if;
    update public.admin_role_assignments
    set is_active = false, deactivated_at = now(), deactivated_by = a.user_id, deactivation_kind = 'staff_disabled'
    where user_id = p_user_id and is_active;
    perform app.record_audit_event('admin_staff.disabled', 'user', p_user_id, null,
      jsonb_build_object('roles', v_roles, 'reason', app.admin_clean_reason(p_reason)));
  else
    if exists (select 1 from public.admin_role_assignments x
               where x.user_id = p_user_id and not x.is_active and x.deactivation_kind = 'staff_disabled'
                 and not app.admin_can_wield_role(x.role_id, a.rank, a.permissions, a.is_super)) then
      raise exception 'you cannot restore a role at or above your own authority' using errcode = '42501';
    end if;
    -- Reactivate the disabled set, skipping any the member has since regained
    -- (the partial unique index would otherwise reject them).
    with restorable as (
      select x.id from public.admin_role_assignments x
      join public.admin_roles r on r.id = x.role_id
      where x.user_id = p_user_id and not x.is_active and x.deactivation_kind = 'staff_disabled'
        and r.status = 'active'
        and not exists (
          select 1 from public.admin_role_assignments y
          where y.user_id = x.user_id and y.role_id = x.role_id and y.is_active and y.scope_type = x.scope_type
            and y.scope_organization_id is not distinct from x.scope_organization_id
            and y.scope_branch_id is not distinct from x.scope_branch_id
            and y.scope_user_id is not distinct from x.scope_user_id)
    )
    update public.admin_role_assignments x
    set is_active = true, deactivated_at = null, deactivated_by = null, deactivation_kind = null
    from restorable where x.id = restorable.id;
    if not found then
      raise exception 'nothing to restore' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(r.key), '[]') into v_roles
    from public.admin_role_assignments x join public.admin_roles r on r.id = x.role_id
    where x.user_id = p_user_id and x.is_active;
    perform app.record_audit_event('admin_staff.restored', 'user', p_user_id, null,
      jsonb_build_object('roles', v_roles, 'reason', app.admin_clean_reason(p_reason)));
  end if;
end;
$$;

-- DBA/migration-ONLY bootstrap of the first Super Admin. Not callable by any
-- application role (no grant). Refuses once any active Super Admin exists —
-- after that, Super Admins are managed through admin_staff_* by a Super Admin.
create or replace function app.admin_bootstrap_super_admin(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role uuid;
  v_id   uuid;
begin
  select id into v_role from public.admin_roles where key = 'super_admin';
  if exists (select 1 from public.admin_role_assignments where role_id = v_role and is_active) then
    raise exception 'an active Super Admin already exists; use the Admin Staff workflow' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users where id = p_user_id and status = 'active') then
    raise exception 'bootstrap target must be an active user' using errcode = '22023';
  end if;
  insert into public.admin_role_assignments (user_id, role_id, scope_type)
  values (p_user_id, v_role, 'platform')
  returning id into v_id;
  perform app.record_audit_event('admin_role.assigned', 'admin_role_assignment', v_id, null,
    jsonb_build_object('target_user_id', p_user_id, 'role_key', 'super_admin',
                       'scope_type', 'platform', 'source', 'dba_bootstrap'));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. RLS + grants (deny by default; RPC-only access)
-- ---------------------------------------------------------------------------
alter table public.admin_permissions       enable row level security;
alter table public.admin_roles             enable row level security;
alter table public.admin_role_permissions  enable row level security;
alter table public.admin_role_assignments  enable row level security;
-- No policies: nothing but the security-definer RPCs above can read or write
-- these tables, and there is NO direct DML grant to any application role.
revoke all on public.admin_permissions, public.admin_roles,
  public.admin_role_permissions, public.admin_role_assignments
  from public, anon, authenticated, service_role;

-- Internal helpers: never executable by clients.
revoke all on function
  app.admin_rank_of(uuid), app.admin_permissions_of(uuid), app.admin_legacy_tier(int),
  app.admin_role_permissions_guard(), app.admin_roles_guard(),
  app.admin_role_assignments_shape_guard(), app.admin_last_super_admin_guard(),
  app.mirror_platform_role_grant(), app.platform_role_grants_bridge_guard(),
  app.admin_backfill_legacy_grants(), app.admin_actor(),
  app.admin_can_wield_role(uuid, int, text[], boolean), app.admin_clean_reason(text),
  app.admin_validate_permission_set(text[], text[]),
  app.admin_require_manageable_target(uuid),
  app.admin_resolve_scope(public.admin_scope_type, uuid),
  app.admin_require(text), app.admin_bootstrap_super_admin(uuid)
  from public, anon, authenticated, service_role;

-- Checks used by RLS policies and RPC guards run as the calling user.
revoke all on function app.has_admin_permission(text, uuid, uuid, uuid) from public, anon, service_role;
revoke all on function app.is_admin_staff() from public, anon, service_role;
revoke all on function app.can_review_verification(uuid) from public, anon, service_role;
grant execute on function app.has_admin_permission(text, uuid, uuid, uuid) to authenticated;
grant execute on function app.is_admin_staff() to authenticated;
grant execute on function app.can_review_verification(uuid) to authenticated;

-- Public RPC surface: authenticated only; each enforces its own permission.
revoke all on function
  public.admin_my_access(), public.admin_rbac_permissions(), public.admin_rbac_roles(),
  public.admin_rbac_staff(),
  public.admin_role_create(text, text, int, public.admin_scope_type, text[], text),
  public.admin_role_update(uuid, text, text, int, text[], text),
  public.admin_role_set_archived(uuid, boolean, text),
  public.admin_staff_assign_role(uuid, uuid, public.admin_scope_type, uuid, text),
  public.admin_staff_change_role(uuid, uuid, text),
  public.admin_assignment_change_scope(uuid, uuid, text),
  public.admin_staff_unassign(uuid, text),
  public.admin_staff_set_disabled(uuid, boolean, text)
  from public, anon, service_role;
grant execute on function
  public.admin_my_access(), public.admin_rbac_permissions(), public.admin_rbac_roles(),
  public.admin_rbac_staff(),
  public.admin_role_create(text, text, int, public.admin_scope_type, text[], text),
  public.admin_role_update(uuid, text, text, int, text[], text),
  public.admin_role_set_archived(uuid, boolean, text),
  public.admin_staff_assign_role(uuid, uuid, public.admin_scope_type, uuid, text),
  public.admin_staff_change_role(uuid, uuid, text),
  public.admin_assignment_change_scope(uuid, uuid, text),
  public.admin_staff_unassign(uuid, text),
  public.admin_staff_set_disabled(uuid, boolean, text)
  to authenticated;
