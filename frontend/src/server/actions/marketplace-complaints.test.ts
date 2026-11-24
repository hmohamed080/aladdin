import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: mocks.rpc }) }));

import { decideComplaintAction, fileComplaintAction, takeComplaintAction } from "./marketplace-complaints";

const ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { complaint_id: "c1", state: "open" }, error: null });
});

describe("takeComplaintAction", () => {
  it("takes under the caller's own session and refreshes the queue and the page", async () => {
    await expect(takeComplaintAction(ID)).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_marketplace_payment_complaint_take", { p_complaint_id: ID });
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/marketplace/payment-complaints");
    expect(mocks.revalidate).toHaveBeenCalledWith(`/admin/marketplace/payment-complaints/${ID}`);
  });
  it("refuses a malformed id without calling the database, and maps a refusal to a stable code", async () => {
    await expect(takeComplaintAction("nope")).resolves.toEqual({ ok: false, code: "not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "mp:not_permitted", code: "42501" } });
    await expect(takeComplaintAction(ID)).resolves.toEqual({ ok: false, code: "not_permitted" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("decideComplaintAction", () => {
  it("needs a real decision and a 3 to 500 character note before calling the database", async () => {
    await expect(decideComplaintAction(ID, "refund" as never, "a proper note")).resolves.toEqual({ ok: false, code: "invalid_payload" });
    await expect(decideComplaintAction(ID, "payment_valid", "  x ")).resolves.toEqual({ ok: false, code: "reason_required" });
    await expect(decideComplaintAction(ID, "payment_valid", "x".repeat(501))).resolves.toEqual({ ok: false, code: "reason_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("sends the trimmed note", async () => {
    await expect(decideComplaintAction(ID, "payment_not_received", "  no credit on the account  ")).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_marketplace_payment_complaint_decide",
      { p_complaint_id: ID, p_decision: "payment_not_received", p_note: "no credit on the account" });
  });
  it("reports a decision on a complaint another admin took", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "mp:invalid_transition", code: "23514" } });
    await expect(decideComplaintAction(ID, "dismissed", "not our concern")).resolves.toEqual({ ok: false, code: "invalid_transition" });
  });
});

describe("fileComplaintAction", () => {
  it("files with an optional note and returns the complaint id", async () => {
    await expect(fileComplaintAction(ID, "transfer_made", "")).resolves.toEqual({ ok: true, complaintId: "c1" });
    expect(mocks.rpc).toHaveBeenCalledWith("marketplace_payment_complaint_file", { p_order_id: ID, p_reason: "transfer_made", p_note: null });
  });
  it("requires a note for the reason 'other' and rejects a too-short note", async () => {
    await expect(fileComplaintAction(ID, "other", "")).resolves.toEqual({ ok: false, code: "reason_required" });
    await expect(fileComplaintAction(ID, "transfer_made", "ab")).resolves.toEqual({ ok: false, code: "invalid_payload" });
    await expect(fileComplaintAction(ID, "weird" as never, "")).resolves.toEqual({ ok: false, code: "invalid_payload" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("maps the database refusals", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "mp:complaint_exists", code: "23505" } });
    await expect(fileComplaintAction(ID, "transfer_made", "")).resolves.toEqual({ ok: false, code: "complaint_exists" });
  });
});
