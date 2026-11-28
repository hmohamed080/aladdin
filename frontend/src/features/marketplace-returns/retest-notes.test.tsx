import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmedView } from "@/features/marketplace-checkout/confirmed-view";
import type { OrderDocumentV2, OrderWaybill } from "@/features/marketplace-orders/order-types";
import { WaybillView } from "@/features/marketplace-orders/print-views";
import { renderWithI18n } from "@/test/render";
import type { ReturnDocument } from "./contract";
import { ReturnActions } from "./return-actions";

const decide = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/server/actions/marketplace-returns", () => ({ adminDecideReturnAction: (...a: unknown[]) => decide(...a) }));
vi.mock("@/features/marketplace-orders/reason-panel", () => ({ ReasonPanel: () => null }));

beforeEach(() => decide.mockReset());

// F29: an admin decision cannot be undone, so one press never sends it
describe("admin return decision", () => {
  const doc = { id: "r1", actions: ["approve", "reject"], items: [], partial_refund_egp: null } as unknown as ReturnDocument;
  const view = () => {
    renderWithI18n(<ReturnActions doc={doc} role="admin" locale="en" />, "en");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Checked the photos" } });
  };

  it.each([
    ["Reject", "reject", "Confirm rejection"],
    ["Approve", "approve", "Confirm approval"],
  ])("%s asks first and sends only on the confirmation", async (button, decision, confirm) => {
    decide.mockResolvedValue({ ok: true });
    view();
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: confirm }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("r1", decision, "Checked the photos", "", ""));
  });

  it("Back closes the question and sends nothing", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByText(/cannot be undone/)).not.toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();
  });
});

// F27: the sheet says why nothing is collected
describe("waybill after a refund", () => {
  const waybill = (status: string): OrderWaybill => ({
    order_number: "MP-000125", recipient: { name: "Mona", phone: null }, address_text: "12 Example Street", governorate_key: null, area_key: null,
    latitude: null, longitude: null, items: [], payment: { method: "cod", status, collect_on_delivery_egp: 0 }, tracking_number: null, notes: null,
  });

  it.each([
    ["refunded", "Money refunded to the buyer, nothing to collect"],
    ["refund_due", "Refund due to the buyer, nothing to collect"],
    ["collected", "Paid in full, nothing to collect"],
  ])("payment %s", (status, text) => {
    renderWithI18n(<WaybillView backHref="/x" waybill={waybill(status)} />, "en");
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

// F28: the thank-you page labels the saved address in the reader's language
describe("thank-you page address", () => {
  it("builds the address from the saved parts, not the stored line", () => {
    const order = {
      id: "o1", order_number: "MP-000126", status: "new", fulfilment: "delivery", payment_method: "cod", recipient: { name: "Mona", phone: null },
      place: { governorate_key: null, area_key: null, address_text: "Street - عمارة 1 - دور 2", address_snapshot: { street: "Street", building: "1", floor: "2" } },
      totals: { subtotal_egp: 150, delivery_fee_egp: 0, total_egp: 150 }, items: [], seller: { name: "S" }, pickup: null,
    } as unknown as OrderDocumentV2;
    renderWithI18n(<ConfirmedView order={order} />, "en");
    expect(screen.getByText("Street, Building 1, Floor 2")).toBeInTheDocument();
    expect(screen.queryByText(/عمارة/)).not.toBeInTheDocument();
  });
});
