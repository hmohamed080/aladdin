import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc }) }));

const { submitCraftsmanVerificationIfComplete } = await import("./craftsman-verification");

describe("submitCraftsmanVerificationIfComplete", () => {
  beforeEach(() => rpc.mockReset());

  it.each(["submitted", "resubmitted", "resubmitted_after_rejection", "already_open", "approved", "rejected", "incomplete"])(
    "returns the database's %s outcome",
    async (state) => {
      rpc.mockResolvedValueOnce({ data: { state, percent: 100, verification_id: null }, error: null });
      expect(await submitCraftsmanVerificationIfComplete()).toBe(state);
    },
  );

  it("passes afterRejection only when asked: the automatic path never resubmits a rejection", async () => {
    rpc.mockResolvedValue({ data: { state: "rejected" }, error: null });
    await submitCraftsmanVerificationIfComplete();
    expect(rpc).toHaveBeenLastCalledWith("craftsman_profile_verification_submit", { p_after_rejection: false });
    await submitCraftsmanVerificationIfComplete(true);
    expect(rpc).toHaveBeenLastCalledWith("craftsman_profile_verification_submit", { p_after_rejection: true });
  });

  it("reports failed, never a silent success, for an error, an unknown state, a non-object or a thrown failure", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await submitCraftsmanVerificationIfComplete()).toBe("failed");
    rpc.mockResolvedValueOnce({ data: { state: "whatever" }, error: null });
    expect(await submitCraftsmanVerificationIfComplete()).toBe("failed");
    rpc.mockResolvedValueOnce({ data: "x", error: null });
    expect(await submitCraftsmanVerificationIfComplete()).toBe("failed");
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await submitCraftsmanVerificationIfComplete()).toBe("failed");
  });

  it("returns null only for a caller who is not a Craftsman (42501)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "only a craftsman profile can request verification here" } });
    expect(await submitCraftsmanVerificationIfComplete()).toBeNull();
  });
});
