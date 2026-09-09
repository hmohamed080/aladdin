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
import { resolveTimezone } from "@/lib/workspace/timezone";
import { loadAccountIdentity } from "@/server/queries/identity";
import { createTranslator } from "@/lib/i18n/translate";
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
import { availableKpiCards, type DashboardKpiCardKey } from "@/lib/workspace/dashboard-kpi-catalog";
import { loadEffectiveKpiLayout } from "@/server/queries/dashboard-kpi-layout";
import { KpiCustomizeDialog } from "@/features/home/kpi-customize-dialog";
import { recentQuotations } from "@/server/queries/commerce";
import { listJoinRequests } from "@/server/queries/affiliation";
import { NeedsAttentionSection } from "@/features/home/needs-attention";

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
 * Built so far: header/context, the period selector, the eight-card KPI
 * grid (نظرة على يومك, personalizable via `KpiCustomizeDialog`), and
 * يحتاج تدخلك اليوم (`NeedsAttentionSection` — overdue follow-ups,
 * quotations awaiting decision, pending join requests). The remaining
 * approved sections (اكتشف منتجات جديدة, حركة السوق, مشترياتك, مبيعاتك,
 * سجل النشاط) are separate map tickets, each a sibling section appended to
 * this same component — see the "Hana Showroom Owner dashboard milestone" map.
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

  // Fetched FIRST and awaited on its own, rather than folded into the
  // Promise.all below: the resolved timezone (branch → org → Africa/Cairo)
  // is a genuine dependency of `range` below, and `range` in turn gates the
  // one period-scoped read further down. There is no way to parallelize a
  // read the next step needs the answer to.
  const [names, identity] = await Promise.all([
    orgBilingualNames(supabase, org.organizationId, branchId),
    loadAccountIdentity(),
  ]);
  const timezone = resolveTimezone(names.branchTimezone, names.orgTimezone);

  const periodKey: DashboardPeriodKey = resolveDashboardPeriod(rawPeriod, rawFrom, rawTo);
  const now = new Date();
  const range = dashboardPeriodRange(
    periodKey,
    now,
    timezone,
    periodKey === "custom" && rawFrom && rawTo ? { from: rawFrom, to: rawTo } : undefined,
  );

  // "يحتاج تدخلك اليوم" needs org.members.manage to even ask for pending join
  // requests — the RPC behind `listJoinRequests` already gates this itself,
  // but skipping the call entirely for a caller who cannot act on the result
  // is one fewer denied round trip, not a second authorization layer.
  const canManageMembers = has("org.members.manage");

  const [currentState, periodScoped, saved, projects, overdue, dueToday, kpiLayout, quotationsAwaitingDecision, joinRequests] =
    await Promise.all([
      buys ? purchaseSummary(supabase, org.organizationId, {}) : Promise.resolve(NO_PURCHASE),
      buys
        ? purchaseSummary(supabase, org.organizationId, { from: range.from, to: range.to })
        : Promise.resolve(NO_PURCHASE),
      buys ? savedByCategory(supabase, org.organizationId) : Promise.resolve({} as Record<string, number>),
      buys ? projectSummary(supabase, org.organizationId) : Promise.resolve(NO_PROJECTS),
      sells ? overdueFollowUps(supabase, org.organizationId, branchId) : Promise.resolve([]),
      sells ? followUpsDueToday(supabase, org.organizationId, branchId) : Promise.resolve([]),
      loadEffectiveKpiLayout(supabase, org.organizationId, org.membershipId),
      // Restrained: the 5 most recently updated, capped — a prioritized list,
      // never a second full quotations inbox.
      buys
        ? recentQuotations(supabase, org.organizationId, "requester", { statuses: ["submitted"], limit: 5 })
        : Promise.resolve({ rows: [], total: 0 }),
      canManageMembers ? listJoinRequests(supabase, org.organizationId) : Promise.resolve([]),
    ]);
  const pendingJoinRequests = joinRequests.filter((r) => r.status === "pending").slice(0, 5);

  const savedCount = Object.values(saved).reduce((a, b) => a + b, 0);
  const runningProjects = (projects.executing.active ?? 0) + (projects.incoming.active ?? 0);
  // The greeting names the signed-in PERSON, never the organization — the org
  // is already visible in the workspace header and repeating it here was the
  // "duplicated organization name" bug. `loadAccountIdentity()` returns a safe
  // null when no display name was ever set, and the fallback is the existing
  // nameless greeting rather than a hardcoded person. The name itself is
  // resolved through the SAME bilingual-fallback rule the org/branch names
  // use (20260916090001) — Arabic prefers the person's own real Arabic name,
  // never a transliteration of their Latin one, and falls back to whatever
  // single name they did enter when no Arabic override exists.
  const t = createTranslator(locale);
  const personName = identity?.displayName
    ? resolveBilingualText(locale, identity.displayName, identity.displayNameAr, identity.displayNameEn)
    : null;
  const greeting = personName ? t("home.greetingNamed", { name: personName }) : m.home.greeting;

  // Capability-aware first: a card whose underlying data this caller cannot
  // see must never be offered or rendered, REGARDLESS of what a stale saved
  // layout says — the layout was written under whatever capabilities were
  // true then, and may no longer match (a role change, a capability revoked
  // since).
  const availableCards = availableKpiCards({ buys, sells });
  const iconFor = new Map(availableCards.map((c) => [c.key, c.Icon]));

  // Every KPI tile this caller's stance permits, keyed by the same
  // `DashboardKpiCardKey` the personalization schema uses — the ONE place a
  // card key maps to its live value. Which of these actually render, and in
  // what order, is decided below by the effective layout, never by this
  // object's own iteration order.
  const tileFor: Partial<Record<DashboardKpiCardKey, Tile>> = {
    overdue_followups: {
      label: m.home.overdue,
      value: overdue.length,
      Icon: iconFor.get("overdue_followups")!,
      tone: overdue.length > 0 ? "danger" : "neutral",
      href: "/b2b/follow-ups",
    },
    due_today: {
      label: m.home.dueToday,
      value: dueToday.length,
      Icon: iconFor.get("due_today")!,
      tone: dueToday.length > 0 ? "warning" : "neutral",
      href: "/b2b/follow-ups",
    },
    quotations_to_review: {
      label: m.home.tile.quotationsToReview,
      value: currentState.offers.submitted ?? 0,
      Icon: iconFor.get("quotations_to_review")!,
      tone: (currentState.offers.submitted ?? 0) > 0 ? "accent" : "neutral",
      href: "/b2b/quotations",
    },
    open_purchase_requests: {
      label: m.home.tile.openRequests,
      value: (currentState.requests.submitted ?? 0) + (currentState.requests.quoted ?? 0),
      Icon: iconFor.get("open_purchase_requests")!,
      href: "/b2b/rfqs",
    },
    orders_in_progress: {
      label: m.home.tile.ordersInProgress,
      value: currentState.orders.in_progress ?? 0,
      Icon: iconFor.get("orders_in_progress")!,
      tone: "info",
      href: "/b2b/orders",
    },
    total_purchases: {
      label: m.home.tile.totalPurchases,
      value: formatCompactMoney(periodScoped.orderValue, locale),
      Icon: iconFor.get("total_purchases")!,
      hint: m.home.period[periodKey],
      href: "/b2b/reports",
    },
    projects: {
      label: m.home.tileProjects,
      value: runningProjects,
      Icon: iconFor.get("projects")!,
      href: "/b2b/projects",
    },
    saved_products: {
      label: m.home.tile.saved,
      value: savedCount,
      Icon: iconFor.get("saved_products")!,
      href: "/b2b/saved",
    },
  };

  const availableKeys = availableCards.map((c) => c.key);
  const availableKeySet = new Set(availableKeys);
  const orderedKeys = kpiLayout.cardOrder.filter((k) => availableKeySet.has(k));
  const primaryTiles: Tile[] = orderedKeys.slice(0, 6).map((k) => tileFor[k]!);
  const secondaryTiles: Tile[] = orderedKeys.slice(6, 8).map((k) => tileFor[k]!);

  const periodOptions = DASHBOARD_PERIOD_ORDER.map((key) => ({ value: key, label: m.home.period[key] }));

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0">
          <p className="truncate text-label text-fg-muted">{greeting}</p>
          <div className="flex items-center gap-1.5">
            <h1 className="text-headline text-fg">{m.home.title}</h1>
            <KpiCustomizeDialog
              orgId={org.organizationId}
              availableKeys={availableKeys}
              initialOrder={orderedKeys}
              hasPersonal={kpiLayout.hasPersonal}
              hasTeamDefault={kpiLayout.hasTeamDefault}
              canManageTeamDefault={superUser}
            />
          </div>
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

      {/* `gap-md` (16px) — the standard grid-to-grid rhythm, not the
          dashboard's own outer `gap-lg` (24px, meant for header-to-KPI-area
          and future SIBLING sections, not for the two grids inside this one
          KPI area). Grouping the primary row and the collapsible secondary
          row into their own `gap-md` block is what keeps the primary→
          secondary gap the same 16px regardless of what the outer section
          rhythm is elsewhere on the page. */}
      <div className="flex flex-col gap-md">
        <StatTiles locale={locale} tiles={primaryTiles} layout="grid" columns={6} />

        {secondaryTiles.length > 0 ? (
          <ExpandCollapse moreLabel={m.common.showMore} lessLabel={m.common.showLess}>
            {/* Same `columns={6}` template as the primary row, on purpose: the two
                additional cards must be the identical size as the six primary ones
                (never stretched into two oversized cards), and sharing one grid
                definition is what makes them start from the correct leading edge —
                column 1 of a 6-column grid — in both RTL and LTR for free. The four
                empty tracks on this row are accepted: two cards do not need to fake
                a full row to look intentional. */}
            <StatTiles locale={locale} tiles={secondaryTiles} layout="grid" columns={6} />
          </ExpandCollapse>
        ) : null}
      </div>

      <NeedsAttentionSection
        overdueFollowUps={overdue}
        quotationsAwaitingDecision={quotationsAwaitingDecision.rows}
        pendingJoinRequests={pendingJoinRequests}
        locale={locale}
        m={m}
      />
    </div>
  );
}
