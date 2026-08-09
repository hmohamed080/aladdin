-- Migration: B2B Execution — Order → Project → Completion (Phase 3, Sprint 10).
--
-- Continues the commercial value chain past the Sprint 9 boundary:
--   accepted quotation → ORDER (immutable commercial snapshot)
--   → start order → PROJECT (execution) → activate → complete → PROJECT COMPLETED.
-- No invoice/payment/accounting is created (explicitly out of scope this sprint).
--
-- Security model is identical to the hardened Sales/Commerce domains (ADR-0008):
-- base tables are SELECT-only for client/service roles; every mutation is a
-- security-definer RPC that derives the actor from auth.uid(), enforces
-- organization scope + capability, is optimistic-concurrency safe on `version`,
-- and emits an audit event in the SAME transaction. No direct write grant exists,
-- so nothing can bypass lifecycle/tenant/audit invariants.
--
-- Actor model (both parties participate, each scoped to its side):
--   • ORDER is created by the REQUESTER (the buyer who accepted the quotation).
--   • ORDER lifecycle (start / cancel) and the whole PROJECT (create / activate /
--     complete) are driven by the SUPPLIER — the executing organization.
--   • Completing the project completes its parent order in the same transaction:
--     execution is delivered THROUGH the project, so that is where an order ends.
--
-- Design: ADR-0007 (tenancy), ADR-0008 (trusted write paths), 06_rls_strategy.md,
-- docs/product/mvp-scope.md (… → Decision → Execution → Follow-up).

-- ===========================================================================
-- 1. Enum types (smallest useful lifecycles)
-- ===========================================================================
create type public.order_status   as enum ('confirmed', 'in_progress', 'completed', 'cancelled');
create type public.project_status as enum ('planned', 'active', 'completed');

-- ===========================================================================
-- 2. Capability catalog extension (append the two order capabilities;
--    project.read / project.write already exist from the Sprint 3 catalog).
-- ===========================================================================
alter table public.membership_capabilities drop constraint ck_membership_capability_key;
alter table public.membership_capabilities add constraint ck_membership_capability_key check (capability_key in (
  'org.manage', 'org.members.manage', 'branch.manage',
  'verification.submit', 'verification.read',
  'catalog.read', 'catalog.write', 'catalog.publish',
  'inventory.write',
  'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
  'sales.task.write', 'sales.followup.send',
  'sales.read', 'sales.write', 'sales.assign', 'sales.manage',
  'rfq.create', 'rfq.respond',
  'quote.submit', 'quote.decide',
  -- Sprint 10 — B2B execution (orders). project.read/project.write pre-exist.
  'order.create', 'order.manage',
  'project.read', 'project.write',
  'conversation.participate',
  'ad.manage',
  'subscription.read', 'subscription.manage',
  'analytics.view',
  'export.data'
));

-- ===========================================================================
-- 3. Audit action allow-list extension (append order/project lifecycle events)
-- ===========================================================================
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
  'rfq.created', 'rfq.updated', 'rfq.submitted', 'rfq.closed', 'rfq.cancelled',
  'quotation.created', 'quotation.updated', 'quotation.submitted',
  'quotation.accepted', 'quotation.rejected',
  -- Sprint 10 — B2B execution (orders / projects).
  'order.created', 'order.started', 'order.completed', 'order.cancelled',
  'project.created', 'project.activated', 'project.completed'
));

