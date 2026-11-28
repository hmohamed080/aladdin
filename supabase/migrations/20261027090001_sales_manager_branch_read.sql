-- ===========================================================================
-- Sales Manager reads the organization's branches (hosted acceptance finding,
-- 2026-10-27, owner decision "Managers read all branches").
--
-- PROBLEM. Sales authority is org-wide for a Sales Manager:
-- app.can_manage_sales(org) = has_capability(sales.manage) OR has_capability(org.manage),
-- and leads/customers/follow_up_tasks/sales_activities show a manager every row of
-- the organization. The frontend agrees (frontend/src/server/queries/context.ts:
-- canManageSales -> the organization's full branch list). But
-- branches_select_member (20260802090002) only opens every branch to org.manage
-- or branch.manage; anyone else sees the branches in app.current_branch_ids(),
-- i.e. their membership_branch_access rows. A Sales Manager is org-wide by design
-- and has NO branch rows, so they read ZERO branches: no branch filter on
-- /b2b/customers, "location not set", empty branch names in Sales lists.
--
-- FIX (forward-only, policy only): re-create branches_select_member with one more
-- branch: app.can_manage_sales(organization_id). Read-only (SELECT policy); no
-- write policy, function, grant or capability changes.
--
-- WHY THE POLICY AND NOT app.current_branch_ids(). current_branch_ids() also
-- scopes the branch-limited arm of the leads/customers/follow_up_tasks/
-- sales_activities policies. Those already admit can_manage_sales on their own,
-- so widening the function would change nothing there today, but would silently
-- widen any FUTURE branch-scoped table to Sales Managers. Keeping the change in
-- the one branches policy keeps that function's meaning (org.manage /
-- branch.manage / assigned branches) unchanged.
--
-- UNCHANGED: branches_select_platform, every branches write policy,
-- app.current_branch_ids(), app.can_manage_sales(), all Sales policies. Tenant
-- isolation holds: app.is_org_member(organization_id) still gates the row, and
-- can_manage_sales is evaluated for the row's own organization.
-- ===========================================================================

drop policy if exists branches_select_member on public.branches;

create policy branches_select_member on public.branches
  for select to authenticated
  using (
    deleted_at is null
    and app.is_org_member(organization_id)
    and (
      app.has_capability(organization_id, 'org.manage')
      or app.has_capability(organization_id, 'branch.manage')
      or app.can_manage_sales(organization_id)
      or id in (select app.current_branch_ids(organization_id))
    )
  );
