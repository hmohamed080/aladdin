import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listOrgMembers } from "@/server/queries/sales";
import { canWrite, canAssign } from "@/server/queries/context";
import { PageHeader } from "@/components/ui/workspace-layout";
import { BackLink } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { LeadForm } from "@/features/sales/lead-form";

export const dynamic = "force-dynamic";

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { customer } = await searchParams;

  if (!canWrite(org)) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href="/b2b/leads">{m.leads.title}</BackLink>
        <StatePanel title={m.states.permissionTitle} body={m.states.permissionBody} tone="warning" />
      </div>
    );
  }

  // Customer picklist (active customers in scope) + members for assignment.
  const [{ data: custData }, members] = await Promise.all([
    supabase
      .from("customers")
      .select("id, display_name")
      .eq("organization_id", org.organizationId)
      .eq("status", "active")
      .order("display_name")
      .limit(500),
    canAssign(org) ? listOrgMembers(supabase, org.organizationId) : Promise.resolve([]),
  ]);
  const customers = (custData ?? []).map((c) => ({ id: c.id, name: c.display_name }));

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href="/b2b/leads">{m.leads.title}</BackLink>
      <PageHeader locale={locale} title={m.leads.createTitle} />
      <LeadForm
        orgId={org.organizationId}
        branches={org.branches}
        customers={customers}
        members={members}
        canManageSales={org.canManageSales}
        canAssign={canAssign(org)}
        presetCustomerId={customer}
      />
    </div>
  );
}
