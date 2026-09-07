-- =============================================================================
-- CRM assignment name resolution — a minimal read-model `sales.assign` holders
-- can actually call, scoped to the SAME branch a write RPC will validate.
--
-- THE GAP THIS CLOSES (round 1). Every write path that assigns a customer,
-- lead or follow-up to a teammate (`set_customer_ownership`,
-- `set_lead_source_branch`, `reassign_follow_up`, and the optional assignee
-- on `create_customer` / `create_lead` / `create_follow_up`) is gated on
-- `sales.assign` OR org-wide sales authority (`app.can_manage_sales`) — never
-- on `org.members.manage`. The frontend's own `canAssign()` gate already
-- mirrors that predicate on every Customers/Leads/Follow-ups assignment
-- surface. But the only existing read-model that can resolve a MEMBER's
-- identity (`public.profiles` is locked to `select self only`, so a plain
-- join returns nothing for a teammate) was `org_members_list`, gated on
-- `org.members.manage` — the broader People-management capability. A member
-- holding exactly the `sales_manager` preset (`sales.read/write/assign/
-- manage`, no `org.members.manage` — a real, UI-offered role, see
-- `frontend/src/lib/org/roles.ts`) legitimately reaches every assignment
-- dropdown and then gets refused by the identity read-model underneath it.
--
-- THE GAP THIS CLOSES (round 2 — this revision). The round-1 fix returned
-- every ACTIVE member of the org, unfiltered by branch, reasoning that "the
-- write RPCs remain the final branch-compatibility enforcer via
-- app.membership_can_access_branch()." That is necessary for security but
-- insufficient for the product contract: a branch-scoped `sales.assign`
-- holder could be OFFERED a teammate's name from a branch they have no
-- access to, and would only discover the assignment is impossible when the
-- write RPC rejects it. This revision makes the function branch-aware: it
-- accepts the SAME branch context (`p_branch_id`) the caller is about to
-- assign within, applies the caller's own branch authority under the exact
-- rule the write RPCs use (`v_is_mgr OR p_branch_id in
-- app.current_branch_ids(p_org_id)` — see `set_customer_ownership` /
-- `set_lead_source_branch` / `create_customer` / `create_lead`), and filters
-- returned targets through `app.membership_can_access_branch()` — the
-- IDENTICAL function every write RPC calls as its own target-eligibility
-- check. The list can therefore never offer a name the write RPC would go on
-- to reject for that same branch. `p_branch_id = null` is the real, legitimate
-- "org-wide record" context (matching a null `branch_id` on customers/leads/
-- follow_up_tasks): only org-wide sales authority may query or receive it,
-- exactly as only org-wide authority may create or move a record to a null
-- branch today.
--
-- THE FIX. A new, narrow read-model authorized on the SAME predicate the
-- write paths already use, filtered by the SAME branch-compatibility
-- function the write paths already use, returning ONLY what an assignment
-- dropdown needs (`membership_id`, `display_name`) — none of
-- `org_members_list`'s broader People-screen columns (masked email, account
-- type, status, branch scope, capability array). `org_members_list` itself
-- is UNCHANGED — this does not widen it, and does not touch
-- `org.members.manage`'s meaning anywhere.
--
-- This migration has never been deployed (pending on every environment), so
-- it is revised in place rather than superseded by a second migration.
-- Forward-only from the perspective of every environment that will ever see
-- it; no existing object is touched.
-- =============================================================================

drop function if exists public.sales_assignable_members(uuid);

create function public.sales_assignable_members(p_org_id uuid, p_branch_id uuid default null)
returns table (
  membership_id uuid,
  display_name  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_mgr boolean;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  -- Membership in the TARGET org, checked before anything else: a caller
  -- cannot reach this function's result set for an org they do not belong to,
  -- regardless of what they hold in their own org. This is what prevents
  -- cross-organization enumeration.
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  -- The exact predicate every assignment write path already requires
  -- (set_customer_ownership, set_lead_source_branch's reassignment branch,
  -- reassign_follow_up) — never org.members.manage.
  if not (app.has_capability(p_org_id, 'sales.assign') or app.can_manage_sales(p_org_id)) then
    raise exception 'sales.assign required' using errcode = '42501';
  end if;

  v_is_mgr := app.can_manage_sales(p_org_id);

  -- A non-null branch must genuinely belong to this org — a clean, explicit
  -- validation error rather than a raw cross-org id silently sorting into
  -- "not in caller scope" below (mirrors set_customer_ownership /
  -- set_lead_source_branch's own "branch not in this organization" check).
  if p_branch_id is not null
     and not exists (
       select 1 from public.branches b
       where b.id = p_branch_id and b.organization_id = p_org_id
     ) then
    raise exception 'branch not in this organization' using errcode = '22023';
  end if;

  -- Caller branch authority — IDENTICAL to the write RPCs' own caller-scope
  -- check: org-wide sales authority reaches every branch (and the null/
  -- org-wide context); anyone else must hold an explicit grant for THIS
  -- branch. A null p_branch_id with a non-manager caller falls through to
  -- "false" here exactly as it does in create_customer/create_lead/
  -- set_customer_ownership/set_lead_source_branch ("org-wide requires
  -- sales.manage") — a branch-scoped sales.assign holder can never query the
  -- org-wide bucket.
  if not (v_is_mgr or (p_branch_id is not null and p_branch_id in (select app.current_branch_ids(p_org_id)))) then
    raise exception 'branch not in caller scope' using errcode = '42501';
  end if;

  return query
    select m.id, coalesce(p.display_name, '')
    from public.memberships m
    left join public.profiles p on p.user_id = m.user_id
    where m.organization_id = p_org_id
      -- The IDENTICAL target-eligibility function every write RPC calls
      -- (assign_lead, set_customer_ownership, set_lead_source_branch,
      -- reassign_follow_up, create_customer, create_lead, create_follow_up)
      -- to validate a chosen assignee — active status, org-wide caps reach
      -- every branch of their own org (or null/org-wide), otherwise an
      -- explicit membership_branch_access grant for this exact branch. A
      -- name can never appear here that the corresponding write RPC would
      -- go on to reject for p_branch_id.
      and app.membership_can_access_branch(m.id, p_branch_id)
    order by coalesce(p.display_name, '');
end;
$$;

comment on function public.sales_assignable_members(uuid, uuid) is
  'Minimal, branch-aware assignee read-model for CRM assignment dropdowns (Customers/Leads/Follow-ups): membership_id + display_name only, for candidates active, same-org, and branch-compatible (app.membership_can_access_branch) with p_branch_id (null = org-wide record). Gated on sales.assign or org-wide sales authority for the org AND that specific branch — the same predicate and the same target-eligibility function the assignment write RPCs already enforce, never org.members.manage. A returned membership_id can never be rejected by the corresponding write RPC for that same branch. Distinct from org_members_list (the broader, org.members.manage-gated People-screen read-model), which this does not widen or replace.';

-- ---------------------------------------------------------------------------
-- Grants (deny-by-default; authenticated callers only — a service-role key is
-- not a business-authorization path, ADR-0008/D17).
-- ---------------------------------------------------------------------------
revoke execute on function public.sales_assignable_members(uuid, uuid) from public;
grant execute on function public.sales_assignable_members(uuid, uuid) to authenticated;
