import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), supabase: { marker: "supabase" } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => mocks.supabase }));
vi.mock("@/server/queries/job-opportunities", () => ({ listDashboardOpportunities: mocks.list }));

import { loadDashboardOpportunitiesAction } from "./dashboard-opportunities";

const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `op-${n}`, title: `Opportunity ${n}`, poster_org_name: "Horizon", trade_key: "tiling", governorate: "Cairo", city: "Maadi",
  offered_amount: 4500, expected_duration_days: 3, published_at: "2026-09-01T00:00:00Z", has_applied: false, is_saved: false,
  overall_percent: 90, trade_points: 50, specialty_points: 20, location_points: 10, availability_points: 10,
  trade_reason: "trade_matches", specialty_reason: "no_specialty_required", location_reason: "primary_governorate", availability_reason: "available_no_dates",
  ...over,
});

beforeEach(() => {
  mocks.list.mockReset();
});

describe("loadDashboardOpportunitiesAction", () => {
  it.each([
    ["match", "newest", "best"], // Best match = trade + specialty only
    ["distance", "newest", "nearest"],
    ["distance", "oldest", "nearest"],
    ["recent", "newest", "newest"],
    ["recent", "oldest", "oldest"],
  ])("maps the quick filter (%s, %s) to the database ordering %s — three cards, from the caller's session", async (sort, dateOrder, mode) => {
    mocks.list.mockResolvedValue([row(1), row(2), row(3)]);
    const result = await loadDashboardOpportunitiesAction(sort, dateOrder);
    expect(mocks.list).toHaveBeenCalledWith(mocks.supabase, mode, 3);
    expect(result.ok && result.opportunities.map((o) => o.id)).toEqual(["op-1", "op-2", "op-3"]);
  });

  it("carries the database's canonical Overall Match (and the saved flag) onto each card, and the real link into the opening", async () => {
    mocks.list.mockResolvedValue([row(1, { overall_percent: 0, trade_points: 0, specialty_points: 0, location_points: 0, availability_points: 0 }), row(2, { overall_percent: 100, is_saved: true })]);
    const result = await loadDashboardOpportunitiesAction("match", "newest");
    expect(result.ok && result.opportunities.map((o) => [o.matchPercent, o.match?.tradeReason, o.isSaved, o.href])).toEqual([
      [0, "trade_matches", false, "/home/jobs/op-1"],
      [100, "trade_matches", true, "/home/jobs/op-2"],
    ]);
  });

  it("refuses an ordering it does not know — the browser cannot name a column, a direction or a count", async () => {
    for (const [sort, dateOrder] of [["price", "newest"], ["match; drop table jobs", "newest"], ["match", "sideways"], ["", ""]]) {
      expect(await loadDashboardOpportunitiesAction(sort!, dateOrder!)).toEqual({ ok: false });
    }
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("reports a failed read as a failure — never as an empty strip", async () => {
    mocks.list.mockImplementation(async () => { throw new Error("boom"); });
    expect(await loadDashboardOpportunitiesAction("match", "newest")).toEqual({ ok: false });
  });
});
