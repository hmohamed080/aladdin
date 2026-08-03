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
import { HomeQuickActions, HomeLeadList, HomeFollowUpList, HomeStageCounts, HomeActivityList } from "@/features/sales/home-widgets";

export const dynamic = "force-dynamic";

export default async function B2BHomePage() {
  const ctx = await getPageContext();
  if (!ctx) return null; // layout shows the no-org notice
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);

  const [open, overdue, dueToday, stages, activities, custNames] = await Promise.all([
    myOpenLeads(supabase),
    overdueFollowUps(supabase),
    followUpsDueToday(supabase),
    stageCounts(supabase, org.organizationId),
    recentActivities(supabase),
    customerNameMap(supabase, org.organizationId),
  ]);

  const custMap = Object.fromEntries(custNames);
  const canWrite = org.canManageSales || org.capabilities.includes("sales.write");

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <div>
        <h1 className="text-headline text-fg">{m.home.title}</h1>
        <p className="text-body text-fg-secondary">{org.organizationName}</p>
      </div>

      {canWrite ? <HomeQuickActions /> : null}

      <div className="grid gap-lg desktop:grid-cols-2">
        <Card>
          <SectionTitle className="mb-md">{m.home.overdue}</SectionTitle>
          {overdue.length === 0 ? (
            <p className="text-body text-fg-secondary">{m.home.nothingDue}</p>
          ) : (
            <HomeFollowUpList items={overdue} tone="danger" />
          )}
          <div className="mt-md">
            <Link href="/b2b/follow-ups" className="text-label text-accent hover:underline">
              {m.followUps.title} →
            </Link>
          </div>
        </Card>

        <Card>
          <SectionTitle className="mb-md">{m.home.dueToday}</SectionTitle>
          {dueToday.length === 0 ? (
            <p className="text-body text-fg-secondary">{m.home.nothingDue}</p>
          ) : (
            <HomeFollowUpList items={dueToday} tone="warning" />
          )}
        </Card>

        <Card>
          <SectionTitle className="mb-md">{m.home.myOpenLeads}</SectionTitle>
          {open.length === 0 ? (
            <p className="text-body text-fg-secondary">{m.home.noOpenLeads}</p>
          ) : (
            <HomeLeadList items={open} customerNames={custMap} />
          )}
        </Card>

        <Card>
          <SectionTitle className="mb-md">{m.home.leadsByStage}</SectionTitle>
          {stages.length === 0 ? (
            <p className="text-body text-fg-secondary">{m.home.startHint}</p>
          ) : (
            <HomeStageCounts counts={stages} />
          )}
        </Card>

        <Card className="desktop:col-span-2">
          <SectionTitle className="mb-md">{m.home.recentActivity}</SectionTitle>
          {activities.length === 0 ? (
            <StatePanel title={m.home.noActivity} body={m.home.startHint} />
          ) : (
            <HomeActivityList items={activities} />
          )}
        </Card>
      </div>
    </div>
  );
}
