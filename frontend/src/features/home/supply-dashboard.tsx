import Link from "next/link";
import type { PageContext } from "@/server/queries/page-context";
import type { Locale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/translate";
import {
  recentRfqs,
  recentQuotations,
  ownProductCounts,
  type RfqListRow,
  type QuotationListRow,
} from "@/server/queries/commerce";
import { listOrders, quotationsWithOrders } from "@/server/queries/execution";
import { supplySummary, projectSummary } from "@/server/queries/reports";
import { StatePanel } from "@/components/ui/primitives";
import {
  PageHead,
  KpiStrip,
  Row,
  Panel,
  PanelRow,
  NextSteps,
  Band,
  type Kpi,
  type KpiTone,
  type NextStep,
} from "@/components/ui/workspace-layout";
import { TrendLine, RankedBars, Funnel } from "@/components/ui/charts";
import { RfqTable, QuotationTable } from "@/features/commerce/commerce-lists";
import { OrderTable } from "@/features/execution/execution-lists";
import { AttentionQueue, AttentionCount, type AttentionItem } from "@/features/home/supply-attention";
import { formatMoney } from "@/features/commerce/constants";
import { formatMonth, formatCompactMoney, formatPercent, formatCount } from "@/lib/ui/format";
import { supplyVoice } from "@/lib/workspace/supply-side";
import {
  DemandIcon,
  FileTextIcon,
  ClipboardIcon,
  PackageIcon,
  MoneyIcon,
  TrendingUpIcon,
  StorefrontIcon,
  ActivityIcon,
  GaugeIcon,
  PlusIcon,
  BarChartIcon,
  AlertIcon,
  CheckIcon,
} from "@/components/ui/icons";

/**
 * The SUPPLY-SIDE dashboard — what a Distributor, Manufacturer or Importer opens
 * the app to.
 *
 * ONE WORKSPACE, READ FROM THE SELLING SEAT
 * This is not a second application. Every record shown lives at the same route
 * the buyer's does, and the tables are the same components with
 * `perspective="supplier"`. What differs is the QUESTION each block answers,
 * because the two seats do genuinely different work.
 *
 * THE SHAPE, AND WHY IT CHANGED TWICE
 * Version one was a single column of equally-weighted cards: correct and
 * unreadable, because nothing led. Version two fixed the weighting but kept the
 * MODULE page's shape — a wide list column with a fixed 18rem context rail
 * beside it — and on a wide display that rail held ~300px of content in a 790px
 * row, so a sixth of the page was blank from its last panel down. It read as a
 * rearranged Showroom dashboard because structurally that is what it was: the
 * same primitives, the same rhythm, different words.
 *
 * The Distributor reference is built from ROWS, not from a column with a rail.
 * Each row holds two or three blocks that are peers of different weight and end
 * level with each other, and the operational block in each row is the widest
 * thing in it. That is what `Row` + `Panel fill` encode, and it is why the page
 * now uses proportional tracks (1.55fr / 2.5fr) rather than a fixed rem aside:
 * a proportion spends a wide display on the operational block and hands the room
 * back on a laptop, which a fixed rail can never do.
 *
 * THE ORDER OF THE PAGE IS THE ORDER OF THE QUESTIONS
 *   1. What needs my attention? — the cross-stage triage queue, and the pipeline
 *      it came from. No module owns this list, which is why it is the one thing
 *      on the page that is not available anywhere else.
 *   2. What demand is coming in, and what did I price? — the two live record
 *      lists, side by side, because a seller reads them against each other.
 *   3. Am I converting? — the value trend and the demand → quotation → order
 *      funnel, then what is actually selling and who is actually buying.
 *   4. What am I fulfilling? — the orders with work behind them.
 *   5. What should I do next? — the closing action row.
 *
 * WHAT IS DELIBERATELY ABSENT
 * The reference set also shows a wallet balance, carrier tracking on a map,
 * invoices and collections, chat threads, a Reels rail and an opportunity-match
 * engine. None has a model in this repository, and a dashboard that renders a
 * plausible number with nothing behind it is worse than one that renders
 * nothing. Its COMPOSITION is borrowed; its features are not.
 *
 * The reference's growth badges ("+18% from last month") are absent for the same
 * reason: nothing here produces a comparison period, and a fabricated delta is a
 * lie with a percentage sign on it.
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
  const fulfils = has("order.manage", "order.create", "project.read", "project.write");

  const EMPTY_LIST = { rows: [], total: 0 };

  const [supply, products, projects, incoming, sent, undecided, accepted, orders] = await Promise.all([
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
      : Promise.resolve(EMPTY_LIST),
    sells ? recentQuotations(supabase, org.organizationId, "supplier") : Promise.resolve(EMPTY_LIST),
    // The two stages the summary counts but cannot name: prices out for a
    // decision, and prices already accepted. The attention queue needs the
    // RECORDS, not the totals, so it can link each one at its own route.
    sells
      ? recentQuotations(supabase, org.organizationId, "supplier", { statuses: ["submitted"] })
      : Promise.resolve(EMPTY_LIST),
    sells
      ? recentQuotations(supabase, org.organizationId, "supplier", { statuses: ["accepted"] })
      : Promise.resolve(EMPTY_LIST),
    fulfils ? listOrders(supabase, org.organizationId, "supplier") : Promise.resolve([]),
  ]);

  /* An accepted price with no order behind it is the most valuable stalled thing
     a seller owns: the buyer has already said yes. Asked as an exact lookup on
     just these ids rather than inferred from the capped order page, so an old
     acceptance cannot read as "ready" forever. */
  const ordered = await quotationsWithOrders(
    supabase,
    accepted.rows.map((q) => q.id).filter((id): id is string => !!id),
  );
  const readyForOrder = accepted.rows.filter((q) => q.id && !ordered.has(q.id));

  const activeOrders = orders.filter((o) => o.status === "confirmed" || o.status === "in_progress");
  const runningProjects = projects.executing.active ?? 0;
  const money = (v: number | null | undefined) => formatMoney(v, locale);

  /**
   * FIVE cells, not nine.
   *
   * The strip is an instrument panel: it answers "what is the state of my
   * business right now" at a glance, and a glance does not survive nine numbers.
   * Everything that used to sit here is still on the page — catalogue state in
   * the pipeline panel, delivery in the fulfilment band — where each has room
   * for the detail a bare count could not carry anyway.
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
      Icon: MoneyIcon,
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

  /**
   * THE ATTENTION QUEUE.
   *
   * Ordered by STAGE — price, chase, order, fulfil — which is the order a seller
   * actually works, and the only ordering that is honest across four record
   * types: "soonest date first" would be sorting a required-by against a
   * valid-until against a confirmed-on, which compares nothing.
   *
   * Three per stage, six in total. The cap is what keeps this a triage list
   * rather than a fifth copy of the queues that live below it — each stage's
   * full list is one click away on its own module.
   */
  /* The status→tone maps, declared ABOVE the attention queue because the queue
     reads from them: one status must not be amber in the pipeline panel and blue
     in the row three inches to its left. */
  const demandStatuses = ["submitted", "quoted", "closed"] as const;
  const demandTone = { submitted: "danger", quoted: "accent", closed: "success" } as const;
  const orderStatuses = ["confirmed", "in_progress", "completed"] as const;
  const orderTone = { confirmed: "info", in_progress: "warning", completed: "success" } as const;

  const at = m.supply.attention;
  const stageCap = <T,>(rows: readonly T[]) => rows.slice(0, 3);

  const attention: AttentionItem[] = [
    ...stageCap(incoming.rows).map(
      (r: RfqListRow): AttentionItem => ({
        key: `price-${r.id}`,
        kind: "price",
        title: r.title ?? "—",
        meta: m.commerce.rfq.itemCountShort.replace(
          "{count}",
          formatCount(r.item_count ?? 0, locale),
        ),
        customer: r.requester_name ?? "—",
        status: m.commerce.rfqStatus.submitted,
        tone: "danger",
        dateLabel: at.date.required,
        date: r.required_date,
        href: `/b2b/rfqs/${r.id}`,
        cta: at.cta.price,
      }),
    ),
    ...stageCap(undecided.rows).map(
      (q: QuotationListRow): AttentionItem => ({
        key: `chase-${q.id}`,
        kind: "chase",
        title: q.rfq_title ?? "—",
        customer: q.requester_name ?? "—",
        status: m.commerce.quotationStatus.submitted,
        tone: "warning",
        dateLabel: at.date.validUntil,
        date: q.validity_date,
        amount: money(q.total),
        amountLabel: at.amount,
        href: `/b2b/quotations/${q.id}`,
        cta: at.cta.chase,
      }),
    ),
    ...stageCap(readyForOrder).map(
      (q: QuotationListRow): AttentionItem => ({
        key: `order-${q.id}`,
        kind: "order",
        title: q.rfq_title ?? "—",
        customer: q.requester_name ?? "—",
        status: m.commerce.readyForOrder,
        tone: "success",
        dateLabel: at.date.accepted,
        date: q.decided_at,
        amount: money(q.total),
        amountLabel: at.amount,
        href: `/b2b/quotations/${q.id}`,
        cta: at.cta.order,
      }),
    ),
    ...stageCap(activeOrders).map(
      (o): AttentionItem => ({
        key: `fulfil-${o.id}`,
        kind: "fulfil",
        title: o.title ?? "—",
        customer: o.requester_name ?? "—",
        status: m.execution.orderStatus[o.status ?? "confirmed"],
        /* The same tone the pipeline panel gives this status, deliberately: two
           blocks on one screen calling "in progress" amber in one and blue in
           the other teaches the reader that colour means nothing here. */
        tone: orderTone[o.status === "in_progress" ? "in_progress" : "confirmed"],
        dateLabel: at.date.confirmed,
        date: o.confirmed_at,
        amount: money(o.total),
        amountLabel: at.amount,
        href: `/b2b/orders/${o.id}`,
        cta: at.cta.fulfil,
      }),
    ),
  ].slice(0, 6);

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
          {/* ROW 1 — triage, and the pipeline it was drawn from. The queue takes
              the 2.5fr track: it is the densest and most actionable block on the
              page, so it is the one that should absorb a wide display. */}
          <Band title={m.supply.section.attention} Icon={AlertIcon}>
            <Row cols="wide-lead">
              <Panel
                fill
                title={at.title}
                Icon={AlertIcon}
                hint={at.hint}
                badge={
                  attention.length > 0 ? (
                    <AttentionCount
                      count={attention.length}
                      locale={locale}
                      tone={attention[0]?.tone ?? "accent"}
                    />
                  ) : null
                }
                action={seeAll("/b2b/rfqs", m.supply.demand.title)}
              >
                <AttentionQueue
                  items={attention}
                  locale={locale}
                  labels={at.column}
                  empty={
                    /* An empty queue is a WIN, not a missing feature, and it is
                       drawn as one — the same panel with a tick in it, rather
                       than the apologetic "nothing here yet" an empty list
                       usually gets. */
                    <StatePanel
                      icon={<CheckIcon size={20} />}
                      title={at.clear}
                      body={at.clearBody}
                    />
                  }
                />
              </Panel>

              <Panel
                fill
                title={m.supply.pipeline.title}
                Icon={ActivityIcon}
                hint={m.supply.pipeline.hint}
                /* The catalogue closes the pipeline rather than opening a fourth
                   group inside it: it is the REASON demand arrives at all, so
                   the seller should see it here — but it is not a stage, and as
                   a fourth bar group it made the supporting panel taller than
                   the operational queue beside it, which inverts the whole
                   point of the row. */
                foot={
                  managesCatalog ? (
                    <Link href="/b2b/products" className="hover:text-accent hover:underline">
                      {m.supply.pipeline.catalogue} · {m.supply.products.stat.published}{" "}
                      <span className="font-medium tabular-nums text-fg">
                        {formatCount(products.published, locale)}
                      </span>{" "}
                      · {m.supply.products.stat.draft}{" "}
                      <span className="font-medium tabular-nums text-fg">
                        {formatCount(products.draft, locale)}
                      </span>
                    </Link>
                  ) : undefined
                }
              >
                <PipelineGroup
                  locale={locale}
                  label={m.supply.pipeline.demand}
                  href="/b2b/rfqs"
                  rows={demandStatuses.map((s) => ({
                    key: s,
                    label: m.commerce.rfqStatus[s],
                    value: supply.demand[s] ?? 0,
                    tone: demandTone[s],
                  }))}
                />

                <PipelineGroup
                  locale={locale}
                  label={m.supply.pipeline.quotations}
                  href="/b2b/quotations"
                  rows={QUOTE_STATUSES.map((s) => ({
                    key: s,
                    label: m.commerce.quotationStatus[s],
                    value: supply.quotations[s] ?? 0,
                    tone: QUOTE_TONE[s],
                  }))}
                />

                <PipelineGroup
                  locale={locale}
                  label={m.supply.pipeline.orders}
                  href="/b2b/orders"
                  rows={orderStatuses.map((s) => ({
                    key: s,
                    label: m.execution.orderStatus[s],
                    value: supply.orders[s] ?? 0,
                    tone: orderTone[s],
                  }))}
                />

              </Panel>
            </Row>
          </Band>

          {/* ROW 2 — the two live record lists, as peers. A seller reads "what
              came in" against "what I sent back"; stacking them full-width put
              a screen of scroll between two lists that answer each other. */}
          <Band
            title={m.supply.section.demand}
            Icon={DemandIcon}
            action={seeAll("/b2b/rfqs", m.supply.demand.title)}
          >
            <Row cols="even">
              <Panel
                fill
                title={m.supply.demand.awaiting}
                Icon={DemandIcon}
                hint={m.supply.demand.awaitingHint}
                action={seeAll("/b2b/rfqs", m.common.view)}
              >
                <RfqTable rfqs={incoming.rows} perspective="supplier" locale={locale} m={m} />
              </Panel>

              <Panel
                fill
                title={m.supply.quotations.latest}
                Icon={FileTextIcon}
                hint={m.supply.quotations.latestHint}
                action={seeAll("/b2b/quotations", m.supply.quotations.title)}
              >
                <QuotationTable quotations={sent.rows} perspective="supplier" locale={locale} m={m} compact />
              </Panel>
            </Row>
          </Band>

          {/* ROW 3 + 4 — conversion. The trend leads its row because a line needs
              width to be readable at all; the funnel beside it is the same story
              told as a rate rather than a total. */}
          <Band
            title={m.supply.section.performance}
            Icon={TrendingUpIcon}
            action={seeAll("/b2b/reports", m.home.openReports)}
          >
            <Row cols="lead">
              <Panel
                fill
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

              <Panel
                fill
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
            </Row>

            <Row cols="thirds">
              <Panel
                fill
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
                fill
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

              <Panel
                fill
                title={m.supply.chart.quotationsByStatus}
                Icon={FileTextIcon}
                foot={
                  <>
                    {m.supply.acceptedValue}:{" "}
                    <span dir="ltr" className="font-medium tabular-nums text-fg">
                      {money(supply.acceptedValue)}
                    </span>
                  </>
                }
              >
                <RankedBars
                  locale={locale}
                  emptyLabel={m.reports.noData}
                  items={QUOTE_STATUSES.map((s) => ({
                    label: m.commerce.quotationStatus[s],
                    value: supply.quotations[s] ?? 0,
                  }))}
                />
              </Panel>
            </Row>
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

/**
 * One stage inside the pipeline panel.
 *
 * The panel used to be three separate cards of two or three rows each, which is
 * how a context column ends up 300px tall beside an 800px queue. Grouped under
 * quiet stage captions instead, the same figures read as ONE pipeline — which is
 * what they are — and the panel earns the height of the row it sits in.
 */
function PipelineGroup({
  label,
  href,
  locale,
  rows,
}: {
  label: string;
  /** Where every row in this group goes — one stage, one module. */
  href: string;
  locale: Locale;
  rows: { key: string; label: string; value: number; tone: KpiTone }[];
}) {
  // Share of THIS group, not of the page: a stage's statuses are parts of that
  // stage, and measuring "closed requests" against the order count would compare
  // two different denominators and draw a bar that means nothing.
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1 text-label font-medium uppercase tracking-wide text-fg-muted">{label}</p>
      {rows.map((r) => (
        <PanelRow
          key={r.key}
          locale={locale}
          label={r.label}
          value={r.value}
          tone={r.tone}
          href={href}
          share={total > 0 ? r.value / total : 0}
        />
      ))}
    </div>
  );
}

const QUOTE_STATUSES = ["draft", "submitted", "accepted", "rejected"] as const;
const QUOTE_TONE = {
  draft: "neutral",
  submitted: "warning",
  accepted: "success",
  rejected: "danger",
} as const;

function sumOf(rec: Record<string, number>) {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}
