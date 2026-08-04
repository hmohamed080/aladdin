import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  getLead,
  listActivitiesForLead,
  listFollowUpsForLead,
  listOrgMembers,
  customerNameMap,
  branchNameMap,
  memberNameMap,
} from "@/server/queries/sales";
import { canWrite, canAssign } from "@/server/queries/context";
import { formatDate } from "@/lib/ui/format";
import { PageHeader, BackLink, FlashSuccess } from "@/features/sales/page-parts";
import { Card, Field, StatePanel, SectionTitle } from "@/components/ui/primitives";
import { StageBadge, StatusBadge, PriorityBadge, FollowUpStatusBadge } from "@/features/sales/badges";
import { ActivityTimeline } from "@/features/sales/activity-timeline";
import { LeadActions } from "@/features/sales/lead-actions";
import { LeadActivityForm } from "@/features/sales/lead-activity-form";
import { InlineFollowUpForm } from "@/features/sales/follow-up-inline";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { id } = await params;
  const { created } = await searchParams;

  const lead = await getLead(supabase, id);
  if (!lead) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href="/b2b/leads">{m.leads.title}</BackLink>
        <StatePanel title={m.states.notFoundTitle} body={m.states.notFoundBody} />
      </div>
    );
  }

  const [activities, followUps, custNames, branchNames, memberNames, members] = await Promise.all([
    listActivitiesForLead(supabase, id),
    listFollowUpsForLead(supabase, id),
    customerNameMap(supabase, org.organizationId),
    branchNameMap(supabase, org.organizationId),
    memberNameMap(supabase, org.organizationId),
    canAssign(org) ? listOrgMembers(supabase, org.organizationId) : Promise.resolve([]),
  ]);
  const cn = Object.fromEntries(custNames);
  const bn = Object.fromEntries(branchNames);
  const mn = Object.fromEntries(memberNames);

  const writable = canWrite(org);
  const openFollowUps = followUps.filter((f) => f.status === "open");
  const doneFollowUps = followUps.filter((f) => f.status !== "open");

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <div>
        <BackLink href="/b2b/leads">{m.leads.title}</BackLink>
        {created ? <FlashSuccess messageKey="leads.created" /> : null}
        <PageHeader title={lead.title} />
        <div className="flex flex-wrap items-center gap-1">
          <StageBadge stage={lead.stage} />
          <StatusBadge status={lead.status} />
          <PriorityBadge priority={lead.priority} />
        </div>
      </div>

      <div className="grid gap-lg desktop:grid-cols-3">
        {/* Left: summary + actions */}
        <div className="flex flex-col gap-lg desktop:col-span-1">
          <Card>
            <SectionTitle className="mb-md">{m.leads.detailsTitle}</SectionTitle>
            <dl className="flex flex-col gap-md">
              <Field label={m.leads.customer}>
                {lead.customer_id ? cn[lead.customer_id] ?? "—" : m.common.none}
              </Field>
              <Field label={m.customers.branch}>{lead.branch_id ? bn[lead.branch_id] ?? "—" : m.common.none}</Field>
              <Field label={m.leads.assign}>
                {lead.assigned_membership_id ? mn[lead.assigned_membership_id] ?? "—" : m.common.unassigned}
              </Field>
              <Field label={m.leads.nextFollowUp}>{formatDate(lead.next_follow_up_at, locale)}</Field>
              {lead.status === "lost" && lead.lost_reason ? (
                <Field label={m.leads.lostReason}>{lead.lost_reason}</Field>
              ) : null}
              <Field label={m.leads.lastUpdated}>{formatDate(lead.updated_at, locale)}</Field>
            </dl>
          </Card>

          {writable ? (
            <LeadActions
              leadId={lead.id}
              version={lead.version}
              status={lead.status}
              stage={lead.stage}
              canAssign={canAssign(org)}
              members={members}
            />
          ) : null}
        </div>

        {/* Right: timeline + follow-ups */}
        <div className="flex flex-col gap-lg desktop:col-span-2">
          {writable ? (
            <Card>
              <SectionTitle className="mb-md">{m.leads.timeline}</SectionTitle>
              <LeadActivityForm orgId={org.organizationId} leadId={lead.id} />
              <div className="mt-md">
                {activities.length === 0 ? (
                  <p className="text-body text-fg-secondary">{m.activities.empty}</p>
                ) : (
                  <ActivityTimeline activities={activities} />
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <SectionTitle className="mb-md">{m.leads.timeline}</SectionTitle>
              {activities.length === 0 ? (
                <p className="text-body text-fg-secondary">{m.activities.empty}</p>
              ) : (
                <ActivityTimeline activities={activities} />
              )}
            </Card>
          )}

          <Card>
            <SectionTitle className="mb-md">{m.leads.openFollowUps}</SectionTitle>
            {writable ? (
              <InlineFollowUpForm
                orgId={org.organizationId}
                leadId={lead.id}
                members={members}
                canAssign={canAssign(org)}
                selfMembershipId={org.membershipId}
              />
            ) : null}
            <div className="mt-md">
              {openFollowUps.length === 0 ? (
                <p className="text-body text-fg-secondary">{m.followUps.empty}</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {openFollowUps.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-md py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-lg text-fg">{f.title}</span>
                        <span className="text-label text-fg-muted">{formatDate(f.due_at, locale)}</span>
                      </span>
                      <FollowUpStatusBadge status={f.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {doneFollowUps.length > 0 ? (
              <details className="mt-md">
                <summary className="cursor-pointer text-label text-fg-secondary">
                  {m.leads.completedFollowUps} ({doneFollowUps.length})
                </summary>
                <ul className="mt-sm flex flex-col divide-y">
                  {doneFollowUps.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-md py-2 text-fg-muted">
                      <span className="min-w-0 flex-1 truncate">{f.title}</span>
                      <FollowUpStatusBadge status={f.status} />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
