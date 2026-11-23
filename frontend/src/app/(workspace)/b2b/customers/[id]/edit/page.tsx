import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getCustomer, branchNameMap, memberNameMap, listOrgMembersByBranch, type OrgMember } from "@/server/queries/sales";
import { canWrite, canAssign } from "@/server/queries/context";
import { PageHeader } from "@/components/ui/workspace-layout";
import { BackLink } from "@/features/sales/page-parts";
import { Card, StatePanel } from "@/components/ui/primitives";
import { CustomerEditForm } from "@/features/sales/customer-edit-form";
import { CustomerOwnershipForm } from "@/features/sales/customer-ownership-form";

export const dynamic = "force-dynamic";

export default async function CustomerEditPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { id } = await params;

  const customer = await getCustomer(supabase, id);
  if (!customer) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href="/b2b/customers">{m.customers.title}</BackLink>
        <StatePanel title={m.states.notFoundTitle} body={m.states.notFoundBody} />
      </div>
    );
  }
  if (!canWrite(org)) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href={`/b2b/customers/${id}`}>{customer.display_name}</BackLink>
        <StatePanel title={m.states.permissionTitle} body={m.states.permissionBody} />
      </div>
    );
  }

  const canReassign = canAssign(org);
  // The label resolves for ANY viewer with sales.read (memberNameMap degrades
  // safely if the caller can't call the assign-gated RPC); the reactive
  // per-branch map for the ownership form's picker is only ever fetched once
  // canReassign is already confirmed, so a denial there is a real bug, not an
  // expected outcome — see the two helpers' own docs in server/queries/sales.
  const [branchNames, memberNames, membersByBranch] = await Promise.all([
    branchNameMap(supabase, org.organizationId),
    memberNameMap(supabase, org.organizationId, [customer.branch_id]),
    canReassign
      ? listOrgMembersByBranch(supabase, org.organizationId, [
          ...org.branches.map((b) => b.id),
          customer.branch_id,
          ...(org.canManageSales ? [null] : []),
        ])
      : Promise.resolve({} as Record<string, OrgMember[]>),
  ]);
  const branchName = customer.branch_id
    ? branchNames.get(customer.branch_id) ?? "—"
    : m.common.none;
  const assigneeName = customer.assigned_membership_id
    ? memberNames.get(customer.assigned_membership_id) ?? "—"
    : m.common.unassigned;

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <div>
        <BackLink href={`/b2b/customers/${id}`}>{customer.display_name}</BackLink>
        <PageHeader locale={locale} title={m.customers.editTitle} />
      </div>
      <CustomerEditForm customer={customer} branchName={branchName} assigneeName={assigneeName} />

      {canReassign ? (
        <Card className="max-w-2xl">
          <div className="flex flex-col gap-sm">
            <div>
              <h2 className="text-title text-fg">{m.customers.ownershipTitle}</h2>
              <p className="text-label text-fg-muted">{m.customers.ownershipHint}</p>
            </div>
            <dl className="grid grid-cols-2 gap-md rounded-sm border border-dashed p-md text-label">
              <div>
                <dt className="text-fg-muted">{m.customers.branch}</dt>
                <dd className="text-fg">{branchName}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{m.customers.assignee}</dt>
                <dd className="text-fg">{assigneeName}</dd>
              </div>
            </dl>
            <CustomerOwnershipForm
              customerId={customer.id}
              expectedUpdatedAt={customer.updated_at}
              currentBranchId={customer.branch_id}
              currentAssigneeId={customer.assigned_membership_id}
              branches={org.branches}
              membersByBranch={membersByBranch}
              canOrgWide={org.canManageSales}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
