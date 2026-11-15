import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc }) }));

import { loadPublicFacets, resetFacetsMemoForTests } from "./marketplace-public";

const FACETS = { categories: [{ key: "floors", name_ar: "أرضيات", name_en: "Floors", count: "3", types: [] }], price: { min: "10", max: "90" }, filters: [] };

describe("public facets memo", () => {
  beforeEach(() => {
    rpc.mockReset();
    resetFacetsMemoForTests();
  });

  it("serves the same facets from memory instead of asking the database again", async () => {
    rpc.mockResolvedValue({ data: FACETS, error: null });
    const first = await loadPublicFacets("spc");
    const second = await loadPublicFacets("spc");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.categories[0]?.count).toBe(3);
  });

  it("keeps one entry per product type", async () => {
    rpc.mockResolvedValue({ data: FACETS, error: null });
    await loadPublicFacets("spc");
    await loadPublicFacets("paint");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("never remembers a failure or an empty answer", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    expect((await loadPublicFacets()).categories).toEqual([]);
    rpc.mockResolvedValueOnce({ data: FACETS, error: null });
    expect((await loadPublicFacets()).categories).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("expires after the short window", async () => {
    vi.useFakeTimers();
    try {
      rpc.mockResolvedValue({ data: FACETS, error: null });
      await loadPublicFacets();
      vi.advanceTimersByTime(61_000);
      await loadPublicFacets();
      expect(rpc).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
