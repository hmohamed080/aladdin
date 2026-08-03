-- Migration: B2B Sales domain — activities & follow-up tasks (Phase 2, Sprint 3).
--
-- The sales timeline (`sales_activities`, append-only) and actionable
-- `follow_up_tasks`. Both carry a denormalized branch_id so RLS scope matches the
-- lead/customer they belong to without cross-table RLS recursion. Writes are
-- RPC-only (migration ...090003); no direct write grant exists.
--
-- Design: ADR-0008, 02_domain_model.md §F, 11_state_machines.md §4b.

-- ---------------------------------------------------------------------------
-- 1. Enum types
-- ---------------------------------------------------------------------------
-- status_change / assignment_change are SYSTEM-generated timeline entries emitted
-- by the transition/assign RPCs; note/call/meeting/follow_up are user-authored.
create type public.sales_activity_type as enum ('note', 'call', 'meeting', 'follow_up', 'status_change', 'assignment_change');
create type public.follow_up_status    as enum ('open', 'completed', 'cancelled');

-- ---------------------------------------------------------------------------
-- 2. sales_activities — append-only tenant timeline for a lead/customer
-- ---------------------------------------------------------------------------
create table public.sales_activities (
  id                  uuid primary key default extensions.gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  -- Denormalized from the lead/customer at insert time so activity visibility
  -- uses the same branch/assignment scope as its parent (no RLS recursion).
  branch_id           uuid,
  lead_id             uuid,
  customer_id         uuid,
  actor_membership_id uuid not null,
  activity_type       public.sales_activity_type not null,
  summary             text not null,
  occurred_at         timestamptz not null default now(),
  metadata            jsonb not null default '{}'::jsonb,
  created_by          uuid not null references public.users (id) on delete restrict,
  created_at          timestamptz not null default now(),
  constraint ck_sales_activity_summary_len check (char_length(summary) between 1 and 2000),
  constraint ck_sales_activity_target check (lead_id is not null or customer_id is not null),
  constraint ck_sales_activity_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint ck_sales_activity_metadata_size check (length(metadata::text) <= 4096),
  constraint fk_sales_activity_branch foreign key (organization_id, branch_id)
    references public.branches (organization_id, id) on delete set null,
  constraint fk_sales_activity_lead foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete cascade,
  constraint fk_sales_activity_customer foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete cascade,
  constraint fk_sales_activity_actor foreign key (organization_id, actor_membership_id)
    references public.memberships (organization_id, id)
);
comment on table public.sales_activities is 'Append-only tenant sales timeline. No UPDATE/DELETE path exists for any client role (RPC inserts only), so history is preserved, not overwritten. branch_id is denormalized from the parent for scope-consistent RLS.';

create index ix_sales_activity_lead on public.sales_activities (lead_id, occurred_at desc);
create index ix_sales_activity_customer on public.sales_activities (customer_id, occurred_at desc);
create index ix_sales_activity_org_created on public.sales_activities (organization_id, created_at desc);
create index ix_sales_activity_actor on public.sales_activities (actor_membership_id);

-- ---------------------------------------------------------------------------
-- 3. follow_up_tasks — actionable follow-ups (create/complete/reopen/reassign)
-- ---------------------------------------------------------------------------
create table public.follow_up_tasks (
  id                     uuid primary key default extensions.gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  branch_id              uuid,
  lead_id                uuid,
  customer_id            uuid,
  assigned_membership_id uuid not null,
  title                  text not null,
  description            text,
  due_at                 timestamptz,
  status                 public.follow_up_status not null default 'open',
  priority               public.sales_priority not null default 'normal',
  completed_at           timestamptz,
  version                integer not null default 1,
  created_by             uuid not null references public.users (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ck_follow_up_title_len check (char_length(title) between 1 and 200),
  constraint ck_follow_up_desc_len check (description is null or char_length(description) <= 2000),
  constraint ck_follow_up_target check (lead_id is not null or customer_id is not null),
  constraint ck_follow_up_completed_consistency check ((status = 'completed') = (completed_at is not null)),
  constraint fk_follow_up_branch foreign key (organization_id, branch_id)
    references public.branches (organization_id, id) on delete set null,
  constraint fk_follow_up_lead foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete cascade,
  constraint fk_follow_up_customer foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete cascade,
  constraint fk_follow_up_assignee foreign key (organization_id, assigned_membership_id)
    references public.memberships (organization_id, id)
);
comment on table public.follow_up_tasks is 'Actionable sales follow-ups. Lifecycle (open/completed/cancelled) and assignment are enforced only in the security-definer RPCs. Designed so a notification/reminder feature can connect later (due_at, assignee) without redesign — reminders are out of Sprint 3 scope.';

create index ix_follow_up_assignee_open on public.follow_up_tasks (assigned_membership_id, due_at)
  where status = 'open';
create index ix_follow_up_org_due_open on public.follow_up_tasks (organization_id, due_at)
  where status = 'open';
create index ix_follow_up_org_branch on public.follow_up_tasks (organization_id, branch_id);
create index ix_follow_up_lead on public.follow_up_tasks (lead_id);
create index ix_follow_up_customer on public.follow_up_tasks (customer_id);

create trigger set_follow_up_tasks_updated_at
  before update on public.follow_up_tasks
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 4. RLS — same scope model as leads (org-wide / branch / personal). Reads only;
--    writes are RPC-only. No platform cross-tenant read (ADR-0008).
-- ===========================================================================
alter table public.sales_activities enable row level security;
alter table public.follow_up_tasks  enable row level security;

-- Activity: managers see all; you see activities you logged; branch-scoped
-- readers see activities on their branch.
create policy sales_activities_select_scope on public.sales_activities
  for select to authenticated
  using (
    app.is_org_member(organization_id) and (
      app.can_manage_sales(organization_id)
      or actor_membership_id in (
        select m.id from public.memberships m
        where m.user_id = (select auth.uid())
          and m.organization_id = sales_activities.organization_id  -- correlate to the row's org
          and m.status = 'active'
      )
      or (
        app.has_capability(organization_id, 'sales.read')
        and branch_id is not null
        and branch_id in (select app.current_branch_ids(organization_id))
      )
    )
  );

-- Follow-up: managers see all; assignee sees their own; branch-scoped readers
-- see follow-ups on their branch.
create policy follow_up_tasks_select_scope on public.follow_up_tasks
  for select to authenticated
  using (
    app.is_org_member(organization_id) and (
      app.can_manage_sales(organization_id)
      or assigned_membership_id in (
        select m.id from public.memberships m
        where m.user_id = (select auth.uid())
          and m.organization_id = follow_up_tasks.organization_id  -- correlate to the row's org
          and m.status = 'active'
      )
      or (
        app.has_capability(organization_id, 'sales.read')
        and branch_id is not null
        and branch_id in (select app.current_branch_ids(organization_id))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Grants (SELECT only — every write is an RPC)
-- ---------------------------------------------------------------------------
revoke all on public.sales_activities, public.follow_up_tasks from anon, authenticated, service_role;
grant select on public.sales_activities to authenticated, service_role;
grant select on public.follow_up_tasks  to authenticated, service_role;
