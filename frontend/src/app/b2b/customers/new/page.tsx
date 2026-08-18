import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listOrgMembers } from "@/server/queries/sales";
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

  const members = canAssign(org) ? await listOrgMembers(supabase, org.organizationId) : [];

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href="/b2b/customers">{m.customers.title}</BackLink>
      <PageHeader locale={locale} title={m.customers.createTitle} />
      <CustomerForm
        orgId={org.organizationId}
        branches={org.branches}
        members={members}
        canManageSales={org.canManageSales}
        canAssign={canAssign(org)}
      />
    </div>
  );
}
