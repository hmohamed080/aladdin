import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { SellersTable, type SellerRow } from "./sellers-table";
import type { PresetRow } from "./seller-model";

const transition = vi.fn();
const refresh = vi.fn();
vi.mock("@/server/actions/admin-marketplace", () => ({ sellerTransitionAction: (...a: unknown[]) => transition(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const row = (over: Partial<SellerRow>): SellerRow => ({
  organizationId: "org-1",
  organizationName: "Nile Showroom",
  eligible: true,
  orgType: "showroom_dealer",
  orgStatus: "active",
  orgDeleted: false,
  status: "pending",
  statusReason: null,
  ownerMessage: null,
  statusChangedAt: "2026-11-20T10:00:00Z",
  requestedAt: "2026-11-20T10:00:00Z",
  approvedByName: null,
  productsTotal: 0,
  productsPublished: 0,
  productsDraft: 0,
  ...over,
});

const presets: PresetRow[] = [
  { id: "p-reject", action: "reject", labelAr: "بيانات غير مكتملة", labelEn: "Incomplete details", textAr: "نص", textEn: "Please complete your details.", isActive: true, sortOrder: 10 },
  { id: "p-off", action: "reject", labelAr: "موقوفة", labelEn: "Switched off", textAr: "ن", textEn: "Off", isActive: false, sortOrder: 20 },
  { id: "p-revoke", action: "revoke", labelAr: "مخالفة", labelEn: "Breach", textAr: "ن", textEn: "Breach text", isActive: true, sortOrder: 10 },
];

beforeEach(() => {
  transition.mockReset();
  refresh.mockReset();
  transition.mockResolvedValue({ ok: true, status: "x" });
});

describe("SellersTable", () => {
  it("shows what is missing when Eligible is No, on hover (title) and to assistive technology", () => {
    renderWithI18n(
      <SellersTable rows={[row({ eligible: false, status: null, orgStatus: "suspended", orgType: "supplier", orgDeleted: true })]} presets={presets} />,
      "en",
    );
    const no = screen.getByTestId("eligibility-org-1");
    expect(no.getAttribute("title")).toBe("The organization was deleted. The organization is not active. The organization is not a showroom.");
    expect(no.getAttribute("aria-label")).toContain("The organization is not active.");
  });

  it("draws the revoke button as Revoke (not Cancel) and offers Approve again after a revoke", () => {
    const first = renderWithI18n(<SellersTable rows={[row({ status: "approved" })]} presets={presets} />, "en");
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    first.unmount();
    renderWithI18n(<SellersTable rows={[row({ status: "revoked" })]} presets={presets} />, "en");
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reinstate" })).toBeNull();
  });

  it("uses the Arabic words for revoke and the revoked status", () => {
    renderWithI18n(<SellersTable rows={[row({ status: "approved" }), row({ organizationId: "org-2", status: "revoked" })]} presets={presets} />, "ar");
    expect(screen.getByRole("button", { name: "سحب" })).toBeTruthy();
    expect(screen.getByText("مسحوب")).toBeTruthy();
  });

  it("approves without any reason (optional), sending no message", async () => {
    renderWithI18n(<SellersTable rows={[row({ status: "pending" })]} presets={presets} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText("Internal reason (optional)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Approve · Confirm/ }));
    await waitFor(() => expect(transition).toHaveBeenCalledWith("org-1", "approve", { reason: "", presetId: null, message: null }));
    expect(refresh).toHaveBeenCalled();
  });

  it("requires a reason for reject / suspend / revoke / reinstate before Confirm is enabled", () => {
    renderWithI18n(<SellersTable rows={[row({ status: "pending" })]} presets={presets} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const confirm = screen.getByRole("button", { name: /Reject · Confirm/ }) as HTMLButtonElement;
    expect(screen.getByText("Internal reason (required)")).toBeTruthy();
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Internal reason (required)"), { target: { value: "papers missing" } });
    expect(confirm.disabled).toBe(false);
  });

  it("lists only the ACTIVE presets of the chosen action and sends the chosen preset with the reason", async () => {
    renderWithI18n(<SellersTable rows={[row({ status: "pending" })]} presets={presets} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText("Internal reason (required)"), { target: { value: "papers missing" } });
    const select = screen.getByLabelText("Message to the owner", { selector: "select" }) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(["No message", "Incomplete details", "Other (write your own)"]);
    fireEvent.change(select, { target: { value: "p-reject" } });
    expect(screen.getByTestId("preset-preview").textContent).toBe("Please complete your details.");
    fireEvent.click(screen.getByRole("button", { name: /Reject · Confirm/ }));
    await waitFor(() => expect(transition).toHaveBeenCalledWith("org-1", "reject", { reason: "papers missing", presetId: "p-reject", message: null }));
  });

  it("sends custom free text ('Other') and needs some text before Confirm", async () => {
    renderWithI18n(<SellersTable rows={[row({ status: "approved" })]} presets={presets} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.change(screen.getByLabelText("Internal reason (required)"), { target: { value: "breach" } });
    fireEvent.change(screen.getByLabelText("Message to the owner", { selector: "select" }), { target: { value: "__other__" } });
    const confirm = screen.getByRole("button", { name: /Revoke · Confirm/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Write the message the owner will read"), { target: { value: "Please call us" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(transition).toHaveBeenCalledWith("org-1", "revoke", { reason: "breach", presetId: null, message: "Please call us" }));
  });

  it("shows the refusal and keeps the form open when the server refuses", async () => {
    transition.mockResolvedValue({ ok: false, code: "transition_refused" });
    renderWithI18n(<SellersTable rows={[row({ status: "approved" })]} presets={presets} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    fireEvent.change(screen.getByLabelText("Internal reason (required)"), { target: { value: "review" } });
    fireEvent.click(screen.getByRole("button", { name: /Suspend · Confirm/ }));
    await waitFor(() => expect(screen.getByText("This change is not allowed from the seller's current state.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the internal reason and the owner message as two separate things", () => {
    renderWithI18n(<SellersTable rows={[row({ status: "rejected", statusReason: "forged papers", ownerMessage: "Please complete your details." })]} presets={presets} />, "en");
    expect(screen.getByText("forged papers")).toBeTruthy();
    expect(screen.getByText("Please complete your details.")).toBeTruthy();
    expect(screen.getByText(/Internal reason/)).toBeTruthy();
    expect(screen.getByText(/Message to the owner:/)).toBeTruthy();
  });
});
