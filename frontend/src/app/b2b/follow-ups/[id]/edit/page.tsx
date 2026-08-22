import Link from "next/link";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getFollowUp, listOrgMembers } from "@/server/queries/sales";
import { canWrite, canAssign } from "@/server/queries/context";
import { PageHeader } from "@/components/ui/workspace-layout";
import { BackLink } from "@/features/sales/page-parts";
import { StatePanel, SectionTitle } from "@/components/ui/primitives";
import { FollowUpEditForm } from "@/features/sales/follow-up-edit-form";
import { ReassignFollowUpForm } from "@/features/sales/reassign-follow-up-form";

export const dynamic = "force-dynamic";

export default async function FollowUpEditPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { id } = await params;

  const followUp = await getFollowUp(supabase, id);
  if (!followUp) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href="/b2b/follow-ups">{m.followUps.title}</BackLink>
        <StatePanel title={m.states.notFoundTitle} body={m.states.notFoundBody} />
      </div>
    );
  }
  if (!canWrite(org)) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href="/b2b/follow-ups">{m.followUps.title}</BackLink>
        <StatePanel title={m.states.permissionTitle} body={m.states.permissionBody} />
      </div>
    );
  }

  const assignable = canAssign(org);
  const members = assignable ? await listOrgMembers(supabase, org.organizationId) : [];

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <div>
        <BackLink href="/b2b/follow-ups">{m.followUps.title}</BackLink>
        <PageHeader locale={locale} title={m.followUps.editTitle} />
      </div>
      {followUp.status === "open" ? (
        <>
          <FollowUpEditForm followUp={followUp} />
          {assignable ? (
            <div className="flex flex-col gap-sm">
              <SectionTitle>{m.followUps.reassign}</SectionTitle>
              <ReassignFollowUpForm
                followUpId={followUp.id}
                version={followUp.version}
                currentAssigneeId={followUp.assigned_membership_id}
                members={members}
                leadId={followUp.lead_id}
                customerId={followUp.customer_id}
              />
            </div>
          ) : null}
        </>
      ) : (
        <StatePanel
          title={m.followUps.notOpen}
          body={m.states.followUpNotOpen}
          action={
            <Link href="/b2b/follow-ups" className="text-label text-accent hover:underline">
              {m.followUps.title} →
            </Link>
          }
        />
      )}
    </div>
  );
}
