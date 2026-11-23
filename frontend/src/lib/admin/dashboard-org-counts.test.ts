import { describe, it, expect } from "vitest";
import { dashboardOrgCards } from "./dashboard-org-counts";

describe("dashboardOrgCards", () => {
  it("equals the Organizations directory's own tab counts (Approved is the Verified tab)", () => {
    expect(dashboardOrgCards({ ok: true, data: { counts: { all: 9, pending: 3, verified: 4, suspended: 1, rejected: 2 } } })).toEqual({
      all: 9,
      pending: 3,
      approved: 4,
      rejected: 2,
      suspended: 1,
    });
  });

  it("keeps real zeros as zeros", () => {
    const cards = dashboardOrgCards({ ok: true, data: { counts: { all: 0, pending: 0, verified: 0, suspended: 0, rejected: 0 } } });
    expect(Object.values(cards)).toEqual([0, 0, 0, 0, 0]);
  });

  it("shows a dash on every card when the directory read fails (never a misleading zero)", () => {
    expect(dashboardOrgCards({ ok: false })).toEqual({ all: "—", pending: "—", approved: "—", rejected: "—", suspended: "—" });
  });
});
