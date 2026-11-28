/**
 * The order shapes of the buyer and seller order pages (PR 13). They mirror the order-model contract
 * (docs/product/marketplace-order-model-contract-20261124.md, section 4.1 and 4.3): the database
 * returns the order document and the `actions` list, and these pages only render them.
 *
 * Statuses and payment values of rows created before the new order model (`source: "legacy"`) are
 * still readable, so the unions keep them; the pages show such an order read-only.
 */
export type OrderStatusV2 =
  | "new"
  | "preparing"
  | "ready"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "delivery_failed"
  | "returned"
  // legacy rows only (never produced by the new model)
  | "pending_confirmation"
  | "confirmed"
  | "processing"
  | "ready_for_pickup";

export type PaymentMethodV2 = "cod" | "instapay_full" | "instapay_deposit" | "instapay";

export type PaymentStatusV2 =
  | "pending"
  | "collected"
  | "not_collected"
  | "receipt_submitted"
  | "receipt_accepted"
  | "receipt_disputed"
  | "refund_due"
  | "refunded"
  // legacy rows only
  | "awaiting_deposit"
  | "deposit_submitted"
  | "deposit_accepted"
  | "deposit_rejected";

export type FulfilmentV2 = "delivery" | "pickup";

export type DateRange = { earliest: string; latest: string };

export type OrderSummaryItem = { name_ar: string; name_en: string; image_id: string | null; quantity: number };

/** One row of the order lists (contract 4.1 "Order summary"). `buyer_name` and `governorate_key` are filled for the seller only. */
export type OrderSummaryV2 = {
  id: string;
  order_number: string;
  status: OrderStatusV2;
  payment_method: PaymentMethodV2;
  payment_status: PaymentStatusV2;
  fulfilment: FulfilmentV2;
  total_egp: number;
  placed_at: string;
  delivered_at: string | null;
  estimate: DateRange | null;
  item_count: number;
  first_items: OrderSummaryItem[];
  seller_name: string;
  buyer_name?: string | null;
  governorate_key?: string | null;
  has_dispute: boolean;
  action_needed: boolean;
};

export type BuyerOrdersPage = { total: number; items: OrderSummaryV2[] };

export type SellerOrderCounts = { new: number; in_preparation: number; shipped: number; delivered: number; cancelled: number };
export type SellerOrdersPageV2 = { total: number; counts: SellerOrderCounts; needs_attention: number; items: OrderSummaryV2[] };

export type OrderReceipt = {
  id: string;
  object_key: string;
  status: "submitted" | "accepted" | "rejected" | "superseded";
  purpose: "initial" | "resubmission";
  declared_amount_egp: number | null;
  review_note: string | null;
  created_at: string;
};

export type OrderLineV2 = {
  id: string;
  slug: string | null;
  sku: string;
  name_ar: string;
  name_en: string;
  variant_label: { ar: string; en: string } | null;
  selling_unit: string;
  unit_price_egp: number;
  quantity: number;
  line_total_egp: number;
  image_id: string | null;
  non_returnable: boolean;
  free_shipping: boolean;
  quantity_returned: number;
};

export type OrderEventV2 = {
  id: string;
  action: string;
  to_status: string | null;
  to_payment: string | null;
  actor_role: "buyer" | "seller" | "system" | "admin";
  note: string | null;
  at: string;
};

export type OrderCancellation = {
  by: "buyer" | "seller" | "system" | "admin";
  label_ar: string | null;
  label_en: string | null;
  message_ar: string | null;
  message_en: string | null;
  /** Seller and admin only; the buyer's document never carries it. */
  internal_note?: string | null;
};

export type OrderDocumentV2 = {
  id: string;
  order_number: string;
  checkout_id: string;
  status: OrderStatusV2;
  payment_method: PaymentMethodV2;
  payment_status: PaymentStatusV2;
  fulfilment: FulfilmentV2;
  delivery_speed: "standard" | "next_day";
  viewer: "buyer" | "seller" | "admin";
  source: "v2" | "legacy";
  seller: { name: string };
  recipient: { name: string; phone: string | null };
  place: {
    governorate_key: string | null;
    area_key: string | null;
    address_text: string | null;
    latitude: number | null;
    longitude: number | null;
    address_snapshot: Record<string, unknown> | null;
  };
  pickup: { address: string | null; instructions: string | null } | null;
  totals: {
    subtotal_egp: number;
    delivery_fee_egp: number;
    total_egp: number;
    paid_now_egp: number | null;
    balance_due_egp: number | null;
    deposit_percent: number | null;
    deposit_egp: number | null;
  };
  payment: {
    method: PaymentMethodV2;
    status: PaymentStatusV2;
    instapay: { address: string | null; account_name: string | null } | null;
    receipts: OrderReceipt[];
    dispute: {
      flagged_at: string;
      resubmit_due_at: string | null;
      message_ar: string | null;
      message_en: string | null;
      complaint_id: string | null;
    } | null;
  };
  delivery: {
    estimate: DateRange | null;
    shipment: { carrier_name: string | null; tracking_number: string | null; shipped_at: string } | null;
  };
  timestamps: {
    placed_at: string;
    preparing_at: string | null;
    ready_at: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
    cancelled_at: string | null;
  };
  cancellation: OrderCancellation | null;
  timers: { seller_start_due_at: string | null; receipt_resubmit_due_at: string | null };
  items: OrderLineV2[];
  events: OrderEventV2[];
  /** The buttons the viewer may press now; unknown names are ignored by the pages. */
  actions: string[];
  invoice: { number: string; issued_at: string } | null;
  return_window: { general_ends_at: string; defect_ends_at: string; returnable: boolean } | null;
  returns: { id: string; request_number: string; status: string; kind: string }[];
};

/** A preset reason (marketplace_order_reason_presets). */
export type ReasonPreset = { id: string; label_ar: string; label_en: string; text_ar: string; text_en: string };
export type ReasonAction = "order_cancel_seller" | "order_cancel_buyer" | "payment_issue" | "return_reject";

export type InvoiceParty = {
  name?: string | null;
  address?: string | null;
  registration_no?: string | null;
  tax_id?: string | null;
  /** Buyer only, on invoices issued since 20261128090001: the area and the structured address. */
  governorate_key?: string | null;
  area_key?: string | null;
  address_parts?: Record<string, unknown> | null;
};

export type OrderInvoice = {
  invoice_number: string;
  issued_at: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: { sku: string; name_ar: string; name_en: string; quantity: number; unit_price_egp: number; line_total_egp: number; variant_label?: { ar: string; en: string } | null }[];
  subtotal_egp: number;
  delivery_fee_egp: number;
  total_egp: number;
  payment_method: PaymentMethodV2;
  paid_now_egp: number | null;
  balance_due_egp: number | null;
};

export type OrderWaybill = {
  order_number: string;
  recipient: { name: string; phone: string | null };
  address_text: string | null;
  /** Absent until migration 20261128120001 is applied; null for orders without a saved structured address. */
  address_parts?: Record<string, unknown> | null;
  governorate_key: string | null;
  area_key: string | null;
  latitude: number | null;
  longitude: number | null;
  items: { name: string; sku: string; quantity: number }[];
  /** `status` is absent until migration 20261128150001 is applied. */
  payment: { method: PaymentMethodV2; status?: string; collect_on_delivery_egp: number };
  tracking_number: string | null;
  notes: string | null;
};
