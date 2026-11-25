import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { BuyerOrderDetail } from "./buyer-order-detail";
import { BuyerOrdersList } from "./buyer-orders-list";
import { InvoiceView, WaybillView } from "./print-views";
import { orderDoc, summary } from "./order-fixtures";
import { parseBuyerOrdersQuery } from "./order-model";

const cancel = vi.fn();
const presets = vi.fn();
const sync = vi.fn();
vi.mock("@/server/actions/marketplace-order-pages", () => ({
  buyerCancelOrderPageAction: (...a: unknown[]) => cancel(...a),
  reasonPresetsAction: (...a: unknown[]) => presets(...a),
  requestResubmitUploadAction: vi.fn(),
  confirmResubmitAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/marketplace-orders", () => ({ proofImageUrlAction: vi.fn() }));
vi.mock("@/server/actions/marketplace-cart-account", () => ({ syncMarketplaceCartAction: (...a: unknown[]) => sync(...a) }));

beforeEach(() => {
  cancel.mockReset();
  presets.mockReset();
  sync.mockReset();
  presets.mockResolvedValue({ ok: true, presets: [] });
});

const q = parseBuyerOrdersQuery({});

describe("buyer orders list", () => {
  it("shows the Noon layout: search, period filter, groups and one card per order", () => {
    renderWithI18n(<BuyerOrdersList page={{ total: 1, items: [summary()] }} query={q} />, "en");
    expect(screen.getByRole("heading", { name: "My orders" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /Search your orders/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "In progress" })).toBeInTheDocument();
    expect(screen.getByText("1 order")).toBeInTheDocument();
    expect(screen.getByText(/Expected delivery/)).toHaveTextContent("12–14 Dec");
    expect(screen.getByRole("link", { name: "MP-000123" })).toHaveAttribute("href", "/market/orders/11111111-1111-4111-8111-111111111111");
  });

  it("shows the empty state with a way back to shopping", () => {
    renderWithI18n(<BuyerOrdersList page={{ total: 0, items: [] }} query={q} />, "en");
    expect(screen.getByText("You have no orders yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue shopping" })).toHaveAttribute("href", "/market");
  });

  it("tells a filtered empty result apart and offers to clear the filters", () => {
    renderWithI18n(<BuyerOrdersList page={{ total: 0, items: [] }} query={parseBuyerOrdersQuery({ q: "tile" })} />, "en");
    expect(screen.getByText("No orders match")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/market/orders");
  });

  it("flags an order that needs a new receipt and reports a load failure", () => {
    const { unmount } = renderWithI18n(<BuyerOrdersList page={{ total: 1, items: [summary({ action_needed: true, has_dispute: true, payment_status: "receipt_disputed", status: "preparing" })] }} query={q} />, "en");
    expect(screen.getByText(/send a new receipt/)).toBeInTheDocument();
    unmount();
    renderWithI18n(<BuyerOrdersList page={{ total: 0, items: [] }} query={q} failed />, "en");
    expect(screen.getByRole("alert")).toHaveTextContent("could not load");
  });

  it("writes the Arabic copy", () => {
    renderWithI18n(<BuyerOrdersList page={{ total: 0, items: [] }} query={q} />, "ar");
    expect(screen.getByRole("heading", { name: "طلباتي" })).toBeInTheDocument();
    expect(screen.getByText("لا توجد طلبات بعد")).toBeInTheDocument();
  });
});

describe("buyer order page", () => {
  it("shows the progress bar, the estimate, the items and the timeline, and no seller contact element", () => {
    renderWithI18n(<BuyerOrderDetail initial={orderDoc({ status: "preparing", actions: [] })} />, "en");
    const bar = screen.getByRole("list", { name: "Order progress" });
    expect(within(bar).getAllByRole("listitem")).toHaveLength(4);
    expect(within(bar).getByText("Preparing").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/Expected delivery/)).toHaveTextContent("12–14 Dec");
    expect(screen.getByText("Soft wallpaper")).toBeInTheDocument();
    expect(screen.getAllByText("Order placed")).toHaveLength(2); // progress step and timeline entry
    expect(screen.queryByText(/WhatsApp|Contact the showroom|phone of the showroom/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
  });

  it("shows the tracking number once shipped", () => {
    const doc = orderDoc({ status: "shipped", delivery: { estimate: null, shipment: { carrier_name: "Bosta", tracking_number: "BST-1001", shipped_at: "2026-12-02T10:00:00Z" } } });
    renderWithI18n(<BuyerOrderDetail initial={doc} />, "en");
    expect(screen.getByText("BST-1001")).toBeInTheDocument();
    expect(screen.getByText("Bosta")).toBeInTheDocument();
  });

  it("offers cancel only when the database says so, with the preset reasons", async () => {
    presets.mockResolvedValue({ ok: true, presets: [{ id: "p1", label_ar: "غيرت رأيي", label_en: "Changed my mind", text_ar: "x", text_en: "y" }] });
    cancel.mockResolvedValue({ ok: true, order: orderDoc({ status: "cancelled", actions: [], cancellation: { by: "buyer", label_ar: null, label_en: null, message_ar: null, message_en: null } }) });
    renderWithI18n(<BuyerOrderDetail initial={orderDoc({ actions: ["cancel"] })} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Changed my mind" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel order" }).at(-1)!);
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(orderDoc().id, "p1", ""));
    expect(await screen.findByText("You cancelled this order.")).toBeInTheDocument();
  });

  it("ignores buttons of later PRs it does not know", () => {
    renderWithI18n(<BuyerOrderDetail initial={orderDoc({ actions: ["file_complaint", "request_return"] })} />, "en");
    expect(screen.queryByRole("button", { name: /complaint|return/i })).toBeNull();
  });

  it("reorders through the cart merge with slug, SKU and quantity only", async () => {
    sync.mockResolvedValue({ ok: false, code: "own_showroom" });
    renderWithI18n(<BuyerOrderDetail initial={orderDoc()} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Order again" }));
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    const arg = sync.mock.calls[0]![0] as { mode: string; key: string; lines: unknown[] };
    expect(arg.mode).toBe("merge");
    expect(arg.lines).toEqual([
      { slug: "soft-wallpaper", sku: "PG-1", qty: 3 },
      { slug: "second-paper", sku: "PG-2", qty: 1 },
    ]);
    expect(await screen.findByRole("alert")).toHaveTextContent("own showroom");
  });

  it("shows the disputed receipt with the countdown and the upload button", () => {
    const doc = orderDoc({
      status: "preparing",
      payment_method: "instapay_full",
      payment_status: "receipt_disputed",
      actions: ["resubmit_receipt"],
      payment: { method: "instapay_full", status: "receipt_disputed", instapay: { address: "decore@instapay", account_name: "Decore" }, receipts: [], dispute: { flagged_at: "2026-12-01T10:00:00Z", resubmit_due_at: new Date(Date.now() + 5 * 3_600_000).toISOString(), message_ar: null, message_en: "Please check the transfer", complaint_id: null } },
    });
    renderWithI18n(<BuyerOrderDetail initial={doc} />, "en");
    expect(screen.getByText("Please check the transfer")).toBeInTheDocument();
    expect(screen.getByText(/hours left/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload a new receipt" })).toBeInTheDocument();
  });

  it("links the invoice only when the order is ready, and shows a cancellation to the buyer without the internal note", () => {
    const { unmount } = renderWithI18n(<BuyerOrderDetail initial={orderDoc({ status: "new" })} />, "en");
    expect(screen.queryByRole("link", { name: "Invoice" })).toBeNull();
    unmount();
    renderWithI18n(<BuyerOrderDetail initial={orderDoc({ status: "cancelled", cancellation: { by: "seller", label_ar: null, label_en: "Out of stock", message_ar: "نفد", message_en: "Out of stock" } })} />, "en");
    expect(screen.getByText("The showroom cancelled this order.")).toBeInTheDocument();
    expect(screen.getByText(/Out of stock/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Order progress" })).toBeNull();
  });
});

describe("print views", () => {
  it("labels the invoice as an order invoice, not a tax invoice, and carries no phone", () => {
    const invoice = {
      invoice_number: "INV-000007", issued_at: "2026-12-05T10:00:00Z", seller: { name: "Decore Store", address: "Maadi" }, buyer: { name: "Mona Hassan", address: "12 Example Street" },
      lines: [{ sku: "PG-1", name_ar: "ورق", name_en: "Paper", quantity: 3, unit_price_egp: 100, line_total_egp: 300 }],
      subtotal_egp: 300, delivery_fee_egp: 60, total_egp: 360, payment_method: "cod" as const, paid_now_egp: 0, balance_due_egp: 360,
    };
    const { container } = renderWithI18n(<InvoiceView invoice={invoice} backHref="/market/orders/x" />, "en");
    expect(screen.getByText(/not a tax invoice/)).toBeInTheDocument();
    expect(screen.getByText("INV-000007")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\+20/);
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  });

  it("prints the waybill with the phone for the courier and the amount to collect", () => {
    renderWithI18n(
      <WaybillView backHref="/showroom/marketplace/orders/x" waybill={{ order_number: "MP-000123", recipient: { name: "Mona", phone: "+201999000009" }, address_text: "12 Example Street", governorate_key: "cairo", area_key: null, latitude: 30, longitude: 31.2, items: [{ name: "Paper", sku: "PG-1", quantity: 3 }], payment: { method: "cod", collect_on_delivery_egp: 360 }, tracking_number: null, notes: "Call first" }} />,
      "en",
    );
    expect(screen.getByText("+201999000009")).toBeInTheDocument();
    expect(screen.getByText(/Collect on delivery/)).toHaveTextContent("360");
    expect(screen.getByText("Call first")).toBeInTheDocument();
  });
});
