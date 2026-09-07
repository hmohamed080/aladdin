import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listOrgMembersByBranch, type OrgMember } from "@/server/queries/sales";
import { canWrite, canAssign } from "@/server/queries/context";
import { PageHeader } from "@/components/ui/workspace-layout";
import { BackLink } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { CustomerForm } from "@/features/sales/customer-form";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);

  if (!canWrite(org)) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href="/b2b/customers">{m.customers.title}</BackLink>
        <StatePanel title={m.states.permissionTitle} body={m.states.permissionBody} tone="warning" />
      </div>
    );
  }

  const membersByBranch: Record<string, OrgMember[]> = canAssign(org)
    ? await listOrgMembersByBranch(supabase, org.organizationId, [
        ...org.branches.map((b) => b.id),
        ...(org.canManageSales ? [null] : []),
      ])
    : {};

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href="/b2b/customers">{m.customers.title}</BackLink>
      <PageHeader locale={locale} title={m.customers.createTitle} />
      <CustomerForm
        orgId={org.organizationId}
        branches={org.branches}
        membersByBranch={membersByBranch}
        canManageSales={org.canManageSales}
        canAssign={canAssign(org)}
      />
    </div>
  );
}
