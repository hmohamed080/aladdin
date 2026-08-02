import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { applyAccountUpgrade, requestAccountUpgrade } from "./account-upgrade";

/**
 * These boundaries hold no authorization logic — that lives in the DB RPCs. The
 * tests only pin the contract: the correct RPC name + parameter shape is sent,
 * the returned id is surfaced, and RPC errors propagate (never swallowed).
 */
function mockClient(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("account-upgrade boundaries", () => {
  it("requestAccountUpgrade calls the RPC with the derived-user contract", async () => {
    const { client, rpc } = mockClient({ data: "verif-1", error: null });
    const id = await requestAccountUpgrade(client, "engineer");
    expect(rpc).toHaveBeenCalledWith("request_account_upgrade", {
      p_requested_account_type: "engineer",
    });
    expect(id).toBe("verif-1");
  });

  it("propagates RPC errors instead of swallowing them", async () => {
    const { client } = mockClient({ data: null, error: new Error("insufficient authority") });
    await expect(applyAccountUpgrade(client, "verif-1")).rejects.toThrow(
      "insufficient authority",
    );
  });

  it("applyAccountUpgrade sends only the verification id (no privileged fields)", async () => {
    const { client, rpc } = mockClient({ data: null, error: null });
    await applyAccountUpgrade(client, "verif-9");
    expect(rpc).toHaveBeenCalledWith("apply_account_upgrade", { p_verification_id: "verif-9" });
  });
});
