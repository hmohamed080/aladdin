import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: mocks.rpc }) }));

import { reviewVideoAction } from "./marketplace-video-review";

const ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe("reviewVideoAction", () => {
  it("approves under the caller's own session and refreshes the queue", async () => {
    await expect(reviewVideoAction(ID, "approve")).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_marketplace_video_review",
      { p_video_id: ID, p_decision: "approve", p_reason: null, p_message_ar: null, p_message_en: null });
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/marketplace/videos");
  });

  it("needs the internal reason and both messages to reject, without calling the database", async () => {
    await expect(reviewVideoAction(ID, "reject", { messageAr: "م", messageEn: "m" })).resolves.toEqual({ ok: false, code: "reason_required" });
    await expect(reviewVideoAction(ID, "reject", { reason: "blurry", messageEn: "m" })).resolves.toEqual({ ok: false, code: "message_required" });
    await expect(reviewVideoAction(ID, "reject", { reason: "blurry", messageAr: "م" })).resolves.toEqual({ ok: false, code: "message_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends a rejection with trimmed texts", async () => {
    await reviewVideoAction(ID, "reject", { reason: " blurry ", messageAr: " م ", messageEn: " m " });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_marketplace_video_review",
      { p_video_id: ID, p_decision: "reject", p_reason: "blurry", p_message_ar: "م", p_message_en: "m" });
  });

  it("refuses a malformed id or decision", async () => {
    await expect(reviewVideoAction("nope", "approve")).resolves.toEqual({ ok: false, code: "decision_invalid" });
    await expect(reviewVideoAction(ID, "maybe" as never)).resolves.toEqual({ ok: false, code: "decision_invalid" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps the database refusals to stable codes", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "mp:video_not_ready", code: "22023" } });
    await expect(reviewVideoAction(ID, "approve")).resolves.toEqual({ ok: false, code: "video_not_ready" });
    mocks.rpc.mockResolvedValueOnce({ error: { message: "permission denied", code: "42501" } });
    await expect(reviewVideoAction(ID, "approve")).resolves.toEqual({ ok: false, code: "not_permitted" });
    mocks.rpc.mockResolvedValueOnce({ error: { message: "boom", code: "XX000" } });
    await expect(reviewVideoAction(ID, "approve")).resolves.toEqual({ ok: false, code: "unexpected" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
