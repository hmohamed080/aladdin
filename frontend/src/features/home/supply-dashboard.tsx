import Link from "next/link";
import type { PageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { recentRfqs, recentQuotations, ownProductCounts } from "@/server/queries/commerce";
import { listOrders } from "@/server/queries/execution";
import { supplySummary, projectSummary } from "@/server/queries/reports";
import { Card, StatePanel, SectionTitle } from "@/components/ui/primitives";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import { TrendLine, RankedBars, Funnel } from "@/components/ui/charts";
import { QuickActions } from "@/features/home/quick-actions";
import { RfqTable, QuotationTable } from "@/features/commerce/commerce-lists";
import { OrderTable } from "@/features/execution/execution-lists";
import { formatMoney } from "@/features/commerce/constants";
import { formatMonth, formatCompactMoney, formatPercent } from "@/lib/ui/format";
import { supplyVoice } from "@/lib/workspace/supply-side";
import {
  DemandIcon,
  FileTextIcon,
  ClipboardIcon,
  PackageIcon,
  WalletIcon,
  TrendingUpIcon,
  StorefrontIcon,
  ActivityIcon,
  BadgeCheckIcon,
  LayersIcon,
} from "@/components/ui/icons";

/**
 * The SUPPLY-SIDE dashboard — what a Distributor, Manufacturer or Importer opens
 * the app to.
 *
 * ONE WORKSPACE, READ FROM THE SELLING SEAT
 * This is not a second application. Every panel below is composed from the same
 * shared primitives as the buyer dashboard (StatTiles, CardRail, the chart set,
 * the same RfqTable / QuotationTable / OrderTable with `perspective="supplier"`),
 * and every record it shows lives at the same route the buyer's does. What
 * differs is the QUESTION each block answers, because the two seats do genuinely
 * different work.
 *
 * THE THREE QUESTIONS, IN THE ORDER A SUPPLIER ASKS THEM
 *   1. What is waiting on ME? — requests nobody has priced, quotations out for
 *      decision, orders to fulfil. This is the whole reason the tiles lead, and
 *      why "awaiting response" is first: it is the only number on the page with a
 *      clock running on it.
 *   2. Am I converting? — the demand → quotation → order funnel and the value
 *      trend. A supplier's business is a conversion business; a total without a
 *      conversion rate does not tell them whether to change anything.
 *   3. What is actually moving? — the live records, five at a time, each a link
 *      into the module that owns it.
 *
 * WHAT IS DELIBERATELY ABSENT
 * The Distributor reference set this was drawn from also shows a wallet balance,
 * carrier shipment tracking on a map, invoices and collections, chat threads and
 * a Reels rail. None of those has a model in this repository, and a dashboard
 * that renders a plausible number with nothing behind it is worse than one that
 * renders nothing. They are not stubbed, not mocked, and not faked here.
 *
 * The reference's growth badges ("+18% from last month") are absent for the same
 * reason the buyer dashboard has none: nothing in the database produces a
 * comparison period, and a fabricated delta in front of a client is a lie with a
 * percentage sign on it.
 */
export async function SupplyDashboard({ ctx }: { ctx: PageContext }) {
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const voice = supplyVoice(org.orgType);

  const caps = new Set(org.capabilities);
  const superUser = caps.has("org.manage");
  const has = (...keys: string[]) => superUser || keys.some((k) => caps.has(k));

  // Capability gates, not org-type gates. A distributor's warehouse clerk may
  // hold `project.read` and nothing else; they get the fulfilment panel and no
  // pricing figures, in the same workspace.
  const sells = has("rfq.respond", "quote.submit", "catalog.publish", "order.manage");
  const managesCatalog = has("catalog.write", "catalog.publish");

  const EMPTY_RFQ = { rows: [], total: 0 };

  const [supply, products, projects, incoming, sent, orders] = await Promise.all([
    // One call covers every tile, both charts and both rankings — they are all
    // aggregates of the same three record sets.
    sells ? supplySummary(supabase, org.organizationId) : null,
    managesCatalog
      ? ownProductCounts(supabase, org.organizationId)
      : Promise.resolve({ total: 0, published: 0, draft: 0 }),
    projectSummary(supabase, org.organizationId),
    // Requests still waiting to be priced — the work queue, newest first.
    sells
      ? recentRfqs(supabase, org.organizationId, "supplier", { statuses: ["submitted"] })
      : Promise.resolve(EMPTY_RFQ),
    sells ? recentQuotations(supabase, org.organizationId, "supplier") : Promise.resolve(EMPTY_RFQ),
    has("order.manage", "order.create", "project.read", "project.write")
      ? listOrders(supabase, org.organizationId, "supplier")
      : Promise.resolve([]),
  ]);

  const activeOrders = orders.filter((o) => o.status === "confirmed" || o.status === "in_progress");
  const runningProjects = projects.executing.active ?? 0;

  const money = (v: number) => formatMoney(v, locale);

  /**
   * Tiles lead with whatever has a clock on it. An unanswered request outranks a
   * completed-orders total, because a total needs no action and a competitor is
   * already pricing that request.
   */
  const tiles: Tile[] = [];
  if (supply) {
    tiles.push({
      label: m.supply.tile.awaitingResponse,
      value: supply.awaitingResponse,
      Icon: DemandIcon,
      tone: supply.awaitingResponse > 0 ? "danger" : "neutral",
      hint: m.supply.tile.awaitingResponseHint,
      href: "/b2b/rfqs",
    });
    tiles.push({
      label: m.supply.tile.awaitingDecision,
      value: supply.awaitingDecision,
      Icon: FileTextIcon,
      tone: supply.awaitingDecision > 0 ? "warning" : "neutral",
      hint: formatCompactMoney(supply.awaitingDecisionValue, locale),
      href: "/b2b/quotations",
    });
    tiles.push({
      label: m.supply.tile.activeOrders,
      value: (supply.orders.confirmed ?? 0) + (supply.orders.in_progress ?? 0),
      Icon: ClipboardIcon,
      tone: "info",
      href: "/b2b/orders",
    });
    tiles.push({
      label: m.supply.tile.orderValue,
      // Compact on a tile so a seven-figure EGP total cannot truncate in the
      // two-column mobile grid; the exact figure lives on Reports, one click away.
      value: formatCompactMoney(supply.orderValue, locale),
      Icon: WalletIcon,
      tone: "accent",
      hint: m.supply.tile.orderValueHint,
      href: "/b2b/reports",
    });
    tiles.push({
      label: m.supply.tile.completedOrders,
      value: supply.orders.completed ?? 0,
      Icon: BadgeCheckIcon,
      tone: "success",
      href: "/b2b/orders",
    });
    tiles.push({
      label: m.supply.tile.customers,
      value: supply.activeCustomers,
      Icon: StorefrontIcon,
      hint: m.supply.tile.customersHint,
      href: "/b2b/buyers",
    });
  }
  if (managesCatalog) {
    tiles.push({
      label: m.supply.tile.published,
      value: products.published,
      Icon: PackageIcon,
      href: "/b2b/products?status=published",
    });
    tiles.push({
      label: m.supply.tile.drafts,
      value: products.draft,
      Icon: PackageIcon,
      tone: products.draft > 0 ? "warning" : "neutral",
      hint: m.supply.tile.draftsHint,
      href: "/b2b/products?status=draft",
    });
  }
  if (runningProjects > 0) {
    tiles.push({
      label: m.supply.tile.fulfilling,
      value: runningProjects,
      Icon: LayersIcon,
      href: "/b2b/projects",
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
        <h1 className="text-headline text-fg">{m.supply.title}</h1>
        {/* The one line on the page that differs between a Distributor, a
            Manufacturer and an Importer. Everything below is identical. */}
        <p className="mt-1 text-body text-fg-secondary">{m.supply.voice[voice].subtitle}</p>
      </div>

      {/* Up to nine tiles here. As a grid that is three rows before the first
          real panel; as a shared rail it is one row, and on a wide desktop where
          they all fit no control is drawn at all. */}
      {tiles.length > 0 ? <StatTiles tiles={tiles} layout="rail" railLabel={m.supply.title} /> : null}

      <QuickActions m={m} capabilities={org.capabilities} stance="seller" />

      {supply ? (
        <>
          <SectionTitle
            icon={<DemandIcon size={18} />}
            action={seeAll("/b2b/rfqs", m.supply.demand.title)}
          >
            {m.supply.section.demand}
          </SectionTitle>

          <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <SectionTitle icon={<DemandIcon size={18} />}>{m.supply.demand.awaiting}</SectionTitle>
              <p className="mt-1 text-label text-fg-muted">{m.supply.demand.awaitingHint}</p>
              <div className="mt-md">
                <RfqTable rfqs={incoming.rows} perspective="supplier" locale={locale} m={m} />
              </div>
            </Card>

            <Card>
              <SectionTitle
                icon={<FileTextIcon size={18} />}
                action={seeAll("/b2b/quotations", m.supply.quotations.title)}
              >
                {m.supply.quotations.latest}
              </SectionTitle>
              <p className="mt-1 text-label text-fg-muted">{m.supply.quotations.latestHint}</p>
              <div className="mt-md">
                <QuotationTable
                  quotations={sent.rows}
                  perspective="supplier"
                  locale={locale}
                  m={m}
                />
              </div>
            </Card>
          </div>

          {/* ---------------------------------------------------------------- */}
          <SectionTitle
            icon={<TrendingUpIcon size={18} />}
            action={seeAll("/b2b/reports", m.home.openReports)}
          >
            {m.supply.section.performance}
          </SectionTitle>

          <Card>
            <SectionTitle icon={<TrendingUpIcon size={18} />}>{m.supply.chart.valueTrend}</SectionTitle>
            <p className="mt-1 text-label text-fg-muted">{m.supply.chart.valueTrendHint}</p>
            <div className="mt-md">
              <TrendLine
                points={supply.trend.map((b) => ({
                  label: formatMonth(b.month, locale),
                  value: b.value,
                }))}
                emptyLabel={m.supply.empty.noOrders}
                ariaLabel={m.supply.chart.valueTrend}
                formatValue={(v) => formatCompactMoney(v, locale)}
              />
            </div>
          </Card>

          <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <SectionTitle icon={<ActivityIcon size={18} />}>{m.supply.chart.funnel}</SectionTitle>
              <p className="mt-1 text-label text-fg-muted">{m.supply.chart.funnelHint}</p>
              <div className="mt-md">
                <Funnel
                  steps={[
                    { label: m.supply.funnel.demand, value: sumOf(supply.demand) },
                    { label: m.supply.funnel.quoted, value: sumOf(supply.quotations) },
                    { label: m.supply.funnel.ordered, value: sumOf(supply.orders) },
                  ]}
                  emptyLabel={m.reports.noData}
                  ofFirstLabel={(pct) =>
                    m.reports.funnel.ofFirst.replace("{pct}", formatPercent(pct, locale))
                  }
                />
              </div>
            </Card>

            <Card>
              <SectionTitle icon={<PackageIcon size={18} />}>{m.supply.chart.topProducts}</SectionTitle>
              <p className="mt-1 text-label text-fg-muted">{m.supply.voice[voice].topProductsHint}</p>
              <div className="mt-md">
                <RankedBars
                  colored
                  emptyLabel={m.supply.empty.noProductSales}
                  items={supply.topProducts.slice(0, 5).map((p) => ({
                    label: p.name,
                    value: p.value,
                    detail: money(p.value),
                  }))}
                />
              </div>
            </Card>

            <Card>
              <SectionTitle
                icon={<StorefrontIcon size={18} />}
                action={seeAll("/b2b/buyers", m.supply.customers.title)}
              >
                {m.supply.chart.topCustomers}
              </SectionTitle>
              <div className="mt-md">
                <RankedBars
                  colored
                  emptyLabel={m.supply.empty.noCustomers}
                  items={supply.topCustomers.slice(0, 5).map((c) => ({
                    label: c.name,
                    value: c.value || c.orders,
                    detail: money(c.value),
                  }))}
                />
              </div>
            </Card>

            <Card>
              <SectionTitle icon={<FileTextIcon size={18} />}>
                {m.supply.chart.quotationsByStatus}
              </SectionTitle>
              <div className="mt-md">
                <RankedBars
                  emptyLabel={m.reports.noData}
                  items={QUOTE_STATUSES.map((s) => ({
                    label: m.commerce.quotationStatus[s],
                    value: supply.quotations[s] ?? 0,
                  }))}
                />
              </div>
              <p className="mt-md border-t pt-sm text-label text-fg-muted">
                {m.supply.acceptedValue}:{" "}
                <span dir="ltr" className="font-medium tabular-nums text-fg">
                  {money(supply.acceptedValue)}
                </span>
              </p>
            </Card>
          </div>
        </>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {activeOrders.length > 0 || runningProjects > 0 ? (
        <>
          <SectionTitle
            icon={<ClipboardIcon size={18} />}
            action={seeAll("/b2b/orders", m.supply.orders.title)}
          >
            {m.supply.section.fulfilment}
          </SectionTitle>
          <Card>
            <SectionTitle icon={<ClipboardIcon size={18} />}>{m.supply.orders.active}</SectionTitle>
            {/* Fulfilment, NOT shipment tracking. The reference shows carriers,
                waybill numbers and a live route on a map; this repository has no
                shipment model and no coordinates, so what is shown is the order
                and project state that genuinely exists. */}
            <p className="mt-1 text-label text-fg-muted">{m.supply.orders.activeHint}</p>
            <div className="mt-md">
              {activeOrders.length === 0 ? (
                <StatePanel
                  icon={<ClipboardIcon size={20} />}
                  title={m.supply.empty.noActiveOrders}
                  body={m.supply.empty.noActiveOrdersBody}
                />
              ) : (
                <OrderTable
                  orders={activeOrders.slice(0, 6)}
                  perspective="supplier"
                  locale={locale}
                  m={m}
                />
              )}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

const QUOTE_STATUSES = ["draft", "submitted", "accepted", "rejected"] as const;

function sumOf(rec: Record<string, number>) {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}
