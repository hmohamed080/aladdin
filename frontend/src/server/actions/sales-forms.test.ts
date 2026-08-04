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
  updateLeadDetails: vi.fn(),
  transitionLead: vi.fn(),
  assignLead: vi.fn(),
  addSalesActivity: vi.fn(),
  createFollowUp: vi.fn(),
  updateFollowUp: vi.fn(),
  completeFollowUp: vi.fn(),
  reopenFollowUp: vi.fn(),
  cancelFollowUp: vi.fn(),
  reassignFollowUp: vi.fn(),
}));

import * as sales from "@/server/actions/sales";
import {
  createCustomerAction,
  updateCustomerAction,
  createLeadAction,
  updateLeadDetailsAction,
  updateFollowUpAction,
  transitionLeadAction,
  assignLeadAction,
} from "./sales-forms";

const CUST = "d0000001-0000-4000-8000-000000000001";

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

  it("creates ONLY the lead — never a swallowed best-effort intent activity", async () => {
    vi.mocked(sales.createLead).mockResolvedValueOnce("1ead0002-0000-4000-8000-000000000002");
    await expect(
      // Even if the form carried an `intent`, it must not trigger a separate
      // write whose failure could be silently discarded.
      createLeadAction({ ok: false }, fd({ orgId: ORG, title: "T", intent: "wants tiles" })),
    ).rejects.toThrow(/REDIRECT:\/b2b\/leads\//);
    expect(sales.addSalesActivity).not.toHaveBeenCalled();
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

describe("updateCustomerAction (trusted update_customer RPC)", () => {
  it("requires a display name", async () => {
    const res = await updateCustomerAction({ ok: false }, fd({ customerId: CUST }));
    expect(res.fieldErrors?.displayName).toBe("validation.nameLength");
    expect(sales.updateCustomer).not.toHaveBeenCalled();
  });

  it("maps an invalid/duplicate phone to a localized key", async () => {
    vi.mocked(sales.updateCustomer).mockRejectedValueOnce({ code: "23505" });
    const res = await updateCustomerAction({ ok: false }, fd({ customerId: CUST, displayName: "X", primaryPhone: "01000000000" }));
    expect(res.code).toBe("states.duplicatePhone");
  });

  it("redirects to the detail on success and never sends type/branch/assignee", async () => {
    vi.mocked(sales.updateCustomer).mockResolvedValueOnce(undefined);
    await expect(
      updateCustomerAction({ ok: false }, fd({ customerId: CUST, displayName: "New Name", email: "a@b.co" })),
    ).rejects.toThrow(`REDIRECT:/b2b/customers/${CUST}?updated=1`);
    const patch = vi.mocked(sales.updateCustomer).mock.calls[0]![2];
    expect(patch).toMatchObject({ displayName: "New Name", email: "a@b.co" });
    expect(patch).not.toHaveProperty("branchId");
    expect(patch).not.toHaveProperty("assignedMembershipId");
    expect(patch).not.toHaveProperty("customerType");
  });
});

describe("updateLeadDetailsAction (optimistic version; lifecycle stays separate)", () => {
  it("requires a title", async () => {
    const res = await updateLeadDetailsAction({ ok: false }, fd({ leadId: LEAD, version: "3" }));
    expect(res.fieldErrors?.title).toBe("validation.titleLength");
    expect(sales.updateLeadDetails).not.toHaveBeenCalled();
  });

  it("forwards the expected version and only edits title/priority", async () => {
    vi.mocked(sales.updateLeadDetails).mockResolvedValueOnce(4);
    await expect(
      updateLeadDetailsAction({ ok: false }, fd({ leadId: LEAD, version: "3", title: "T2", priority: "high" })),
    ).rejects.toThrow(`REDIRECT:/b2b/leads/${LEAD}?updated=1`);
    expect(sales.updateLeadDetails).toHaveBeenCalledWith({}, LEAD, 3, { title: "T2", priority: "high" });
  });

  it("surfaces a stale-version conflict as leads.conflict", async () => {
    vi.mocked(sales.updateLeadDetails).mockRejectedValueOnce({ message: "lead was modified concurrently (expected version 3, found 4)" });
    const res = await updateLeadDetailsAction({ ok: false }, fd({ leadId: LEAD, version: "3", title: "T2" }));
    expect(res.code).toBe("leads.conflict");
  });
});

describe("updateFollowUpAction (open-only guard)", () => {
  it("requires a title", async () => {
    const res = await updateFollowUpAction({ ok: false }, fd({ followUpId: "f1" }));
    expect(res.fieldErrors?.title).toBe("validation.titleLength");
  });

  it("maps a non-open follow-up to states.followUpNotOpen", async () => {
    vi.mocked(sales.updateFollowUp).mockRejectedValueOnce({ code: "22023", message: "only an open follow-up can be edited" });
    const res = await updateFollowUpAction({ ok: false }, fd({ followUpId: "f1", title: "T" }));
    expect(res.code).toBe("states.followUpNotOpen");
  });

  it("redirects on success", async () => {
    vi.mocked(sales.updateFollowUp).mockResolvedValueOnce(undefined);
    await expect(
      updateFollowUpAction({ ok: false }, fd({ followUpId: "f1", title: "T", priority: "low" })),
    ).rejects.toThrow("REDIRECT:/b2b/follow-ups?updated=1");
  });
});
