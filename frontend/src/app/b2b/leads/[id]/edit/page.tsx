import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getLead } from "@/server/queries/sales";
import { canWrite } from "@/server/queries/context";
import { PageHeader, BackLink } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { LeadEditForm } from "@/features/sales/lead-edit-form";

export const dynamic = "force-dynamic";

export default async function LeadEditPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { id } = await params;

  const lead = await getLead(supabase, id);
  if (!lead) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href="/b2b/leads">{m.leads.title}</BackLink>
        <StatePanel title={m.states.notFoundTitle} body={m.states.notFoundBody} />
      </div>
    );
  }
  if (!canWrite(org)) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href={`/b2b/leads/${id}`}>{lead.title}</BackLink>
        <StatePanel title={m.states.permissionTitle} body={m.states.permissionBody} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <div>
        <BackLink href={`/b2b/leads/${id}`}>{lead.title}</BackLink>
        <PageHeader title={m.leads.editTitle} />
      </div>
      <LeadEditForm lead={lead} />
    </div>
  );
}
