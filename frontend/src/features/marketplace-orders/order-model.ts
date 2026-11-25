import type {
  DateRange,
  OrderDocumentV2,
  OrderLineV2,
  OrderStatusV2,
  OrderSummaryV2,
  PaymentMethodV2,
  PaymentStatusV2,
  SellerOrderCounts,
} from "./order-types";

/**
 * Pure rules of the order pages. The database decides which action is allowed (the `actions` list of the
 * order document); everything here is presentation: which step of the progress bar is reached, which tab
 * an order belongs to, how a filter travels in the URL, what «إعادة الطلب» sends.
 */

// ---------------------------------------------------------------------------
// Buyer progress bar: placed -> preparing -> shipped -> delivered
// ---------------------------------------------------------------------------
export const PROGRESS_STEPS = ["placed", "preparing", "shipped", "delivered"] as const;
export type ProgressStep = (typeof PROGRESS_STEPS)[number];

/** Index of the step an order has reached (0..3), or null for an order that left the line (cancelled, returned). */
export function progressIndex(status: OrderStatusV2, fulfilment: "delivery" | "pickup"): number | null {
  switch (status) {
    case "new":
    case "pending_confirmation":
      return 0;
    case "preparing":
    case "confirmed":
    case "processing":
    case "ready":
    case "ready_for_pickup":
      // a delivery order that is ready is still being prepared; a pickup order waiting at the showroom is shown as ready for pickup
      return 1;
    case "shipped":
    case "delivery_failed":
      return 2;
    case "delivered":
      return 3;
    case "cancelled":
    case "returned":
      return null;
    default:
      return fulfilment === "pickup" ? 1 : 0;
  }
}

/** Pickup orders that wait for the buyer say so under the "preparing" step. */
export function isReadyForPickup(status: OrderStatusV2, fulfilment: "delivery" | "pickup"): boolean {
  return fulfilment === "pickup" && (status === "ready" || status === "ready_for_pickup");
}

// ---------------------------------------------------------------------------
// Buyer list filters (URL <-> query)
// ---------------------------------------------------------------------------
export const BUYER_PERIODS = ["3m", "6m", "1y", "all"] as const;
export type BuyerPeriod = (typeof BUYER_PERIODS)[number];
export const BUYER_GROUPS = ["active", "delivered", "cancelled"] as const;
export type BuyerGroup = (typeof BUYER_GROUPS)[number];

export type BuyerOrdersQuery = { search: string; period: BuyerPeriod; status: BuyerGroup | null; page: number };
export const BUYER_PAGE_SIZE = 20;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseBuyerOrdersQuery(params: Params): BuyerOrdersQuery {
  const period = one(params.period);
  const status = one(params.status);
  const page = Number.parseInt(one(params.page) ?? "1", 10);
  return {
    search: (one(params.q) ?? "").trim().slice(0, 80),
    period: (BUYER_PERIODS as readonly string[]).includes(period ?? "") ? (period as BuyerPeriod) : "3m",
    status: (BUYER_GROUPS as readonly string[]).includes(status ?? "") ? (status as BuyerGroup) : null,
    page: Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1,
  };
}

/** The query string of a buyer list; default values are left out so the URL stays short. */
export function buyerOrdersHref(q: Partial<BuyerOrdersQuery>): string {
  const p = new URLSearchParams();
  if (q.search) p.set("q", q.search);
  if (q.period && q.period !== "3m") p.set("period", q.period);
  if (q.status) p.set("status", q.status);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `/market/orders?${s}` : "/market/orders";
}

// ---------------------------------------------------------------------------
// Seller tabs
// ---------------------------------------------------------------------------
export const SELLER_TABS = ["new", "in_preparation", "shipped", "delivered", "cancelled"] as const;
export type SellerTab = (typeof SELLER_TABS)[number];

