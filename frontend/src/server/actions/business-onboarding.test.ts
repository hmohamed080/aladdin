import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allowed: false,
  rpc: vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: { code: string } | null }>>(
    async () => ({ data: "draft-1", error: null }),
  ),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: state.rpc }) }));
vi.mock("@/server/queries/business-creation-access", () => ({
  loadBusinessCreationAccess: async () => ({ allowed: state.allowed, data: null }),
}));

import { saveBusiness, submitBusiness } from "./business-onboarding";

describe("business draft writers — the same entitlement as the page", () => {
  beforeEach(() => {
    state.rpc.mockClear();
    state.allowed = false;
  });

  it("refuses to save a draft for a caller who may not create a business, and never reaches the database", async () => {
    const res = await saveBusiness({ displayName: "X" });
    expect(res).toEqual({ ok: false, code: "onboarding.error.businessNotAllowed" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses to submit for a caller who may not create a business", async () => {
    const res = await submitBusiness({ displayName: "X" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("onboarding.error.businessNotAllowed");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("saves for an entitled / mid-registration caller", async () => {
    state.allowed = true;
    const res = await saveBusiness({ displayName: "X" });
    expect(res).toEqual({ ok: true, draftId: "draft-1" });
    expect(state.rpc).toHaveBeenCalledWith("business_draft_save", expect.any(Object));
  });

  it("surfaces a database refusal (42501) as the same not-allowed code, not a generic save failure", async () => {
    state.allowed = true; // the application gate passed; the database is the final authority
    state.rpc.mockImplementationOnce(async () => ({ data: null, error: { code: "42501" } }));
    expect(await saveBusiness({ displayName: "X" })).toEqual({ ok: false, code: "onboarding.error.businessNotAllowed" });
  });

  it("keeps other database failures as a generic save failure", async () => {
    state.allowed = true;
    state.rpc.mockImplementationOnce(async () => ({ data: null, error: { code: "22023" } }));
    expect(await saveBusiness({ displayName: "X" })).toEqual({ ok: false, code: "onboarding.error.saveFailed" });
  });
});
