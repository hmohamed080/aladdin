-- =============================================================================
-- Sprint 6 — Sales ownership edit paths + scoped Realtime publication.
--
-- Two gaps remained after Sprint 5: a customer's owning BRANCH and SALESPERSON
-- could not be changed after creation, and a lead's SOURCE and BRANCH could not
-- either (the existing update RPCs deliberately excluded these ownership axes).
-- This migration adds two minimal, trusted, audited, optimistic-concurrent RPCs
-- and nothing else on the write side. `customer_type` stays IMMUTABLE: no
-- product/domain document approves mutating it, so per the sprint rule it is not
-- made editable (a mis-typed customer is corrected by archive + re-create, which
-- preserves the audit trail).
--
-- It also publishes the two approved sales tables to `supabase_realtime` so the
-- lead pipeline and follow-up board can refresh when another user changes data.
-- RLS remains the security boundary — Realtime authorizes every change against
-- the subscriber's own policies, and the client treats events as a refresh hint
-- only (it re-fetches through RLS; it never renders a Realtime payload). Design:
-- ADR-0008 (sales domain), 06_rls_strategy.md, 07_permissions_matrix.md.
--
-- Forward-only. No existing object is dropped; two functions are added and the
-- audit-action allow-list gains two rows.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit action allow-list — add the two ownership-change events.
--    (Re-declared in full; the two new rows are the last two.)
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
  -- Sprint 6 — ownership edits.
  'customer.reassigned', 'lead.details_changed'
));

-- ---------------------------------------------------------------------------
-- 2. set_customer_ownership — change a customer's branch and/or assignee.
--
--    Ownership is an assignment-class operation, so it requires `sales.assign`
--    (or org-wide sales authority). A non-manager may only move a customer
--    BETWEEN branches they can access, and may never create an org-wide
--    (null-branch) customer. The assignee must stay branch-compatible: if a
--    branch move would strand the current assignee, the caller must reassign in
--    the same call (never a silent unassign). Optimistic-concurrent on the
--    trigger-maintained `updated_at`; audited in the same transaction; nothing is
--    written and no audit row is created on any failure or conflict.
-- ---------------------------------------------------------------------------
create function public.set_customer_ownership(
  p_customer_id                uuid,
  p_expected_updated_at        timestamptz,
  p_change_branch              boolean default false,
  p_new_branch_id              uuid default null,
  p_change_assignee            boolean default false,
  p_new_assignee_membership_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.customers; v_caller_mem uuid;
  v_new_branch uuid; v_new_assignee uuid; v_is_mgr boolean;
begin
  if not (p_change_branch or p_change_assignee) then
    raise exception 'no ownership change requested' using errcode = '22023';
  end if;

  select * into v_c from public.customers where id = p_customer_id for update;
  if not found then raise exception 'customer not found'; end if;

  v_is_mgr := app.can_manage_sales(v_c.organization_id);
  if not (app.has_capability(v_c.organization_id, 'sales.assign') or v_is_mgr) then
    raise exception 'sales.assign required' using errcode = '42501';
  end if;
  -- Caller must currently be able to act on the customer: a manager, or a
  -- branch member of the customer's CURRENT branch. (Org-wide customers can only
  -- be moved by a manager.)
  if not (v_is_mgr
          or (v_c.branch_id is not null and v_c.branch_id in (select app.current_branch_ids(v_c.organization_id)))) then
    raise exception 'customer not in caller scope' using errcode = '42501';
  end if;

  -- Optimistic concurrency (checked under the row lock).
  if p_expected_updated_at is not null and v_c.updated_at <> p_expected_updated_at then
    raise exception 'customer was modified concurrently (stale update rejected)' using errcode = '40001';
  end if;

  v_new_branch   := case when p_change_branch   then p_new_branch_id              else v_c.branch_id end;
  v_new_assignee := case when p_change_assignee then p_new_assignee_membership_id else v_c.assigned_membership_id end;

  if p_change_branch then
    if not v_is_mgr then
      if v_new_branch is null then
        raise exception 'org-wide customers require sales.manage' using errcode = '42501';
      end if;
      if v_new_branch not in (select app.current_branch_ids(v_c.organization_id)) then
        raise exception 'branch not in caller scope' using errcode = '42501';
      end if;
    end if;
    -- Cross-tenant branch is impossible by construction, but reject early with a
    -- clean error rather than a raw FK violation.
    if v_new_branch is not null
       and not exists (select 1 from public.branches b
                       where b.id = v_new_branch and b.organization_id = v_c.organization_id) then
      raise exception 'branch not in this organization' using errcode = '22023';
    end if;
  end if;

  -- The effective assignee (new or retained) must be able to access the effective
  -- branch. This rejects a branch move that would strand the current assignee
  -- unless the caller supplies a compatible reassignment in the same call.
  if v_new_assignee is not null
     and not app.membership_can_access_branch(v_new_assignee, v_new_branch) then
    raise exception 'assignee cannot access this branch' using errcode = '22023';
  end if;

  update public.customers set
    branch_id              = v_new_branch,
    assigned_membership_id = v_new_assignee
  where id = p_customer_id;

  perform app.record_audit_event('customer.reassigned', 'customer', p_customer_id, v_c.organization_id,
    jsonb_build_object(
      'from_branch', v_c.branch_id, 'to_branch', v_new_branch,
      'from_assignee', v_c.assigned_membership_id, 'to_assignee', v_new_assignee));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. set_lead_source_branch — change a lead's source and/or branch.
