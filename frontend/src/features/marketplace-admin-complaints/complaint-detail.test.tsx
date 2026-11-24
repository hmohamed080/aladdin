import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { ComplaintDetailView } from "./complaint-detail";
import type { ComplaintDetail } from "./model";

const take = vi.fn();
const decide = vi.fn();
const refresh = vi.fn();
vi.mock("@/server/actions/marketplace-complaints", () => ({
  takeComplaintAction: (...a: unknown[]) => take(...a),
  decideComplaintAction: (...a: unknown[]) => decide(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const detail = (over: Partial<ComplaintDetail["complaint"]> = {}): ComplaintDetail => ({
  complaint: { id: "k1", order_id: "o1", state: "open", reason: "transfer_made", note: "I paid at 10am", filed_by_role: "buyer", decision: null,
    decision_note: null, decided_at: null, taken: false, taken_by_me: false, created_at: "2026-12-01T10:00:00Z", ...over },
  order: { order_number: "MP-000042", status: "preparing", payment_method: "instapay_full", payment_status: "receipt_disputed",
    seller: { name: "Decore" }, recipient: { name: "Test Buyer" }, totals: { total_egp: 500, paid_now_egp: 500, balance_due_egp: 0 },
    payment: { receipts: [], dispute: null } },
  events: [{ action: "filed", actor_role: "buyer", note: "I paid at 10am", at: "2026-12-01T10:00:00Z" }],
});
const receipts = [{ id: "r1", url: "/api/media/marketplace?key=x", created_at: "2026-12-01T09:00:00Z", status: "rejected" }];

beforeEach(() => {
  take.mockReset(); decide.mockReset(); refresh.mockReset();
  take.mockResolvedValue({ ok: true });
  decide.mockResolvedValue({ ok: true });
});

describe("ComplaintDetailView", () => {
  it("shows the order, the receipt and the complaint note, and no phone", () => {
    renderWithI18n(<ComplaintDetailView detail={detail()} receipts={receipts} />, "en");
    expect(screen.getByText(/MP-000042/)).toBeTruthy();
    expect(screen.getByAltText("Transfer receipt")).toBeTruthy();
    expect(screen.getByText("I paid at 10am", { selector: "p" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\+20/);
  });

  it("takes an open complaint", async () => {
    renderWithI18n(<ComplaintDetailView detail={detail()} receipts={[]} />, "en");
    expect(screen.getByText("No receipt is on file.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take this complaint" }));
    await waitFor(() => expect(take).toHaveBeenCalledWith("k1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("decides only with a written note and sends the chosen decision", async () => {
    renderWithI18n(<ComplaintDetailView detail={detail({ state: "under_review", taken: true, taken_by_me: true })} receipts={[]} />, "en");
    const save = screen.getByRole("button", { name: "Save the decision" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/The money was not received/));
    fireEvent.change(screen.getByLabelText(/Written note/), { target: { value: "No credit on the account" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(decide).toHaveBeenCalledWith("k1", "payment_not_received", "No credit on the account"));
  });

  it("shows a refusal in plain words and does not refresh", async () => {
    decide.mockResolvedValueOnce({ ok: false, code: "invalid_transition" });
    renderWithI18n(<ComplaintDetailView detail={detail({ state: "under_review", taken: true, taken_by_me: true })} receipts={[]} />, "en");
    fireEvent.change(screen.getByLabelText(/Written note/), { target: { value: "Looks fine to me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the decision" }));
    expect(await screen.findByText(/already handled or is taken by another admin/)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers no decision form when another admin took it", () => {
    renderWithI18n(<ComplaintDetailView detail={detail({ state: "under_review", taken: true, taken_by_me: false })} receipts={[]} />, "en");
    expect(screen.getByText("Another admin is reviewing this complaint.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save the decision" })).toBeNull();
  });

  it("shows the decision of a closed complaint, in Arabic too", () => {
    renderWithI18n(<ComplaintDetailView detail={detail({ state: "resolved", decision: "payment_valid", decision_note: "Bank confirms" })} receipts={[]} />, "ar");
    expect(screen.getByText("الدفع صحيح")).toBeTruthy();
    expect(screen.getByText("Bank confirms")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "حفظ القرار" })).toBeNull();
  });
});
