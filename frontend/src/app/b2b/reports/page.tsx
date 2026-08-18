import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  purchaseSummary,
  sellSummary,
  supplySummary,
  savedByCategory,
  spendByCategory,
  projectSummary,
  salesSummary,
  type ReportFilters,
  type ProductCategory,
} from "@/server/queries/reports";
import { commerceStance, supplyVoice } from "@/lib/workspace/supply-side";
import { SupplyReport } from "@/features/reports/supply-report";
import { PageHeader } from "@/components/ui/workspace-layout";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { StatTiles } from "@/components/ui/stat-tiles";
import { FilterBar } from "@/components/ui/filter-bar";
import { orderCountLabel } from "@/features/directory/directory-tables";
import { TrendLine, DonutSplit, RankedBars, Funnel } from "@/components/ui/charts";
import { formatMoney, PRODUCT_CATEGORIES } from "@/features/commerce/constants";
import { formatMonth, formatCompactMoney, formatPercent } from "@/lib/ui/format";
import {
  ShoppingBagIcon,
  InboxIcon,
  ClipboardIcon,
  WalletIcon,
  TruckIcon,
  BookmarkIcon,
  TrendingUpIcon,
  LayersIcon,
  UsersIcon,
  ActivityIcon,
  BarChartIcon,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

const RFQ_STATUSES = ["draft", "submitted", "quoted", "closed", "cancelled"] as const;
const QUOTE_STATUSES = ["draft", "submitted", "accepted", "rejected"] as const;
const ORDER_STATUSES = ["confirmed", "in_progress", "completed", "cancelled"] as const;
const PROJECT_STATUSES = ["planned", "active", "completed"] as const;
const LEAD_STAGES = ["new", "contacted", "qualified", "proposal_pending", "decision_pending"] as const;

/** Named windows, in days. `""` is all time — the default. */
const PERIODS = { last90: 90, last180: 180, last365: 365 } as const;
type PeriodKey = keyof typeof PERIODS;

/** The shape a caller without sales rights gets — no query is issued for them. */
const NO_SALES: Awaited<ReturnType<typeof salesSummary>> = {
  leadsByStage: {},
  won: 0,
  lost: 0,
  customers: 0,
};

function sum(rec: Record<string, number>) {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Reports & Analytics.
 *
 * Every figure is an aggregate of records the caller can open — the same
 * RLS-scoped views that fill the module lists. There are deliberately no targets,
 * forecasts or growth percentages: nothing in the database produces them, and a
 * fabricated trend line is worse than no trend line in front of a client.
 *
 * The page is organised by the QUESTION each block answers, not by table:
 *   Purchasing — what did we commit, to whom, on what, and how does it move?
 *   Delivery   — what work is running, for us and by us?
 *   Selling    — what did we quote, and what came back?
 *   Pipeline   — only for a caller who runs the sales side.
 *
 * Filters live in the URL, so a filtered report is a shareable link and the whole
 * page stays a server component. Every panel reads the SAME filter, so the page
 * can never show a chart and a total that disagree about what period they cover.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; branch?: string; category?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  // A filter value that is not one this page offers is ignored rather than passed
  // to the database — the URL is user input, and a report must never be steerable
  // into a query the module does not define.
  const period = (sp.period && sp.period in PERIODS ? sp.period : "") as PeriodKey | "";
  const branchId = org.branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const category = PRODUCT_CATEGORIES.includes(sp.category as ProductCategory)
    ? (sp.category as ProductCategory)
    : undefined;

  const filters: ReportFilters = {
    from: period ? isoDaysAgo(PERIODS[period]) : undefined,
    branchId,
    category,
  };
  // The trend always spans the selected window (or the last year when unfiltered),
  // so the x-axis and the totals above it describe the same stretch of time.
  const trendMonths = period ? Math.round(PERIODS[period] / 30) : 12;

  const caps = new Set(org.capabilities);
  const runsSales = caps.has("org.manage") || ["sales.read", "sales.write", "sales.manage"].some((c) => caps.has(c));

  // A supply-side organization gets its own analytics FIRST. The purchasing
  // report stays below it in full — a distributor buys raw materials, and cutting
  // that off would answer half its questions. Nothing is duplicated: the two
  // halves read opposite ends of the same records.
  const isSeller = commerceStance(org.orgType) === "seller";

  const [purchase, sell, supply, saved, byCategory, projects, sales] = await Promise.all([
    purchaseSummary(supabase, org.organizationId, filters, trendMonths),
    sellSummary(supabase, org.organizationId, filters),
    isSeller ? supplySummary(supabase, org.organizationId, filters, trendMonths) : Promise.resolve(null),
    savedByCategory(supabase, org.organizationId),
    spendByCategory(supabase, org.organizationId, filters),
    projectSummary(supabase, org.organizationId, filters),
    runsSales ? salesSummary(supabase, org.organizationId, filters) : Promise.resolve(NO_SALES),
  ]);

  const totalRequests = sum(purchase.requests);
  const totalOffers = sum(purchase.offers);
  const totalOrders = sum(purchase.orders);
  const totalProjects = sum(projects.executing) + sum(projects.incoming);
  // A business that has never quoted anybody gets no sell-side section at all,
  // rather than a card full of zeros. It is also suppressed for a supply-side
  // organization: `SupplyReport` above already covers the same three numbers in
  // full, and repeating them lower down as a one-card summary would let the page
  // state the same figure twice under two different headings.
  const sells = !supply && (sum(sell.quotesSent) > 0 || sell.ordersReceived > 0);
  const hasPipeline = runsSales && (sum(sales.leadsByStage) > 0 || sales.customers > 0 || sales.won > 0);

  const money = (v: number) => formatMoney(v, locale);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader Icon={BarChartIcon} title={m.reports.title} subtitle={m.reports.subtitle} />

      <FilterBar
        basePath="/b2b/reports"
        clearLabel={m.reports.filters.clear}
        selects={[
          {
            name: "period",
            label: m.reports.filters.period,
            value: period,
            anyLabel: m.reports.filters.allTime,
            options: [
              { value: "last90", label: m.reports.filters.last90 },
              { value: "last180", label: m.reports.filters.last180 },
              { value: "last365", label: m.reports.filters.last365 },
            ],
          },
          // Offered only to a caller who actually has more than one branch —
          // a single-branch business filtering by its only branch is a no-op.
          ...(org.branches.length > 1
            ? [
                {
                  name: "branch",
                  label: m.reports.filters.branch,
                  value: branchId ?? "",
                  anyLabel: m.reports.filters.allBranches,
                  options: org.branches.map((b) => ({ value: b.id, label: b.name })),
                },
              ]
            : []),
          {
            name: "category",
            label: m.reports.filters.category,
            value: category ?? "",
            anyLabel: m.reports.filters.allCategories,
            options: PRODUCT_CATEGORIES.map((c) => ({ value: c, label: m.commerce.categories[c] })),
          },
        ]}
      />

      {/* The supply-side analytics lead for a seller, and are absent entirely for
          a buyer — not rendered empty, not rendered with zeros. */}
      {supply ? (
        <SupplyReport supply={supply} voice={supplyVoice(org.orgType)} m={m} locale={locale} />
      ) : null}

      {/* For a seller the tiles below are the PURCHASING figures, not the page
          summary, so the heading moves above them. A buyer's page is unchanged:
          there the same tiles ARE the summary and the heading follows. */}
      {supply ? (
        <SectionTitle icon={<WalletIcon size={18} />}>{m.reports.section.purchasing}</SectionTitle>
      ) : null}

      <StatTiles
        tiles={[
          {
            label: m.reports.stat.spend,
            value: formatCompactMoney(purchase.orderValue, locale),
            Icon: WalletIcon,
            tone: "accent",
            hint: m.reports.stat.spendHint,
          },
          { label: m.reports.stat.requests, value: totalRequests, Icon: ShoppingBagIcon, href: "/b2b/rfqs" },
          { label: m.reports.stat.offers, value: totalOffers, Icon: InboxIcon, tone: "info", href: "/b2b/quotations" },
          { label: m.reports.stat.orders, value: totalOrders, Icon: ClipboardIcon, tone: "success", href: "/b2b/orders" },
          { label: m.reports.stat.projects, value: totalProjects, Icon: LayersIcon, href: "/b2b/projects" },
          { label: m.reports.stat.saved, value: sum(saved), Icon: BookmarkIcon, href: "/b2b/saved" },
        ]}
        /* HISTORY, because this cell has moved twice.
           Six tiles across a laptop width once squeezed the committed-spend
           figure until "EGP 1,103,100.00" truncated to "EGP 1,103,10…" — the one
           number on this page nobody may misread — and the fix at the time was a
           rail, whose cards hold their width instead of shrinking.
           The strip supersedes it on both counts: money on a KPI is now formatted
           COMPACT (`formatCompactMoney`, three tiles above), and the strip's value
           wraps rather than truncating, so a long figure can no longer be
           silently clipped into a different number. Three across keeps every cell
           roomy, and the page now opens the same way every other module does
           instead of being the one screen with a carousel on it. */
        layout="strip"
        columns={3}
      />

      {/* ---------------------------------------------------------------- */}
      {supply ? null : (
        <SectionTitle icon={<WalletIcon size={18} />}>{m.reports.section.purchasing}</SectionTitle>
      )}

      <Card>
        <SectionTitle icon={<TrendingUpIcon size={18} />}>{m.reports.chart.spendTrend}</SectionTitle>
        <p className="mt-1 text-label text-fg-muted">{m.reports.chart.spendTrendHint}</p>
        <div className="mt-md">
          <TrendLine
            points={purchase.trend.map((b) => ({ label: formatMonth(b.month, locale), value: b.value }))}
            emptyLabel={m.reports.noSpend}
            ariaLabel={m.reports.chart.spendTrend}
            formatValue={(v) => formatCompactMoney(v, locale)}
          />
        </div>
      </Card>

      <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <SectionTitle icon={<LayersIcon size={18} />}>{m.reports.chart.spendByCategory}</SectionTitle>
          <div className="mt-md">
            <DonutSplit
              slices={PRODUCT_CATEGORIES.map((c) => ({
                label: m.commerce.categories[c],
                value: byCategory[c] ?? 0,
              }))}
              emptyLabel={m.reports.noSpend}
              ariaLabel={m.reports.chart.spendByCategory}
              centerLabel={m.reports.chart.total}
              formatValue={(v) => formatCompactMoney(v, locale)}
              formatShare={(p) => formatPercent(p, locale)}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<TruckIcon size={18} />}>{m.reports.topSuppliers}</SectionTitle>
          <div className="mt-md">
            <RankedBars
              colored
              emptyLabel={m.reports.noSuppliers}
              items={purchase.topDistributors.map((s) => ({
                label: s.name,
                value: s.value || s.orders,
                detail: money(s.value),
                // How many orders, not how many line items — the bar is ranked by
                // value, and the count is what tells a buyer whether that value is
                // one big purchase or a standing relationship.
                meta: orderCountLabel(s.orders, m),
              }))}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<ActivityIcon size={18} />}>{m.reports.chart.funnel}</SectionTitle>
          <div className="mt-md">
            <Funnel
              steps={[
                { label: m.reports.funnel.requests, value: totalRequests },
                { label: m.reports.funnel.offers, value: totalOffers },
                { label: m.reports.funnel.orders, value: totalOrders },
              ]}
              emptyLabel={m.reports.noData}
              ofFirstLabel={(pct) => m.reports.funnel.ofFirst.replace("{pct}", formatPercent(pct, locale))}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<ClipboardIcon size={18} />}>{m.reports.ordersByStatus}</SectionTitle>
          <div className="mt-md">
            <RankedBars
              emptyLabel={m.reports.noData}
              items={ORDER_STATUSES.map((s) => ({
                label: m.execution.orderStatus[s],
                value: purchase.orders[s] ?? 0,
              }))}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<ShoppingBagIcon size={18} />}>{m.reports.requestsByStatus}</SectionTitle>
          <div className="mt-md">
            <RankedBars
              emptyLabel={m.reports.noData}
              items={RFQ_STATUSES.map((s) => ({
                label: m.commerce.rfqStatus[s],
                value: purchase.requests[s] ?? 0,
              }))}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<InboxIcon size={18} />}>{m.reports.offersByStatus}</SectionTitle>
          <div className="mt-md">
            <RankedBars
              emptyLabel={m.reports.noData}
              items={QUOTE_STATUSES.map((s) => ({
                label: m.commerce.quotationStatus[s],
                value: purchase.offers[s] ?? 0,
              }))}
            />
          </div>
          <p className="mt-md border-t pt-sm text-label text-fg-muted">
            {m.reports.acceptedValue}:{" "}
            <span dir="ltr" className="font-medium tabular-nums text-fg">
              {money(purchase.acceptedOfferValue)}
            </span>
            {branchId ? <span className="mt-1 block">{m.reports.offersBranchNote}</span> : null}
          </p>
        </Card>
      </div>

      {/* ---------------------------------------------------------------- */}
      <SectionTitle icon={<LayersIcon size={18} />}>{m.reports.section.delivery}</SectionTitle>

      <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <SectionTitle icon={<LayersIcon size={18} />}>{m.reports.projectsByStatus}</SectionTitle>
          <div className="mt-md">
            <RankedBars
              emptyLabel={m.reports.noProjects}
              items={PROJECT_STATUSES.map((s) => ({
                label: m.execution.projectStatus[s],
                value: projects.executing[s] ?? 0,
              }))}
            />
          </div>
          <p className="mt-md border-t pt-sm text-label text-fg-muted">
            {m.reports.projectValue}:{" "}
            <span dir="ltr" className="font-medium tabular-nums text-fg">
              {money(projects.executingValue)}
            </span>
          </p>
        </Card>

        <Card>
          <SectionTitle icon={<TruckIcon size={18} />}>{m.reports.projectsIncoming}</SectionTitle>
          <div className="mt-md">
            <RankedBars
              emptyLabel={m.reports.noProjects}
              items={PROJECT_STATUSES.map((s) => ({
                label: m.execution.projectStatus[s],
                value: projects.incoming[s] ?? 0,
              }))}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<BookmarkIcon size={18} />}>{m.reports.shortlistByCategory}</SectionTitle>
          <div className="mt-md">
            <RankedBars
              colored
              emptyLabel={m.reports.noShortlist}
              items={PRODUCT_CATEGORIES.map((c) => ({
                label: m.commerce.categories[c],
                value: saved[c] ?? 0,
              }))}
            />
          </div>
        </Card>

        {sells ? (
          <Card>
            <SectionTitle icon={<TrendingUpIcon size={18} />}>{m.reports.sellSide}</SectionTitle>
            <div className="mt-md">
              <RankedBars
                emptyLabel={m.reports.noData}
                items={QUOTE_STATUSES.map((s) => ({
                  label: m.commerce.quotationStatus[s],
                  value: sell.quotesSent[s] ?? 0,
                }))}
              />
            </div>
            <p className="mt-md border-t pt-sm text-label text-fg-muted">
              {m.reports.ordersWon}:{" "}
              <span className="font-medium tabular-nums text-fg">{sell.ordersReceived}</span>
              {" · "}
              <span dir="ltr" className="font-medium tabular-nums text-fg">
                {money(sell.ordersReceivedValue)}
              </span>
            </p>
          </Card>
        ) : null}
      </div>

      {/* ----- Only for a caller who runs the sales side AND has records. ----- */}
      {hasPipeline ? (
        <>
          <SectionTitle icon={<UsersIcon size={18} />}>{m.reports.section.pipeline}</SectionTitle>
          <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <SectionTitle icon={<TrendingUpIcon size={18} />}>{m.reports.leadsByStage}</SectionTitle>
              <div className="mt-md">
                <RankedBars
                  colored
                  emptyLabel={m.reports.noData}
                  items={LEAD_STAGES.map((s) => ({
                    label: m.leads.stages[s],
                    value: sales.leadsByStage[s] ?? 0,
                  }))}
                />
              </div>
            </Card>
            <Card>
              <SectionTitle icon={<UsersIcon size={18} />}>{m.reports.activeCustomers}</SectionTitle>
              <div className="mt-md">
                <RankedBars
                  emptyLabel={m.reports.noData}
                  items={[
                    { label: m.reports.activeCustomers, value: sales.customers },
                    { label: m.reports.leadsWon, value: sales.won },
                    { label: m.reports.leadsLost, value: sales.lost },
                  ]}
                />
              </div>
            </Card>
          </div>
        </>
      ) : null}

      <p className="text-label text-fg-muted">{m.reports.scopeNote}</p>
    </div>
  );
}
