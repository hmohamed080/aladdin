import type { PageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { overdueFollowUps, followUpsDueToday } from "@/server/queries/sales";
import {
  purchaseSummary,
  savedByCategory,
  projectSummary,
  type PurchaseSummary,
  type ProjectSummary,
} from "@/server/queries/reports";
import { orgBilingualNames } from "@/server/queries/organization-i18n";
import { resolveBilingualText } from "@/lib/i18n/bilingual";
import {
  resolveDashboardPeriod,
  dashboardPeriodRange,
  DASHBOARD_PERIOD_ORDER,
  type DashboardPeriodKey,
} from "@/lib/workspace/dashboard-period";
import { DashboardPeriodSelect } from "@/features/home/dashboard-period-select";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import { ExpandCollapse } from "@/components/ui/expand-collapse";
import { formatCompactMoney } from "@/lib/ui/format";
import {
  AlertIcon,
  ClockIcon,
  InboxIcon,
  ShoppingBagIcon,
  ClipboardIcon,
  MoneyIcon,
  BookmarkIcon,
  LayersIcon,
} from "@/components/ui/icons";

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

/**
 * The SHOWROOM OWNER dashboard — the `showroom_dealer` org-type composition
 * approved for Hana Mansour / Cairo Ceramics Showroom. A sibling of
 * `BuyerDashboard`/`SupplyDashboard`, not a fork of either: it reuses the
 * same `StatTiles`, query functions and chart primitives, but composes a
 * DIFFERENT information architecture (approved 05E direction) — no Quick
 * Actions, no Recent Activity, a dedicated period scope, and a
 * yiحتاج-تدخلك-اليوم / اكتشف-منتجات-جديدة / حركة-السوق / مشترياتك / مبيعاتك
 * structure that BuyerDashboard does not have.
 *
 * THIS INCREMENT builds only the foundation: header/context, the period
 * selector, and the six primary KPIs (نظرة على يومك) with a secondary,
 * expandable set. The remaining approved sections (يحتاج تدخلك اليوم,
 * اكتشف منتجات جديدة, حركة السوق, مشترياتك, مبيعاتك, سجل النشاط) are
 * separate map tickets, each a sibling section appended to this same
 * component — see the "Hana Showroom Owner dashboard milestone" map.
 *
 * PERIOD-DEPENDENT VS CURRENT-STATE (task requirement 5's own rule): of the
 * six KPIs, only "إجمالي المشتريات" moves with the period selector. The
 * other five — متابعات متأخرة، مستحقة اليوم، عروض للمراجعة، طلبات شراء
 * مفتوحة، طلبات قيد التنفيذ — are what is TRUE RIGHT NOW regardless of the
 * selected reporting window, so they are read from an UNFILTERED query. That
 * is why this component issues purchaseSummary TWICE: once with no date
 * filter (current-state tallies) and once with the resolved period (the one
 * historical total).
 */
export async function ShowroomDashboard({
  ctx,
  period: rawPeriod,
  from: rawFrom,
  to: rawTo,
}: {
  ctx: PageContext;
  period?: string;
  from?: string;
  to?: string;
}) {
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const branchId = org.activeBranchId;

  const caps = new Set(org.capabilities);
  const superUser = caps.has("org.manage");
  const has = (...keys: string[]) => superUser || keys.some((k) => caps.has(k));
  const buys = has("rfq.create", "order.create", "catalog.read", "quote.decide");
  const sells = has("sales.read", "sales.write", "sales.manage");

  const periodKey: DashboardPeriodKey = resolveDashboardPeriod(rawPeriod, rawFrom, rawTo);
  const now = new Date();
  const range = dashboardPeriodRange(
    periodKey,
    now,
    periodKey === "custom" && rawFrom && rawTo ? { from: rawFrom, to: rawTo } : undefined,
  );

  const [currentState, periodScoped, saved, projects, overdue, dueToday, names] = await Promise.all([
    buys ? purchaseSummary(supabase, org.organizationId, {}) : Promise.resolve(NO_PURCHASE),
    buys
      ? purchaseSummary(supabase, org.organizationId, { from: range.from, to: range.to })
      : Promise.resolve(NO_PURCHASE),
    buys ? savedByCategory(supabase, org.organizationId) : Promise.resolve({} as Record<string, number>),
    buys ? projectSummary(supabase, org.organizationId) : Promise.resolve(NO_PROJECTS),
    sells ? overdueFollowUps(supabase, org.organizationId, branchId) : Promise.resolve([]),
    sells ? followUpsDueToday(supabase, org.organizationId, branchId) : Promise.resolve([]),
    orgBilingualNames(supabase, org.organizationId, branchId),
  ]);

  const savedCount = Object.values(saved).reduce((a, b) => a + b, 0);
  const runningProjects = (projects.executing.active ?? 0) + (projects.incoming.active ?? 0);
  const orgDisplayName = resolveBilingualText(locale, org.organizationName, names.orgNameAr, names.orgNameEn);

  const primaryTiles: Tile[] = [
    {
      label: m.home.overdue,
      value: overdue.length,
      Icon: AlertIcon,
      tone: overdue.length > 0 ? "danger" : "neutral",
      href: "/b2b/follow-ups",
    },
    {
      label: m.home.dueToday,
      value: dueToday.length,
      Icon: ClockIcon,
      tone: dueToday.length > 0 ? "warning" : "neutral",
      href: "/b2b/follow-ups",
    },
    {
      label: m.home.tile.quotationsToReview,
      value: currentState.offers.submitted ?? 0,
      Icon: InboxIcon,
      tone: (currentState.offers.submitted ?? 0) > 0 ? "accent" : "neutral",
      href: "/b2b/quotations",
    },
    {
      label: m.home.tile.openRequests,
      value: (currentState.requests.submitted ?? 0) + (currentState.requests.quoted ?? 0),
      Icon: ShoppingBagIcon,
      href: "/b2b/rfqs",
    },
    {
      label: m.home.tile.ordersInProgress,
      value: currentState.orders.in_progress ?? 0,
      Icon: ClipboardIcon,
      tone: "info",
      href: "/b2b/orders",
    },
    {
      label: m.home.tile.totalPurchases,
      value: formatCompactMoney(periodScoped.orderValue, locale),
      Icon: MoneyIcon,
      hint: m.home.period[periodKey],
      href: "/b2b/reports",
    },
  ];

  const secondaryTiles: Tile[] = [
    {
      label: m.home.tileProjects,
      value: runningProjects,
      Icon: LayersIcon,
      href: "/b2b/projects",
    },
    {
      label: m.home.tile.saved,
      value: savedCount,
      Icon: BookmarkIcon,
      href: "/b2b/saved",
    },
  ];

  const periodOptions = DASHBOARD_PERIOD_ORDER.map((key) => ({ value: key, label: m.home.period[key] }));

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0">
          <p className="truncate text-label text-fg-muted">
            {m.home.greeting} · {orgDisplayName}
          </p>
          <h1 className="text-headline text-fg">{m.home.title}</h1>
        </div>
        <DashboardPeriodSelect
          value={periodKey}
          from={periodKey === "custom" ? range.from : undefined}
          to={periodKey === "custom" ? range.to : undefined}
          basePath="/b2b"
          label={m.home.period.label}
          options={periodOptions}
          fromLabel={m.home.period.from}
          toLabel={m.home.period.to}
          applyLabel={m.home.period.apply}
        />
      </div>

      <StatTiles locale={locale} tiles={primaryTiles} layout="grid" columns={6} />

      {secondaryTiles.length > 0 ? (
        <ExpandCollapse moreLabel={m.common.showMore} lessLabel={m.common.showLess}>
          <StatTiles locale={locale} tiles={secondaryTiles} layout="grid" columns={4} />
        </ExpandCollapse>
      ) : null}
    </div>
  );
}
