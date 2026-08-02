-- Migration: organizations & tenancy (Phase 1 — Identity & Multi-Tenancy, Sprint 1).
--
-- Creates the tenant boundary (`organizations`, `branches`), the canonical
-- user<->org relationship (`memberships`), capability grants, branch access, and
-- the platform-role boundary. Adds the `app` tenancy helpers that every future
-- feature migration's RLS policies rely on, then applies RLS to these tables.
--
-- Design: ADR-0007, docs/database/phase1-identity-tenancy-review.md, 06_rls_strategy.md.

-- ---------------------------------------------------------------------------
-- 1. Enum types (tenancy subset)
-- ---------------------------------------------------------------------------
create type public.org_status as enum ('draft', 'pending_verification', 'active', 'suspended', 'archived');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'revoked');

-- ---------------------------------------------------------------------------
-- 2. organizations — the tenant
-- ---------------------------------------------------------------------------
create table public.organizations (
  id            uuid primary key default extensions.gen_random_uuid(),
  name          text not null,
  slug          text,
  org_type      public.account_type not null,
  status        public.org_status   not null default 'draft',
  is_verified   boolean not null default false,
  primary_locale text  not null default 'en',
  locality_id   uuid,   -- FK to localities added by the locality migration (later phase)
  logo_media_id uuid,   -- FK to media added by the media migration (later phase)
  created_by    uuid not null references public.users (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint ck_organizations_name_len check (char_length(name) between 2 and 120),
  constraint ck_organizations_type_not_consumer check (org_type <> 'end_consumer'),
  constraint ck_organizations_locale check (primary_locale in ('en', 'ar'))
);
comment on table public.organizations is 'The tenant. Every org-owned row carries organization_id and is isolated by RLS. An end-consumer identity is not an org (ck_organizations_type_not_consumer).';

create unique index uq_organizations_slug on public.organizations (slug) where slug is not null;
create index ix_organizations_status on public.organizations (status);
create index ix_organizations_created_by on public.organizations (created_by);
create index ix_organizations_name_trgm on public.organizations using gin (name extensions.gin_trgm_ops);

create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. branches — operational sub-units of an organization
-- ---------------------------------------------------------------------------
create table public.branches (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  locality_id     uuid,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint ck_branches_name_len check (char_length(name) between 1 and 120)
);
comment on table public.branches is 'A branch belongs to exactly one organization (its tenant boundary). Branch-scoped rows carry branch_id.';

create index ix_branches_organization_id on public.branches (organization_id);

create trigger set_branches_updated_at
  before update on public.branches
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. memberships — canonical user<->organization relationship
-- ---------------------------------------------------------------------------
create table public.memberships (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id       uuid references public.branches (id) on delete set null,  -- optional home branch
  status          public.membership_status not null default 'invited',
  invited_by      uuid references public.users (id) on delete set null,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_memberships_user_org unique (user_id, organization_id)
);
comment on table public.memberships is 'The canonical link between one identity and one organization. Never forks the identity. uq prevents duplicate active membership. Tenant access derives from active memberships, not from a role on the user profile.';

create index ix_memberships_org on public.memberships (organization_id);
create index ix_memberships_user on public.memberships (user_id);
create index ix_memberships_branch on public.memberships (branch_id);

create trigger set_memberships_updated_at
  before update on public.memberships
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. membership_capabilities — granular grants (fixed catalog, 07_permissions_matrix.md)
-- ---------------------------------------------------------------------------
create table public.membership_capabilities (
  id             uuid primary key default extensions.gen_random_uuid(),
  membership_id  uuid not null references public.memberships (id) on delete cascade,
  capability_key text not null,
  created_at     timestamptz not null default now(),
  constraint uq_membership_capability unique (membership_id, capability_key),
  constraint ck_membership_capability_key check (capability_key in (
    'org.manage', 'org.members.manage', 'branch.manage',
    'verification.submit', 'verification.read',
    'catalog.read', 'catalog.write', 'catalog.publish',
    'inventory.write',
    'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
    'sales.task.write', 'sales.followup.send',
    'rfq.create', 'rfq.respond',
    'quote.submit', 'quote.decide',
    'project.read', 'project.write',
    'conversation.participate',
    'ad.manage',
    'subscription.read', 'subscription.manage',
    'analytics.view',
    'export.data'
  ))
);
comment on table public.membership_capabilities is 'Capability grants scoped to a membership. Keys come from the fixed catalog (07_permissions_matrix.md). Org-wide vs branch-limited access derives from these + branch assignment, never from a global role on the profile.';

create index ix_membership_capabilities_membership on public.membership_capabilities (membership_id);

-- ---------------------------------------------------------------------------
-- 6. membership_branch_access — explicit multi-branch assignment (ADR-0007 D2)
-- ---------------------------------------------------------------------------
create table public.membership_branch_access (
  id            uuid primary key default extensions.gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint uq_membership_branch_access unique (membership_id, branch_id)
);
comment on table public.membership_branch_access is 'Explicit branch assignments for branch-limited members. Org-wide members (org.manage/branch.manage) see all branches and need no rows here.';

create index ix_membership_branch_access_membership on public.membership_branch_access (membership_id);
create index ix_membership_branch_access_branch on public.membership_branch_access (branch_id);

-- ---------------------------------------------------------------------------
-- 7. platform_role_grants — the platform-admin boundary (ADR-0007 D4)
-- ---------------------------------------------------------------------------
create table public.platform_role_grants (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  role       public.platform_role not null,
  granted_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint uq_platform_role unique (user_id, role)
);
comment on table public.platform_role_grants is 'Platform governance authority (support/moderator/administrator). NOT a profile field and NOT an org capability. No ordinary-user write path; provisioned server-side/DBA for the pilot and audited.';

create index ix_platform_role_grants_user on public.platform_role_grants (user_id);

-- ===========================================================================
-- 8. Tenancy helper functions (the RLS choke point — ADR-0007 D1)
--    All are `stable security definer` with a pinned empty search_path so a
--    policy on `memberships` can call them without RLS recursion.
-- ===========================================================================

-- Org ids where the caller has an ACTIVE membership.
create or replace function app.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

-- True if the caller has an active membership in the org.
create or replace function app.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.organization_id = p_org_id
      and m.status = 'active'
  );
