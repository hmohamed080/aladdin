import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import { SellerOrderDetail } from "./seller-order-detail";
import { orderDoc } from "./order-fixtures";

const action = vi.fn();
const shipment = vi.fn();
const presets = vi.fn();
vi.mock("@/server/actions/marketplace-order-pages", () => ({
  sellerOrderActionPageAction: (...a: unknown[]) => action(...a),
  shipmentUpdateAction: (...a: unknown[]) => shipment(...a),
  reasonPresetsAction: (...a: unknown[]) => presets(...a),
}));
vi.mock("@/server/actions/marketplace-orders", () => ({ proofImageUrlAction: vi.fn() }));
vi.mock("@/server/actions/marketplace-complaints", () => ({ fileComplaintAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const COMPLAINT = createTranslator("en")("marketplaceComplaints.file.open");
const seller = (over = {}) => orderDoc({ viewer: "seller", ...over });
beforeEach(() => {
  action.mockReset();
  shipment.mockReset();
  presets.mockReset();
  presets.mockResolvedValue({ ok: true, presets: [{ id: "p1", label_ar: "نفد المخزون", label_en: "Out of stock", text_ar: "نفد", text_en: "Out" }] });
});

describe("seller order page", () => {
  it("draws only the buttons the database listed, and ignores names it does not know", () => {
    renderWithI18n(<SellerOrderDetail initial={seller({ actions: ["start_preparing", "cancel", "file_complaint", "request_return"] })} />, "en");
    expect(screen.getByRole("button", { name: "Start preparing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /return/i })).toBeNull();
    // the complaint form of PR 14 opens from the listed action
    expect(screen.getByRole("button", { name: COMPLAINT })).toBeInTheDocument();
    // the removed confirm step is gone
    expect(screen.queryByText(/Confirm order|Awaiting confirmation/i)).toBeNull();
  });

  it("offers no button for a legacy order", () => {
    renderWithI18n(<SellerOrderDetail initial={seller({ source: "legacy", status: "shipped", actions: [] })} />, "en");
    expect(screen.queryByRole("button", { name: "Start preparing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Correct shipment details" })).toBeNull();
    expect(screen.getByText(/read-only here/)).toBeInTheDocument();
  });

  it("asks before starting to prepare, then sends the action and shows the new state", async () => {
    action.mockResolvedValue({ ok: true, order: seller({ status: "preparing", actions: ["mark_ready", "cancel"] }) });
    renderWithI18n(<SellerOrderDetail initial={seller({ actions: ["start_preparing", "cancel"] })} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Start preparing" }));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith(seller().id, "start_preparing", {}));
    expect(await screen.findByRole("button", { name: "Ready to ship" })).toBeInTheDocument();
  });

  it("labels the ready step for a pickup order", () => {
    renderWithI18n(<SellerOrderDetail initial={seller({ fulfilment: "pickup", pickup: { address: "Branch", instructions: null }, status: "preparing", actions: ["mark_ready", "cancel"] })} />, "en");
    expect(screen.getByRole("button", { name: "Ready for pickup" })).toBeInTheDocument();
  });

  it("cancels with a preset reason", async () => {
    action.mockResolvedValue({ ok: true, order: seller({ status: "cancelled", actions: [] }) });
    renderWithI18n(<SellerOrderDetail initial={seller({ actions: ["start_preparing", "cancel"] })} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    expect(await screen.findByRole("radio", { name: "Out of stock" })).toBeChecked();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel order" }).at(-1)!);
    await waitFor(() => expect(action).toHaveBeenCalledWith(seller().id, "cancel", { preset_id: "p1" }));
  });

  it("refuses an empty custom reason and sends a custom one in both languages", async () => {
    presets.mockResolvedValue({ ok: true, presets: [] });
    action.mockResolvedValue({ ok: true, order: seller({ status: "cancelled", actions: [] }) });
    renderWithI18n(<SellerOrderDetail initial={seller({ actions: ["cancel"] })} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    const confirm = async () => screen.getAllByRole("button", { name: "Cancel order" }).at(-1)!;
    await screen.findByLabelText("Reason in Arabic");
    fireEvent.click(await confirm());
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick a reason");
    expect(action).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason in English"), { target: { value: "Supplier delay" } });
    fireEvent.click(await confirm());
    await waitFor(() => expect(action).toHaveBeenCalledWith(seller().id, "cancel", { message_ar: "Supplier delay", message_en: "Supplier delay" }));
  });

  it("flags a receipt with «money did not arrive» only through its own panel", async () => {
    action.mockResolvedValue({ ok: true, order: seller({ status: "preparing", payment_status: "receipt_disputed", actions: ["cancel", "accept_receipt"] }) });
    const doc = seller({ status: "preparing", payment_method: "instapay_full", payment_status: "receipt_submitted", actions: ["mark_ready", "cancel", "accept_receipt", "flag_receipt_not_received"] });
    renderWithI18n(<SellerOrderDetail initial={doc} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Money did not arrive" }));
    expect(await screen.findByText(/within 48 hours/)).toBeInTheDocument();
    await screen.findByRole("radio", { name: "Out of stock" }); // the reasons load after the panel opens
    fireEvent.click(screen.getByRole("button", { name: "Tell the buyer" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith(doc.id, "flag_receipt_not_received", { preset_id: "p1" }));
    expect(await screen.findByText(/Progress is on hold/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ready to ship" })).toBeNull();
  });

  it("validates tracking before shipping and sends carrier and number", async () => {
    action.mockResolvedValue({ ok: true, order: seller({ status: "shipped", actions: ["mark_delivered", "mark_delivery_failed"] }) });
    renderWithI18n(<SellerOrderDetail initial={seller({ status: "ready", actions: ["mark_shipped", "cancel"] })} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Mark as shipped" }));
    fireEvent.change(screen.getByLabelText(/Tracking number/), { target: { value: "bad number" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Mark as shipped" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("3 to 64");
    expect(action).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Tracking number/), { target: { value: "BST-1001" } });
    fireEvent.change(screen.getByLabelText(/Carrier/), { target: { value: "Bosta" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Mark as shipped" }).at(-1)!);
    await waitFor(() => expect(action).toHaveBeenCalledWith(seller().id, "mark_shipped", { carrier_name: "Bosta", tracking_number: "BST-1001" }));
  });

  it("corrects the shipment of a shipped order", async () => {
    const shipped = seller({ status: "shipped", actions: ["mark_delivered"], delivery: { estimate: null, shipment: { carrier_name: "Bosta", tracking_number: "BST-1", shipped_at: "2026-12-02T10:00:00Z" } } });
    shipment.mockResolvedValue({ ok: true, order: shipped });
    renderWithI18n(<SellerOrderDetail initial={shipped} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Correct shipment details" }));
    fireEvent.change(screen.getByLabelText(/Tracking number/), { target: { value: "BST-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(shipment).toHaveBeenCalledWith(shipped.id, "Bosta", "BST-2"));
  });

  it("shows a refusal as a sentence, never raw database text", async () => {
    action.mockResolvedValue({ ok: false, code: "invalid_transition" });
    renderWithI18n(<SellerOrderDetail initial={seller({ actions: ["start_preparing"] })} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Start preparing" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed in the meantime");
  });

  it("links the waybill for delivery orders only and the invoice once the order is ready", () => {
    const { unmount } = renderWithI18n(<SellerOrderDetail initial={seller({ status: "preparing" })} />, "en");
    expect(screen.getByRole("link", { name: "Print waybill" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Print invoice" })).toBeNull();
    unmount();
    renderWithI18n(<SellerOrderDetail initial={seller({ status: "ready", fulfilment: "pickup", pickup: { address: "B", instructions: null } })} />, "en");
    expect(screen.queryByRole("link", { name: "Print waybill" })).toBeNull();
    expect(screen.getByRole("link", { name: "Print invoice" })).toBeInTheDocument();
  });

  it("shows no contact element for the buyer beyond the delivery phone, and the Arabic copy", () => {
    renderWithI18n(<SellerOrderDetail initial={seller({ actions: ["start_preparing"] })} />, "ar");
    expect(screen.getByRole("button", { name: "بدء التجهيز" })).toBeInTheDocument();
    expect(screen.queryByText(/واتساب|WhatsApp|تواصل/)).toBeNull();
  });
});