-- ===========================================================================
-- 4. orders — the committed deal, an IMMUTABLE snapshot of the accepted quote
-- ===========================================================================
create table public.orders (
  id                   uuid primary key default extensions.gen_random_uuid(),
  -- Exactly one order per accepted quotation (the unique constraint is the
  -- "no duplicate order" invariant; the RPC also asserts the quotation is accepted).
  quotation_id         uuid not null references public.quotations (id) on delete restrict,
  rfq_id               uuid not null references public.rfqs (id) on delete restrict,
  requester_org_id     uuid not null references public.organizations (id) on delete cascade,
  supplier_org_id      uuid not null references public.organizations (id) on delete cascade,
  requester_branch_id  uuid,   -- optional requester-side site branch (composite FK)
  -- Commercial snapshot (frozen at accept-time; there is NO edit RPC for these).
  title                text not null,
  note                 text,   -- operational note carried from the quotation
  subtotal             numeric(16, 2) not null default 0,
  total                numeric(16, 2) not null default 0,
  status               public.order_status not null default 'confirmed',
  version              integer not null default 1,
  confirmed_at         timestamptz not null default now(),
  started_at           timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  created_by           uuid not null references public.users (id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ck_orders_title_len check (char_length(title) between 2 and 200),
  constraint ck_orders_note_len check (note is null or char_length(note) <= 2000),
  constraint ck_orders_totals check (subtotal >= 0 and total >= 0),
  constraint ck_orders_distinct_orgs check (requester_org_id <> supplier_org_id),
  constraint uq_orders_quotation unique (quotation_id),        -- one order per accepted quotation
  constraint fk_orders_requester_branch foreign key (requester_org_id, requester_branch_id)
    references public.branches (organization_id, id) on delete set null,
  constraint uq_orders_id unique (id)                          -- parent key for projects
);
comment on table public.orders is 'A committed B2B order: an IMMUTABLE commercial snapshot of an accepted quotation (parties, branch, totals, lines). Created by the requester; execution lifecycle driven by the supplier. Written only via security-definer RPCs. No invoice/payment (out of scope).';

create index ix_orders_requester_status on public.orders (requester_org_id, status);
create index ix_orders_supplier_status on public.orders (supplier_org_id, status);
create index ix_orders_rfq on public.orders (rfq_id);

create trigger set_orders_updated_at
  before update on public.orders
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 5. order_items — the frozen priced lines copied from the quotation
-- ===========================================================================
create table public.order_items (
  id             uuid primary key default extensions.gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete cascade,
  product_name   text not null,
  unit           public.product_unit not null,
  quantity       numeric(14, 2) not null,
  unit_price     numeric(14, 2) not null,
  line_total     numeric(16, 2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at     timestamptz not null default now(),
  constraint ck_order_items_qty check (quantity > 0),
  constraint ck_order_items_price check (unit_price >= 0 and unit_price <= 1000000000),
  constraint ck_order_items_name_len check (char_length(product_name) between 1 and 160)
);
comment on table public.order_items is 'Frozen order line copied from a quotation_item at accept-time. Immutable — there is no edit/add/remove RPC. line_total is generated (quantity * unit_price).';

create index ix_order_items_order on public.order_items (order_id);

-- ===========================================================================
-- 6. projects — the execution of an order (exactly one per order)
-- ===========================================================================
create table public.projects (
  id                uuid primary key default extensions.gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete restrict,
  requester_org_id  uuid not null references public.organizations (id) on delete cascade,
  executing_org_id  uuid not null references public.organizations (id) on delete cascade,
  branch_id         uuid,   -- optional requester-side site branch (composite FK)
  title             text not null,
  location          text,   -- optional general location / site
  description       text,
  start_date        date,
  target_date       date,
  status            public.project_status not null default 'planned',
  version           integer not null default 1,
  activated_at      timestamptz,
  completed_at      timestamptz,
  created_by        uuid not null references public.users (id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ck_projects_title_len check (char_length(title) between 2 and 200),
  constraint ck_projects_location_len check (location is null or char_length(location) <= 200),
  constraint ck_projects_desc_len check (description is null or char_length(description) <= 2000),
  constraint ck_projects_distinct_orgs check (requester_org_id <> executing_org_id),
  constraint ck_projects_dates check (target_date is null or start_date is null or target_date >= start_date),
  constraint uq_projects_order unique (order_id),   -- exactly one project per order
  constraint fk_projects_branch foreign key (requester_org_id, branch_id)
    references public.branches (organization_id, id) on delete set null
);
comment on table public.projects is 'Execution record for an order (exactly one per order). Created and driven by the executing (supplier) organization. Completing the project completes its parent order. No task/Gantt system — minimal by design.';

create index ix_projects_requester_status on public.projects (requester_org_id, status);
create index ix_projects_executing_status on public.projects (executing_org_id, status);
create index ix_projects_order on public.projects (order_id);

create trigger set_projects_updated_at
  before update on public.projects
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 7. Capability helpers (security-definer, mirror the commerce helpers).
-- ===========================================================================
-- Requester-side order creation authority.
create or replace function app.can_create_order(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'order.create') or app.has_capability(p_org_id, 'org.manage');
$$;
-- Order lifecycle (start / cancel) authority — held by either party per transition.
create or replace function app.can_manage_order(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'order.manage') or app.has_capability(p_org_id, 'org.manage');
$$;
-- Project authority (executing org).
create or replace function app.can_write_project(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'project.write') or app.has_capability(p_org_id, 'org.manage');
$$;

revoke execute on function app.can_create_order(uuid), app.can_manage_order(uuid),
  app.can_write_project(uuid) from public;
grant execute on function app.can_create_order(uuid), app.can_manage_order(uuid),
  app.can_write_project(uuid) to authenticated;

-- ===========================================================================
-- 8. RLS — reads are scope-limited to the two parties; writes have NO policy.
-- ===========================================================================
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.projects     enable row level security;

-- orders: both the requester org and the supplier org see the order (any status);
-- platform support reads cross-tenant. No draft state — an order is committed.
create policy orders_select_requester on public.orders
  for select to authenticated using (app.is_org_member(requester_org_id));
create policy orders_select_supplier on public.orders
  for select to authenticated using (app.is_org_member(supplier_org_id));
create policy orders_select_platform on public.orders
  for select to authenticated using (app.is_platform('support'));

-- order_items: visible exactly when the parent order is visible (RLS-filtered EXISTS).
create policy order_items_select_parent on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id));

-- projects: the requester org and the executing org see the project; platform reads.
create policy projects_select_requester on public.projects
  for select to authenticated using (app.is_org_member(requester_org_id));
create policy projects_select_executing on public.projects
  for select to authenticated using (app.is_org_member(executing_org_id));
create policy projects_select_platform on public.projects
  for select to authenticated using (app.is_platform('support'));

-- ===========================================================================
-- 9. Grants (deny-by-default; SELECT only — every write is an RPC)
-- ===========================================================================
revoke all on public.orders, public.order_items, public.projects
  from anon, authenticated, service_role;
grant select on public.orders       to authenticated, service_role;
grant select on public.order_items  to authenticated, service_role;
grant select on public.projects     to authenticated, service_role;

-- ===========================================================================
-- 10. Order write paths
-- ===========================================================================
-- Create an order from an ACCEPTED quotation. Requester-side action. Snapshots
-- the commercial data (parties, branch, totals, lines) so nothing shifts later.
-- One order per accepted quotation (unique constraint + explicit guard).
create or replace function public.create_order_from_quotation(p_quotation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_q public.quotations; v_r public.rfqs; v_id uuid;
begin
  select * into v_q from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation not found'; end if;
  -- Only the requester (buyer) commits an accepted quotation into an order.
  if not app.is_org_member(v_q.requester_org_id) then
    raise exception 'not a member of the requester organization' using errcode = '42501';
  end if;
  if not app.can_create_order(v_q.requester_org_id) then
    raise exception 'order.create required' using errcode = '42501';
  end if;
  if v_q.status <> 'accepted' then
    raise exception 'an order can only be created from an accepted quotation' using errcode = '22023';
  end if;
  if exists (select 1 from public.orders where quotation_id = p_quotation_id) then
    raise exception 'an order already exists for this quotation' using errcode = '23505';
  end if;
  select * into v_r from public.rfqs where id = v_q.rfq_id;
  insert into public.orders (
    quotation_id, rfq_id, requester_org_id, supplier_org_id, requester_branch_id,
    title, note, subtotal, total, created_by)
  values (
    p_quotation_id, v_q.rfq_id, v_q.requester_org_id, v_q.supplier_org_id, v_r.requester_branch_id,
    v_r.title, v_q.note, v_q.subtotal, v_q.total, (select auth.uid()))
  returning id into v_id;
  -- Freeze the priced lines from the quotation.
  insert into public.order_items (order_id, product_name, unit, quantity, unit_price)
  select v_id, qi.product_name, qi.unit, qi.quantity, qi.unit_price
  from public.quotation_items qi where qi.quotation_id = p_quotation_id;
  perform app.record_audit_event('order.created', 'order', v_id, v_q.requester_org_id,
    jsonb_build_object('quotation_id', p_quotation_id, 'supplier_org_id', v_q.supplier_org_id, 'total', v_q.total));
  return v_id;
end;
$$;

-- confirmed → in_progress. Supplier (executing org) begins fulfilment.
create or replace function public.start_order(
  p_order_id         uuid,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not app.is_org_member(v_o.supplier_org_id) then
    raise exception 'not a member of the supplier organization' using errcode = '42501';
  end if;
  if not app.can_manage_order(v_o.supplier_org_id) then
    raise exception 'order.manage required' using errcode = '42501';
  end if;
  if v_o.status <> 'confirmed' then
    raise exception 'only a confirmed order can be started' using errcode = '22023';
  end if;
  if v_o.version <> p_expected_version then
    raise exception 'order was modified concurrently' using errcode = '40001';
  end if;
  update public.orders set status = 'in_progress', started_at = now(), version = version + 1
  where id = p_order_id;
  perform app.record_audit_event('order.started', 'order', p_order_id, v_o.supplier_org_id, '{}'::jsonb);
  return v_o.version + 1;
end;
$$;

-- confirmed → cancelled. Either party may cancel BEFORE work starts.
create or replace function public.cancel_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_o public.orders; v_actor_org uuid;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  -- The caller must be a manager on EITHER party org.
  if app.is_org_member(v_o.requester_org_id) and app.can_manage_order(v_o.requester_org_id) then
    v_actor_org := v_o.requester_org_id;
  elsif app.is_org_member(v_o.supplier_org_id) and app.can_manage_order(v_o.supplier_org_id) then
    v_actor_org := v_o.supplier_org_id;
  else
    raise exception 'order.manage required' using errcode = '42501';
  end if;
  if v_o.status <> 'confirmed' then
    raise exception 'only a confirmed order can be cancelled' using errcode = '22023';
  end if;
  update public.orders set status = 'cancelled', cancelled_at = now(), version = version + 1
  where id = p_order_id;
  perform app.record_audit_event('order.cancelled', 'order', p_order_id, v_actor_org, '{}'::jsonb);
end;
$$;

-- ===========================================================================
-- 11. Project write paths (executing / supplier org)
-- ===========================================================================
-- An eligible (in_progress) order can create exactly one project. Executing-org
-- action. The unique(order_id) constraint is the "no duplicate project" invariant.
create or replace function public.create_project_from_order(
  p_order_id    uuid,
  p_title       text,
  p_location    text default null,
  p_description text default null,
  p_start_date  date default null,
  p_target_date date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_o public.orders; v_id uuid;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  -- The executing (supplier) org runs the project.
  if not app.is_org_member(v_o.supplier_org_id) then
    raise exception 'not a member of the executing organization' using errcode = '42501';
  end if;
  if not app.can_write_project(v_o.supplier_org_id) then
    raise exception 'project.write required' using errcode = '42501';
  end if;
  if v_o.status <> 'in_progress' then
    raise exception 'only an in-progress order can start a project' using errcode = '22023';
  end if;
  if exists (select 1 from public.projects where order_id = p_order_id) then
    raise exception 'a project already exists for this order' using errcode = '23505';
  end if;
  insert into public.projects (
    order_id, requester_org_id, executing_org_id, branch_id,
    title, location, description, start_date, target_date, created_by)
  values (
    p_order_id, v_o.requester_org_id, v_o.supplier_org_id, v_o.requester_branch_id,
    coalesce(nullif(btrim(p_title), ''), v_o.title), p_location, p_description,
    p_start_date, p_target_date, (select auth.uid()))
  returning id into v_id;
  perform app.record_audit_event('project.created', 'project', v_id, v_o.supplier_org_id,
    jsonb_build_object('order_id', p_order_id, 'requester_org_id', v_o.requester_org_id));
  return v_id;
end;
$$;

-- planned → active.
create or replace function public.activate_project(
  p_project_id       uuid,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_p public.projects;
begin
  select * into v_p from public.projects where id = p_project_id for update;
  if not found then raise exception 'project not found'; end if;
  if not app.can_write_project(v_p.executing_org_id) then
    raise exception 'project.write required' using errcode = '42501';
  end if;
  if v_p.status <> 'planned' then
    raise exception 'only a planned project can be activated' using errcode = '22023';
  end if;
  if v_p.version <> p_expected_version then
    raise exception 'project was modified concurrently' using errcode = '40001';
  end if;
  update public.projects set status = 'active', activated_at = now(), version = version + 1
  where id = p_project_id;
  perform app.record_audit_event('project.activated', 'project', p_project_id, v_p.executing_org_id, '{}'::jsonb);
  return v_p.version + 1;
end;
$$;

-- active → completed. Completing the project completes its parent order in the
-- SAME transaction (execution is delivered through the project). PROJECT COMPLETED.
create or replace function public.complete_project(
  p_project_id       uuid,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_p public.projects;
begin
  select * into v_p from public.projects where id = p_project_id for update;
  if not found then raise exception 'project not found'; end if;
  if not app.can_write_project(v_p.executing_org_id) then
    raise exception 'project.write required' using errcode = '42501';
  end if;
  if v_p.status <> 'active' then
    raise exception 'only an active project can be completed' using errcode = '22023';
  end if;
  if v_p.version <> p_expected_version then
    raise exception 'project was modified concurrently' using errcode = '40001';
  end if;
  update public.projects set status = 'completed', completed_at = now(), version = version + 1
  where id = p_project_id;
  -- Complete the parent order too (only if still in progress).
  update public.orders set status = 'completed', completed_at = now(), version = version + 1
  where id = v_p.order_id and status = 'in_progress';
  perform app.record_audit_event('project.completed', 'project', p_project_id, v_p.executing_org_id,
    jsonb_build_object('order_id', v_p.order_id));
  perform app.record_audit_event('order.completed', 'order', v_p.order_id, v_p.executing_org_id,
    jsonb_build_object('project_id', p_project_id));
  return v_p.version + 1;
end;
$$;

-- ===========================================================================
-- 12. Execute grants — authenticated only (a service-role key is not a business
--     authorization path, ADR-0008/D17).
-- ===========================================================================
revoke execute on function
  public.create_order_from_quotation(uuid),
  public.start_order(uuid, integer),
  public.cancel_order(uuid),
  public.create_project_from_order(uuid, text, text, text, date, date),
  public.activate_project(uuid, integer),
  public.complete_project(uuid, integer)
  from public;

grant execute on function
  public.create_order_from_quotation(uuid),
  public.start_order(uuid, integer),
  public.cancel_order(uuid),
  public.create_project_from_order(uuid, text, text, text, date, date),
  public.activate_project(uuid, integer),
  public.complete_project(uuid, integer)
  to authenticated;

-- ===========================================================================
-- 13. Read models — security_invoker views so RLS scopes rows to the caller.
--     Counterparty names resolve via the existing app.org_display_name definer
--     scalar (only yields a name for an org already on a row the caller can see).
-- ===========================================================================
create view public.order_list with (security_invoker = true) as
  select
    o.id, o.quotation_id, o.rfq_id, o.requester_org_id, o.supplier_org_id,
    o.title, o.status, o.total, o.confirmed_at, o.started_at, o.completed_at,
    o.created_at, o.updated_at, o.version,
    app.org_display_name(o.requester_org_id) as requester_name,
    app.org_display_name(o.supplier_org_id)  as supplier_name,
    (select count(*) from public.order_items oi where oi.order_id = o.id) as item_count,
    exists (select 1 from public.projects p where p.order_id = o.id)       as has_project
  from public.orders o;
comment on view public.order_list is 'Order list projection (RLS-scoped) with party names, item counts, and whether a project exists.';

create view public.project_list with (security_invoker = true) as
  select
    p.id, p.order_id, p.requester_org_id, p.executing_org_id, p.title,
    p.status, p.location, p.start_date, p.target_date, p.activated_at, p.completed_at,
    p.created_at, p.updated_at, p.version,
    app.org_display_name(p.requester_org_id) as requester_name,
    app.org_display_name(p.executing_org_id) as executing_name
  from public.projects p;
comment on view public.project_list is 'Project list projection (RLS-scoped) with party names.';

grant select on public.order_list   to authenticated;
grant select on public.project_list to authenticated;
