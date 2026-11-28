/**
 * Pure model of checkout v2 (Marketplace PR 12): the shapes `marketplace_checkout_prepare` / `_confirm` return and the
 * few rules the page derives from them. The database is the authority: it prices every line, decides what is missing and
 * places the order; nothing here computes a price.
 */
export type CheckoutFulfilment = "delivery" | "pickup";
export type CheckoutPayment = "cod" | "instapay_full" | "instapay_deposit";
export type CheckoutSpeed = "standard" | "next_day";

export type CheckoutLineInput = { slug: string; sku: string; qty: number };
export type CheckoutPrepareInput = {
  lines: CheckoutLineInput[];
  fulfilment: CheckoutFulfilment;
  addressId: string | null;
  speed: CheckoutSpeed;
  payment: CheckoutPayment;
  sessionId: string | null;
};

/** The codes `missing` can hold. The page words each one; an unknown code is shown as a generic "not ready". */
export const MISSING_CODES = [
  "insufficient_stock",
  "address_missing",
  "phone_unverified",
  "delivery_not_available",
  "next_day_not_available",
  "pickup_not_available",
  "payment_not_available",
  "receipt_required",
] as const;
export type MissingCode = (typeof MISSING_CODES)[number];

export type QuoteLine = {
  slug: string;
  sku: string;
  status: string;
  name_ar: string;
  name_en: string;
  quantity: number;
  unit_price_egp?: number;
  line_total_egp?: number;
  non_returnable?: boolean;
  free_shipping?: boolean;
};

export type CheckoutQuote = {
  lines: QuoteLine[];
  seller: { name: string; pickup_available: boolean };
  fulfilment: CheckoutFulfilment;
  delivery_speed: CheckoutSpeed;
  subtotal_egp: number;
  delivery_fee_egp: number;
  total_egp: number;
  delivery: {
    status: string;
    free: boolean;
    fee_egp: number | null;
    estimate?: { earliest: string; latest: string };
    next_day?: { arrival: string; fee_egp: number } | null;
  };
  payment: {
    method: CheckoutPayment;
    pay_now_egp: number;
    balance_due_egp: number;
    instapay?: { address: string; account_name: string } | null;
    methods_enabled: { cod: boolean; instapay_full: boolean; instapay_deposit: false | { deposit_percent: number } };
  };
  receipt_required: boolean;
  non_returnable_lines: string[];
  warnings: string[];
};

export type CheckoutPrepared = {
  session_id: string;
  quote_hash: string;
  expires_at: string;
  ready: boolean;
  missing: string[];
  quote: CheckoutQuote;
  receipts?: { id: string; created_at: string }[];
};

export type CheckoutConfirmed = {
  checkout_id: string;
  replayed: boolean;
  orders: { id: string; order_number: string; status: string; total_egp: number; paid_now_egp: number; payment_method: CheckoutPayment }[];
};

/** The page may send the order only when the database says every requirement is met. */
export function canConfirm(p: Pick<CheckoutPrepared, "ready" | "missing"> | null): boolean {
  return p !== null && p.ready && p.missing.length === 0;
}

export const needsReceipt = (payment: CheckoutPayment) => payment !== "cod";

/** Payments the showroom offers, in the order they are listed (cash first). */
export function offeredPayments(q: Pick<CheckoutQuote, "payment">): CheckoutPayment[] {
  const m = q.payment.methods_enabled;
  const out: CheckoutPayment[] = [];
  if (m.cod) out.push("cod");
  if (m.instapay_full) out.push("instapay_full");
  if (m.instapay_deposit) out.push("instapay_deposit");
  return out;
}

export function isMissingCode(code: string): code is MissingCode {
  return (MISSING_CODES as readonly string[]).includes(code);
}

/** One stable idempotency key per checkout session: pressing "Confirm order" twice can never place two orders. */
export function idempotencyKeyFor(sessionId: string): string {
  return `co-${sessionId}`;
}
