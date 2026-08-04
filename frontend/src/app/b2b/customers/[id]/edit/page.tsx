import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getCustomer, branchNameMap, memberNameMap } from "@/server/queries/sales";
import { canWrite } from "@/server/queries/context";
import { PageHeader, BackLink } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { CustomerEditForm } from "@/features/sales/customer-edit-form";

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

  const [branchNames, memberNames] = await Promise.all([
    branchNameMap(supabase, org.organizationId),
    memberNameMap(supabase, org.organizationId),
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
        <PageHeader title={m.customers.editTitle} />
      </div>
      <CustomerEditForm customer={customer} branchName={branchName} assigneeName={assigneeName} />
    </div>
  );
}
