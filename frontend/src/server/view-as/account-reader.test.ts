import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
const client = { rpc, from: vi.fn(), auth: { getUser: vi.fn() }, storage: {} };
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => client }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/server/queries/job-opportunities", () => ({ listJobOpportunities: vi.fn(async () => []) }));
vi.mock("@/server/queries/profile-identity", () => ({ loadMyIdentity: vi.fn(async () => ({ avatarUrl: "https://signed.example/a.png" })) }));
vi.mock("@/server/queries/personal-home", () => ({
  loadPersonalHome: vi.fn(async () => ({ displayName: "Owner", professional: { governorate: "cairo", city: "new-cairo" } })),
}));

import { selfReader, viewAsReader, type AccountReader } from "./account-reader";

const ID = "70000009-0000-4000-8000-000000000009";
const MEDIA = "80000000-0000-4000-8000-000000000001";

beforeEach(() => rpc.mockReset());

describe("AccountReader", () => {
  it("selfReader is an adapter over the existing loaders (identity, signed avatar, location, search jobs)", async () => {
    const shell = await selfReader("en").shell();
    expect(shell.displayName).toBe("Owner");
    expect(shell.avatarUrl).toBe("https://signed.example/a.png");
    expect(shell.location).toBeTruthy();
    expect(shell.searchJobs).toEqual([]);
  });

  it("viewAsReader reads the shell ONLY through admin_view_craftsman_profile and serves the avatar through the view media door", async () => {
    rpc.mockResolvedValue({
      data: { display_name: "Ahmed", avatar_id: MEDIA, service_areas: [{ governorate: "cairo", city: "new-cairo", is_primary: true }] },
      error: null,
    });
    const shell = await viewAsReader(ID, "en").shell();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_view_craftsman_profile", { p_subject: ID });
    expect(shell.displayName).toBe("Ahmed");
    expect(shell.avatarUrl).toBe(`/admin/users/${ID}/view/media/avatar/${MEDIA}`);
    expect(shell.avatarUrl).not.toMatch(/https?:|storage|r2/i);
    expect(shell.location).toBeTruthy();
    expect(shell.searchJobs).toEqual([]);
  });

  it("viewAsReader sends a refused read back to the user's admin page and fails closed on any other error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    await expect(viewAsReader(ID, "en").shell()).rejects.toThrow(`redirect:/admin/users/${ID}`);
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "x" } });
    await expect(viewAsReader(ID, "en").shell()).rejects.toThrow("view-as read failed");
  });

  it("drift guard: both implementations expose exactly the interface's loaders, and an incomplete reader does not compile", () => {
    const keys = (r: AccountReader) => Object.keys(r).sort();
    expect(keys(viewAsReader(ID, "en"))).toEqual(keys(selfReader("en")));
    // @ts-expect-error a reader missing a loader of the interface is a compile error
    const incomplete: AccountReader = {};
    expect(incomplete).toBeDefined();
  });
});