--
--    LIFECYCLE IS OUT OF BOUNDS: this RPC never touches status/stage/won/lost/
--    closed_at/lost_reason (those stay in transition_lead). Source-only edits
--    need `sales.write`; a branch move or reassignment is ownership-class and
--    additionally needs `sales.assign`. A branch move must keep the assignee
--    branch-compatible — either the current assignee already can access the new
--    branch, or the caller reassigns to a compatible member in the same call.
--    Optimistic-concurrent on the lead `version`; audited transactionally.
-- ---------------------------------------------------------------------------
create function public.set_lead_source_branch(
  p_lead_id                uuid,
  p_expected_version       integer,
  p_change_source          boolean default false,
  p_new_source             public.sales_source default null,
  p_change_branch          boolean default false,
  p_new_branch_id          uuid default null,
  p_reassign               boolean default false,
  p_reassign_membership_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.leads; v_caller_mem uuid; v_is_mgr boolean;
  v_new_branch uuid; v_new_source public.sales_source; v_new_assignee uuid;
  v_ownership boolean;
begin
  if not (p_change_source or p_change_branch or p_reassign) then
    raise exception 'no change requested' using errcode = '22023';
  end if;

  select * into v_l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead not found'; end if;

  v_is_mgr := app.can_manage_sales(v_l.organization_id);
  if not (app.has_capability(v_l.organization_id, 'sales.write') or v_is_mgr) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  -- A branch move or a reassignment is ownership-class → needs sales.assign.
  v_ownership := p_change_branch or p_reassign;
  if v_ownership and not (app.has_capability(v_l.organization_id, 'sales.assign') or v_is_mgr) then
    raise exception 'sales.assign required' using errcode = '42501';
  end if;

  v_caller_mem := app.active_membership_id(v_l.organization_id);
  if not (v_is_mgr
          or (v_l.assigned_membership_id is not null and v_l.assigned_membership_id = v_caller_mem)
          or (v_l.branch_id is not null and v_l.branch_id in (select app.current_branch_ids(v_l.organization_id)))) then
    raise exception 'lead not in caller scope' using errcode = '42501';
  end if;

  if v_l.version <> p_expected_version then
    raise exception 'lead was modified concurrently (expected %, found %)', p_expected_version, v_l.version
      using errcode = '40001';
  end if;

  v_new_branch   := case when p_change_branch then p_new_branch_id else v_l.branch_id end;
  v_new_source   := case when p_change_source then p_new_source   else v_l.source end;
  v_new_assignee := case when p_reassign      then p_reassign_membership_id else v_l.assigned_membership_id end;

  if p_change_branch then
    if not v_is_mgr then
      if v_new_branch is null then
        raise exception 'org-wide leads require sales.manage' using errcode = '42501';
      end if;
      if v_new_branch not in (select app.current_branch_ids(v_l.organization_id)) then
        raise exception 'branch not in caller scope' using errcode = '42501';
      end if;
    end if;
    if v_new_branch is not null
       and not exists (select 1 from public.branches b
                       where b.id = v_new_branch and b.organization_id = v_l.organization_id) then
      raise exception 'branch not in this organization' using errcode = '22023';
    end if;
  end if;

  -- The effective assignee must remain compatible with the effective branch.
  -- This is what forbids a silent strand: a branch move that leaves the current
  -- assignee unable to reach the new branch is rejected unless reassigned here.
  if v_new_assignee is not null
     and not app.membership_can_access_branch(v_new_assignee, v_new_branch) then
    raise exception 'assignee is not compatible with the selected branch; reassign to a branch member'
      using errcode = '22023';
  end if;

  update public.leads set
    source                 = v_new_source,
    branch_id              = v_new_branch,
    assigned_membership_id = v_new_assignee,
    version                = version + 1
  where id = p_lead_id;

  -- Reassignment as part of the move gets its own timeline entry (parity with
  -- assign_lead) so the pipeline history stays honest.
  if p_reassign and v_new_assignee is distinct from v_l.assigned_membership_id then
    insert into public.sales_activities (organization_id, branch_id, lead_id, actor_membership_id,
      activity_type, summary, metadata, created_by)
    values (v_l.organization_id, v_new_branch, p_lead_id, v_caller_mem, 'assignment_change',
      'Lead assignment changed',
      jsonb_build_object('from', v_l.assigned_membership_id, 'to', v_new_assignee),
      (select auth.uid()));
  end if;

  perform app.record_audit_event('lead.details_changed', 'lead', p_lead_id, v_l.organization_id,
    jsonb_build_object(
      'from_source', v_l.source, 'to_source', v_new_source,
      'from_branch', v_l.branch_id, 'to_branch', v_new_branch,
      'from_assignee', v_l.assigned_membership_id, 'to_assignee', v_new_assignee));
  return v_l.version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Deny-by-default execute grants (authenticated only — a service-role key is
--    not a business-authorization path, ADR-0008/D17).
-- ---------------------------------------------------------------------------
revoke execute on function public.set_customer_ownership(uuid, timestamptz, boolean, uuid, boolean, uuid) from public;
revoke execute on function public.set_lead_source_branch(uuid, integer, boolean, public.sales_source, boolean, uuid, boolean, uuid) from public;
grant execute on function public.set_customer_ownership(uuid, timestamptz, boolean, uuid, boolean, uuid) to authenticated;
grant execute on function public.set_lead_source_branch(uuid, integer, boolean, public.sales_source, boolean, uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Scoped Realtime publication — ONLY the two approved sales tables.
--    RLS is already enabled on both; Realtime authorizes each change against the
--    subscriber's SELECT policy. No identity/verification/audit/customer-PII
--    table is published. Replica identity stays default (primary key), so UPDATE/
--    DELETE frames carry only the key — the client re-fetches through RLS anyway.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.follow_up_tasks;
