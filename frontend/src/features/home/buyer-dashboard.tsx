import Link from "next/link";
import type { PageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  myOpenLeads,
  overdueFollowUps,
  followUpsDueToday,
  recentActivities,
  customerNamesFor,
} from "@/server/queries/sales";
import { recentRfqs, recentQuotations, type RfqStatus } from "@/server/queries/commerce";
import {
  purchaseSummary,
  savedByCategory,
  projectSummary,
  type PurchaseSummary,
  type ProjectSummary,
} from "@/server/queries/reports";
import { Card, StatePanel, SectionTitle } from "@/components/ui/primitives";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import { TrendLine, DonutSplit, RankedBars } from "@/components/ui/charts";
import { QuickActions } from "@/features/home/quick-actions";
import { RfqTable, QuotationTable } from "@/features/commerce/commerce-lists";
import { HomeFollowUpList, HomeLeadList, HomeActivityList, EmptyLine } from "@/features/sales/home-widgets";
import { formatMoney, PRODUCT_CATEGORIES } from "@/features/commerce/constants";
import { formatMonth, formatCompactMoney, formatPercent, formatNumber } from "@/lib/ui/format";
import {
  AlertIcon,
  ClockIcon,
  TargetIcon,
  ActivityIcon,
  ShoppingBagIcon,
  InboxIcon,
  ClipboardIcon,
  BookmarkIcon,
  MoneyIcon,
  LayersIcon,
  TrendingUpIcon,
  TruckIcon,
} from "@/components/ui/icons";

/** "Waiting on a distributor" — a request that is out and not yet closed. */
const OPEN_RFQ_STATUSES: readonly RfqStatus[] = ["submitted", "quoted"];
const TREND_MONTHS = 6;