$$;

-- True if the caller's active membership in the org holds the capability.
create or replace function app.has_capability(p_org_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.membership_capabilities c on c.membership_id = m.id
    where m.user_id = (select auth.uid())
      and m.organization_id = p_org_id
      and m.status = 'active'
      and c.capability_key = p_key
  );
$$;

-- Branch ids the caller can access within an org. Org-wide members
-- (org.manage/branch.manage) see every branch; others see assigned + home branch.
create or replace function app.current_branch_ids(p_org_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Org-wide: all branches of the org.
  select b.id
  from public.branches b
  where b.organization_id = p_org_id
    and (
      app.has_capability(p_org_id, 'org.manage')
      or app.has_capability(p_org_id, 'branch.manage')
    )
  union
  -- Branch-limited: explicitly assigned branches.
  select mba.branch_id
  from public.memberships m
  join public.membership_branch_access mba on mba.membership_id = m.id
  join public.branches b on b.id = mba.branch_id
  where m.user_id = (select auth.uid())
    and m.organization_id = p_org_id
    and m.status = 'active'
    and b.organization_id = p_org_id
  union
  -- Home branch on the membership, if set.
  select m.branch_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.organization_id = p_org_id
    and m.status = 'active'
    and m.branch_id is not null;
$$;

-- True if the caller holds the given platform role (or a higher one).
-- administrator implies moderator/support authority for read gating.
create or replace function app.is_platform(p_role public.platform_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_role_grants g
    where g.user_id = (select auth.uid())
      and (
        g.role = p_role
        or g.role = 'administrator'
        or (p_role = 'support' and g.role = 'moderator')
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 9. RLS enable
-- ---------------------------------------------------------------------------
alter table public.organizations           enable row level security;
alter table public.branches                enable row level security;
alter table public.memberships             enable row level security;
alter table public.membership_capabilities enable row level security;
alter table public.membership_branch_access enable row level security;
alter table public.platform_role_grants    enable row level security;

-- organizations -------------------------------------------------------------
-- Members see their org; platform admins read cross-tenant; the public sees
-- active+verified orgs (B2C discovery).
create policy organizations_select_member on public.organizations
  for select to authenticated
  using (deleted_at is null and app.is_org_member(id));

create policy organizations_select_public on public.organizations
  for select to anon, authenticated
  using (deleted_at is null and status = 'active' and is_verified);

create policy organizations_select_platform on public.organizations
  for select to authenticated
  using (app.is_platform('support'));

-- Any authenticated user may create an org; they must be the recorded creator.
-- (Per-user creation caps are an anti-abuse concern for the write path — deferred.)
create policy organizations_insert_creator on public.organizations
  for insert to authenticated
  with check (created_by = (select auth.uid()));

-- Update requires org.manage in that org.
create policy organizations_update_manager on public.organizations
  for update to authenticated
  using (deleted_at is null and app.has_capability(id, 'org.manage'))
  with check (app.has_capability(id, 'org.manage'));

-- branches ------------------------------------------------------------------
create policy branches_select_member on public.branches
  for select to authenticated
  using (
    deleted_at is null
    and app.is_org_member(organization_id)
    and (
      app.has_capability(organization_id, 'org.manage')
      or app.has_capability(organization_id, 'branch.manage')
      or id in (select app.current_branch_ids(organization_id))
    )
  );

create policy branches_select_platform on public.branches
  for select to authenticated
  using (app.is_platform('support'));

create policy branches_write_manager on public.branches
  for insert to authenticated
  with check (app.has_capability(organization_id, 'branch.manage'));

create policy branches_update_manager on public.branches
  for update to authenticated
  using (deleted_at is null and app.has_capability(organization_id, 'branch.manage'))
  with check (app.has_capability(organization_id, 'branch.manage'));

-- memberships ---------------------------------------------------------------
-- A user always sees their own membership rows; org member-managers see all
-- rows in their org; platform admins read cross-tenant.
create policy memberships_select_self on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy memberships_select_org_manager on public.memberships
  for select to authenticated
  using (app.has_capability(organization_id, 'org.members.manage'));

create policy memberships_select_platform on public.memberships
  for select to authenticated
  using (app.is_platform('support'));

create policy memberships_insert_manager on public.memberships
  for insert to authenticated
  with check (app.has_capability(organization_id, 'org.members.manage'));

create policy memberships_update_manager on public.memberships
  for update to authenticated
  using (app.has_capability(organization_id, 'org.members.manage'))
  with check (app.has_capability(organization_id, 'org.members.manage'));

-- membership_capabilities ---------------------------------------------------
-- Read: the owning member (their own caps) or an org member-manager. Writes:
-- member-manager only. (No-escalation — inviter can only grant caps they hold —
-- is enforced in the write path, per the review F9.)
create policy membership_caps_select_self on public.membership_capabilities
  for select to authenticated
  using (membership_id in (
    select m.id from public.memberships m where m.user_id = (select auth.uid())
  ));

create policy membership_caps_select_manager on public.membership_capabilities
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.id = membership_id
      and app.has_capability(m.organization_id, 'org.members.manage')
  ));

create policy membership_caps_insert_manager on public.membership_capabilities
  for insert to authenticated
  with check (exists (
    select 1 from public.memberships m
    where m.id = membership_id
      and app.has_capability(m.organization_id, 'org.members.manage')
  ));

create policy membership_caps_delete_manager on public.membership_capabilities
  for delete to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.id = membership_id
      and app.has_capability(m.organization_id, 'org.members.manage')
  ));

