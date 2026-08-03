-- Migration: B2B Sales domain — trusted write paths & read models (Phase 2, Sprint 3).
--
-- Every sensitive sales mutation is a security-definer RPC that derives the caller
-- from auth.uid(), resolves the caller's ACTIVE membership, enforces organization
-- + branch scope and capability, is concurrency-safe (optimistic version + row
-- lock on lead transitions), and emits an audit event in the SAME transaction.
-- Direct table DML is revoked, so these RPCs are the only write path — nothing can
-- bypass lifecycle/assignment/tenant/audit invariants. RPCs are executable by
-- `authenticated` only (a service-role key is not a business-authorization path).
--
-- Design: ADR-0008, 12_validation_rules.md §13, 11_state_machines.md §4a/§4b.

-- ===========================================================================
-- 0. Internal helper — the caller's active membership id in an org (or null).
-- ===========================================================================
create or replace function app.active_membership_id(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.organization_id = p_org_id
    and m.status = 'active'
  limit 1;
$$;
revoke execute on function app.active_membership_id(uuid) from public;
grant execute on function app.active_membership_id(uuid) to authenticated;

-- ===========================================================================
-- 1. Customers
-- ===========================================================================
create or replace function public.create_customer(
  p_org_id             uuid,
  p_display_name       text,
  p_customer_type      public.customer_type default 'individual',
  p_branch_id          uuid    default null,
  p_primary_phone      text    default null,
  p_email              text    default null,
  p_preferred_language text    default null,
  p_location_summary   text    default null,
  p_source             public.sales_source default null,
  p_assigned_membership_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not (app.has_capability(p_org_id, 'sales.write') or app.can_manage_sales(p_org_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  -- Branch scope: a non-manager may only create within a branch they can access;
  -- an org-wide (null-branch) customer requires org-wide sales authority.
  if not app.can_manage_sales(p_org_id) then
    if p_branch_id is null then
      raise exception 'org-wide customers require sales.manage' using errcode = '42501';
    end if;
    if p_branch_id not in (select app.current_branch_ids(p_org_id)) then
      raise exception 'branch not in caller scope' using errcode = '42501';
    end if;
  end if;
  -- Optional assignee must be active + branch-compatible (composite FK already
  -- guarantees same org).
  if p_assigned_membership_id is not null
     and not app.membership_can_access_branch(p_assigned_membership_id, p_branch_id) then
    raise exception 'assignee cannot access this branch' using errcode = '22023';
  end if;

  insert into public.customers (
    organization_id, branch_id, display_name, customer_type, primary_phone, email,
    preferred_language, location_summary, source, assigned_membership_id, created_by
  ) values (
    p_org_id, p_branch_id, p_display_name, p_customer_type, p_primary_phone, p_email,
    p_preferred_language, p_location_summary, p_source, p_assigned_membership_id, (select auth.uid())
  )
  returning id into v_id;

  perform app.record_audit_event('customer.created', 'customer', v_id, p_org_id,
    jsonb_build_object('branch_id', p_branch_id, 'customer_type', p_customer_type));
  return v_id;
exception when unique_violation then
  raise exception 'a customer with this phone already exists in this organization'
    using errcode = '23505';
end;
$$;

create or replace function public.update_customer(
  p_customer_id        uuid,
  p_display_name       text default null,
  p_primary_phone      text default null,
  p_email              text default null,
  p_preferred_language text default null,
  p_location_summary   text default null,
  p_source             public.sales_source default null,
  p_archive            boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_c public.customers; v_caller_mem uuid;
begin
  select * into v_c from public.customers where id = p_customer_id for update;
  if not found then raise exception 'customer not found'; end if;
  if not (app.has_capability(v_c.organization_id, 'sales.write') or app.can_manage_sales(v_c.organization_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  v_caller_mem := app.active_membership_id(v_c.organization_id);
  if not (app.can_manage_sales(v_c.organization_id)
          or (v_c.assigned_membership_id is not null and v_c.assigned_membership_id = v_caller_mem)
          or (v_c.branch_id is not null and v_c.branch_id in (select app.current_branch_ids(v_c.organization_id)))) then
    raise exception 'customer not in caller scope' using errcode = '42501';
  end if;

  update public.customers set
    display_name       = coalesce(p_display_name, display_name),
    primary_phone      = coalesce(p_primary_phone, primary_phone),
    email              = coalesce(p_email, email),
    preferred_language = coalesce(p_preferred_language, preferred_language),
    location_summary   = coalesce(p_location_summary, location_summary),
    source             = coalesce(p_source, source),
    status             = case when p_archive is true then 'archived'::public.customer_status
                              when p_archive is false then 'active'::public.customer_status
                              else status end,
    archived_at        = case when p_archive is true then now()
                              when p_archive is false then null
                              else archived_at end
  where id = p_customer_id;

  perform app.record_audit_event('customer.updated', 'customer', p_customer_id, v_c.organization_id,
    jsonb_build_object('archived', p_archive));
exception when unique_violation then
  raise exception 'a customer with this phone already exists in this organization'
    using errcode = '23505';
end;
$$;

-- ===========================================================================
-- 2. Leads
-- ===========================================================================
create or replace function public.create_lead(
  p_org_id           uuid,
  p_title            text,
  p_branch_id        uuid default null,
  p_customer_id      uuid default null,
  p_source           public.sales_source default null,
  p_priority         public.sales_priority default 'normal',
  p_assigned_membership_id uuid default null,
  p_next_follow_up_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not (app.has_capability(p_org_id, 'sales.write') or app.can_manage_sales(p_org_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  if not app.can_manage_sales(p_org_id) then
    if p_branch_id is null then
      raise exception 'org-wide leads require sales.manage' using errcode = '42501';
    end if;
    if p_branch_id not in (select app.current_branch_ids(p_org_id)) then
      raise exception 'branch not in caller scope' using errcode = '42501';
    end if;
  end if;
  if p_assigned_membership_id is not null
     and not app.membership_can_access_branch(p_assigned_membership_id, p_branch_id) then
    raise exception 'assignee cannot access this branch' using errcode = '22023';
  end if;

  insert into public.leads (
    organization_id, branch_id, customer_id, title, source, priority,
    assigned_membership_id, next_follow_up_at, created_by
  ) values (
    p_org_id, p_branch_id, p_customer_id, p_title, p_source, p_priority,
    p_assigned_membership_id, p_next_follow_up_at, (select auth.uid())
  )
  returning id into v_id;

  perform app.record_audit_event('lead.created', 'lead', v_id, p_org_id,
    jsonb_build_object('branch_id', p_branch_id, 'assigned', p_assigned_membership_id));
  return v_id;
end;
$$;

create or replace function public.update_lead_details(
  p_lead_id          uuid,
  p_expected_version integer,
  p_title            text default null,
  p_priority         public.sales_priority default null,
  p_next_follow_up_at timestamptz default null,
  p_customer_id      uuid default null,
  p_clear_next_follow_up boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_l public.leads; v_caller_mem uuid;
begin
  select * into v_l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead not found'; end if;
  if not (app.has_capability(v_l.organization_id, 'sales.write') or app.can_manage_sales(v_l.organization_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  v_caller_mem := app.active_membership_id(v_l.organization_id);
  if not (app.can_manage_sales(v_l.organization_id)
          or (v_l.assigned_membership_id is not null and v_l.assigned_membership_id = v_caller_mem)
          or (v_l.branch_id is not null and v_l.branch_id in (select app.current_branch_ids(v_l.organization_id)))) then
    raise exception 'lead not in caller scope' using errcode = '42501';
  end if;
  if v_l.version <> p_expected_version then
    raise exception 'lead was modified concurrently (expected version %, found %)', p_expected_version, v_l.version
      using errcode = '40001';
  end if;

  update public.leads set
    title             = coalesce(p_title, title),
    priority          = coalesce(p_priority, priority),
    customer_id       = coalesce(p_customer_id, customer_id),
    next_follow_up_at = case when p_clear_next_follow_up then null
                             else coalesce(p_next_follow_up_at, next_follow_up_at) end,
    version           = version + 1
  where id = p_lead_id;
  return v_l.version + 1;
end;
$$;

create or replace function public.assign_lead(
  p_lead_id          uuid,
  p_assignee_membership_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_l public.leads; v_caller_mem uuid; v_action text;
begin
  select * into v_l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead not found'; end if;
  if not (app.has_capability(v_l.organization_id, 'sales.assign') or app.can_manage_sales(v_l.organization_id)) then
    raise exception 'sales.assign required' using errcode = '42501';
  end if;
  -- Caller must have authority over the lead's branch (managers reach all).
  if not (app.can_manage_sales(v_l.organization_id)
          or (v_l.branch_id is not null and v_l.branch_id in (select app.current_branch_ids(v_l.organization_id)))) then
    raise exception 'lead not in caller scope' using errcode = '42501';
  end if;
  if v_l.version <> p_expected_version then
    raise exception 'lead was modified concurrently' using errcode = '40001';
  end if;
  -- New assignee must be an active, branch-compatible membership (composite FK
  -- already guarantees same tenant).
  if not app.membership_can_access_branch(p_assignee_membership_id, v_l.branch_id) then
    raise exception 'assignee is not an active member with access to this branch' using errcode = '22023';
  end if;

  v_action := case when v_l.assigned_membership_id is null then 'lead.assigned' else 'lead.reassigned' end;
  v_caller_mem := app.active_membership_id(v_l.organization_id);

  update public.leads set assigned_membership_id = p_assignee_membership_id, version = version + 1
  where id = p_lead_id;

  insert into public.sales_activities (organization_id, branch_id, lead_id, actor_membership_id,
    activity_type, summary, metadata, created_by)
  values (v_l.organization_id, v_l.branch_id, p_lead_id, v_caller_mem, 'assignment_change',
    'Lead assignment changed',
    jsonb_build_object('from', v_l.assigned_membership_id, 'to', p_assignee_membership_id),
    (select auth.uid()));

  perform app.record_audit_event(v_action, 'lead', p_lead_id, v_l.organization_id,
    jsonb_build_object('from', v_l.assigned_membership_id, 'to', p_assignee_membership_id));
  return v_l.version + 1;
end;
$$;

-- Constrained pipeline transition. Optimistic-locked (row FOR UPDATE + expected
-- version). Validates status/stage transitions server-side; won/lost/reopen are
-- audited; a status_change activity is emitted.
create or replace function public.transition_lead(
  p_lead_id          uuid,
  p_expected_version integer,
  p_new_stage        public.lead_stage default null,
  p_new_status       public.lead_status default null,
  p_lost_reason      text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.leads; v_caller_mem uuid;
  v_stage public.lead_stage; v_status public.lead_status;
  v_closed_at timestamptz; v_lost_reason text; v_audit text;
begin
  select * into v_l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead not found'; end if;
  if not (app.has_capability(v_l.organization_id, 'sales.write') or app.can_manage_sales(v_l.organization_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  v_caller_mem := app.active_membership_id(v_l.organization_id);
  if not (app.can_manage_sales(v_l.organization_id)
          or (v_l.assigned_membership_id is not null and v_l.assigned_membership_id = v_caller_mem)
          or (v_l.branch_id is not null and v_l.branch_id in (select app.current_branch_ids(v_l.organization_id)))) then
    raise exception 'lead not in caller scope' using errcode = '42501';
  end if;
  if v_l.version <> p_expected_version then
    raise exception 'lead was modified concurrently (expected %, found %)', p_expected_version, v_l.version
      using errcode = '40001';
  end if;

  v_status := coalesce(p_new_status, v_l.status);
  v_stage  := coalesce(p_new_stage,  v_l.stage);

  -- Validate STATUS transition (only the legal edges — 11_state_machines.md §4a).
  if v_status <> v_l.status then
    if not (
      (v_l.status = 'active' and v_status in ('won', 'lost', 'archived'))
      or (v_l.status in ('won', 'lost', 'archived') and v_status = 'active')  -- reopen
    ) then
      raise exception 'illegal lead status transition % -> %', v_l.status, v_status using errcode = '22023';
    end if;
  end if;

  -- A stage change is only allowed when the (resulting) status is active.
  if v_stage <> v_l.stage and v_status <> 'active' then
    raise exception 'cannot change stage of a % lead', v_status using errcode = '22023';
  end if;

  -- lost requires a reason; reopening clears the previous lost reason.
  if v_status = 'lost' then
    if p_lost_reason is null or char_length(btrim(p_lost_reason)) = 0 then
      raise exception 'a reason is required when marking a lead lost' using errcode = '22023';
    end if;
    v_lost_reason := btrim(p_lost_reason);
    v_closed_at := now();
  elsif v_status = 'won' then
    v_lost_reason := null; v_closed_at := now();
  else  -- active or archived
    v_lost_reason := null; v_closed_at := null;
  end if;

  update public.leads set
    stage = v_stage, status = v_status, lost_reason = v_lost_reason,
    closed_at = v_closed_at, version = version + 1
  where id = p_lead_id;

  v_audit := case
    when v_status = 'won'  and v_l.status <> 'won'  then 'lead.won'
    when v_status = 'lost' and v_l.status <> 'lost' then 'lead.lost'
    when v_status = 'active' and v_l.status in ('won', 'lost', 'archived') then 'lead.reopened'
    when v_status = 'archived' and v_l.status <> 'archived' then 'lead.archived'
    else 'lead.stage_changed'
  end;

  insert into public.sales_activities (organization_id, branch_id, lead_id, actor_membership_id,
    activity_type, summary, metadata, created_by)
  values (v_l.organization_id, v_l.branch_id, p_lead_id, v_caller_mem, 'status_change',
    'Lead transitioned',
    jsonb_build_object('from_stage', v_l.stage, 'to_stage', v_stage,
                       'from_status', v_l.status, 'to_status', v_status),
    (select auth.uid()));

  perform app.record_audit_event(v_audit, 'lead', p_lead_id, v_l.organization_id,
    jsonb_build_object('from_stage', v_l.stage, 'to_stage', v_stage,
                       'from_status', v_l.status, 'to_status', v_status));
  return v_l.version + 1;
end;
$$;

-- ===========================================================================
-- 3. Sales activities (user-authored timeline entries)
-- ===========================================================================
create or replace function public.add_sales_activity(
  p_org_id       uuid,
  p_activity_type public.sales_activity_type,
  p_summary      text,
  p_lead_id      uuid default null,
  p_customer_id  uuid default null,
  p_occurred_at  timestamptz default null,
  p_metadata     jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_caller_mem uuid; v_branch uuid;
begin
  if p_activity_type not in ('note', 'call', 'meeting', 'follow_up') then
    raise exception 'status_change/assignment_change activities are system-generated' using errcode = '22023';
  end if;
  if p_lead_id is null and p_customer_id is null then
    raise exception 'an activity must reference a lead or a customer' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not (app.has_capability(p_org_id, 'sales.write') or app.can_manage_sales(p_org_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  v_caller_mem := app.active_membership_id(p_org_id);
  if v_caller_mem is null then raise exception 'no active membership' using errcode = '42501'; end if;

  -- Resolve and scope-check the parent; denormalize its branch onto the activity.
  if p_lead_id is not null then
    select branch_id into v_branch from public.leads where id = p_lead_id and organization_id = p_org_id;
    if not found then raise exception 'lead not found in this organization' using errcode = '22023'; end if;
  else
    select branch_id into v_branch from public.customers where id = p_customer_id and organization_id = p_org_id;
    if not found then raise exception 'customer not found in this organization' using errcode = '22023'; end if;
  end if;
  if not (app.can_manage_sales(p_org_id)
          or (v_branch is not null and v_branch in (select app.current_branch_ids(p_org_id)))) then
    raise exception 'target not in caller scope' using errcode = '42501';
  end if;

  insert into public.sales_activities (organization_id, branch_id, lead_id, customer_id,
    actor_membership_id, activity_type, summary, occurred_at, metadata, created_by)
  values (p_org_id, v_branch, p_lead_id, p_customer_id, v_caller_mem, p_activity_type, p_summary,
    coalesce(p_occurred_at, now()), coalesce(p_metadata, '{}'::jsonb), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- ===========================================================================
-- 4. Follow-up tasks
-- ===========================================================================
create or replace function public.create_follow_up(
  p_org_id       uuid,
  p_title        text,
  p_assignee_membership_id uuid,
  p_lead_id      uuid default null,
  p_customer_id  uuid default null,
  p_due_at       timestamptz default null,
  p_priority     public.sales_priority default 'normal',
  p_description  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_caller_mem uuid; v_branch uuid;
begin
  if p_lead_id is null and p_customer_id is null then
    raise exception 'a follow-up must reference a lead or a customer' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not (app.has_capability(p_org_id, 'sales.write') or app.can_manage_sales(p_org_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  v_caller_mem := app.active_membership_id(p_org_id);

  if p_lead_id is not null then
    select branch_id into v_branch from public.leads where id = p_lead_id and organization_id = p_org_id;
    if not found then raise exception 'lead not found in this organization' using errcode = '22023'; end if;
  else
    select branch_id into v_branch from public.customers where id = p_customer_id and organization_id = p_org_id;
    if not found then raise exception 'customer not found in this organization' using errcode = '22023'; end if;
  end if;
  if not (app.can_manage_sales(p_org_id)
          or (v_branch is not null and v_branch in (select app.current_branch_ids(p_org_id)))) then
    raise exception 'target not in caller scope' using errcode = '42501';
  end if;
  -- Assigning to someone else requires sales.assign; self-assignment only needs write.
  if p_assignee_membership_id <> v_caller_mem
     and not (app.has_capability(p_org_id, 'sales.assign') or app.can_manage_sales(p_org_id)) then
    raise exception 'assigning a follow-up to another member requires sales.assign' using errcode = '42501';
  end if;
  if not app.membership_can_access_branch(p_assignee_membership_id, v_branch) then
    raise exception 'assignee cannot access this branch' using errcode = '22023';
  end if;

  insert into public.follow_up_tasks (organization_id, branch_id, lead_id, customer_id,
    assigned_membership_id, title, description, due_at, priority, created_by)
  values (p_org_id, v_branch, p_lead_id, p_customer_id, p_assignee_membership_id, p_title,
    p_description, p_due_at, p_priority, (select auth.uid()))
  returning id into v_id;

  perform app.record_audit_event('followup.created', 'follow_up', v_id, p_org_id,
    jsonb_build_object('assignee', p_assignee_membership_id, 'due_at', p_due_at));
  return v_id;
end;
$$;

-- Shared scope guard for follow-up mutations: manager, assignee, or branch reader.
create or replace function app.can_act_on_follow_up(p_task public.follow_up_tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_manage_sales(p_task.organization_id)
      or p_task.assigned_membership_id = app.active_membership_id(p_task.organization_id)
      or (app.has_capability(p_task.organization_id, 'sales.write')
          and p_task.branch_id is not null
          and p_task.branch_id in (select app.current_branch_ids(p_task.organization_id)));
$$;
revoke execute on function app.can_act_on_follow_up(public.follow_up_tasks) from public;
grant execute on function app.can_act_on_follow_up(public.follow_up_tasks) to authenticated;

create or replace function public.update_follow_up(
  p_follow_up_id uuid,
  p_title        text default null,
  p_description  text default null,
  p_due_at       timestamptz default null,
  p_priority     public.sales_priority default null,
  p_clear_due    boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_t public.follow_up_tasks;
begin
  select * into v_t from public.follow_up_tasks where id = p_follow_up_id for update;
  if not found then raise exception 'follow-up not found'; end if;
  if not (app.has_capability(v_t.organization_id, 'sales.write') or app.can_manage_sales(v_t.organization_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  if not app.can_act_on_follow_up(v_t) then
    raise exception 'follow-up not in caller scope' using errcode = '42501';
  end if;
  if v_t.status <> 'open' then
    raise exception 'only an open follow-up can be edited' using errcode = '22023';
  end if;
  update public.follow_up_tasks set
    title       = coalesce(p_title, title),
    description = coalesce(p_description, description),
    priority    = coalesce(p_priority, priority),
    due_at      = case when p_clear_due then null else coalesce(p_due_at, due_at) end,
    version     = version + 1
  where id = p_follow_up_id;
end;
$$;

create or replace function public.complete_follow_up(p_follow_up_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_t public.follow_up_tasks;
begin
  select * into v_t from public.follow_up_tasks where id = p_follow_up_id for update;
  if not found then raise exception 'follow-up not found'; end if;
  if not (app.has_capability(v_t.organization_id, 'sales.write') or app.can_manage_sales(v_t.organization_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  if not app.can_act_on_follow_up(v_t) then
    raise exception 'follow-up not in caller scope' using errcode = '42501';
  end if;
  if v_t.status = 'cancelled' then
    raise exception 'a cancelled follow-up cannot be completed' using errcode = '22023';
  end if;
  if v_t.status = 'completed' then return; end if;  -- idempotent
  update public.follow_up_tasks set status = 'completed', completed_at = now(), version = version + 1
  where id = p_follow_up_id;
  perform app.record_audit_event('followup.completed', 'follow_up', p_follow_up_id, v_t.organization_id, '{}'::jsonb);
end;
$$;

create or replace function public.reopen_follow_up(p_follow_up_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_t public.follow_up_tasks;
begin
  select * into v_t from public.follow_up_tasks where id = p_follow_up_id for update;
  if not found then raise exception 'follow-up not found'; end if;
  if not (app.has_capability(v_t.organization_id, 'sales.write') or app.can_manage_sales(v_t.organization_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  if not app.can_act_on_follow_up(v_t) then
    raise exception 'follow-up not in caller scope' using errcode = '42501';
  end if;
  if v_t.status <> 'completed' then
    raise exception 'only a completed follow-up can be reopened' using errcode = '22023';
  end if;
  update public.follow_up_tasks set status = 'open', completed_at = null, version = version + 1
  where id = p_follow_up_id;
  perform app.record_audit_event('followup.reopened', 'follow_up', p_follow_up_id, v_t.organization_id, '{}'::jsonb);
end;
$$;

create or replace function public.cancel_follow_up(p_follow_up_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_t public.follow_up_tasks;
begin
  select * into v_t from public.follow_up_tasks where id = p_follow_up_id for update;
  if not found then raise exception 'follow-up not found'; end if;
  if not (app.has_capability(v_t.organization_id, 'sales.write') or app.can_manage_sales(v_t.organization_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  if not app.can_act_on_follow_up(v_t) then
    raise exception 'follow-up not in caller scope' using errcode = '42501';
  end if;
  if v_t.status = 'completed' then
    raise exception 'a completed follow-up cannot be cancelled' using errcode = '22023';
  end if;
  if v_t.status = 'cancelled' then return; end if;  -- idempotent
  update public.follow_up_tasks set status = 'cancelled', version = version + 1 where id = p_follow_up_id;
end;
$$;

create or replace function public.reassign_follow_up(
  p_follow_up_id uuid,
  p_assignee_membership_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_t public.follow_up_tasks;
begin
  select * into v_t from public.follow_up_tasks where id = p_follow_up_id for update;
  if not found then raise exception 'follow-up not found'; end if;
  if not (app.has_capability(v_t.organization_id, 'sales.assign') or app.can_manage_sales(v_t.organization_id)) then
    raise exception 'sales.assign required' using errcode = '42501';
  end if;
  if not (app.can_manage_sales(v_t.organization_id)
          or (v_t.branch_id is not null and v_t.branch_id in (select app.current_branch_ids(v_t.organization_id)))) then
    raise exception 'follow-up not in caller scope' using errcode = '42501';
  end if;
  if v_t.status <> 'open' then
    raise exception 'only an open follow-up can be reassigned' using errcode = '22023';
  end if;
  if not app.membership_can_access_branch(p_assignee_membership_id, v_t.branch_id) then
    raise exception 'assignee cannot access this branch' using errcode = '22023';
  end if;
  update public.follow_up_tasks set assigned_membership_id = p_assignee_membership_id, version = version + 1
  where id = p_follow_up_id;
  perform app.record_audit_event('followup.reassigned', 'follow_up', p_follow_up_id, v_t.organization_id,
    jsonb_build_object('from', v_t.assigned_membership_id, 'to', p_assignee_membership_id));
end;
$$;

-- ===========================================================================
-- 5. Execute grants — authenticated only (no PUBLIC/anon/service_role).
--    A service-role key is not a business-authorization path (ADR-0008/D17).
-- ===========================================================================
revoke execute on function public.create_customer(uuid, text, public.customer_type, uuid, text, text, text, text, public.sales_source, uuid) from public;
revoke execute on function public.update_customer(uuid, text, text, text, text, text, public.sales_source, boolean) from public;
revoke execute on function public.create_lead(uuid, text, uuid, uuid, public.sales_source, public.sales_priority, uuid, timestamptz) from public;
revoke execute on function public.update_lead_details(uuid, integer, text, public.sales_priority, timestamptz, uuid, boolean) from public;
revoke execute on function public.assign_lead(uuid, uuid, integer) from public;
revoke execute on function public.transition_lead(uuid, integer, public.lead_stage, public.lead_status, text) from public;
revoke execute on function public.add_sales_activity(uuid, public.sales_activity_type, text, uuid, uuid, timestamptz, jsonb) from public;
revoke execute on function public.create_follow_up(uuid, text, uuid, uuid, uuid, timestamptz, public.sales_priority, text) from public;
revoke execute on function public.update_follow_up(uuid, text, text, timestamptz, public.sales_priority, boolean) from public;
revoke execute on function public.complete_follow_up(uuid) from public;
revoke execute on function public.reopen_follow_up(uuid) from public;
revoke execute on function public.cancel_follow_up(uuid) from public;
revoke execute on function public.reassign_follow_up(uuid, uuid) from public;

grant execute on function public.create_customer(uuid, text, public.customer_type, uuid, text, text, text, text, public.sales_source, uuid) to authenticated;
grant execute on function public.update_customer(uuid, text, text, text, text, text, public.sales_source, boolean) to authenticated;
grant execute on function public.create_lead(uuid, text, uuid, uuid, public.sales_source, public.sales_priority, uuid, timestamptz) to authenticated;
grant execute on function public.update_lead_details(uuid, integer, text, public.sales_priority, timestamptz, uuid, boolean) to authenticated;
grant execute on function public.assign_lead(uuid, uuid, integer) to authenticated;
grant execute on function public.transition_lead(uuid, integer, public.lead_stage, public.lead_status, text) to authenticated;
grant execute on function public.add_sales_activity(uuid, public.sales_activity_type, text, uuid, uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.create_follow_up(uuid, text, uuid, uuid, uuid, timestamptz, public.sales_priority, text) to authenticated;
grant execute on function public.update_follow_up(uuid, text, text, timestamptz, public.sales_priority, boolean) to authenticated;
grant execute on function public.complete_follow_up(uuid) to authenticated;
grant execute on function public.reopen_follow_up(uuid) to authenticated;
grant execute on function public.cancel_follow_up(uuid) to authenticated;
grant execute on function public.reassign_follow_up(uuid, uuid) to authenticated;

-- ===========================================================================
-- 6. Dashboard read models — security_invoker views so RLS scopes every row to
--    the caller BEFORE aggregation (a branch-limited user never sees org-wide
--    metrics). Read foundation only; no UI, no cross-scope leakage.
-- ===========================================================================
create view public.sales_lead_stage_counts with (security_invoker = true) as
  select organization_id, stage, count(*)::bigint as lead_count
  from public.leads
  where status = 'active'
  group by organization_id, stage;
comment on view public.sales_lead_stage_counts is 'Active-lead counts by stage within the caller''s visible scope (RLS-filtered before aggregation).';

create view public.sales_my_open_leads with (security_invoker = true) as
  select l.*
  from public.leads l
  where l.status = 'active'
    and l.assigned_membership_id in (
      select m.id from public.memberships m
      where m.user_id = (select auth.uid()) and m.status = 'active'
    );
comment on view public.sales_my_open_leads is 'Active leads assigned to the caller (their working queue).';

create view public.sales_overdue_follow_ups with (security_invoker = true) as
  select * from public.follow_up_tasks
  where status = 'open' and due_at is not null and due_at < now();
comment on view public.sales_overdue_follow_ups is 'Open, past-due follow-ups within the caller''s visible scope.';

create view public.sales_follow_ups_due_today with (security_invoker = true) as
  select * from public.follow_up_tasks
  where status = 'open' and due_at is not null
    and due_at >= date_trunc('day', now()) and due_at < date_trunc('day', now()) + interval '1 day';
comment on view public.sales_follow_ups_due_today is 'Open follow-ups due today within the caller''s visible scope.';

create view public.sales_recent_activities with (security_invoker = true) as
  select * from public.sales_activities
  order by created_at desc;
comment on view public.sales_recent_activities is 'Recent sales-timeline activities within the caller''s visible scope.';

grant select on public.sales_lead_stage_counts    to authenticated;
grant select on public.sales_my_open_leads         to authenticated;
grant select on public.sales_overdue_follow_ups    to authenticated;
grant select on public.sales_follow_ups_due_today  to authenticated;
grant select on public.sales_recent_activities     to authenticated;
