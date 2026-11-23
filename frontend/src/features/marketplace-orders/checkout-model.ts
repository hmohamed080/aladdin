import { clampQty } from "@/features/marketplace/live/cart-math";
import type { CartQuote, CartQuoteLine, CartSeller, StoredCartLine } from "@/features/marketplace/live/public-contract";
import type { Fulfilment, PaymentMethod } from "./contract";

/**
 * Pure arithmetic of checkout, shared by the page and its tests. Everything priced comes from the
 * quote (the database); the browser contributes which products, how many, and the choices. The
 * database recomputes all of it when the order is placed.
 */
const cents = (n: number) => Math.round(n * 100) / 100;

export type OkLine = Extract<CartQuoteLine, { status: "ok" }>;
export type CheckoutLineView = OkLine & { qty: number; lineTotalEgp: number };
export type SellerChoice = { fulfilment: Fulfilment | null; payment: PaymentMethod | null };

export type CheckoutSeller = {
  seller: CartSeller;
  /** the showroom's index as the place RPC counts it: 1-based, by first appearance among the submitted lines */
  submitIndex: number;
  lines: CheckoutLineView[];
  canDeliver: boolean;
  canPickup: boolean;
  cod: boolean;
  instapayPercent: number | null;
  choice: SellerChoice;
  subtotalEgp: number;
  /** null while delivery is chosen but has no price for the chosen place */
  feeEgp: number | null;
  totalEgp: number | null;
  depositEgp: number | null;
  /** a receiving way and a payment method are chosen and both are offered */
  ready: boolean;
};

export type CheckoutView = {
  sellers: CheckoutSeller[];
  /** lines in the order they are sent to the database */
  submitLines: { slug: string; sku: string; qty: number }[];
  skipped: number;
  grandTotalEgp: number | null;
  needsAddress: boolean;
};

/** Sensible first choice: delivery when it has a price, else pickup; cash on delivery, else InstaPay. */
export function defaultChoice(seller: CartSeller): SellerChoice {
  const canDeliver = seller.delivery.status !== "not_available";
  const fulfilment: Fulfilment | null =
    seller.delivery.status === "available" ? "delivery" : seller.pickup_available ? "pickup" : canDeliver ? "delivery" : null;
  const methods = seller.payment_methods;
  const payment: PaymentMethod | null = methods?.cod ? "cod" : methods?.instapay ? "instapay" : null;
  return { fulfilment, payment };
}

export function buildCheckout(
  quote: CartQuote,
  stored: readonly StoredCartLine[],
  choices: Readonly<Record<number, SellerChoice>>,
): CheckoutView {
  const byKey = new Map(quote.lines.map((l) => [`${l.slug}\u0000${l.sku}`, l]));
  const sellersByIndex = new Map(quote.sellers.map((s) => [s.index, s]));
  const order: number[] = [];
  const grouped = new Map<number, CheckoutLineView[]>();
  const submitLines: CheckoutView["submitLines"] = [];
  let skipped = 0;

  for (const s of stored) {
    const l = byKey.get(`${s.slug}\u0000${s.sku}`);
    if (!l || l.status !== "ok" || l.available <= 0 || !sellersByIndex.has(l.seller)) {
      skipped++;
      continue;
    }
    const qty = clampQty(s.qty, l.available);
    if (!grouped.has(l.seller)) {
      grouped.set(l.seller, []);
      order.push(l.seller);
    }
    grouped.get(l.seller)!.push({ ...l, qty, lineTotalEgp: cents(l.price_egp * qty) });
    submitLines.push({ slug: l.slug, sku: l.sku, qty });
  }

  const sellers: CheckoutSeller[] = order.map((index, i) => {
    const seller = sellersByIndex.get(index)!;
    const lines = grouped.get(index)!;
    const choice = choices[index] ?? defaultChoice(seller);
    const canDeliver = seller.delivery.status !== "not_available";
    const canPickup = seller.pickup_available;
    const cod = Boolean(seller.payment_methods?.cod);
    const instapayPercent = seller.payment_methods?.instapay?.deposit_percent ?? null;
    const subtotalEgp = cents(lines.reduce((n, l) => n + l.lineTotalEgp, 0));
    const feeEgp =
      choice.fulfilment === "pickup" ? 0 : choice.fulfilment === "delivery" && seller.delivery.status === "available" ? seller.delivery.fee_egp : null;
    const totalEgp = feeEgp === null ? null : cents(subtotalEgp + feeEgp);
    const depositEgp = choice.payment === "instapay" && instapayPercent !== null && totalEgp !== null ? cents((totalEgp * instapayPercent) / 100) : null;
    const fulfilmentOk = choice.fulfilment === "pickup" ? canPickup : choice.fulfilment === "delivery" ? seller.delivery.status === "available" : false;
    const paymentOk = choice.payment === "cod" ? cod : choice.payment === "instapay" ? instapayPercent !== null : false;
    return {
      seller, submitIndex: i + 1, lines, canDeliver, canPickup, cod, instapayPercent, choice,
      subtotalEgp, feeEgp, totalEgp, depositEgp, ready: fulfilmentOk && paymentOk,
    };
  });

  const grandTotalEgp = sellers.every((s) => s.totalEgp !== null) ? cents(sellers.reduce((n, s) => n + (s.totalEgp ?? 0), 0)) : null;
  return { sellers, submitLines, skipped, grandTotalEgp, needsAddress: sellers.some((s) => s.choice.fulfilment === "delivery") };
}
