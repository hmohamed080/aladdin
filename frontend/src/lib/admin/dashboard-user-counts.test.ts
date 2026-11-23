import { describe, it, expect } from "vitest";
import { dashboardUserCards } from "./dashboard-user-counts";

describe("dashboardUserCards", () => {
  it("uses the directory tab counts, so each card equals the tab it links to", () => {
    expect(dashboardUserCards({ ok: true, data: { counts: { pending: 28, verified: 1, rejected: 1 } } })).toEqual({ pending: 28, verified: 1, rejected: 1 });
  });
  it("shows a dash on every card when the directory read fails (never zero)", () => {
    expect(dashboardUserCards({ ok: false })).toEqual({ pending: "—", verified: "—", rejected: "—" });
  });
});
