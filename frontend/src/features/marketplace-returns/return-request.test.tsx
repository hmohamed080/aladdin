import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import type { Eligibility } from "./contract";
import { ReturnPolicyForm } from "./return-policy-form";
import { ReturnRequest } from "./return-request";

const push = vi.fn();
const create = vi.fn();
const request = vi.fn();
const confirm = vi.fn();
const save = vi.fn();
const upload = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/storage/browser-upload", () => ({ uploadWithGrant: (...a: unknown[]) => upload(...a) }));
vi.mock("@/server/actions/marketplace-returns", () => ({
  createReturnAction: (...a: unknown[]) => create(...a),
  requestEvidenceUploadAction: (...a: unknown[]) => request(...a),
  confirmEvidenceAction: (...a: unknown[]) => confirm(...a),
  saveReturnSettingsAction: (...a: unknown[]) => save(...a),
}));

const ORDER = "11111111-1111-4111-8111-111111111111";
const eligibility: Eligibility = {
  eligible: true,
  window: { general_ends_at: "2026-12-10T21:59:59Z", defect_ends_at: "2026-12-26T21:59:59Z", transit_ends_at: "2026-11-28T10:00:00Z" },
  active_return_id: null,
  lines: [
    { item_id: "i1", name_ar: "ورق", name_en: "Wallpaper", sku: "W", variant_label: null, image_id: null, unit_price_egp: 100, quantity: 3, returnable_quantity: 2, non_returnable: false },
    { item_id: "i2", name_ar: "ستارة", name_en: "Curtain", sku: "C", variant_label: null, image_id: null, unit_price_egp: 50, quantity: 1, returnable_quantity: 1, non_returnable: true },
  ],
  reasons: [
    { id: "r-mind", label_ar: "غيرت رأيي", label_en: "Changed my mind", claim_type: "general", requires_evidence: false, transit_damage: false, shipping_payer: "buyer" },
    { id: "r-defect", label_ar: "عيب", label_en: "Defective", claim_type: "defect", requires_evidence: true, transit_damage: false, shipping_payer: "seller" },
  ],
};
const view = (now = "2026-11-27T10:00:00Z") =>
  renderWithI18n(<ReturnRequest orderId={ORDER} eligibility={eligibility} initialKind="return" locale="en" now={now} />, "en");

beforeEach(() => {
  [push, create, request, confirm, save, upload].forEach((m) => m.mockReset());
});

describe("return request", () => {
  it("sends the chosen units and reason, then opens the new request", async () => {
    create.mockResolvedValue({ ok: true, return: { id: "ret-1" } });
    view();
    const send = screen.getByRole("button", { name: "Send the request" });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Changed my mind/ }));
    // a made-to-order line is not offered for a change of mind
    expect(screen.getByRole("spinbutton", { name: /Curtain/ })).toBeDisabled();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Wallpaper/ }), { target: { value: "9" } });
    fireEvent.click(send);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/market/returns/ret-1"));
    expect(create.mock.calls[0]![0]).toMatchObject({ orderId: ORDER, kind: "return", lines: [{ item_id: "i1", quantity: 2 }], reasonPresetId: "r-mind", evidenceIds: [] });
  });

  it("asks for a photo when the reason needs one, and attaches it", async () => {
    request.mockResolvedValue({ ok: true, evidenceId: "e1", objectKey: "returns/o/e1.jpg", grant: {} });
    confirm.mockResolvedValue({ ok: true, evidence: [{ id: "e1", object_key: "returns/o/e1.jpg", created_at: "" }] });
    create.mockResolvedValue({ ok: false, code: "return_window_closed" });
    view();
    fireEvent.click(screen.getByRole("radio", { name: /Defective/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Curtain/ }), { target: { value: "1" } });
    expect(screen.getByText("This reason needs at least one photo.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("return-photo-input"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByText("Photos (1 of 6)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send the request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The return period for this reason has ended.");
    expect(create.mock.calls[0]![0]).toMatchObject({ evidenceIds: ["e1"] });
    expect(push).not.toHaveBeenCalled();
  });

  it("offers only the reasons whose period is still open", () => {
    view("2026-12-15T10:00:00Z");
    expect(screen.queryByRole("radio", { name: /Changed my mind/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Defective/ })).toBeInTheDocument();
  });
});

describe("return policy form", () => {
  const initial = { general_days: 14, defect_days: 30, min_general_days: 14, min_defect_days: 30 };

  it("saves longer windows and refuses shorter ones", async () => {
    save.mockResolvedValue({ ok: true, settings: initial });
    renderWithI18n(<ReturnPolicyForm organizationId="org-1" initial={initial} locale="en" />, "en");
    const general = screen.getByRole("spinbutton", { name: /Regular returns/ });
    fireEvent.change(general, { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(general, { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The return policy was saved.")).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith("org-1", 21, 30);
  });
});
