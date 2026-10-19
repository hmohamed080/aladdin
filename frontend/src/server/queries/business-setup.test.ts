import type { SupabaseClient } from "@supabase/supabase-js";
import { claimsFrom } from "@/test/session-claims";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const mocks = vi.hoisted(() => ({
  loadWorkspaces: vi.fn(),
  loadIsAdminStaff: vi.fn(),
}));
vi.mock("@/server/queries/workspace", () => ({ loadWorkspaces: mocks.loadWorkspaces }));
vi.mock("@/server/queries/platform", () => ({ loadIsAdminStaff: mocks.loadIsAdminStaff }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({}) }));

import { computeMandatoryBusinessSetup } from "./business-setup";

type Facts = {
  user?: { id: string } | null;
  progress?: { selected_track: string | null; selected_org_type: string | null } | null;
  completedDrafts?: number;
};

/** A client that records which tables were read, so the cheap path can be proven cheap. */
function client({ user = { id: "u1" }, progress = null, completedDrafts = 0 }: Facts = {}) {
  const reads: string[] = [];
  const supabase = {
    auth: { getUser: async () => ({ data: { user } }), getClaims: claimsFrom(async () => ({ data: { user } })) },
    from: (table: string) => {
      reads.push(table);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        not: async () => ({ count: completedDrafts, error: null }),
        maybeSingle: async () => ({ data: progress, error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { supabase, reads };
}

const personal = { kind: "personal", name: "P", persona: "engineer" };
const business = { kind: "business", organizationId: "o1", name: "Nile", orgType: "showroom_dealer", relationship: "owner" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadWorkspaces.mockResolvedValue({ entries: [], context: null });
  mocks.loadIsAdminStaff.mockResolvedValue(false);
});

describe("computeMandatoryBusinessSetup", () => {
  it("a verified Showroom registrant with no organization: the first business is required, as showroom_dealer", async () => {
    const { supabase } = client({ progress: { selected_track: "business", selected_org_type: "showroom_dealer" } });
    await expect(computeMandatoryBusinessSetup(supabase)).resolves.toEqual({ required: true, orgType: "showroom_dealer" });
  });

  it.each(["supplier", "manufacturer", "importer"])("the same for %s, carrying that type through", async (orgType) => {
    const { supabase } = client({ progress: { selected_track: "business", selected_org_type: orgType } });
    await expect(computeMandatoryBusinessSetup(supabase)).resolves.toEqual({ required: true, orgType });
  });

  it("is re-derived from the database each time, so interruption loses nothing (sign out, sign in: still required)", async () => {
    const progress = { selected_track: "business", selected_org_type: "importer" };
    const first = await computeMandatoryBusinessSetup(client({ progress }).supabase);
    const afterSignIn = await computeMandatoryBusinessSetup(client({ progress }).supabase);
    expect(first).toEqual(afterSignIn);
    expect(afterSignIn.required).toBe(true);
  });

  it("not required after the first organization exists (the owner membership is there)", async () => {
    mocks.loadWorkspaces.mockResolvedValue({ entries: [business], context: null });
    const { supabase } = client({ progress: { selected_track: "business", selected_org_type: "showroom_dealer" } });
    await expect(computeMandatoryBusinessSetup(supabase)).resolves.toEqual({ required: false, orgType: null });
  });

  it("not required for someone who completed a business before and no longer has the membership", async () => {
    const { supabase } = client({ progress: { selected_track: "business", selected_org_type: "supplier" }, completedDrafts: 1 });
    await expect(computeMandatoryBusinessSetup(supabase)).resolves.toEqual({ required: false, orgType: null });
  });

  it("not required for someone who also holds a personal persona (Engineer + business coexistence is unchanged)", async () => {
    mocks.loadWorkspaces.mockResolvedValue({ entries: [personal], context: null });
    const { supabase } = client({ progress: { selected_track: "business", selected_org_type: "showroom_dealer" } });
    await expect(computeMandatoryBusinessSetup(supabase)).resolves.toEqual({ required: false, orgType: null });
  });

  it("not required for platform staff", async () => {
    mocks.loadIsAdminStaff.mockResolvedValue(true);
    const { supabase } = client({ progress: { selected_track: "business", selected_org_type: "showroom_dealer" } });
    await expect(computeMandatoryBusinessSetup(supabase)).resolves.toEqual({ required: false, orgType: null });
  });

  it("an installer, a salesperson, a consumer and an engineer (professional/consumer tracks) are not gated, and cost ONE read", async () => {
    for (const track of ["professional", "consumer"]) {
      const { supabase, reads } = client({ progress: { selected_track: track, selected_org_type: null } });
      await expect(computeMandatoryBusinessSetup(supabase)).resolves.toEqual({ required: false, orgType: null });
      expect(reads).toEqual(["onboarding_progress"]);
    }
    expect(mocks.loadWorkspaces).not.toHaveBeenCalled();
  });

  it("an invited employee (no onboarding progress row) is not gated", async () => {
    const { supabase, reads } = client({ progress: null });
    await expect(computeMandatoryBusinessSetup(supabase)).resolves.toEqual({ required: false, orgType: null });
    expect(reads).toEqual(["onboarding_progress"]);
  });

  it("a legacy wholesaler intent (no longer an approved type) is not gated", async () => {
    const { supabase } = client({ progress: { selected_track: "business", selected_org_type: "wholesaler" } });
    await expect(computeMandatoryBusinessSetup(supabase)).resolves.toEqual({ required: false, orgType: null });
  });

  it("no session: nothing is required and nothing is read", async () => {
    const { supabase, reads } = client({ user: null });
    await expect(computeMandatoryBusinessSetup(supabase)).resolves.toEqual({ required: false, orgType: null });
    expect(reads).toEqual([]);
  });
});
