import type { PageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  recentRfqs,
  recentQuotations,
  ownProductCounts,
  demandSignals,
  listOwnProducts,
  type RfqListRow,
  type QuotationListRow,
} from "@/server/queries/commerce";
import { listOrders, quotationsWithOrders } from "@/server/queries/execution";
import { supplySummary } from "@/server/queries/reports";
import { resolvePeriod, periodDays } from "@/lib/workspace/period";
import { type Kpi, type KpiDelta } from "@/components/ui/workspace-layout";
import { RankedBars, DonutSplit } from "@/components/ui/charts";
import {
  AttentionFilter,
  type AttentionItem,
  type AttentionKind,
} from "@/features/home/supply-attention";
import {
  NotificationsEmpty,
  BlockEmpty,
  type FlowStage,
} from "@/features/home/supply-blocks";
import { ViewActivityAction } from "@/features/home/notifications-footer-link";
import { StageSelect } from "@/features/home/stage-select";
import { BoardMenu } from "@/features/home/board-menu";
import {
  Board,
  BoardCount,
  BoardOut,
  DashboardHead,
  PrimaryAction,
  SecondaryAction,
  MetricStrip,
  AttentionBoard,
  IncomingRail,
  MovingBoard,
  ActivityBoard,
  PipelineTrack,
  HeaderToggle,
  ReelsBoard,
  type Metric,
  type MetricTone,
  type AttentionRow,
  type IncomingRow,
  type MovingRow,
  type ActivityRow,
  type PipelineStage,
  type ReelItem,
} from "@/features/home/supply-boards";
import { listNotifications } from "@/server/queries/notifications";
import { toNotificationViews } from "@/features/notifications/view-model";
import { createTranslator } from "@/lib/i18n/translate";
import {
  formatCompactMoney,
  formatCount,
  formatDate,
  formatDateShort,
  formatPercent,
  formatQuantity,
  formatRelativeTime,
} from "@/lib/ui/format";
import { supplyVoice } from "@/lib/workspace/supply-side";
import {
  DemandIcon,
  FileTextIcon,
  ClipboardIcon,
  PackageIcon,
  MoneyIcon,
  StorefrontIcon,
  ActivityIcon,
  PlusIcon,
  BarChartIcon,
  AlertIcon,
  CheckIcon,
  TrendingUpIcon,
  BellIcon,
  CalendarIcon,
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
  sort: rawSort,
  demandWindow: rawDemandWindow,
}: {
  ctx: PageContext;
  /** From the URL — validated here, never trusted. */
  period?: string;
  stage?: string;
  /** The attention board's "Due date" header toggle. */
  sort?: string;
  /** The incoming-demand board's "Today" header toggle. */
  demandWindow?: string;
}) {
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const voice = supplyVoice(org.orgType);

  const period = resolvePeriod(rawPeriod);
  const days = periodDays(period);
  const stage = resolveStage(rawStage);
  /* Both header toggles are ordinary view state now. They used to be gated on
     one account's email, which is not a permission — it was scaffolding holding
     a prototype control off everyone else's dashboard. Sorting a queue by due
     date and narrowing a demand list to today read NOTHING the caller cannot
     already see on this page, and both resolve to a boolean that only reorders
     or filters rows RLS already returned. There is nothing here for a
     hand-typed query string to reach. */
  const sortDue = rawSort === "due";
  const demandToday = rawDemandWindow === "today";

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

  const [supply, products, incoming, undecided, accepted, orders, signals, notificationRows, reelProducts] =
    await Promise.all([
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
      /* The SAME persisted source the header panel reads, scoped to the same
         workspace — five rows, because this is a block in a three-across row and
         not an inbox. Ungated by capability on purpose: `notifications` is
         recipient-scoped by RLS, so what arrives is already only this reader's
         own mail. */
      listNotifications(supabase, { orgId: org.organizationId, limit: 5 }),
      /* The Reels module's product photos. Gated on the CAPABILITY that decides
         whether this workspace has a catalogue to show reels of — the same gate
         the module itself renders behind — so a workspace that cannot publish
         products pays nothing for a query it would never draw. This used to be
         `designLabAtmosphere && managesCatalog`: the identity half is gone, the
         capability half is the part that was always doing real work. */
      managesCatalog
        ? listOwnProducts(supabase, org.organizationId, { status: "published" })
        : Promise.resolve([]),
    ]);

  const notifications = toNotificationViews(notificationRows, createTranslator(locale), locale);

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

  /* DESIGN-LAB "Due date" header toggle — resorts the SAME six rows already
     selected above by their own date, soonest first. Not a new query: every
     row already carries the one date that matters for its stage: */
  if (sortDue) {
    attention.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }

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

  /* Parameters a header control must carry forward, so changing ONE of them
     cannot silently reset another — a stage chip changing the period, or the
     "Due date" toggle dropping a stage filter. Each control's own href
     builder still sets/deletes its OWN param on top of this; the point is
     that every OTHER param already reflects the current URL. Defaults carry
     nothing, which is what keeps the plain dashboard URL clean. */
  const carry: Record<string, string> = {
    ...(period !== "30d" ? { period } : {}),
    ...(stage ? { stage } : {}),
    ...(sortDue ? { sort: "due" } : {}),
    ...(demandToday ? { demandWindow: "today" } : {}),
  };

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

  /* ------------------------------------------------------------------
     FROM FIGURES TO BOARDS

     Everything below this line is PRESENTATION. Not one query moves, not one
     capability gate changes, and no figure is recomputed — the strip, the queue
     and the flow are the same values assembled above, re-shaped for the boards
     that draw them. That separation is the whole reason the visual rebuild
     could be this large without touching a contract.
     ------------------------------------------------------------------ */

  /* KpiTone carries two tones the metric chips have no use for. `warning` folds
     into `accent` (both are the warm chip) and anything unrecognised falls to
     neutral, so a new tone upstream degrades to a grey chip rather than to no
     chip at all. */
  const chipTone = (t: Kpi["tone"]): MetricTone =>
    t === "warning" || t === "accent"
      ? "accent"
      : t === "success" || t === "danger" || t === "info" || t === "iris"
        ? t
        : "neutral";

  const metrics: Metric[] = kpis.map((k, idx) => ({
    key: `${idx}-${k.label}`,
    label: k.label,
    /* Counts arrive as numbers and money arrives pre-formatted, because money
       had to be compacted where it was computed. Both end as strings here so
       the board layer never has to know which is which. */
    value: typeof k.value === "number" ? formatCount(k.value, locale) : String(k.value),
    Icon: k.Icon,
    tone: chipTone(k.tone),
    delta: k.delta
      ? {
          /* The sign is carried by the arrow and the colour, so the number is
             printed unsigned — "▼ 8%" rather than "▼ -8%", which reads as a
             double negative. */
          text: formatPercent(Math.abs(k.delta.pct), locale),
          better: k.delta.better,
          label: k.delta.label,
        }
      : undefined,
    foot: k.foot,
    /* The one metric that is a live backlog rather than a period flow marks
       itself when it is non-zero — see the `kpis` block above. */
    footTone: k.tone === "danger" ? "warning" : "muted",
    href: k.href,
  }));

  /* The material images and the buyer's actual lines, indexed by request.

     Both come from `signals.open`, which is ALREADY FETCHED for the incoming
     rail — this is a regrouping of rows in hand, not a second read. Only
     unpriced requests are covered, so only `price` rows can carry a photo;
     every other stage falls through to ProductMedia's own "no image" panel,
     which is the honest outcome rather than a placeholder standing in for one. */
  const imageByRfq = new Map<string, string>();
  const linesByRfq = new Map<string, { name: string; quantity: string; imageRef: string | null }[]>();
  for (const line of signals.open) {
    if (line.imageRef && !imageByRfq.has(line.rfqId)) imageByRfq.set(line.rfqId, line.imageRef);
    const bucket = linesByRfq.get(line.rfqId) ?? [];
    bucket.push({
      name: line.productName,
      quantity: `${formatQuantity(line.quantity, locale)} ${m.commerce.units[line.unit]}`,
      imageRef: line.imageRef,
    });
    linesByRfq.set(line.rfqId, bucket);
  }

  /* The record id, recovered from the queue key.

     The key is built directly above as `${kind}-${id}`, and no kind contains a
     hyphen, so the first hyphen is the boundary. Reading it back here rather
     than widening `AttentionItem` keeps the id out of a view model that has no
     other use for it — the queue navigates by `href`, not by id. */
  const recordId = (key: string) => key.slice(key.indexOf("-") + 1);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const attentionRows: AttentionRow[] = attention.map((a) => {
    const id = recordId(a.key);
    /* Overdue is only meaningful where the date is a DEADLINE. A required-by
       date and a validity date are both promises about the future, so a past one
       is a fault; an accepted-on or confirmed-on date is a record of the past and
       is supposed to have happened already. Painting the latter red would mark
       every healthy order in the queue. */
    const deadline = a.kind === "price" || a.kind === "chase";
    return {
      key: a.key,
      stage: at.stage[a.kind],
      tone: chipTone(a.tone),
      title: a.title,
      customer: a.customer,
      imageRef: imageByRfq.get(id) ?? null,
      dateLabel: a.dateLabel,
      /* The row's column gets day-and-month; the expanded region, which has
         the width, keeps the full date. Same instant, two readings. */
      date: formatDateShort(a.date, locale),
      dateLong: formatDate(a.date, locale),
      overdue: deadline && !!a.date && new Date(a.date) < startOfToday,
      /* Money where the stage has money, the line count where it does not.
         Only the money gets a caption: "Value / EGP 132K" needs one, and
         "1 items" is already its own caption. */
      figureLabel: a.amount ? a.amountLabel : undefined,
      figure: a.amount ?? a.meta,
      status: a.status,
      href: a.href,
      cta: a.cta,
      lines: linesByRfq.get(id),
    };
  });

  /* DESIGN-LAB "Today" header toggle — filters the SAME already-fetched rows
     by a field they already carry (`createdAt`, used two lines below for the
     relative-time caption regardless), rather than a second, day-scoped query. */
  const incomingSource = demandToday
    ? signals.open.filter((line) => !!line.createdAt && new Date(line.createdAt) >= startOfToday)
    : signals.open;

  const incomingRows: IncomingRow[] = incomingSource.slice(0, 5).map((line, idx) => ({
    key: `${line.rfqId}-${idx}`,
    productName: line.productName,
    buyer: line.buyer,
    /* When it arrived. The reference prints a record number and a relative
       time here; these records have no human-readable number, and the request's
       own title — the only other candidate — is both long enough to truncate in
       this column and largely a restatement of the product name one line above. */
    meta: formatRelativeTime(line.createdAt, locale),
    imageRef: line.imageRef,
    href: `/b2b/rfqs/${line.rfqId}`,
    open: true,
  }));

  /* Bars are scaled against the BUSIEST row, so `peak` is the denominator. */
  const peak = Math.max(1, ...signals.movement.map((r) => r.requests));
  const movingRows: MovingRow[] = signals.movement.slice(0, 5).map((r) => ({
    name: r.name,
    requests: formatCount(r.requests, locale),
    share: r.requests / peak,
    /* No previous window, or an empty one, means there is no movement to
       report — not 0% and not "new" dressed up as growth. The cell prints an
       em dash and the row still ranks. */
    change:
      r.previous > 0
        ? formatPercent(Math.abs(((r.requests - r.previous) / r.previous) * 100), locale)
        : null,
    changeBetter: r.previous > 0 ? r.requests >= r.previous : null,
  }));

  /* DESIGN-LAB Reels module — real products, real photos. Skips anything
     with no `image_ref`: the whole point of standing a photo in for a video
     frame is that it IS a real frame, not a grey placeholder pretending to
     be one. */
  const reelItems: ReelItem[] = reelProducts
    .filter((p) => p.image_ref)
    .slice(0, 6)
    .map((p) => ({ id: p.id, title: p.name, imageRef: p.image_ref, href: `/b2b/products/${p.id}` }));

  const activityRows: ActivityRow[] = notifications.slice(0, 5).map((n) => ({
    key: n.id,
    title: n.title,
    timeAgo: n.timeAgo,
    timestamp: n.timestamp,
    href: n.href,
    unread: n.unread,
  }));

  const pipelineStages: PipelineStage[] = flow.map((f) => ({
    key: f.key,
    label: f.label,
    value: formatCount(f.value, locale),
    Icon:
      f.key === "incoming"
        ? DemandIcon
        : f.key === "quoted"
          ? FileTextIcon
          : f.key === "accepted"
            ? CheckIcon
            : f.key === "ordered"
              ? ClipboardIcon
              : ActivityIcon,
    href: f.href,
  }));

  /* Active orders by state — the same three counts the flow above is built
     from, split rather than summed, so the pipeline board answers "how many"
     and "in what condition" in one place. */
  const orderSlices = supply
    ? [
        { label: m.execution.orderStatus.confirmed, value: supply.orders.confirmed ?? 0 },
        { label: m.execution.orderStatus.in_progress, value: supply.orders.in_progress ?? 0 },
        { label: m.execution.orderStatus.completed, value: supply.orders.completed ?? 0 },
      ]
    : [];

  return (
    <div className="flex flex-col gap-3 pb-16 tablet:pb-0">
      <DashboardHead
        title={m.supply.title}
        /* The one line on the page that differs between a Distributor, a
           Manufacturer and an Importer. Everything below is identical. */
        subtitle={m.supply.voice[voice].subtitle}
        actions={
          <>
            {/* NO PERIOD CONTROL IN THIS ROW, BY REVIEW DECISION. It used to sit
                here with the actions, and was pulled on direct request: against
                the approved composition it read as competing with "+ New
                product" for the same corner of the page.

                WHAT DID NOT CHANGE: the period still resolves from the URL
                exactly as before (`?period=`), every KPI still computes its
                period-over-period comparison from it, and each card still names
                its own window in its hint. What is missing is only the UI for
                CHANGING it — a gap worth closing deliberately (most likely
                inside the metric panel's own affordances) rather than by
                re-adding a control the review already rejected from this row. */}
            {managesCatalog ? (
              <PrimaryAction href="/b2b/products/new">
                <PlusIcon size={16} />
                {m.commerce.products.new}
              </PrimaryAction>
            ) : null}
            <SecondaryAction href="/b2b/reports">
              <BarChartIcon size={16} />
              {m.home.openReports}
            </SecondaryAction>
          </>
        }
      />

      <MetricStrip items={metrics} />

      {supply ? (
        <>
          {/* ROW 1 — what needs me, beside what is arriving.

              The ratio is the reference's: the attention board takes roughly
              five parts to the rail's three. It is not a preference — the board
              carries a date, a figure and a status per row and stops being
              readable under about 640px, while the rail carries three lines of
              text and is comfortable at 380. Splitting the difference evenly
              would break the one that matters. */}
          <div className="grid min-w-0 gap-3 wide:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
            <Board
              title={m.supply.section.attention}
              Icon={AlertIcon}
              badge={
                attention.length > 0 ? <BoardCount>{formatCount(attention.length, locale)}</BoardCount> : null
              }
              /* THE BOARD-HEADER CONTROL GRAMMAR, now unconditional. These three
                 — a scope select, a state toggle, an overflow menu — are the
                 approved pattern for a board that has more rows than it shows.
                 They were behind the prototype gate; nothing about them was ever
                 account-specific, and every route they produce is the same
                 RLS-scoped query with a different sort or filter. */
              controls={
                <>
                  <StageSelect
                    value={stage}
                    basePath="/b2b"
                    label={at.stage.all}
                    allLabel={at.typeFilter}
                    options={stageCounts.map((s) => ({ key: s.key, label: s.label }))}
                    query={carry}
                  />
                  <HeaderToggle
                    Icon={CalendarIcon}
                    label={sortDue ? at.dueDateSorted : at.dueDateLabel}
                    active={sortDue}
                    href={toggleHref("/b2b", carry, "sort", sortDue, "due")}
                  />
                  <BoardMenu
                    label={m.supply.section.attention}
                    refreshLabel={m.common.refresh}
                    viewAllLabel={at.viewAll}
                    viewAllHref={stageHref(stage)}
                  />
                </>
              }
              footer={<BoardOut href={stageHref(stage)} label={m.supply.attention.viewAll} />}
            >
              {/* The filter sits inside the board, directly under its header. It
                  is a control over the list, and a control that appears after
                  the list it controls has already been read is a control nobody
                  uses. It is not in the header because the header already holds
                  a title and a count, and five stage chips beside them wrap onto
                  a second line at board width. */}
              <div className="px-4 pb-2.5 tablet:px-5">
                <AttentionFilter
                  stages={stageCounts}
                  active={stage}
                  basePath="/b2b"
                  locale={locale}
                  allLabel={at.stage.all}
                  query={carry}
                />
              </div>

              <AttentionBoard
                rows={attentionRows}
                labels={{
                  requirements: m.supply.opportunities.quantity,
                  buyer: m.supply.opportunities.buyer,
                }}
                empty={
                  /* An empty queue is a WIN, not a missing feature, and it is
                     drawn as one — the same board with a tick in it, rather than
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
            </Board>

            <Board
              title={m.supply.demand.title}
              Icon={DemandIcon}
              controls={
                <>
                  <HeaderToggle
                    Icon={CalendarIcon}
                    label={m.supply.demand.today}
                    active={demandToday}
                    href={toggleHref("/b2b", carry, "demandWindow", demandToday, "today")}
                  />
                  <BoardMenu
                    label={m.supply.demand.title}
                    refreshLabel={m.common.refresh}
                    viewAllLabel={m.supply.demand.viewAll}
                    viewAllHref="/b2b/rfqs"
                  />
                </>
              }
              footer={<BoardOut href="/b2b/rfqs" label={m.supply.demand.viewAll} />}
            >
              <IncomingRail
                rows={incomingRows}
                empty={
                  <BlockEmpty
                    icon={<TrendingUpIcon size={20} />}
                    title={m.supply.opportunities.empty}
                    body={m.supply.opportunities.emptyBody}
                  />
                }
              />
            </Board>
          </div>

          {/* ROW 2 — the reference modules. Read, not acted on, and drawn that
              way: a third of the width each, no accent beyond the header mark,
              and every one of them a way out to the module that owns it. */}
          <div className="grid min-w-0 gap-3 desktop:grid-cols-3">
            <Board
              title={m.supply.market.title}
              Icon={BarChartIcon}
              footer={<BoardOut href="/b2b/reports" label={m.supply.market.viewAll} />}
            >
              <MovingBoard
                rows={movingRows}
                labels={{ requests: m.supply.market.requests }}
                empty={
                  <BlockEmpty
                    icon={<BarChartIcon size={20} />}
                    title={m.supply.market.empty}
                    body={m.supply.market.emptyBody}
                  />
                }
              />
            </Board>

            <Board
              title={m.supply.notifications.title}
              Icon={BellIcon}
              footer={<ViewActivityAction label={m.supply.notifications.viewAll} />}
            >
              <ActivityBoard
                rows={activityRows}
                empty={
                  <NotificationsEmpty
                    title={m.supply.notifications.empty}
                    body={m.supply.notifications.emptyBody}
                  />
                }
              />
            </Board>

            <Board
              title={m.supply.pipeline.title}
              Icon={ActivityIcon}
              footer={<BoardOut href="/b2b/orders" label={m.supply.pipeline.viewAll} />}
            >
              <PipelineTrack stages={pipelineStages} />
              <div className="border-t border-workspace-line px-4 pt-3 tablet:px-5">
                <DonutSplit
                  slices={orderSlices}
                  emptyLabel={m.supply.empty.noProductSales}
                  ariaLabel={m.supply.pipeline.orders}
                  centerLabel={m.supply.pipeline.orders}
                  formatValue={(v) => formatCount(v, locale)}
                  formatShare={(pct) => formatPercent(pct, locale)}
                />
              </div>
            </Board>
          </div>

          {/* ROW 3 — the shelf. Two rankings of what is actually selling and to
              whom. They stay because they answer a question the boards above do
              not: those count WORK, these count VALUE. */}
          <div className="grid min-w-0 gap-3 desktop:grid-cols-2">
            <Board title={m.supply.chart.topProducts} Icon={PackageIcon}>
              <div className="px-4 pb-4 tablet:px-5">
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
              </div>
            </Board>

            <Board
              title={m.supply.chart.topCustomers}
              Icon={StorefrontIcon}
              footer={<BoardOut href="/b2b/buyers" label={m.common.more} />}
            >
              <div className="px-4 pb-4 tablet:px-5">
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
              </div>
            </Board>
          </div>

          {/* ROW 4 — PRODUCT VIDEOS. A SUPPLIER-SIDE MODULE, AND IT STAYS ONE.
              Gated on `managesCatalog` — the capability that means "this
              workspace publishes products" — rather than on an account's
              identity. A buyer-side organization reaching this dashboard has no
              catalogue to draw reels of and never renders this row; the query
              behind it is gated on the same capability, so it also never runs.

              The engagement figures on each tile are PRESENTATION DATA, not
              persisted metrics — see `ReelsBoard`'s own doc, and section 12 of
              the globalization brief. Nothing in the schema stores views, likes
              or durations, and this pass deliberately did not invent a media
              backend to make them real. */}
          {managesCatalog ? (
            <ReelsBoard
              title={m.supply.reels.title}
              viewAllLabel={m.supply.reels.viewAll}
              viewAllHref="/b2b/products"
              addLabel={m.supply.reels.addNew}
              addHref="/b2b/products/new"
              items={reelItems}
              viewsLabel={m.supply.reels.views}
              likesLabel={m.supply.reels.likes}
              empty={
                <BlockEmpty
                  icon={<TrendingUpIcon size={20} />}
                  title={m.supply.videos.empty}
                  body={m.supply.videos.emptyBody}
                />
              }
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}


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

/**
 * A header toggle's own link: `carry` plus `key=value` when turning ON,
 * `carry` with `key` removed when turning OFF — the same "everything else
 * survives" contract `AttentionFilter`'s and `PeriodSelect`'s own href
 * builders keep, generalised because two independent header toggles
 * (`sort`, `demandWindow`) now need it rather than one.
 */
function toggleHref(basePath: string, carry: Record<string, string>, key: string, active: boolean, value: string) {
  const params = new URLSearchParams(carry);
  if (active) params.delete(key);
  else params.set(key, value);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
