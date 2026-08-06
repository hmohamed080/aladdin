import Link from "next/link";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  myOpenLeads,
  overdueFollowUps,
  followUpsDueToday,
  stageCounts,
  recentActivities,
  customerNameMap,
} from "@/server/queries/sales";
import { Card, StatePanel, SectionTitle } from "@/components/ui/primitives";
import {
  HomeQuickActions,
  HomeStatTiles,
  HomeLeadList,
  HomeFollowUpList,
  HomeStageCounts,
  HomeActivityList,
  EmptyLine,
} from "@/features/sales/home-widgets";
import { AlertIcon, ClockIcon, TargetIcon, ActivityIcon, CalendarCheckIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export default async function B2BHomePage() {
  const ctx = await getPageContext();
  if (!ctx) return null; // layout shows the no-org notice
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const branchId = org.activeBranchId;

  const [open, overdue, dueToday, stages, activities, custNames] = await Promise.all([
    myOpenLeads(supabase, org.organizationId, branchId),
    overdueFollowUps(supabase, org.organizationId, branchId),
    followUpsDueToday(supabase, org.organizationId, branchId),
    stageCounts(supabase, org.organizationId, branchId),
    recentActivities(supabase, org.organizationId, branchId),
    customerNameMap(supabase, org.organizationId),
  ]);

  const custMap = Object.fromEntries(custNames);
  const canWrite = org.canManageSales || org.capabilities.includes("sales.write");

  const seeAll = (href: string, label: string) => (
    <Link href={href} className="text-label font-medium text-accent hover:underline">
      {label} →
    </Link>
  );

  return (
    <div className="flex flex-col gap-lg">
      {/* Welcome header */}
      <div className="flex flex-wrap items-end justify-between gap-md">
        <div className="min-w-0">
          <p className="truncate text-label text-fg-muted">
            {m.home.greeting} · {org.organizationName}
          </p>
          <h1 className="text-headline text-fg">{m.home.title}</h1>
        </div>
        {canWrite ? <HomeQuickActions /> : null}
      </div>

      {/* KPI tiles */}
      <HomeStatTiles overdue={overdue.length} dueToday={dueToday.length} openLeads={open.length} />

      {/* Content grid */}
      <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <SectionTitle icon={<AlertIcon size={18} />} action={seeAll("/b2b/follow-ups", m.followUps.title)}>
            {m.home.overdue}
          </SectionTitle>
          <div className="mt-md">
            {overdue.length === 0 ? <EmptyLine>{m.home.nothingDue}</EmptyLine> : <HomeFollowUpList items={overdue} tone="danger" />}
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<ClockIcon size={18} />}>{m.home.dueToday}</SectionTitle>
          <div className="mt-md">
            {dueToday.length === 0 ? <EmptyLine>{m.home.nothingDue}</EmptyLine> : <HomeFollowUpList items={dueToday} tone="warning" />}
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<TargetIcon size={18} />} action={seeAll("/b2b/leads", m.leads.title)}>
            {m.home.myOpenLeads}
          </SectionTitle>
          <div className="mt-md">
            {open.length === 0 ? <EmptyLine>{m.home.noOpenLeads}</EmptyLine> : <HomeLeadList items={open} customerNames={custMap} />}
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<CalendarCheckIcon size={18} />}>{m.home.leadsByStage}</SectionTitle>
          <div className="mt-md">
            {stages.length === 0 ? <EmptyLine>{m.home.startHint}</EmptyLine> : <HomeStageCounts counts={stages} />}
          </div>
        </Card>

        <Card className="desktop:col-span-2">
          <SectionTitle icon={<ActivityIcon size={18} />}>{m.home.recentActivity}</SectionTitle>
          <div className="mt-md">
            {activities.length === 0 ? (
              <StatePanel icon={<ActivityIcon size={20} />} title={m.home.noActivity} body={m.home.startHint} />
            ) : (
              <HomeActivityList items={activities} />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
