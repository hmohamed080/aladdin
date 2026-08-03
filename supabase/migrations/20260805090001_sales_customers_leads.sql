-- Migration: B2B Sales domain — customers & leads (Phase 2 — B2B Sales Operating
-- Workflow, Sprint 3).
--
-- The first slice of the Sales beachhead (PRODUCT_DIRECTION_GUIDE: Sales is the
-- daily-active user). Adds tenant-owned `customers` and `leads` on top of the
-- validated identity/tenancy spine, reusing the existing `app` tenancy helpers,
-- capability catalog, and constrained audit writer — nothing is duplicated.
--
-- Design: ADR-0008 (sales domain), ADR-0007 (identity/tenancy), 06_rls_strategy.md.
-- Security model (same as the hardened Phase 1 write paths): base tables are
-- SELECT-only for client/service roles; every mutation goes through a
-- security-definer RPC (migration ...090003). No direct write grant exists, so
-- direct DML cannot bypass lifecycle/assignment/audit invariants.

-- ---------------------------------------------------------------------------
-- 1. Enum types (sales subset)
-- ---------------------------------------------------------------------------
create type public.customer_type   as enum ('individual', 'company');
create type public.customer_status as enum ('active', 'archived');
create type public.sales_source    as enum ('referral', 'walk_in', 'phone', 'whatsapp', 'website', 'campaign', 'other');
create type public.sales_priority  as enum ('low', 'normal', 'high', 'urgent');
create type public.lead_status     as enum ('active', 'won', 'lost', 'archived');
-- Deliberately excludes matching/quoted stages (they need the deferred Match/RFQ/
-- Quote modules). See ADR-0008 and 11_state_machines.md §4a.
create type public.lead_stage      as enum ('new', 'contacted', 'qualified', 'proposal_pending', 'decision_pending');

-- ---------------------------------------------------------------------------
-- 2. Capability catalog extension (07_permissions_matrix.md)
--    Minimal Sprint-3 sales caps. The older speculative sales.opportunity.*/
--    match.share/task.write/followup.send keys are kept (reserved for the future
--    Opportunity/Match workflow) but are NOT what this sprint enforces.
-- ---------------------------------------------------------------------------
alter table public.membership_capabilities drop constraint ck_membership_capability_key;
alter table public.membership_capabilities add constraint ck_membership_capability_key check (capability_key in (
  'org.manage', 'org.members.manage', 'branch.manage',
  'verification.submit', 'verification.read',
  'catalog.read', 'catalog.write', 'catalog.publish',
  'inventory.write',
  'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
  'sales.task.write', 'sales.followup.send',
  -- Sprint 3 (implemented): the customer/lead/activity/follow-up foundation.
  'sales.read', 'sales.write', 'sales.assign', 'sales.manage',
  'rfq.create', 'rfq.respond',
  'quote.submit', 'quote.decide',
  'project.read', 'project.write',
  'conversation.participate',
  'ad.manage',
  'subscription.read', 'subscription.manage',
  'analytics.view',
  'export.data'
));

-- ---------------------------------------------------------------------------
-- 3. Audit action allow-list extension (append the sales lifecycle events)
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
  -- Sprint 3 — sales domain.
  'customer.created', 'customer.updated',
  'lead.created', 'lead.assigned', 'lead.reassigned', 'lead.stage_changed',
  'lead.won', 'lead.lost', 'lead.reopened', 'lead.archived',
  'followup.created', 'followup.reassigned', 'followup.completed', 'followup.reopened'
));

-- ---------------------------------------------------------------------------
-- 4. Structural tenant-safety: unique (organization_id, id) on the parents so
--    child sales rows can reference them with a COMPOSITE FK. This makes
--    cross-tenant linkage impossible by construction (no trigger required):
--    a customer/lead/assignee referenced by another sales row must share the
--    row's organization_id.
-- ---------------------------------------------------------------------------
alter table public.branches    add constraint uq_branches_org_id    unique (organization_id, id);
alter table public.memberships add constraint uq_memberships_org_id unique (organization_id, id);

-- ---------------------------------------------------------------------------
-- 5. Phone normalization (documented, immutable, WhatsApp-compatible)
--    Rule: keep digits only, then produce an E.164-style "+<cc><national>":
--      - "00…"  -> "+…"                     (international access code)
--      - "0##########" (11 digits, EG local mobile) -> "+20" + national
--      - "20…"  -> "+20…"                   (already EG country code)
--      - otherwise -> "+" + digits          (assume already international)
--    Stored in a generated column for intra-org duplicate detection. This is a
--    pragmatic MVP normalizer, NOT a full libphonenumber; it is stable and
--    good enough to catch same-number duplicates within one tenant.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  with d as (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as digits)
  select case
    when d.digits = '' then null
    when left(d.digits, 2) = '00' then '+' || substr(d.digits, 3)
    when left(d.digits, 1) = '0' and length(d.digits) = 11 then '+20' || substr(d.digits, 2)
    when left(d.digits, 2) = '20' then '+' || d.digits
    else '+' || d.digits
  end
  from d;
