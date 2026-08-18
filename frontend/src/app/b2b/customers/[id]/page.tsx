import Link from "next/link";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  getCustomer,
  listLeads,
  listActivitiesForCustomer,
  listFollowUpsForCustomer,
  listOrgMembers,
  branchNameMap,
  memberNameMap,
} from "@/server/queries/sales";
import { canWrite, canAssign } from "@/server/queries/context";
import { formatDate } from "@/lib/ui/format";
import { PageHeader } from "@/components/ui/workspace-layout";
import { BackLink, FlashSuccess } from "@/features/sales/page-parts";
import { Card, Field, StatePanel, SectionTitle } from "@/components/ui/primitives";
import { CustomerStatusBadge, StageBadge, StatusBadge, FollowUpStatusBadge } from "@/features/sales/badges";
import { ActivityTimeline } from "@/features/sales/activity-timeline";
import { ArchiveCustomerButton } from "@/features/sales/customer-actions";
import { LeadActivityForm } from "@/features/sales/lead-activity-form";
import { InlineFollowUpForm } from "@/features/sales/follow-up-inline";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string; archived?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { id } = await params;
  const { created, updated, archived } = await searchParams;

  const customer = await getCustomer(supabase, id);
  if (!customer) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href="/b2b/customers">{m.customers.title}</BackLink>
        <StatePanel title={m.states.notFoundTitle} body={m.states.notFoundBody} />
      </div>
    );
  }

  const assignable = canAssign(org);
  const [leads, activities, followUps, branchNames, memberNames, members] = await Promise.all([
    listLeads(supabase, { orgId: org.organizationId, customerId: id }),
    listActivitiesForCustomer(supabase, id),
    listFollowUpsForCustomer(supabase, id),
    branchNameMap(supabase, org.organizationId),
    memberNameMap(supabase, org.organizationId),
    assignable ? listOrgMembers(supabase, org.organizationId) : Promise.resolve([]),
  ]);
  const bn = Object.fromEntries(branchNames);
  const mn = Object.fromEntries(memberNames);
  const writable = canWrite(org);
  const isActive = customer.status === "active";
  const openFollowUps = followUps.filter((f) => f.status === "open");
  const doneFollowUps = followUps.filter((f) => f.status !== "open");

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <div>
        <BackLink href="/b2b/customers">{m.customers.title}</BackLink>
        {created ? <FlashSuccess messageKey="customers.created" /> : null}
        {updated ? <FlashSuccess messageKey="customers.updated" /> : null}
        {archived ? <FlashSuccess messageKey="customers.archived" /> : null}
        <PageHeader title={customer.display_name} />
      </div>

      <div className="grid gap-lg desktop:grid-cols-3 [&>*]:min-w-0">
        <Card className="desktop:col-span-1">
          <SectionTitle className="mb-md">{m.customers.contactInfo}</SectionTitle>
          <dl className="flex flex-col gap-md break-words">
            <Field label={m.customers.status}>
              <CustomerStatusBadge status={customer.status} />
            </Field>
            <Field label={m.customers.type}>
              {customer.customer_type === "company" ? m.customers.typeCompany : m.customers.typeIndividual}
            </Field>
            <Field label={m.customers.phone}>
              <span className="font-mono" dir="ltr">{customer.primary_phone ?? "—"}</span>
            </Field>
            <Field label={m.customers.email}>
              <span dir="ltr">{customer.email ?? "—"}</span>
            </Field>
            <Field label={m.customers.branch}>
              {customer.branch_id ? bn[customer.branch_id] ?? "—" : m.common.none}
            </Field>
            <Field label={m.customers.assignee}>
              {customer.assigned_membership_id ? mn[customer.assigned_membership_id] ?? "—" : m.common.unassigned}
            </Field>
            <Field label={m.customers.location}>{customer.location_summary ?? "—"}</Field>
          </dl>
          {writable && isActive ? (
            <div className="mt-md flex flex-wrap gap-sm">
              <Link
                href={`/b2b/customers/${customer.id}/edit`}
                className="inline-flex min-h-9 items-center rounded-sm border border-strong px-md py-1.5 text-label font-medium text-fg hover:bg-surface-2"
              >
                {m.customers.edit}
              </Link>
              <Link
                href={`/b2b/leads/new?customer=${customer.id}`}
                className="inline-flex min-h-9 items-center rounded-sm border border-strong px-md py-1.5 text-label font-medium text-fg hover:bg-surface-2"
              >
                + {m.leads.new}
              </Link>
              <ArchiveCustomerButton customerId={customer.id} />
            </div>
          ) : null}
        </Card>

        <div className="flex flex-col gap-lg desktop:col-span-2">
          <Card>
            <SectionTitle className="mb-md">{m.customers.relatedLeads}</SectionTitle>
            {leads.length === 0 ? (
              <p className="text-body text-fg-secondary">{m.customers.noLeads}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {leads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-md py-2">
                    <Link href={`/b2b/leads/${l.id}`} className="min-w-0 flex-1 truncate text-body-lg text-fg hover:text-accent">
                      {l.title}
                    </Link>
                    <span className="flex shrink-0 items-center gap-1">
                      <StageBadge stage={l.stage} />
                      <StatusBadge status={l.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle className="mb-md">{m.customers.addActivity}</SectionTitle>
            {writable ? <LeadActivityForm orgId={org.organizationId} customerId={customer.id} /> : null}
            <div className="mt-md">
              {activities.length === 0 ? (
                <p className="text-body text-fg-secondary">{m.activities.empty}</p>
              ) : (
                <ActivityTimeline activities={activities} />
              )}
            </div>
          </Card>

          <Card>
            <SectionTitle className="mb-md">{m.followUps.title}</SectionTitle>
            {writable && isActive ? (
              <InlineFollowUpForm
                orgId={org.organizationId}
                customerId={customer.id}
                members={members}
                canAssign={assignable}
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
                      <span className="flex shrink-0 items-center gap-sm">
                        <FollowUpStatusBadge status={f.status} />
                        {writable ? (
                          <Link href={`/b2b/follow-ups/${f.id}/edit`} className="text-label text-accent hover:underline">
                            {m.followUps.edit}
                          </Link>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {doneFollowUps.length > 0 ? (
                <details className="mt-md">
                  <summary className="cursor-pointer text-label text-fg-secondary">
                    {m.followUps.completed} ({doneFollowUps.length})
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
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
