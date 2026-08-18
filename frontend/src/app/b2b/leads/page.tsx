import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listLeads, customerNameMap, memberNameMap } from "@/server/queries/sales";
import { canWrite } from "@/server/queries/context";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { TargetIcon } from "@/components/ui/icons";
import { LeadsView } from "@/features/sales/leads-view";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    stage?: string;
    status?: string;
    branch?: string;
    priority?: string;
    assignee?: string;
  }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const branchId = sp.branch ?? org.activeBranchId ?? undefined;

  const [leads, custNames, memberNames] = await Promise.all([
    listLeads(supabase, {
      orgId: org.organizationId,
      branchId: branchId ?? undefined,
      status: (sp.status as "active" | "won" | "lost" | "archived") || undefined,
      stage: sp.stage,
      priority: sp.priority,
      assigneeMembershipId: sp.assignee,
    }),
    customerNameMap(supabase, org.organizationId),
    memberNameMap(supabase, org.organizationId),
  ]);

  return (
    <div className="pb-16 tablet:pb-0">
      <PageHeader
        Icon={TargetIcon}
        title={m.leads.title}
        subtitle={m.leads.subtitle}
        count={leads.length}
        action={canWrite(org) ? { href: "/b2b/leads/new", label: m.leads.new } : undefined}
      />

      {leads.length === 0 && !sp.stage && !sp.status ? (
        <StatePanel icon={<TargetIcon size={20} />} title={m.leads.empty} body={m.leads.emptyHint} />
      ) : (
        <LeadsView
          leads={leads}
          customerNames={Object.fromEntries(custNames)}
          memberNames={Object.fromEntries(memberNames)}
          branches={org.branches}
          defaults={{
            view: sp.view === "pipeline" ? "pipeline" : "list",
            stage: sp.stage ?? "",
            status: sp.status ?? "",
            branch: sp.branch ?? "",
            priority: sp.priority ?? "",
          }}
        />
      )}
    </div>
  );
}
