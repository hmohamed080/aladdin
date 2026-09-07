-- =============================================================================
-- CRM assignment name resolution — a minimal read-model `sales.assign` holders
-- can actually call.
--
-- THE GAP THIS CLOSES. Every write path that assigns a customer, lead or
-- follow-up to a teammate (`set_customer_ownership`, `set_lead_source_branch`,
-- `reassign_follow_up`, and the optional assignee on `create_customer` /
-- `create_lead` / `create_follow_up`) is gated on `sales.assign` OR org-wide
-- sales authority (`app.can_manage_sales`) — never on `org.members.manage`.
-- The frontend's own `canAssign()` gate already mirrors that predicate on
-- every Customers/Leads/Follow-ups assignment surface. But the only existing
-- read-model that can resolve a MEMBER's identity (`public.profiles` is
-- locked to `select self only`, so a plain join returns nothing for a
-- teammate) is `org_members_list`, gated on `org.members.manage` — the
-- broader People-management capability. A member holding exactly the
-- `sales_manager` preset (`sales.read/write/assign/manage`, no
-- `org.members.manage` — a real, UI-offered role, see
-- `frontend/src/lib/org/roles.ts`) legitimately reaches every assignment
-- dropdown and then gets refused by the identity read-model underneath it.
--
-- THE FIX. A new, narrower read-model authorized on the SAME predicate the
-- write paths already use, returning ONLY what an assignment dropdown needs
-- (`membership_id`, `display_name`) — none of `org_members_list`'s broader
-- People-screen columns (masked email, account type, status, branch scope,
-- capability array). `org_members_list` itself is UNCHANGED — this does not
-- widen it, and does not touch `org.members.manage`'s meaning anywhere.
--
-- SCOPE, DELIBERATELY MATCHING TODAY'S BEHAVIOR. Every existing call site
-- (`customers/new`, `customers/[id]/edit`, `leads/new`, `leads/[id]/edit`,
-- `follow-ups/[id]/edit`) already fetches the assignee list unfiltered by
-- branch — the write RPCs are the actual, final branch-compatibility
-- enforcer via `app.membership_can_access_branch()` at submit time, and
-- always have been. This function preserves that: same-org, ACTIVE members
-- only (matching `app.membership_can_access_branch`'s own `status = 'active'`
-- gate, and excluding invited/suspended/revoked exactly as it does), with no
-- branch parameter — adding branch-reactive filtering to the creation forms
-- would be a new UX feature, not part of closing this gap, and would risk
-- hiding legitimate branch-scoped teammates (e.g. a single-branch org's own
-- salesperson) from a form that has not yet asked the caller to pick a
-- branch. Forward-only; no existing object is touched.
-- =============================================================================

create or replace function public.sales_assignable_members(p_org_id uuid)
returns table (
  membership_id uuid,
  display_name  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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

  return query
    select m.id, coalesce(p.display_name, '')
    from public.memberships m
    left join public.profiles p on p.user_id = m.user_id
    where m.organization_id = p_org_id
      and m.status = 'active'
    order by coalesce(p.display_name, '');
end;
$$;

comment on function public.sales_assignable_members(uuid) is
  'Minimal assignee read-model for CRM assignment dropdowns (Customers/Leads/Follow-ups): membership_id + display_name only, gated on sales.assign or org-wide sales authority — the same predicate the assignment write RPCs already enforce, never org.members.manage. Distinct from org_members_list (the broader, org.members.manage-gated People-screen read-model), which this does not widen or replace.';

-- ---------------------------------------------------------------------------
-- Grants (deny-by-default; authenticated callers only — a service-role key is
-- not a business-authorization path, ADR-0008/D17).
-- ---------------------------------------------------------------------------
revoke execute on function public.sales_assignable_members(uuid) from public;
grant execute on function public.sales_assignable_members(uuid) to authenticated;
