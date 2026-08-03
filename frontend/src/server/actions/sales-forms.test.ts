import { describe, expect, it, vi, beforeEach } from "vitest";

// --- Mocks: keep the action logic, stub the boundaries it calls. ------------
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({})) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/server/actions/sales", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  createLead: vi.fn(),
  transitionLead: vi.fn(),
  assignLead: vi.fn(),
  addSalesActivity: vi.fn(),
  createFollowUp: vi.fn(),
  completeFollowUp: vi.fn(),
  reopenFollowUp: vi.fn(),
  cancelFollowUp: vi.fn(),
  reassignFollowUp: vi.fn(),
}));

import * as sales from "@/server/actions/sales";
import {
  createCustomerAction,
  createLeadAction,
  transitionLeadAction,
  assignLeadAction,
} from "./sales-forms";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD = "1ead0001-0000-4000-8000-000000000001";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe("createCustomerAction", () => {
  it("returns a field error when the name is missing (no RPC call)", async () => {
    const res = await createCustomerAction({ ok: false }, fd({ orgId: ORG }));
    expect(res.fieldErrors?.displayName).toBe("validation.nameLength");
    expect(sales.createCustomer).not.toHaveBeenCalled();
  });

  it("maps a duplicate-phone RPC error to the localized key", async () => {
    vi.mocked(sales.createCustomer).mockRejectedValueOnce({ code: "23505" });
    const res = await createCustomerAction({ ok: false }, fd({ orgId: ORG, displayName: "X" }));
    expect(res.code).toBe("states.duplicatePhone");
  });

  it("redirects to the new customer on success", async () => {
    vi.mocked(sales.createCustomer).mockResolvedValueOnce("d0000001-0000-4000-8000-000000000001");
    await expect(
      createCustomerAction({ ok: false }, fd({ orgId: ORG, displayName: "New Co", branchId: "c1" })),
    ).rejects.toThrow(/REDIRECT:\/b2b\/customers\//);
    expect(sales.createCustomer).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ orgId: ORG, displayName: "New Co", branchId: "c1" }),
    );
  });
});

describe("createLeadAction", () => {
  it("requires a title", async () => {
    const res = await createLeadAction({ ok: false }, fd({ orgId: ORG }));
    expect(res.fieldErrors?.title).toBe("validation.titleLength");
  });

  it("maps a branch-scope denial", async () => {
    vi.mocked(sales.createLead).mockRejectedValueOnce({ message: "branch not in caller scope" });
    const res = await createLeadAction({ ok: false }, fd({ orgId: ORG, title: "T", branchId: "cX" }));
    expect(res.code).toBe("states.branchDenied");
  });
});

describe("transitionLeadAction", () => {
  it("requires a reason when marking lost", async () => {
    const res = await transitionLeadAction(
      { ok: false },
      fd({ leadId: LEAD, version: "2", status: "lost" }),
    );
    expect(res.fieldErrors?.lostReason).toBe("leads.lostReasonRequired");
    expect(sales.transitionLead).not.toHaveBeenCalled();
  });

  it("surfaces a stale-version conflict", async () => {
    vi.mocked(sales.transitionLead).mockRejectedValueOnce({ code: "40001" });
    const res = await transitionLeadAction(
      { ok: false },
      fd({ leadId: LEAD, version: "1", stage: "qualified" }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("leads.conflict");
  });

  it("reports success with the right message when won", async () => {
    vi.mocked(sales.transitionLead).mockResolvedValueOnce(3);
    const res = await transitionLeadAction(
      { ok: false },
      fd({ leadId: LEAD, version: "2", status: "won" }),
    );
    expect(res.ok).toBe(true);
    expect(res.code).toBe("leads.won");
    expect(sales.transitionLead).toHaveBeenCalledWith({}, LEAD, 2, expect.objectContaining({ status: "won" }));
  });
});

describe("assignLeadAction", () => {
  it("maps an unauthorized assignment", async () => {
    vi.mocked(sales.assignLead).mockRejectedValueOnce({ message: "sales.assign required" });
    const res = await assignLeadAction(
      { ok: false },
      fd({ leadId: LEAD, version: "2", assigneeMembershipId: "mem" }),
    );
    expect(res.code).toBe("states.assignDenied");
  });
});
