import {
  CART_MAX_LINES,
  CART_MAX_QTY,
  type CartQuote,
  type CartQuoteLine,
  type CartSeller,
  type StoredCartLine,
} from "./public-contract";

/**
 * Pure arithmetic of the guest cart, shared by the page and its tests. The total is products + delivery;
 * Marketplace prices exclude VAT (DL-16) and the cart adds no tax line. Nothing here trusts the
 * browser: prices, availability and delivery fees all come from the quote (the database), the
 * browser only contributes which products and how many.
 */

const cents = (n: number) => Math.round(n * 100) / 100;

export type ReceivingMethod = "delivery" | "pickup";

export type PricedLine = Extract<CartQuoteLine, { status: "ok" }> & {
  /** the quantity actually charged: what was asked, bounded by what the showroom can supply */
  qty: number;
  lineTotalEgp: number;
  /** the showroom has fewer than the cart asked for */
  reduced: boolean;
  outOfStock: boolean;
};

export type DeliveryState =
  /** every showroom has a price for the chosen area (or the order is picked up) */
  | "ok"
  | "needs_area"
  /** at least one showroom does not deliver to the chosen area */
  | "not_available"
  /** at least one showroom has no pickup point */
  | "pickup_unavailable";

export type SellerDelivery = { seller: CartSeller; feeEgp: number | null };

export type CartTotals = {
  lines: PricedLine[];
  /** lines the showroom no longer sells (unpublished, archived, suspended …) */
  unavailable: Extract<CartQuoteLine, { status: "unavailable" }>[];
  productsEgp: number;
  /** null until every showroom has a price; 0 when picked up */
  deliveryEgp: number | null;
  totalEgp: number;
  state: DeliveryState;
  /** showrooms that block the chosen method (do not deliver there / have no pickup point) */
  blockedBy: CartSeller[];
  perSeller: SellerDelivery[];
};

/** Quantity the cart may hold for a line: a whole number from 1 up to what is available. */
export function clampQty(wanted: number, available: number): number {
  const cap = Math.max(1, Math.min(Math.floor(available), CART_MAX_QTY));
  const n = Math.round(Number.isFinite(wanted) ? wanted : 1);
  return Math.max(1, Math.min(n, cap));
}

/** Parse the stored cart defensively: anything that is not a well-formed, unique line is dropped. */
export function parseStoredCart(raw: string | null): StoredCartLine[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: StoredCartLine[] = [];
  for (const item of parsed) {
    if (out.length >= CART_MAX_LINES) break;
    if (!item || typeof item !== "object") continue;
    const { slug, sku, qty } = item as Record<string, unknown>;
    if (typeof slug !== "string" || !/^[a-z0-9-]{1,120}$/.test(slug)) continue;
    if (typeof sku !== "string" || sku.length < 1 || sku.length > 80) continue;
    if (typeof qty !== "number" || !Number.isFinite(qty)) continue;
    if (out.some((l) => l.slug === slug && l.sku === sku)) continue;
    out.push({ slug, sku, qty: Math.max(1, Math.min(Math.round(qty), CART_MAX_QTY)) });
  }
  return out;
}

/** Price the cart: products, per-showroom delivery, grand total (products + delivery). */
export function priceCart(quote: CartQuote, stored: readonly StoredCartLine[], method: ReceivingMethod): CartTotals {
  const wanted = new Map(stored.map((l) => [`${l.slug}\u0000${l.sku}`, l.qty]));
  const lines: PricedLine[] = [];
  const unavailable: CartTotals["unavailable"] = [];
  for (const l of quote.lines) {
    // a line the buyer has just removed can still be in an older quote; it is gone from the cart at once
    if (!wanted.has(`${l.slug}\u0000${l.sku}`)) continue;
    if (l.status === "unavailable") {
      unavailable.push(l);
      continue;
    }
    const asked = wanted.get(`${l.slug}\u0000${l.sku}`) ?? 1;
    const outOfStock = l.available <= 0;
    const qty = outOfStock ? 0 : clampQty(asked, l.available);
    lines.push({ ...l, qty, outOfStock, reduced: !outOfStock && qty < asked, lineTotalEgp: cents(l.price_egp * qty) });
  }

  // only showrooms that still have something to ship take part in delivery / pickup
  const active = new Set(lines.filter((l) => !l.outOfStock).map((l) => l.seller));
  const sellers = quote.sellers.filter((s) => active.has(s.index));
  const perSeller: SellerDelivery[] = sellers.map((seller) => ({
    seller,
    feeEgp: seller.delivery.status === "available" ? seller.delivery.fee_egp : null,
  }));

  const productsEgp = cents(lines.reduce((n, l) => n + l.lineTotalEgp, 0));
  let state: DeliveryState = "ok";
  let blockedBy: CartSeller[] = [];
  let deliveryEgp: number | null = 0;

  if (method === "pickup") {
    blockedBy = sellers.filter((s) => !s.pickup_available);
    if (blockedBy.length > 0) state = "pickup_unavailable";
  } else if (sellers.some((s) => s.delivery.status === "needs_area")) {
    state = "needs_area";
    deliveryEgp = null;
  } else {
    blockedBy = sellers.filter((s) => s.delivery.status === "not_available");
    if (blockedBy.length > 0) {
      state = "not_available";
      deliveryEgp = null;
    } else {
      deliveryEgp = cents(perSeller.reduce((n, d) => n + (d.feeEgp ?? 0), 0));
    }
  }

  return { lines, unavailable, productsEgp, deliveryEgp, totalEgp: cents(productsEgp + (deliveryEgp ?? 0)), state, blockedBy, perSeller };
}