export type SellerOrdersQuery = { tab: SellerTab | null; search: string; from: string | null; to: string | null; page: number };
export const SELLER_PAGE_SIZE = 25;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: string | undefined): string | null => {
  if (!v || !ISO_DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
};

export function parseSellerOrdersQuery(params: Params): SellerOrdersQuery {
  const tab = one(params.tab);
  const page = Number.parseInt(one(params.page) ?? "1", 10);
  let from = validDay(one(params.from));
  let to = validDay(one(params.to));
  if (from && to && from > to) [from, to] = [to, from];
  return {
    tab: (SELLER_TABS as readonly string[]).includes(tab ?? "") ? (tab as SellerTab) : null,
    search: (one(params.q) ?? "").trim().slice(0, 80),
    from,
    to,
    page: Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1,
  };
}

export function sellerOrdersHref(q: Partial<SellerOrdersQuery>): string {
  const p = new URLSearchParams();
  if (q.tab) p.set("tab", q.tab);
  if (q.search) p.set("q", q.search);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `/showroom/marketplace/orders?${s}` : "/showroom/marketplace/orders";
}

export function totalOrders(counts: SellerOrderCounts): number {
  return counts.new + counts.in_preparation + counts.shipped + counts.delivered + counts.cancelled;
}

// ---------------------------------------------------------------------------
// Action registry (seller and buyer buttons)
// ---------------------------------------------------------------------------
/**
 * Buttons are drawn from `document.actions` through a registry keyed by action name. A name the registry does
 * not know is ignored, so PR 14 and PR 15 add `file_complaint`, `request_return` and the like without touching
 * the page shell.
 */
export function knownActions<T>(actions: readonly string[], registry: Record<string, T>): { key: string; entry: T }[] {
  const out: { key: string; entry: T }[] = [];
  for (const key of actions) {
    if (Object.prototype.hasOwnProperty.call(registry, key)) out.push({ key, entry: registry[key] as T });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Receipt, shipment and money helpers
// ---------------------------------------------------------------------------
export function isInstapay(method: PaymentMethodV2): boolean {
  return method === "instapay_full" || method === "instapay_deposit" || method === "instapay";
}

/** The receipt the seller looks at next: the newest one still waiting. */
export function latestSubmittedReceipt(doc: Pick<OrderDocumentV2, "payment">) {
  return [...doc.payment.receipts].reverse().find((r) => r.status === "submitted") ?? null;
}

/** What the buyer pays the courier or the showroom at delivery. */
export function collectOnDelivery(doc: Pick<OrderDocumentV2, "totals" | "payment_method" | "payment_status">): number {
  if (doc.payment_status === "collected") return 0;
  return Math.max(Number(doc.totals.balance_due_egp ?? 0), 0);
}

export const TRACKING_PATTERN = /^[A-Za-z0-9._/-]{3,64}$/;
export function isValidTracking(value: string): boolean {
  return TRACKING_PATTERN.test(value.trim());
}
export function isValidCarrier(value: string): boolean {
  const t = value.trim();
  return t.length >= 2 && t.length <= 80;
}

/** Custom reasons are 3 to 300 characters in each language (contract 3.2). */
export const REASON_MIN = 3;
export const REASON_MAX = 300;
export function isValidReasonText(value: string): boolean {
  const n = value.trim().length;
  return n >= REASON_MIN && n <= REASON_MAX;
}

/** One typed text becomes both languages; two texts stay as typed (same rule as the preset editor). */
export function customReasonPayload(ar: string, en: string): { message_ar: string; message_en: string } | null {
  const a = ar.trim();
  const e = en.trim();
  if (!a && !e) return null;
  const A = a || e;
  const E = e || a;
  return isValidReasonText(A) && isValidReasonText(E) ? { message_ar: A, message_en: E } : null;
}

// ---------------------------------------------------------------------------
// Dates (calendar days in Africa/Cairo, same rule as the checkout estimate)
// ---------------------------------------------------------------------------
/** "12-14 Dec" / "١٢–١٤ ديسمبر" from two ISO days; one day when they match. Days are calendar dates, never shifted by the viewer's zone. */
export function formatEstimate(range: DateRange | null, locale: "ar" | "en"): string | null {
  if (!range) return null;
  const tag = locale === "ar" ? "ar-EG" : "en-GB";
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, { timeZone: "UTC", ...opts }).format(new Date(`${iso}T00:00:00Z`));
  if (range.earliest === range.latest) return fmt(range.earliest, { day: "numeric", month: "short" });
  const [ey, em] = range.earliest.split("-");
  const [ly, lm] = range.latest.split("-");
  if (ey === ly && em === lm) {
    return `${fmt(range.earliest, { day: "numeric" })}–${fmt(range.latest, { day: "numeric", month: "short" })}`;
  }
  return `${fmt(range.earliest, { day: "numeric", month: "short" })} – ${fmt(range.latest, { day: "numeric", month: "short" })}`;
}

/** Whole hours left until `due` (never negative); null without a deadline. */
export function hoursLeft(due: string | null, now: Date): number | null {
  if (!due) return null;
  const ms = new Date(due).getTime() - now.getTime();
  return Number.isNaN(ms) ? null : Math.max(Math.ceil(ms / 3_600_000), 0);
}

// ---------------------------------------------------------------------------
// Reorder («إعادة الطلب»): lines only, no price; the cart merge re-applies availability and the own-showroom rule
// ---------------------------------------------------------------------------
export type ReorderLine = { slug: string; sku: string; qty: number };

export function reorderLines(items: readonly Pick<OrderLineV2, "slug" | "sku" | "quantity">[]): ReorderLine[] {
  const out: ReorderLine[] = [];
  for (const i of items) {
    if (!i.slug || !/^[a-z0-9-]{1,120}$/.test(i.slug)) continue;
    const qty = Math.min(Math.max(Math.trunc(i.quantity), 1), 9999);
    out.push({ slug: i.slug, sku: i.sku, qty });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names and display helpers
// ---------------------------------------------------------------------------
export const itemName = (i: { name_ar: string; name_en: string }, locale: "ar" | "en") =>
  (locale === "ar" ? i.name_ar || i.name_en : i.name_en || i.name_ar) || "";

export const variantText = (v: { ar: string; en: string } | null, locale: "ar" | "en") =>
  v ? (locale === "ar" ? v.ar || v.en : v.en || v.ar) : "";

/** Orders from before the new model carry old statuses; the pages show them but offer no buttons. */
export function isLegacy(doc: Pick<OrderDocumentV2, "source">): boolean {
  return doc.source === "legacy";
}

/** The timeline the buyer reads: newest last, one row per stored event (internal ones are already filtered by the database). */
export function timelineRows(events: OrderDocumentV2["events"]): OrderDocumentV2["events"] {
  return [...events].sort((a, b) => a.at.localeCompare(b.at));
}

/** Summary rows that need the showroom's attention are drawn first inside a tab only by the database ordering; this just flags them. */
export function needsAttention(o: Pick<OrderSummaryV2, "action_needed" | "has_dispute">): boolean {
  return o.action_needed || o.has_dispute;
}

export function paymentIsSettled(status: PaymentStatusV2): boolean {
  return status === "collected" || status === "receipt_accepted" || status === "deposit_accepted";
}

// ---------------------------------------------------------------------------
// Seller actions the order page can send (contract 4.2)
// ---------------------------------------------------------------------------
/** The seller actions the order page can send (contract 4.2, `marketplace_seller_order_action`). */
export const SELLER_ORDER_ACTIONS = [
  "start_preparing",
  "mark_ready",
  "mark_shipped",
  "mark_delivered",
  "collect_payment",
  "accept_receipt",
  "flag_receipt_not_received",
  "cancel",
  "mark_delivery_failed",
  "mark_returned_to_stock",
] as const;
export type SellerOrderActionName = (typeof SELLER_ORDER_ACTIONS)[number];

export type SellerActionPayload = {
  preset_id?: string;
  message_ar?: string;
  message_en?: string;
  internal_note?: string;
  carrier_name?: string;
  tracking_number?: string;
  note?: string;
  proof_id?: string;
};