-- membership_branch_access --------------------------------------------------
create policy membership_branch_access_select_self on public.membership_branch_access
  for select to authenticated
  using (membership_id in (
    select m.id from public.memberships m where m.user_id = (select auth.uid())
  ));

create policy membership_branch_access_select_manager on public.membership_branch_access
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.id = membership_id
      and (app.has_capability(m.organization_id, 'org.members.manage')
           or app.has_capability(m.organization_id, 'branch.manage'))
  ));

create policy membership_branch_access_write_manager on public.membership_branch_access
  for insert to authenticated
  with check (exists (
    select 1 from public.memberships m
    where m.id = membership_id
      and app.has_capability(m.organization_id, 'branch.manage')
  ));

create policy membership_branch_access_delete_manager on public.membership_branch_access
  for delete to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.id = membership_id
      and app.has_capability(m.organization_id, 'branch.manage')
  ));

-- platform_role_grants ------------------------------------------------------
-- A user may read their OWN grants; administrators may read all. There is NO
-- ordinary-user write policy (ADR-0007 D4): grants are provisioned by the
-- service role / migration / DBA, which bypasses RLS. This prevents an org
-- admin from escalating to platform admin.
create policy platform_role_grants_select_self on public.platform_role_grants
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy platform_role_grants_select_admin on public.platform_role_grants
  for select to authenticated
  using (app.is_platform('administrator'));

-- users: platform cross-tenant read (defined here, now that is_platform exists).
create policy users_select_platform on public.users
  for select to authenticated
  using (app.is_platform('support'));

-- profiles: platform cross-tenant read.
create policy profiles_select_platform on public.profiles
  for select to authenticated
  using (app.is_platform('support'));

-- ---------------------------------------------------------------------------
-- 10. Grants (deny-by-default Data API)
-- ---------------------------------------------------------------------------
grant execute on function app.current_org_ids() to authenticated;
grant execute on function app.is_org_member(uuid) to authenticated;
grant execute on function app.has_capability(uuid, text) to authenticated;
grant execute on function app.current_branch_ids(uuid) to authenticated;
grant execute on function app.is_platform(public.platform_role) to authenticated;

grant select on public.organizations to anon, authenticated;
grant insert on public.organizations to authenticated;
grant update (name, slug, org_type, primary_locale, locality_id, logo_media_id, deleted_at)
  on public.organizations to authenticated;

grant select, insert on public.branches to authenticated;
grant update (name, locality_id, is_active, deleted_at) on public.branches to authenticated;

grant select, insert on public.memberships to authenticated;
grant update (branch_id, status, accepted_at) on public.memberships to authenticated;

grant select, insert, delete on public.membership_capabilities to authenticated;
grant select, insert, delete on public.membership_branch_access to authenticated;

-- platform_role_grants: read only for authenticated (writes are service-role only).
grant select on public.platform_role_grants to authenticated;
