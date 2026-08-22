import Link from "next/link";
import type { PageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  recentRfqs,
  recentQuotations,
  ownProductCounts,
  demandSignals,
  type RfqListRow,
  type QuotationListRow,
} from "@/server/queries/commerce";
import { listOrders, quotationsWithOrders } from "@/server/queries/execution";
import { supplySummary } from "@/server/queries/reports";
import { resolvePeriod, periodDays, type PeriodKey } from "@/lib/workspace/period";
import {
  PageHead,
  KpiStrip,
  Row,
  Panel,
  type Kpi,
  type KpiDelta,
} from "@/components/ui/workspace-layout";
import { RankedBars } from "@/components/ui/charts";
import {
  AttentionQueue,
  AttentionCount,
  AttentionFilter,
  type AttentionItem,
  type AttentionKind,
} from "@/features/home/supply-attention";
import {
  OpportunityList,
  MarketMovement,
  WorkflowFlow,
  NotificationsEmpty,
  ProductVideosEmpty,
  BlockEmpty,
  type FlowStage,
} from "@/features/home/supply-blocks";
import { PeriodSelect } from "@/features/home/period-select";
import { formatCompactMoney, formatCount } from "@/lib/ui/format";
import { supplyVoice } from "@/lib/workspace/supply-side";
import {
  DemandIcon,
  FileTextIcon,
  ClipboardIcon,
  PackageIcon,
  MoneyIcon,
  StorefrontIcon,
  ActivityIcon,
  GaugeIcon,
  PlusIcon,
  BarChartIcon,
  AlertIcon,
  CheckIcon,
  TrendingUpIcon,
  BellIcon,
  VideoIcon,
} from "@/components/ui/icons";

/**
 * The SUPPLY-SIDE dashboard — what a Distributor, Manufacturer or Importer opens
 * the app to.
 *
 * ONE WORKSPACE, READ FROM THE SELLING SEAT
 * This is not a second application. Every record shown lives at the same route
 * the buyer's does, and each figure links to the module that owns it. What
 * differs is the QUESTION each block answers, because the two seats do genuinely
 * different work.
 *
 * WHY IT IS EIGHT BLOCKS ON FOUR ROWS AND NOT A COLUMN OF TWELVE
 * The previous version answered five questions in sequence — triage, then the
 * record lists, then conversion, then fulfilment, then next steps — and each got
 * a full-width band. It was correct and it was four screens long, which for a
 * surface whose entire purpose is the morning glance is a design failure no
 * amount of per-block polish fixes. It also duplicated: the incoming-requests
 * table and the quotations table repeated, in full, two modules that are one
 * click away in the sidebar, while the attention queue above them had already
 * named the rows that actually needed work.
 *
 * What survives is what the dashboard alone can say. Everything that was a
 * second copy of a module's own list is gone — the routes are untouched and
 * every one of them is still reachable; they are simply no longer transcribed
 * onto the home page.
 *
 *   ROW 1  The instrument panel, scoped to a period.
 *   ROW 2  What needs me now · what is being asked of me.
 *   ROW 3  What is moving · what happened · where my work is stuck.
 *   ROW 4  My shelf: clips, best products, best customers.
 *
 * Rows 2–4 are proportional grids, so a wide display spends its extra pixels on
 * the operational block in each row rather than stretching every card equally.
 *
 * WHAT IS DELIBERATELY ABSENT
 * The reference set also shows a wallet balance, carrier tracking on a map,
 * invoices and collections, a commission ledger and an AI recommendation rail.
 * None has a model in this repository. Its COMPOSITION is borrowed; its features
 * are not. See `supply-blocks.tsx` for the four blocks whose honest form is an
 * empty state.
 */
