import Link from "next/link";
import type { PageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { recentRfqs, recentQuotations, ownProductCounts } from "@/server/queries/commerce";
import { listOrders } from "@/server/queries/execution";
import { supplySummary, projectSummary } from "@/server/queries/reports";
import { StatePanel } from "@/components/ui/primitives";
import {
  PageHead,
  KpiStrip,
  WorkPane,
  Panel,
  PanelRow,
  NextSteps,
  Band,
  type Kpi,
  type NextStep,
} from "@/components/ui/workspace-layout";
import { TrendLine, RankedBars, Funnel } from "@/components/ui/charts";
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
  GaugeIcon,
  PlusIcon,
  BarChartIcon,
} from "@/components/ui/icons";

/**
 * The SUPPLY-SIDE dashboard — what a Distributor, Manufacturer or Importer opens
 * the app to.
 *
 * ONE WORKSPACE, READ FROM THE SELLING SEAT
 * This is not a second application. Every panel is composed from the same shared
 * primitives as every other module (`PageHead`, `KpiStrip`, `WorkPane`, the chart
 * set, the same RfqTable / QuotationTable / OrderTable with
 * `perspective="supplier"`), and every record shown lives at the same route the
 * buyer's does. What differs is the QUESTION each block answers, because the two
 * seats do genuinely different work.
 *
 * THE SHAPE, AND WHY IT CHANGED
 * The first version of this page was a single column of equally-weighted cards.
 * It was correct and unreadable: nine KPI tiles on a rail, then eight cards of
 * the same visual weight, so nothing led. The Distributor reference is built the
 * other way round — a banded head, ONE tight instrument panel of five numbers, a
 * wide working column with a narrow context column beside it, and real next
 * steps at the foot. That is the shape now, and it is carried by shared layout
 * primitives rather than by anything supply-specific.
 *
 * THE THREE QUESTIONS, IN THE ORDER A SUPPLIER ASKS THEM
 *   1. What is waiting on ME? — requests nobody has priced, quotations out for
 *      decision, orders to fulfil. This is why the strip leads and why "requests
 *      to answer" is its first cell: it is the only number on the page with a
 *      clock running on it and a competitor already looking at it.
 *   2. Am I converting? — the demand → quotation → order funnel and the value
 *      trend. A supplier's business is a conversion business; a total without a
 *      conversion rate does not tell them whether to change anything.
 *   3. What is actually moving? — live records, five at a time, each a link into
 *      the module that owns it.
 *
 * WHAT IS DELIBERATELY ABSENT
 * The reference set also shows a wallet balance, carrier tracking on a map,
 * invoices and collections, chat threads, a Reels rail and an opportunity-match
 * engine. None has a model in this repository, and a dashboard that renders a
 * plausible number with nothing behind it is worse than one that renders
 * nothing. Their COMPOSITION ideas are borrowed — the KPI band, the side context
 * column, the closing action row — and pointed at real Aladdin data.
 *
 * The reference's growth badges ("+18% from last month") are absent for the same
 * reason the buyer dashboard has none: nothing here produces a comparison
 * period, and a fabricated delta in front of a client is a lie with a percentage
 * sign on it.
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
    // One call covers every KPI, both charts and both rankings — they are all
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
   * FIVE cells, not nine.
   *
   * The strip is an instrument panel: it answers "what is the state of my
   * business right now" at a glance, and a glance does not survive nine numbers.
   * Everything that used to sit here and is not one of those five is still on the
   * page — catalogue state moved into its own context panel beside the demand
   * queue, delivery into the fulfilment band — where each has room for the
   * detail a bare count could not carry anyway.
   */
  const kpis: Kpi[] = [];
  if (supply) {
    kpis.push({
      label: m.supply.tile.awaitingResponse,
      value: supply.awaitingResponse,
      Icon: DemandIcon,
      tone: supply.awaitingResponse > 0 ? "danger" : "neutral",
      foot: m.supply.tile.awaitingResponseHint,
      href: "/b2b/rfqs",
    });
    kpis.push({
      label: m.supply.tile.awaitingDecision,
      value: supply.awaitingDecision,
      Icon: FileTextIcon,
      tone: supply.awaitingDecision > 0 ? "warning" : "neutral",
      foot: formatCompactMoney(supply.awaitingDecisionValue, locale),
      href: "/b2b/quotations",
    });
    kpis.push({
      label: m.supply.tile.activeOrders,
      value: (supply.orders.confirmed ?? 0) + (supply.orders.in_progress ?? 0),
      Icon: ClipboardIcon,
      tone: "info",
      foot: m.supply.orders.activeHint,
      href: "/b2b/orders",
    });
    kpis.push({
      label: m.supply.tile.orderValue,
      // Compact on the strip so a seven-figure EGP total cannot truncate in the
      // two-column phone grid; the exact figure lives on Reports, one click away.
      value: formatCompactMoney(supply.orderValue, locale),
      Icon: WalletIcon,
      tone: "accent",
      foot: m.supply.tile.orderValueHint,
      href: "/b2b/reports",
    });
    kpis.push({
      label: m.supply.tile.customers,
      value: supply.activeCustomers,
      Icon: StorefrontIcon,
      foot: m.supply.tile.customersHint,
      href: "/b2b/buyers",
    });
  } else if (managesCatalog) {
    // A catalogue-only seat (no pricing rights) still needs an instrument panel;
    // it just measures a different thing.
    kpis.push(
      {
        label: m.supply.products.stat.total,
        value: products.total,
        Icon: PackageIcon,
        tone: "accent",
        href: "/b2b/products",
      },
      {
        label: m.supply.products.stat.published,
        value: products.published,
        Icon: PackageIcon,
        tone: "success",
        href: "/b2b/products?status=published",
      },
      {
        label: m.supply.products.stat.draft,
        value: products.draft,
        Icon: FileTextIcon,
        tone: products.draft > 0 ? "warning" : "neutral",
        foot: m.supply.tile.draftsHint,
        href: "/b2b/products?status=draft",
      },
    );
  }

  const seeAll = (href: string, label: string) => (
    <Link href={href} className="text-label font-medium text-accent hover:underline">
      {label} →
    </Link>
  );

  /**
   * Next steps — every card points at a route that exists and an action this
   * caller may take. Assembled here rather than inside `NextSteps` precisely so
   * the capability gate stays where the capabilities are.
   */
  const steps: NextStep[] = [];
  if (sells) {
    steps.push({
      title: m.supply.action.answerDemand,
      body: m.supply.action.answerDemandBody,
      href: "/b2b/rfqs",
      cta: m.supply.demand.title,
      Icon: DemandIcon,
      tone: supply && supply.awaitingResponse > 0 ? "danger" : "accent",
    });
  }
  if (managesCatalog) {
    steps.push({
      title: m.supply.action.addProduct,
      body: m.supply.action.addProductBody,
      href: "/b2b/products/new",
      cta: m.commerce.products.new,
      Icon: PlusIcon,
    });
  }
  if (sells) {
    steps.push({
      title: m.supply.action.customers,
      body: m.supply.action.customersBody,
      href: "/b2b/buyers",
      cta: m.supply.customers.title,
      Icon: StorefrontIcon,
      tone: "info",
    });
  }

  const demandStatuses = ["submitted", "quoted", "closed"] as const;
  const demandTone = { submitted: "danger", quoted: "accent", closed: "success" } as const;

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHead
        locale={locale}
        Icon={GaugeIcon}
        eyebrow={`${m.home.greeting} · ${org.organizationName}`}
        title={m.supply.title}
        /* The one line on the page that differs between a Distributor, a
           Manufacturer and an Importer. Everything below is identical. */
        subtitle={m.supply.voice[voice].subtitle}
        toolbar={seeAll("/b2b/reports", m.home.openReports)}
        actions={
          managesCatalog ? (
            <Link
              href="/b2b/products/new"
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-sm bg-accent-solid px-md py-1.5 text-label font-medium text-brand-basalt shadow-sm transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <PlusIcon size={16} />
              {m.commerce.products.new}
            </Link>
          ) : undefined
        }
      />

      <KpiStrip locale={locale} items={kpis} columns={5} />

      {supply ? (
        <>
          <Band
            title={m.supply.section.demand}
            Icon={DemandIcon}
            action={seeAll("/b2b/rfqs", m.supply.demand.title)}
          >
            <WorkPane
              aside={
                <>
                  <Panel title={m.supply.chart.demandByStatus} Icon={DemandIcon}>
                    {demandStatuses.map((s) => (
                      <PanelRow
                        locale={locale}
                        key={s}
                        label={m.commerce.rfqStatus[s]}
                        value={supply.demand[s] ?? 0}
                        tone={demandTone[s]}
                        href="/b2b/rfqs"
                      />
                    ))}
                  </Panel>

                  {managesCatalog ? (
                    // The catalogue is the reason demand arrives at all, which is
                    // why it sits BESIDE the demand queue rather than in a band of
                    // its own: an empty queue and an empty shelf are the same
                    // problem, and the seller should see both at once.
                    <Panel
                      title={m.supply.products.title}
                      Icon={PackageIcon}
                      action={seeAll("/b2b/products", m.common.view)}
                    >
                      <PanelRow
                        locale={locale}
                        label={m.supply.products.stat.published}
                        value={products.published}
                        tone="success"
                        href="/b2b/products?status=published"
                      />
                      <PanelRow
                        locale={locale}
                        label={m.supply.products.stat.draft}
                        value={products.draft}
                        tone={products.draft > 0 ? "warning" : "neutral"}
                        href="/b2b/products?status=draft"
                      />
                      {products.draft > 0 ? (
                        <p className="mt-1.5 border-t pt-2 text-label text-fg-muted">
                          {m.supply.tile.draftsHint}
                        </p>
                      ) : null}
                    </Panel>
                  ) : null}
                </>
              }
            >
              <Panel
                title={m.supply.demand.awaiting}
                Icon={DemandIcon}
                hint={m.supply.demand.awaitingHint}
                action={seeAll("/b2b/rfqs", m.common.view)}
              >
                <RfqTable rfqs={incoming.rows} perspective="supplier" locale={locale} m={m} />
              </Panel>

              <Panel
                title={m.supply.quotations.latest}
                Icon={FileTextIcon}
                hint={m.supply.quotations.latestHint}
                action={seeAll("/b2b/quotations", m.supply.quotations.title)}
              >
                <QuotationTable quotations={sent.rows} perspective="supplier" locale={locale} m={m} />
              </Panel>
            </WorkPane>
          </Band>

          <Band
            title={m.supply.section.performance}
            Icon={TrendingUpIcon}
            action={seeAll("/b2b/reports", m.home.openReports)}
          >
            <WorkPane
              asideWidth="wide"
              aside={
                <>
                  <Panel
                    title={m.supply.chart.funnel}
                    Icon={ActivityIcon}
                    hint={m.supply.chart.funnelHint}
                  >
                    <Funnel
                      locale={locale}
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
                  </Panel>

                  <Panel title={m.supply.chart.quotationsByStatus} Icon={FileTextIcon}>
                    <RankedBars
                      locale={locale}
                      emptyLabel={m.reports.noData}
                      items={QUOTE_STATUSES.map((s) => ({
                        label: m.commerce.quotationStatus[s],
                        value: supply.quotations[s] ?? 0,
                      }))}
                    />
                    <p className="mt-md border-t pt-sm text-label text-fg-muted">
                      {m.supply.acceptedValue}:{" "}
                      <span dir="ltr" className="font-medium tabular-nums text-fg">
                        {money(supply.acceptedValue)}
                      </span>
                    </p>
                  </Panel>
                </>
              }
            >
              <Panel
                title={m.supply.chart.valueTrend}
                Icon={TrendingUpIcon}
                hint={m.supply.chart.valueTrendHint}
              >
                <TrendLine
                  points={supply.trend.map((b) => ({
                    label: formatMonth(b.month, locale),
                    value: b.value,
                  }))}
                  emptyLabel={m.supply.empty.noOrders}
                  ariaLabel={m.supply.chart.valueTrend}
                  formatValue={(v) => formatCompactMoney(v, locale)}
                />
              </Panel>

              <div className="grid gap-md desktop:grid-cols-2 [&>*]:min-w-0">
                <Panel
                  title={m.supply.chart.topProducts}
                  Icon={PackageIcon}
                  hint={m.supply.voice[voice].topProductsHint}
                >
                  <RankedBars
                    locale={locale}
                    colored
                    emptyLabel={m.supply.empty.noProductSales}
                    items={supply.topProducts.slice(0, 5).map((p) => ({
                      label: p.name,
                      value: p.value,
                      detail: money(p.value),
                    }))}
                  />
                </Panel>

                <Panel
                  title={m.supply.chart.topCustomers}
                  Icon={StorefrontIcon}
                  action={seeAll("/b2b/buyers", m.supply.customers.title)}
                >
                  <RankedBars
                    locale={locale}
                    colored
                    emptyLabel={m.supply.empty.noCustomers}
                    items={supply.topCustomers.slice(0, 5).map((c) => ({
                      label: c.name,
                      value: c.value || c.orders,
                      detail: money(c.value),
                    }))}
                  />
                </Panel>
              </div>
            </WorkPane>
          </Band>
        </>
      ) : null}

      {activeOrders.length > 0 || runningProjects > 0 ? (
        <Band
          title={m.supply.section.fulfilment}
          Icon={ClipboardIcon}
          action={seeAll("/b2b/orders", m.supply.orders.title)}
        >
          <Panel
            title={m.supply.orders.active}
            Icon={ClipboardIcon}
            /* Fulfilment, NOT shipment tracking. The reference shows carriers,
               waybill numbers and a live route on a map; this repository has no
               shipment model and no coordinates, so what is shown is the order
               and project state that genuinely exists. */
            hint={m.supply.orders.activeHint}
            action={
              runningProjects > 0
                ? seeAll("/b2b/projects", `${m.supply.tile.fulfilling}: ${runningProjects}`)
                : undefined
            }
          >
            {activeOrders.length === 0 ? (
              <StatePanel
                icon={<ClipboardIcon size={20} />}
                title={m.supply.empty.noActiveOrders}
                body={m.supply.empty.noActiveOrdersBody}
              />
            ) : (
              <OrderTable orders={activeOrders.slice(0, 6)} perspective="supplier" locale={locale} m={m} />
            )}
          </Panel>
        </Band>
      ) : null}

      <NextSteps steps={steps} label={m.home.openReports} />

      {/* The closing note the reference band occupies with a privacy statement.
          Here it says what the numbers above actually count, which is the honest
          version of the same reassurance. */}
      <p className="flex items-start gap-2 rounded-md border border-dashed bg-surface/60 px-md py-3 text-label text-fg-muted">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-fg-muted">
          <BarChartIcon size={15} />
        </span>
        {m.supply.scopeNote}
      </p>
    </div>
  );
}

const QUOTE_STATUSES = ["draft", "submitted", "accepted", "rejected"] as const;

function sumOf(rec: Record<string, number>) {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}
