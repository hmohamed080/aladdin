import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  assignLead,
  createCustomer,
  createLead,
  completeFollowUp,
  transitionLead,
} from "./sales";

vi.mock("server-only", () => ({}));

/**
 * These boundaries hold no authorization logic — that lives in the sales RPCs
 * (ADR-0008). The tests pin the contract: the correct RPC name + parameter shape
 * is sent, returned ids/versions are validated, and RPC errors propagate.
 */
function mockClient(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("sales workflow boundaries", () => {
  it("createLead forwards only the provided fields and returns the new id", async () => {
    const leadId = "11111111-1111-4111-8111-111111111111";
    const { client, rpc } = mockClient({ data: leadId, error: null });
    const id = await createLead(client, {
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Bathroom finishing",
      branchId: "c1111111-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(rpc).toHaveBeenCalledWith("create_lead", {
      p_org_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      p_title: "Bathroom finishing",
      p_branch_id: "c1111111-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(id).toBe(leadId);
  });

  it("createCustomer rejects a malformed identifier returned by the RPC", async () => {
    const { client } = mockClient({ data: "not-a-uuid", error: null });
    await expect(
      createCustomer(client, { orgId: "org", displayName: "X" }),
    ).rejects.toThrow("create_customer returned an invalid identifier");
  });

  it("transitionLead returns the new version and sends the expected version", async () => {
    const { client, rpc } = mockClient({ data: 3, error: null });
    const version = await transitionLead(client, "lead-1", 2, { stage: "contacted" });
    expect(rpc).toHaveBeenCalledWith("transition_lead", {
      p_lead_id: "lead-1",
      p_expected_version: 2,
      p_new_stage: "contacted",
    });
    expect(version).toBe(3);
  });

  it("assignLead rejects a non-numeric version from the RPC", async () => {
    const { client } = mockClient({ data: "oops", error: null });
    await expect(assignLead(client, "lead-1", "mem-1", 1)).rejects.toThrow(
      "assign_lead returned an invalid version",
    );
  });

  it("propagates RPC errors instead of swallowing them", async () => {
    const { client } = mockClient({ data: null, error: new Error("sales.write required") });
    await expect(completeFollowUp(client, "fu-1")).rejects.toThrow("sales.write required");
  });
});