export async function SupplyDashboard({
  ctx,
  period: rawPeriod,
  stage: rawStage,
}: {
  ctx: PageContext;
  /** From the URL — validated here, never trusted. */
  period?: string;
  stage?: string;
}) {
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const voice = supplyVoice(org.orgType);

  const period = resolvePeriod(rawPeriod);
  const days = periodDays(period);
  const stage = resolveStage(rawStage);

  const caps = new Set(org.capabilities);
  const superUser = caps.has("org.manage");
  const has = (...keys: string[]) => superUser || keys.some((k) => caps.has(k));

  // Capability gates, not org-type gates. A distributor's warehouse clerk may
  // hold `project.read` and nothing else; they get the fulfilment stage and no
  // pricing figures, in the same workspace.
  const sells = has("rfq.respond", "quote.submit", "catalog.publish", "order.manage");
  const managesCatalog = has("catalog.write", "catalog.publish");
  const fulfils = has("order.manage", "order.create", "project.read", "project.write");

  const EMPTY_LIST = { rows: [], total: 0 };
  const EMPTY_SIGNALS = { open: [], openRequests: 0, movement: [], windowRequests: 0 };

  /* The demand-movement window. "All time" has no window, and a movement figure
     over all of history is not a movement — so it borrows a year, which is the
     longest span the selector otherwise offers. The panel's hint names the
     window either way, so the reader is never guessing what they are looking at. */
  const movementDays = days ?? 365;

  const [supply, products, incoming, undecided, accepted, orders, signals] = await Promise.all([
    // One call covers every KPI, both rankings and the flow — they are all
    // aggregates of the same three record sets, and `days` buys the
    // period-over-period comparison from those same rows at no extra cost.
    sells ? supplySummary(supabase, org.organizationId, {}, 6, days) : null,
    managesCatalog
      ? ownProductCounts(supabase, org.organizationId)
      : Promise.resolve({ total: 0, published: 0, draft: 0 }),
    // Six per stage, not five: the queue shows six rows when a single stage is
    // filtered to, and a cap below that would make the filter look broken.
    sells
      ? recentRfqs(supabase, org.organizationId, "supplier", { statuses: ["submitted"], limit: 6 })
      : Promise.resolve(EMPTY_LIST),
    sells
      ? recentQuotations(supabase, org.organizationId, "supplier", {
          statuses: ["submitted"],
          limit: 6,
        })
      : Promise.resolve(EMPTY_LIST),
    sells
      ? recentQuotations(supabase, org.organizationId, "supplier", {
          statuses: ["accepted"],
          limit: 6,
        })
      : Promise.resolve(EMPTY_LIST),
    fulfils ? listOrders(supabase, org.organizationId, "supplier") : Promise.resolve([]),
    // The two demand-reading blocks — opportunities and movement — in one call.
    sells ? demandSignals(supabase, org.organizationId, movementDays, 5) : Promise.resolve(EMPTY_SIGNALS),
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
  /**
   * COMPACT money everywhere on this page, exact money nowhere.
   *
   * `formatMoney` renders "EGP 45,500.00", which at English width overflowed the
   * attention queue's value cell and truncated to "EGP 45,500…". A truncated
   * number does not look truncated — it looks like a SMALLER NUMBER, and it is
   * a perfectly plausible one. This workspace already treats that as a
   * correctness bug rather than a layout nit (`KpiStrip` refuses to truncate for
   * exactly this reason).
   *
   * A wider cell is not the fix: the exact figure would truncate again at seven
   * digits, and the queue has no room to give that is not already spent on the
   * record's own name. A dashboard is a GLANCE surface — "EGP 45.5K" is what a
   * seller triaging six rows needs, it is the same treatment the strip directly
   * above already uses, and the exact total is one click away on the record.
   */
  const money = (v: number | null | undefined) => formatCompactMoney(v, locale);
  const p = supply?.period;

  /**
   * A measured movement, or nothing at all.
   *
   * The rule the whole strip rests on: a delta exists only where a real previous
   * window with a NON-ZERO baseline exists. A first month of trading has no
   * percentage — not 0%, not ∞%, not "new" dressed up as growth — and the tile
   * silently falls back to its `foot` line. See `KpiDelta`.
   */
  const movement = (current: number, previous: number): KpiDelta | undefined => {
    if (!p || previous <= 0) return undefined;
    const pct = ((current - previous) / previous) * 100;
    return {
      pct,
      // Every metric on this strip is one where MORE is better — requests
      // received, prices sent, orders won, money. `null` at exactly zero, so an
      // unchanged month is not painted as a success.
      better: pct === 0 ? null : pct > 0,
      label: period === "30d" ? m.supply.period.vsMonth : m.supply.period.vsPrevious,
    };
  };

  /**
   * FIVE cells, four of them period-scoped flows and one a live backlog.
   *
   * The mix is deliberate and is the honest reading of the period control. Four
   * of these are things that HAPPENED inside the window — requests arrived,
   * prices went out, orders were confirmed, money was won — so they move when
   * the window moves and each can be compared against the window before it.
   *
   * "Waiting to be priced" is not that. It is a STATE, true right now, and it
   * would be false to shrink it because the reader chose to look at 30 days
   * rather than 90: the request from six weeks ago is still unanswered. So it
   * carries no delta and keeps a context line instead, which is also what makes
   * it visually distinguishable from its four neighbours at a glance.
   */
  const kpis: Kpi[] = [];
  if (supply) {
    kpis.push({
      label: m.supply.tile.demandIn,
      value: p ? p.current.demand : sumOf(supply.demand),
      Icon: DemandIcon,
      /* The strip's one accented cell. Requests arriving is what a seller opens
         the app to find out, so it takes the brand colour and its four
         neighbours do not — an accent on every cell is a strip with no lead. */
      tone: "accent",
      delta: movement(p?.current.demand ?? 0, p?.previous.demand ?? 0),
      foot: m.supply.tile.demandInHint,
      href: "/b2b/rfqs",
    });
    kpis.push({
      label: m.supply.tile.quotationsOut,
      value: p ? p.current.quotations : sumOf(supply.quotations),
      Icon: FileTextIcon,
      /* Neutral. Of the inbound/outbound pair, "demand in" is the one a
         seller opens the app for — prices going out is the consequence of it,
         not a second headline, and two accented cells side by side rank against
         each other rather than against the page. */
      tone: "neutral",
      delta: movement(p?.current.quotations ?? 0, p?.previous.quotations ?? 0),
      foot: m.supply.tile.quotationsOutHint,
      href: "/b2b/quotations",
    });
    kpis.push({
      label: m.supply.tile.ordersWon,
      value: p ? p.current.orders : sumOf(supply.orders),
      Icon: ClipboardIcon,
      tone: "info",
      delta: movement(p?.current.orders ?? 0, p?.previous.orders ?? 0),
      foot: m.supply.tile.ordersWonHint,
      href: "/b2b/orders",
    });
    kpis.push({
      label: m.supply.tile.orderValue,
      // Compact on the strip so a seven-figure EGP total cannot truncate in the
      // two-column phone grid; the exact figure lives on Reports, one click away.
      value: formatCompactMoney(p ? p.current.orderValue : supply.orderValue, locale),
      Icon: MoneyIcon,
      /* `info`, not `success`. Money won is a MEASUREMENT, not a state, and the
         cell already answers "is this good?" honestly one line below: the delta
         is what carries success green or danger red, by comparison against the
         previous window. Painting the tile green as well said "good" about the
         figure itself, which no total can be — a green tile over a 40% drop is
         the dashboard contradicting itself. Lapis keeps it in the cool family
         with the orders tile it belongs beside. */
      tone: "info",
      delta: movement(p?.current.orderValue ?? 0, p?.previous.orderValue ?? 0),
      foot: m.supply.tile.orderValueHint,
      href: "/b2b/reports",
    });
    kpis.push({
      label: m.supply.tile.awaitingResponse,
      value: supply.awaitingResponse,
      Icon: AlertIcon,
      tone: supply.awaitingResponse > 0 ? "danger" : "neutral",
      foot: m.supply.tile.awaitingResponseHint,
      href: "/b2b/rfqs",
    });
  } else if (managesCatalog) {
    // A catalogue-only seat (no pricing rights) still needs an instrument panel;
    // it just measures a different thing, and none of it is period-scoped.
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
        /* `info`, not `warning`. An unpublished draft is work in hand, not a
           fault, and amber here claimed otherwise. Blue rather than a second
           accented tile because this strip already leads with one — the total —
           and repeating it three cells later makes the accent the default. */
        tone: products.draft > 0 ? "info" : "neutral",
        foot: m.supply.tile.draftsHint,
        href: "/b2b/products?status=draft",
      },
    );
  }

  /* The status→tone map, declared above the queue because the queue reads from
     it: one status must not be one colour in the flow panel and another in the
     row three inches to its left.

     `in_progress` is INFO, not warning. An order being worked on is the system
     doing exactly what it should; ochre said "something is wrong here" about the
     healthiest row in the queue, and it said it in the same colour as the
     quotation two rows above that genuinely is going stale. Amber here means
     attention is needed and an order in progress needs none, so both live order
     states read as blue and only `completed` graduates to green. */
  const orderTone = { confirmed: "info", in_progress: "info", completed: "success" } as const;

  const at = m.supply.attention;

  /**
   * THE ATTENTION QUEUE, grouped by stage so the filter has something to filter.
   *
   * Ordered by STAGE — price, chase, order, fulfil — which is the order a seller
   * actually works, and the only ordering that is honest across four record
   * types: "soonest date first" would be sorting a required-by against a
   * valid-until against a confirmed-on, which compares nothing.
   */
  const byStage: Record<AttentionKind, AttentionItem[]> = {
    price: incoming.rows.map(
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
    chase: undecided.rows.map(
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
    order: readyForOrder.map(
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
    fulfil: activeOrders.map(
      (o): AttentionItem => ({
        key: `fulfil-${o.id}`,
        kind: "fulfil",
        title: o.title ?? "—",
        customer: o.requester_name ?? "—",
        status: m.execution.orderStatus[o.status ?? "confirmed"],
        /* The same tone the flow panel gives this status, deliberately: two
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
  };

  /**
   * Unfiltered, the queue is a TRIAGE list: three per stage, six in total, so no
   * one stage can bury the others. Filtered, it is a short work list for that
   * stage and shows six of it. Either way the module owning the stage is one
   * click away and holds the complete list.
   */
  const attention: AttentionItem[] = stage
    ? byStage[stage].slice(0, 6)
    : (["price", "chase", "order", "fulfil"] as const)
        .flatMap((k) => byStage[k].slice(0, 3))
        .slice(0, 6);

  /* The chip counts come from the queries' EXACT totals where one exists, not
     from the fetched page — a seat with fifty unpriced requests must not see a
     chip reading "6" beside a tile reading "50". The two derived stages have no
     server-side count (both are computed from a fetched page: "accepted with no
     order behind it" is a set difference, and the active orders are filtered in
     memory), so they report what the queue can actually show. */
  const stageCounts: { key: AttentionKind; label: string; count: number }[] = [
    { key: "price", label: at.stage.price, count: incoming.total },
    { key: "chase", label: at.stage.chase, count: undecided.total },
    { key: "order", label: at.stage.order, count: readyForOrder.length },
    { key: "fulfil", label: at.stage.fulfil, count: activeOrders.length },
  ];

  /* Parameters a stage chip must carry forward, so filtering the queue cannot
     silently reset the period the strip above it is showing. The default period
     carries none, which keeps the plain dashboard URL clean. */
  const carry: Record<string, string> = period === "30d" ? {} : { period };

  /**
   * The "go to the module that owns this" link every panel carries.
   *
   * `text-accent`, which is the EMPHASIS-LINK convention across the whole
   * product — auth, directory, commerce and the buyer dashboard's own `seeAll`
   * all draw it this way. A dashboard that invents its own link colour teaches
   * the reader that a link here is a different kind of thing from a link one
   * route over, which it is not.
   *
   * What keeps eight of them from shouting is not their hue but the company
   * they keep: the panels behind them are neutral, so a link is the only marked
   * thing in each header rather than one warm note among several.
   */
  const seeAll = (href: string, label: string) => (
    <Link href={href} className="text-label font-medium text-accent hover:underline">
      {label} →
    </Link>
  );

  /** The commerce lifecycle, counted. Real stages, real counts, no new domain. */
  const flow: FlowStage[] = supply
    ? [
        {
          key: "incoming",
          label: m.supply.flow.incoming,
          value: supply.demand.submitted ?? 0,
          tone: "danger",
          href: "/b2b/rfqs",
        },
        {
          key: "quoted",
          label: m.supply.flow.quoted,
          value: supply.quotations.submitted ?? 0,
          /* Amber, and it has to be amber precisely BECAUSE the queue calls the
             same population `chase`: these are prices sitting with a customer
             against a validity date. One panel calling that "attention" while
             its neighbour three inches away calls it something else is how a
             reader learns that colour means nothing here. */
          tone: "warning",
          href: "/b2b/quotations",
        },
        {
          key: "accepted",
          label: m.supply.flow.accepted,
          value: supply.quotations.accepted ?? 0,
          tone: "success",
          href: "/b2b/quotations",
        },
        {
          key: "ordered",
          label: m.supply.flow.ordered,
          value: supply.orders.confirmed ?? 0,
          tone: "info",
          href: "/b2b/orders",
        },
        {
          key: "running",
          label: m.supply.flow.running,
          value: (supply.orders.in_progress ?? 0) + (supply.orders.completed ?? 0),
          /* Blue, matching `orderTone` above. The flow panel and the attention
             queue count the same orders and must not colour them differently. */
          tone: "info",
          href: "/b2b/orders",
        },
      ]
    : [];

  const periodLabel = m.supply.period[period];

  return (
    <div className="flex flex-col gap-md pb-16 tablet:pb-0">
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
              /* Lumen, the brand ACTION colour, on the page's one primary
                 action — which is what that colour is for and the only thing it
                 is for. Every decorative amber on this dashboard has been spent
                 elsewhere; this one stays. */
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-sm bg-accent-solid px-md py-1.5 text-label font-medium text-brand-basalt shadow-sm transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <PlusIcon size={16} />
              {m.commerce.products.new}
            </Link>
          ) : undefined
        }
      />

      {/* ROW 1 — the instrument panel. The period control lives INSIDE the
          strip's own header, because it scopes exactly these figures and nothing
          else on the page: the queues below are live work and must not be
          filtered by a date window. */}
      <KpiStrip
        locale={locale}
        items={kpis}
        columns={5}
        title={m.supply.section.overview}
        toolbar={
          <PeriodSelect
            value={period}
            basePath="/b2b"
            label={m.supply.period.label}
            options={PERIODS.map((k) => ({ value: k, label: m.supply.period[k] }))}
          />
        }
      />

      {supply ? (
        <>
          {/* ROW 2 — what needs me, beside what is being asked of me.
              `wide-lead` (5:2), not `lead` (3:2), and the difference is a
              measured defect rather than a preference. The queue switches to its
              single-line row form at the `wide` VIEWPORT breakpoint, but the
              width that form actually needs is a CONTAINER width of ~800px. On a
              1440px display a 3:2 track gave it ~700px, so the row form engaged
              in a column too narrow to hold it and every date in the queue
              truncated mid-word ("١٠ سبتم…", "تاريخ الت…"). At 5:2 the same
              display gives it ~820px and every cell renders whole. */}
          <Row cols="wide-lead">
            <Panel
              fill
              tone="danger"
              bodyClassName="flex flex-col"
              title={at.title}
              Icon={AlertIcon}
              badge={
                attention.length > 0 ? (
                  <AttentionCount
                    count={attention.length}
                    locale={locale}
                    tone={attention[0]?.tone ?? "accent"}
                  />
                ) : null
              }
              action={seeAll(stageHref(stage), m.common.more)}
            >
              {/* The filter sits ABOVE the queue, inside the panel body. It is a
                  control over the list, and a control that appears after the
                  thing it controls has already been read is a control nobody
                  uses. It is in the body rather than the header because the
                  header already carries a title, a count badge and the "more"
                  link — a fourth element there wraps it onto two lines at
                  laptop width. */}
              <div className="mb-3">
                <AttentionFilter
                  stages={stageCounts}
                  active={stage}
                  basePath="/b2b"
                  locale={locale}
                  allLabel={at.stage.all}
                  query={carry}
                />
              </div>

              <AttentionQueue
                items={attention}
                locale={locale}
                labels={at.column}
                empty={
                  /* An empty queue is a WIN, not a missing feature, and it is
                     drawn as one — the same panel with a tick in it, rather than
                     the apologetic "nothing here yet" an empty list usually
                     gets. A FILTERED empty queue says something different: the
                     stage is clear, not the whole board. */
                  <BlockEmpty
                    icon={<CheckIcon size={20} />}
                    title={stage ? at.stageClear : at.clear}
                    body={stage ? at.stageClearBody : at.clearBody}
                  />
                }
              />
            </Panel>

            <Panel
              fill
              tone="info"
              bodyClassName="flex flex-col"
              title={m.supply.opportunities.title}
              Icon={TrendingUpIcon}
              hint={m.supply.opportunities.hint}
              action={seeAll("/b2b/rfqs", m.common.more)}
            >
              <OpportunityList
                lines={signals.open}
                locale={locale}
                unitLabel={(u) => m.commerce.units[u]}
                labels={{
                  quantity: m.supply.opportunities.quantity,
                  buyer: m.supply.opportunities.buyer,
                  required: at.date.required,
                  status: m.supply.opportunities.status,
                  cta: m.supply.opportunities.cta,
                  more: m.supply.opportunities.more,
                }}
                empty={
                  <BlockEmpty
                    icon={<TrendingUpIcon size={20} />}
                    title={m.supply.opportunities.empty}
                    body={m.supply.opportunities.emptyBody}
                  />
                }
              />

              {/* Pinned to the foot of the panel by `mt-auto`, which is what
                  turns the leftover height into a deliberate footer.

                  This panel sits beside the attention queue and will almost
                  always be the shorter of the two, because a seller has more
                  stalled work than they have unpriced lines. `Panel fill` levels
                  the row, so that difference becomes blank surface at the bottom
                  of this one. Rather than fight the levelling — a ragged row
                  foot looks worse than a gap — the gap is spent on the one thing
                  the block was missing: a way out to the full request list that
                  does not require going back up to the header. */}
              {signals.open.length > 0 ? (
                <div className="mt-auto flex justify-center pt-3">
                  <Link
                    href="/b2b/rfqs"
                    className="text-label font-medium text-accent hover:underline"
                  >
                    {m.supply.demand.title} →
                  </Link>
                </div>
              ) : null}
            </Panel>
          </Row>

          {/* ROW 3 — what is moving, what happened, and where the work sits.

              NEUTRAL HEADERS FROM HERE DOWN, and this is where the page stops
              spending colour. `Panel` offers a tinted header band, and taking it
              up on every panel is how a dashboard ends up with eight coloured
              cards and no ranking between them — the wash stops being a label
              and becomes the card's background. Row 2 is where the reader WORKS,
              so its two panels keep a wash: red for what is late, blue for where
              the new business is. Rows 3 and 4 are reference — they are read, not
              acted on — and they carry their subject in the title and their
              accent in the chart, which is enough. */}
          <Row cols="thirds">
            <Panel
              fill
              tone="neutral"
              bodyClassName="flex flex-col"
              title={m.supply.market.title}
              Icon={BarChartIcon}
              hint={m.supply.market.hint.replace("{period}", periodLabel)}
              action={seeAll("/b2b/reports", m.home.openReports)}
            >
              <MarketMovement
                rows={signals.movement}
                locale={locale}
                labels={{ requests: m.supply.market.requests, new: m.supply.market.new }}
                empty={
                  <BlockEmpty
                    icon={<BarChartIcon size={20} />}
                    title={m.supply.market.empty}
                    body={m.supply.market.emptyBody}
                  />
                }
              />
            </Panel>

            <Panel
              fill
              tone="neutral"
              bodyClassName="flex flex-col"
              title={m.supply.notifications.title}
              Icon={BellIcon}
              hint={m.supply.notifications.hint}
            >
              <NotificationsEmpty
                title={m.supply.notifications.empty}
                body={m.supply.notifications.emptyBody}
              />
            </Panel>

            <Panel
              fill
              tone="neutral"
              title={m.supply.pipeline.title}
              Icon={ActivityIcon}
              hint={m.supply.pipeline.hint}
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
              <WorkflowFlow stages={flow} locale={locale} />
            </Panel>
          </Row>

          {/* ROW 4 — the shelf. Two rankings of what is actually selling and to
              whom, and the clips rail that will hold product video when there is
              a model for it. */}
          <Row cols="thirds">
            <Panel
              fill
              tone="neutral"
              bodyClassName="flex flex-col"
              title={m.supply.videos.title}
              Icon={VideoIcon}
              hint={m.supply.videos.hint}
            >
              <ProductVideosEmpty
                title={m.supply.videos.empty}
                body={m.supply.videos.emptyBody}
                action={
                  managesCatalog
                    ? seeAll("/b2b/products", m.supply.products.title)
                    : undefined
                }
              />
            </Panel>

            <Panel
              fill
              tone="neutral"
              title={m.supply.chart.topProducts}
              Icon={PackageIcon}
              hint={m.supply.voice[voice].topProductsHint}
            >
              <RankedBars
                locale={locale}
                rank
                bar="lapis"
                emptyLabel={m.supply.empty.noProductSales}
                items={supply.topProducts.slice(0, 5).map((pr) => ({
                  label: pr.name,
                  value: pr.value,
                  detail: money(pr.value),
                }))}
              />
            </Panel>

            <Panel
              fill
              tone="neutral"
              title={m.supply.chart.topCustomers}
              Icon={StorefrontIcon}
              action={seeAll("/b2b/buyers", m.common.more)}
            >
              <RankedBars
                locale={locale}
                rank
                bar="lapis"
                emptyLabel={m.supply.empty.noCustomers}
                items={supply.topCustomers.slice(0, 5).map((c) => ({
                  label: c.name,
                  value: c.value || c.orders,
                  detail: money(c.value),
                }))}
              />
            </Panel>
          </Row>
        </>
      ) : null}

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

/** The periods the strip offers, in the order the selector lists them. */
const PERIODS: PeriodKey[] = ["30d", "90d", "365d", "all"];

/** The URL is user input: anything not a stage is no stage. */
function resolveStage(raw: string | undefined): AttentionKind | null {
  return raw === "price" || raw === "chase" || raw === "order" || raw === "fulfil" ? raw : null;
}

/**
 * Where the queue's "more" link goes.
 *
 * A filtered queue sends the reader to the module that owns THAT stage, because
 * that is where its full list is; unfiltered, the queue spans four modules and
 * no single one of them is "more", so it falls back to the requests module —
 * the first stage, and the one a seller is most often behind on.
 */
function stageHref(stage: AttentionKind | null): string {
  if (stage === "chase" || stage === "order") return "/b2b/quotations";
  if (stage === "fulfil") return "/b2b/orders";
  return "/b2b/rfqs";
}

function sumOf(rec: Record<string, number>) {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}
