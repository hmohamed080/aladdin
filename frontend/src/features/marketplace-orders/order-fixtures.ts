import type { OrderDocumentV2, OrderSummaryV2 } from "./order-types";

/** Typed fakes of the contract's order document and list row, for the page tests. */
export const ORDER_ID = "11111111-1111-4111-8111-111111111111";

export function orderDoc(over: Partial<OrderDocumentV2> = {}): OrderDocumentV2 {
  return {
    id: ORDER_ID,
    order_number: "MP-000123",
    checkout_id: "22222222-2222-4222-8222-222222222222",
    status: "new",
    payment_method: "cod",
    payment_status: "pending",
    fulfilment: "delivery",
    delivery_speed: "standard",
    viewer: "buyer",
    source: "v2",
    seller: { name: "Decore Store" },
    recipient: { name: "Mona Hassan", phone: "+201999000009" },
    place: { governorate_key: "cairo", area_key: null, address_text: "12 Example Street, Maadi", latitude: 30, longitude: 31.2, address_snapshot: null },
    pickup: null,
    totals: { subtotal_egp: 450, delivery_fee_egp: 60, total_egp: 510, paid_now_egp: 0, balance_due_egp: 510, deposit_percent: null, deposit_egp: null },
    payment: { method: "cod", status: "pending", instapay: null, receipts: [], dispute: null },
    delivery: { estimate: { earliest: "2026-12-12", latest: "2026-12-14" }, shipment: null },
    timestamps: { placed_at: "2026-12-01T10:00:00Z", preparing_at: null, ready_at: null, shipped_at: null, delivered_at: null, cancelled_at: null },
    cancellation: null,
    timers: { seller_start_due_at: null, receipt_resubmit_due_at: null },
    items: [
      { id: "i1", slug: "soft-wallpaper", sku: "PG-1", name_ar: "ورق جدران ناعم", name_en: "Soft wallpaper", variant_label: { ar: "أبيض", en: "White" }, selling_unit: "roll", unit_price_egp: 100, quantity: 3, line_total_egp: 300, image_id: null, non_returnable: false, free_shipping: false, quantity_returned: 0 },
      { id: "i2", slug: "second-paper", sku: "PG-2", name_ar: "ورق ثان", name_en: "Second paper", variant_label: null, selling_unit: "roll", unit_price_egp: 150, quantity: 1, line_total_egp: 150, image_id: null, non_returnable: false, free_shipping: false, quantity_returned: 0 },
    ],
    events: [{ id: "e1", action: "placed", to_status: "new", to_payment: "pending", actor_role: "buyer", note: null, at: "2026-12-01T10:00:00Z" }],
    actions: [],
    invoice: null,
    return_window: null,
    returns: [],
    ...over,
  };
}

export function summary(over: Partial<OrderSummaryV2> = {}): OrderSummaryV2 {
  return {
    id: ORDER_ID,
    order_number: "MP-000123",
    status: "new",
    payment_method: "cod",
    payment_status: "pending",
    fulfilment: "delivery",
    total_egp: 510,
    placed_at: "2026-12-01T10:00:00Z",
    delivered_at: null,
    estimate: { earliest: "2026-12-12", latest: "2026-12-14" },
    item_count: 4,
    first_items: [
      { name_ar: "ورق جدران ناعم", name_en: "Soft wallpaper", image_id: null, quantity: 3 },
      { name_ar: "ورق ثان", name_en: "Second paper", image_id: null, quantity: 1 },
    ],
    seller_name: "Decore Store",
    has_dispute: false,
    action_needed: false,
    ...over,
  };
}