$$;
comment on function app.normalize_phone(text) is 'Deterministic MVP phone normalizer to an E.164-style +<cc><national> string for intra-org duplicate detection (WhatsApp-compatible). Not a full libphonenumber.';
revoke execute on function app.normalize_phone(text) from public;
grant execute on function app.normalize_phone(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. customers — tenant-owned CRM customer record
-- ---------------------------------------------------------------------------
create table public.customers (
  id                     uuid primary key default extensions.gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  -- Optional branch scope. NULL = organization-wide customer. Composite FK below
  -- guarantees a non-null branch belongs to the SAME organization.
  branch_id              uuid,
  display_name           text not null,
  customer_type          public.customer_type not null default 'individual',
  -- Primary contact points live directly on the customer for the MVP (smallest
  -- model). A future multi-contact-point table can be added additively without
  -- migrating these. Normalization documented in app.normalize_phone.
  primary_phone          text,
  primary_phone_e164     text generated always as (app.normalize_phone(primary_phone)) stored,
  email                  text,
  email_normalized       text generated always as (nullif(lower(btrim(email)), '')) stored,
  preferred_language     text,
  location_summary       text,   -- short area/city summary only; never a full sensitive address
  locality_id            uuid,   -- FK to localities added in a later phase
  source                 public.sales_source,
  assigned_membership_id uuid,   -- optional owning salesperson (composite FK below)
  status                 public.customer_status not null default 'active',
  created_by             uuid not null references public.users (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  archived_at            timestamptz,
  constraint ck_customers_display_name_len check (char_length(display_name) between 1 and 160),
  constraint ck_customers_language check (preferred_language is null or preferred_language in ('en', 'ar')),
  constraint ck_customers_location_len check (location_summary is null or char_length(location_summary) <= 240),
  constraint ck_customers_email_len check (email is null or char_length(email) <= 254),
  constraint ck_customers_archive_consistency check ((status = 'archived') = (archived_at is not null)),
  -- Structural tenant safety (cross-tenant impossible by construction).
  constraint fk_customers_branch foreign key (organization_id, branch_id)
    references public.branches (organization_id, id) on delete set null,
  constraint fk_customers_assignee foreign key (organization_id, assigned_membership_id)
    references public.memberships (organization_id, id) on delete set null,
  -- Parent key for child sales rows' composite FKs.
  constraint uq_customers_org_id unique (organization_id, id)
);
comment on table public.customers is 'Tenant-owned CRM customer. organization_id is the tenant boundary; branch_id is optional scope. Contact points are stored directly (MVP). No global phone/email uniqueness across tenants — the same real person may exist independently per org. Written only via security-definer RPCs.';

-- Intra-org duplicate detection: at most one ACTIVE customer per normalized phone
-- within one organization. Archived rows are excluded so a re-add is possible.
-- The same phone may exist freely in another tenant (organization_id is part of
-- the key). This is the approved duplicate-detection strategy.
create unique index uq_customers_org_phone_active on public.customers (organization_id, primary_phone_e164)
  where primary_phone_e164 is not null and status <> 'archived';
create index ix_customers_org_status on public.customers (organization_id, status);
create index ix_customers_org_branch on public.customers (organization_id, branch_id);
create index ix_customers_assignee on public.customers (assigned_membership_id);
create index ix_customers_org_email on public.customers (organization_id, email_normalized) where email_normalized is not null;
-- Name search within an organization (trigram; matches the org-name search pattern).
create index ix_customers_name_trgm on public.customers using gin (display_name extensions.gin_trgm_ops);

create trigger set_customers_updated_at
  before update on public.customers
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. leads — the tenant-owned sales pipeline record (Sprint 3 pipeline unit)
-- ---------------------------------------------------------------------------
create table public.leads (
  id                     uuid primary key default extensions.gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  branch_id              uuid,
  customer_id            uuid,   -- optional link to a customer (same org — composite FK)
  title                  text not null,
  source                 public.sales_source,
  status                 public.lead_status not null default 'active',
  stage                  public.lead_stage  not null default 'new',
  assigned_membership_id uuid,
  priority               public.sales_priority not null default 'normal',
  next_follow_up_at      timestamptz,
  lost_reason            text,
  closed_at              timestamptz,
  -- Optimistic-concurrency token; bumped by every mutating RPC. transition_lead
  -- requires the caller's expected version, so a stale concurrent transition is
  -- rejected instead of silently overwriting a newer stage/status.
  version                integer not null default 1,
  created_by             uuid not null references public.users (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ck_leads_title_len check (char_length(title) between 1 and 200),
  constraint ck_leads_lost_reason check (status <> 'lost' or (lost_reason is not null and char_length(btrim(lost_reason)) between 1 and 2000)),
  -- won/lost are closed states; active/archived are open.
  constraint ck_leads_closed_consistency check ((status in ('won', 'lost')) = (closed_at is not null)),
  constraint fk_leads_branch foreign key (organization_id, branch_id)
    references public.branches (organization_id, id) on delete set null,
  constraint fk_leads_customer foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete set null,
  constraint fk_leads_assignee foreign key (organization_id, assigned_membership_id)
    references public.memberships (organization_id, id) on delete set null,
  constraint uq_leads_org_id unique (organization_id, id)
);
comment on table public.leads is 'Tenant-owned sales pipeline record (Sprint 3 unit). status (active/won/lost/archived) and stage (new..decision_pending) are separate. Lifecycle is enforced only in transition_lead (security-definer, optimistic-locked); direct DML cannot move a lead.';

create index ix_leads_org_status on public.leads (organization_id, status);
create index ix_leads_org_stage on public.leads (organization_id, stage) where status = 'active';
create index ix_leads_org_branch on public.leads (organization_id, branch_id);
create index ix_leads_assignee on public.leads (assigned_membership_id);
create index ix_leads_customer on public.leads (customer_id);
-- Follow-up scheduling queries (needing follow-up / overdue) over open leads.
create index ix_leads_next_follow_up on public.leads (organization_id, next_follow_up_at)
  where status = 'active' and next_follow_up_at is not null;

create trigger set_leads_updated_at
  before update on public.leads
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 8. Sales authority helpers (reused by RLS here and by the RPCs in ...090003)
-- ===========================================================================
-- Org-wide sales authority for the CALLER: a sales manager or an org owner.
create or replace function app.can_manage_sales(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_capability(p_org_id, 'sales.manage')
      or app.has_capability(p_org_id, 'org.manage');
$$;

-- Can a GIVEN membership (not necessarily the caller) receive an assignment
-- scoped to p_branch_id? Org-wide caps reach every branch; a NULL branch (org-wide
-- record) requires org-wide sales authority; otherwise an explicit branch grant.
create or replace function app.membership_can_access_branch(p_membership_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.id = p_membership_id
      and m.status = 'active'
      and (
        -- Org-wide caps reach every branch OF THE MEMBERSHIP'S OWN ORG only.
        (
          exists (
            select 1 from public.membership_capabilities c
            where c.membership_id = m.id
              and c.capability_key in ('org.manage', 'branch.manage', 'sales.manage')
          )
          and (
            p_branch_id is null
            or exists (
              select 1 from public.branches b
              where b.id = p_branch_id and b.organization_id = m.organization_id
            )
          )
        )
        -- Or an explicit branch grant for that exact branch.
        or (
          p_branch_id is not null
          and exists (
            select 1 from public.membership_branch_access mba
            where mba.membership_id = m.id and mba.branch_id = p_branch_id
          )
        )
      )
  );
$$;

revoke execute on function app.can_manage_sales(uuid) from public;
revoke execute on function app.membership_can_access_branch(uuid, uuid) from public;
grant execute on function app.can_manage_sales(uuid) to authenticated;
grant execute on function app.membership_can_access_branch(uuid, uuid) to authenticated;

-- ===========================================================================
-- 9. RLS — reads are scope-limited; writes have NO policy (RPC-only, ADR-0008)
-- ===========================================================================
alter table public.customers enable row level security;
alter table public.leads     enable row level security;

-- A caller in the org sees a sales row when: org-wide sales authority, OR
-- (sales.read AND (the row's branch is in their assigned branches OR the row is
-- assigned to them)). NULL-branch (org-wide) rows are visible only to org-wide
-- authority unless assigned to the caller. There is deliberately NO platform
-- cross-tenant read policy on customer PII (ADR-0008: Customer Data Never Leaves
-- the Platform; no market-wide customer database).
create policy customers_select_scope on public.customers
  for select to authenticated
  using (
    app.is_org_member(organization_id) and (
      app.can_manage_sales(organization_id)
      or (
        app.has_capability(organization_id, 'sales.read') and (
          (branch_id is not null and branch_id in (select app.current_branch_ids(organization_id)))
          or assigned_membership_id in (
            select m.id from public.memberships m
            where m.user_id = (select auth.uid())
              and m.organization_id = organization_id
              and m.status = 'active'
          )
        )
      )
    )
  );

create policy leads_select_scope on public.leads
  for select to authenticated
  using (
    app.is_org_member(organization_id) and (
      app.can_manage_sales(organization_id)
      or (
        app.has_capability(organization_id, 'sales.read') and (
          (branch_id is not null and branch_id in (select app.current_branch_ids(organization_id)))
          or assigned_membership_id in (
            select m.id from public.memberships m
            where m.user_id = (select auth.uid())
              and m.organization_id = organization_id
              and m.status = 'active'
          )
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 10. Grants (deny-by-default; SELECT only — every write is an RPC)
-- ---------------------------------------------------------------------------
revoke all on public.customers, public.leads from anon, authenticated, service_role;
grant select on public.customers to authenticated, service_role;
grant select on public.leads     to authenticated, service_role;
