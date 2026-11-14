/**
 * The shapes the Marketplace order RPCs return (Migration 14, 20261112100014_marketplace_orders.sql)
 * and the pure rules the screens derive from them. The database is the authority for every
 * transition; these helpers only decide which buttons to show.
 */

export const ORDER_STATUSES = [
  "pending_confirmation",
  "confirmed",
  "processing",
  "shipped",
  "ready_for_pickup",
  "delivered",
  "delivery_failed",
  "returned",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type PaymentMethod = "cod" | "instapay";
export type PaymentStatus =
  | "pending"
  | "awaiting_deposit"
  | "deposit_submitted"
  | "deposit_accepted"
  | "deposit_rejected"
  | "collected"
  | "not_collected"
  | "refund_due";
export type Fulfilment = "delivery" | "pickup";

export type OrderSummary = {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  fulfilment: Fulfilment;
  total_egp: number;
  deposit_egp?: number | null;
  seller_name?: string;
  buyer_name?: string;
  governorate_key?: string | null;
  created_at: string;
  item_count: number;
};

export type OrderItem = {
  sku: string;
  name_ar: string;
  name_en: string;
  selling_unit: string;
  unit_price_egp: number;
  quantity: number;
  line_total_egp: number;
};

export type OrderEvent = {
  action: string;
  to_status: string | null;
  to_payment: string | null;
  actor_role: "buyer" | "seller" | "system";
  note: string | null;
  at: string;
};

export type OrderProof = {
  id: string;
  object_key: string;
  status: "submitted" | "accepted" | "rejected";
  review_note: string | null;
  created_at: string;
};

export type OrderDocument = {
  id: string;
  order_number: string;
  checkout_id: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  fulfilment: Fulfilment;
  governorate_key: string | null;
  area_key: string | null;
  address_text: string | null;
  buyer_name: string;
  buyer_phone: string;
  buyer_note: string | null;
  subtotal_egp: number;
  delivery_fee_egp: number;
  total_egp: number;
  deposit_percent: number | null;
  deposit_egp: number | null;
  instapay_address: string | null;
  instapay_account_name: string | null;
  cancel_reason: string | null;
  created_at: string;
  confirmed_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  seller_name: string;
  pickup_address: string | null;
  viewer: "buyer" | "seller";
  items: OrderItem[];
  events: OrderEvent[];
  proofs: OrderProof[];
};

export type SellerOrdersPage = {
  total: number;
  counts: Partial<Record<OrderStatus, number>>;
  awaiting_review: number;
  items: OrderSummary[];
};

export type PaymentSettings = {
  cod_enabled: boolean;
  instapay_enabled: boolean;
  instapay_address: string | null;
  instapay_account_name: string | null;
  instapay_deposit_percent: number | null;
  can_edit: boolean;
};

export type PlacedOrder = { id: string; order_number: string; total_egp: number; payment_method: PaymentMethod; deposit_egp: number | null };
export type PlacedCheckout = { checkout_id: string; replayed: boolean; orders: PlacedOrder[] };

export const SELLER_ACTIONS = ["confirm", "process", "ship", "ready", "deliver", "collect", "fail", "return", "cancel"] as const;
export type SellerAction = (typeof SELLER_ACTIONS)[number];

/** The InstaPay deposit has been accepted (or the whole amount was paid). */
export function depositSettled(o: Pick<OrderDocument, "payment_method" | "payment_status">): boolean {
  return o.payment_method === "instapay" && (o.payment_status === "deposit_accepted" || o.payment_status === "collected");
}

/** The buttons a showroom may press next, in the order they are shown (the database re-checks every one). */
export function sellerActionsFor(o: Pick<OrderDocument, "status" | "fulfilment" | "payment_method" | "payment_status">): SellerAction[] {
  switch (o.status) {
    case "pending_confirmation":
      return o.payment_method === "instapay" && !depositSettled(o) ? ["cancel"] : ["confirm", "cancel"];
    case "confirmed":
      return ["process", "cancel"];
    case "processing":
      return [o.fulfilment === "pickup" ? "ready" : "ship", "cancel"];
    case "shipped":
    case "ready_for_pickup":
      return ["deliver", "fail"];
    case "delivered":
      return o.payment_status === "pending" || o.payment_status === "deposit_accepted" ? ["collect"] : [];
    case "delivery_failed":
      return ["return"];
    default:
      return [];
  }
}

/** Actions that must carry a reason. */
export function actionNeedsReason(action: SellerAction): boolean {
  return action === "cancel";
}

/** A buyer may cancel only before the showroom confirms. */
export function buyerCanCancel(o: Pick<OrderDocument, "status">): boolean {
  return o.status === "pending_confirmation";
}

/** The buyer is expected to (re)send an InstaPay receipt. */
export function buyerMaySendProof(o: Pick<OrderDocument, "status" | "payment_method" | "payment_status">): boolean {
  return (
    o.payment_method === "instapay" &&
    o.status === "pending_confirmation" &&
    (o.payment_status === "awaiting_deposit" || o.payment_status === "deposit_rejected")
  );
}

/** Egyptian mobile / landline as typed by a person: spaces and dashes are ignored, 8–15 digits, optional +. */
export function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, "");
}
export function isValidPhone(value: string): boolean {
  return /^\+?[0-9]{8,15}$/.test(normalizePhone(value));
}

/** The order-error message key for an `mp:` code. */
export const ORDER_ERROR_CODES = new Set([
  "unexpected",
  "auth_required",
  "account_inactive",
  "not_permitted",
  "not_found",
  "invalid_payload",
  "invalid_lines",
  "too_many_lines",
  "cart_changed",
  "invalid_quantity",
  "duplicate_line",
  "insufficient_stock",
  "choice_missing",
  "invalid_fulfilment",
  "invalid_payment",
  "delivery_not_available",
  "pickup_not_available",
  "payment_not_available",
  "address_required",
  "buyer_name_required",
  "buyer_phone_invalid",
  "note_too_long",
  "invalid_location",
  "order_not_cancellable",
  "invalid_transition",
  "deposit_not_accepted",
  "reason_required",
  "proof_not_expected",
  "proof_not_reviewable",
  "image_type_invalid",
  "upload_rate_limited",
  "upload_not_found",
  "upload_failed",
  "file_too_large",
  "image_content_invalid",
  "instapay_address_required",
  "instapay_name_required",
  "deposit_percent_invalid",
  "seller_not_enabled",
]);

export function orderErrorCode(code: string): string {
  return ORDER_ERROR_CODES.has(code) ? code : "unexpected";
}