function sum(rec: Record<string, number>) {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

/** What a caller with no purchasing rights sees — no query is issued for them. */
const NO_PURCHASE: PurchaseSummary = {
  requests: {},
  offers: {},
  orders: {},
  orderValue: 0,
  acceptedOfferValue: 0,
  topDistributors: [],
  trend: [],
};
const NO_PROJECTS: ProjectSummary = { executing: {}, incoming: {}, executingValue: 0 };
const NO_CATEGORIES: Record<string, number> = {};

/**
 * The BUYER-SEAT dashboard — what a Showroom/Dealer, contracting company or
 * design office opens the app to. Its supply-side counterpart lives beside it in
 * `supply-dashboard.tsx`; `/b2b/page.tsx` picks between them from the
 * organization's own classification.
 *
 * The two are siblings, not forks: both compose from the same StatTiles, CardRail,
 * chart set and record tables, and both read the same routes. What differs is
 * which end of the RFQ → quote → order chain the panels are asking about.
 *
 * Buyer-first, because the Showroom/Dealer is this workspace's primary account and
 * its day starts on the purchasing side. The page composes from capabilities rather
 * than from an account type: a member who buys sees the purchasing panels, a member
 * who sells sees the pipeline panels, and someone who does both sees both — in that
 * order. Nothing renders a section the caller has no records or rights for.
 *
 * WHAT A DASHBOARD IS FOR, AND WHAT IT IS NOT
 * Three questions, in the order a buyer asks them: what needs me today (the
 * tiles), how is the business trending (three charts), and what exactly is
 * waiting (two record panels). Anything that answers a fourth question belongs in
 * Reports, which is one click away — a dashboard that shows everything ranks
 * nothing, and a strip of eleven panels is a filing cabinet, not a decision aid.
 *
 * COST
 * The purchasing block now reads aggregate ROWS (status/total/date columns) where
 * it previously read head-only COUNTS, because a trend line and a supplier
 * ranking cannot be derived from a count. That is two extra round trips against
 * three genuinely new decision-support widgets, and each read still selects only
 * the three or four columns its aggregate needs — never the record sets.
 */
export async function BuyerDashboard({ ctx }: { ctx: PageContext }) {
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const branchId = org.activeBranchId;

  const caps = new Set(org.capabilities);
  const superUser = caps.has("org.manage");
  const has = (...keys: string[]) => superUser || keys.some((k) => caps.has(k));

  const buys = has("rfq.create", "order.create", "catalog.read", "quote.decide");
  const sells = has("sales.read", "sales.write", "sales.manage");

  const EMPTY = { rows: [], total: 0 };

  const [purchase, saved, projects, requests, offers, overdue, dueToday, open, activities] =
    await Promise.all([
      // One call covers the purchasing tiles AND all three charts: the tallies,
      // the committed value, the distributor ranking and the monthly trend are
      // all aggregates of the same three reads.
      buys ? purchaseSummary(supabase, org.organizationId, {}, TREND_MONTHS) : Promise.resolve(NO_PURCHASE),
      // Doubles as the shortlist COUNT for its tile — one read, two answers.
      buys ? savedByCategory(supabase, org.organizationId) : Promise.resolve(NO_CATEGORIES),
      buys ? projectSummary(supabase, org.organizationId) : Promise.resolve(NO_PROJECTS),
      buys
        ? recentRfqs(supabase, org.organizationId, "requester", { statuses: OPEN_RFQ_STATUSES })
        : EMPTY,
      buys ? recentQuotations(supabase, org.organizationId, "requester") : EMPTY,
      sells ? overdueFollowUps(supabase, org.organizationId, branchId) : Promise.resolve([]),
      sells ? followUpsDueToday(supabase, org.organizationId, branchId) : Promise.resolve([]),
      sells ? myOpenLeads(supabase, org.organizationId, branchId) : Promise.resolve([]),
      sells ? recentActivities(supabase, org.organizationId, branchId) : Promise.resolve([]),
    ]);

  // Customer names are only needed to LABEL the open leads above, so they are looked
  // up for exactly those leads rather than pulling the whole customer book.
  const custMap = Object.fromEntries(
    await customerNamesFor(supabase, open.map((l) => l.customer_id)),
  );

  const newOfferCount = purchase.offers.submitted ?? 0;
  const openRequestCount = (purchase.requests.submitted ?? 0) + (purchase.requests.quoted ?? 0);
  const activeOrderCount = (purchase.orders.confirmed ?? 0) + (purchase.orders.in_progress ?? 0);
  const savedCount = sum(saved);
  const runningProjects = (projects.executing.active ?? 0) + (projects.incoming.active ?? 0);

  // Tiles lead with whatever is waiting on the caller — an overdue follow-up or an
  // undecided offer outranks a total, because a total needs no action.
  const tiles: Tile[] = [];
  if (sells) {
    tiles.push({
      label: m.home.overdue,
      value: overdue.length,
      Icon: AlertIcon,
      tone: "danger",
      href: "/b2b/follow-ups",
    });
    tiles.push({
      label: m.home.dueToday,
      value: dueToday.length,
      Icon: ClockIcon,
      tone: "warning",
      href: "/b2b/follow-ups",
    });
  }
  if (buys) {
    tiles.push({
      label: m.home.tile.newOffers,
      value: newOfferCount,
      Icon: InboxIcon,
      tone: newOfferCount > 0 ? "accent" : "neutral",
      href: "/b2b/quotations",
    });
    tiles.push({
      label: m.home.tile.openRequests,
      value: openRequestCount,
      Icon: ShoppingBagIcon,
      href: "/b2b/rfqs",
    });
    tiles.push({
      label: m.home.tile.activeOrders,
      value: activeOrderCount,
      Icon: ClipboardIcon,
      tone: "info",
      href: "/b2b/orders",
    });
    tiles.push({
      label: m.home.tileSpend,
      // Compact on a tile so it fits the two-column mobile grid; the exact
      // figure is one click away on Reports, which this tile links to.
      value: formatCompactMoney(purchase.orderValue, locale),
      Icon: MoneyIcon,
      hint: m.home.tileSpendHint,
      href: "/b2b/reports",
    });
    tiles.push({
      label: m.home.tileProjects,
      value: runningProjects,
      Icon: LayersIcon,
      href: "/b2b/projects",
    });
    tiles.push({
      label: m.home.tile.saved,
      value: savedCount,
      Icon: BookmarkIcon,
      href: "/b2b/saved",
    });
  }
  if (sells) {
    tiles.push({
      label: m.home.myOpenLeads,
      value: open.length,
      Icon: TargetIcon,
      tone: "accent",
      href: "/b2b/leads",
    });
  }

  const seeAll = (href: string, label: string) => (
    <Link href={href} className="text-label font-medium text-accent hover:underline">
      {label} →
    </Link>
  );

  return (
    <div className="flex flex-col gap-lg">
      <div className="min-w-0">
        <p className="truncate text-label text-fg-muted">
          {m.home.greeting} · {org.organizationName}
        </p>
        <h1 className="text-headline text-fg">{m.home.title}</h1>
      </div>

      {/* A member who both buys and sells reaches EIGHT tiles here. As a grid that
          is two full rows before the first real panel; as a rail it is one row,
          and on a wide desktop where all of them fit the controls never appear. */}
      {tiles.length > 0 ? (
        <StatTiles locale={locale} tiles={tiles} layout="rail" railLabel={m.home.title} />
      ) : null}

      <QuickActions m={m} capabilities={org.capabilities} stance="buyer" />

      {buys ? (
        <>
          <SectionTitle icon={<MoneyIcon size={18} />} action={seeAll("/b2b/reports", m.home.openReports)}>
            {m.home.section.purchasing}
          </SectionTitle>

          <Card>
            <SectionTitle icon={<TrendingUpIcon size={18} />}>{m.home.spendTrend}</SectionTitle>
            <div className="mt-md">
              <TrendLine
                points={purchase.trend.map((b) => ({ label: formatMonth(b.month, locale), value: b.value }))}
                emptyLabel={m.reports.noSpend}
                ariaLabel={m.home.spendTrend}
                formatValue={(v) => formatCompactMoney(v, locale)}
              />
            </div>
          </Card>

          <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <SectionTitle icon={<TruckIcon size={18} />}>{m.home.topDistributors}</SectionTitle>
              <div className="mt-md">
                <RankedBars
                  locale={locale}
                  colored
                  emptyLabel={m.reports.noSuppliers}
                  items={purchase.topDistributors.slice(0, 5).map((s) => ({
                    label: s.name,
                    value: s.value || s.orders,
                    detail: formatMoney(s.value, locale),
                  }))}
                />
              </div>
            </Card>

            <Card>
              <SectionTitle
                icon={<BookmarkIcon size={18} />}
                action={seeAll("/b2b/saved", m.saved.title)}
              >
                {m.reports.shortlistByCategory}
              </SectionTitle>
              <div className="mt-md">
                <DonutSplit
                  slices={PRODUCT_CATEGORIES.map((c) => ({
                    label: m.commerce.categories[c],
                    value: saved[c] ?? 0,
                  }))}
                  emptyLabel={m.reports.noShortlist}
                  ariaLabel={m.reports.shortlistByCategory}
                  centerLabel={m.saved.title}
                  formatValue={(v) => formatNumber(v, locale)}
                  formatShare={(p) => formatPercent(p, locale)}
                />
              </div>
            </Card>
          </div>

          <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <SectionTitle
                icon={<InboxIcon size={18} />}
                action={seeAll("/b2b/quotations", m.commerce.quotation.title)}
              >
                {m.home.latestOffers}
              </SectionTitle>
              <div className="mt-md">
                <QuotationTable quotations={offers.rows} perspective="requester" locale={locale} m={m} />
              </div>
            </Card>

            <Card>
              <SectionTitle
                icon={<ShoppingBagIcon size={18} />}
                action={seeAll("/b2b/rfqs", m.commerce.rfq.title)}
              >
                {m.home.activeRequests}
              </SectionTitle>
              <div className="mt-md">
                <RfqTable rfqs={requests.rows} perspective="requester" locale={locale} m={m} />
              </div>
            </Card>
          </div>
        </>
      ) : null}

      {sells ? (
        <>
          <SectionTitle icon={<TargetIcon size={18} />}>{m.home.section.pipeline}</SectionTitle>
          <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <SectionTitle
                icon={<AlertIcon size={18} />}
                action={seeAll("/b2b/follow-ups", m.followUps.title)}
              >
                {m.home.overdue}
              </SectionTitle>
              <div className="mt-md">
                {overdue.length === 0 ? (
                  <EmptyLine>{m.home.nothingDue}</EmptyLine>
                ) : (
                  <HomeFollowUpList items={overdue} tone="danger" />
                )}
              </div>
            </Card>

            <Card>
              <SectionTitle icon={<TargetIcon size={18} />} action={seeAll("/b2b/leads", m.leads.title)}>
                {m.home.myOpenLeads}
              </SectionTitle>
              <div className="mt-md">
                {open.length === 0 ? (
                  <EmptyLine>{m.home.noOpenLeads}</EmptyLine>
                ) : (
                  <HomeLeadList items={open} customerNames={custMap} />
                )}
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
        </>
      ) : null}
    </div>
  );
}
