import { describe, expect, it } from "vitest";
import { availableKpiCards, DASHBOARD_KPI_CATALOG, SYSTEM_DEFAULT_KPI_ORDER } from "./dashboard-kpi-catalog";

describe("dashboard-kpi-catalog", () => {
  it("the system default lists every catalog key exactly once, in catalog order", () => {
    expect(SYSTEM_DEFAULT_KPI_ORDER).toEqual(DASHBOARD_KPI_CATALOG.map((c) => c.key));
    expect(new Set(SYSTEM_DEFAULT_KPI_ORDER).size).toBe(SYSTEM_DEFAULT_KPI_ORDER.length);
  });

  it("a caller with neither stance sees no cards at all", () => {
    expect(availableKpiCards({ buys: false, sells: false })).toHaveLength(0);
  });

  it("a seller-only caller (no buys) never sees a buys-gated card", () => {
    const cards = availableKpiCards({ buys: false, sells: true });
    expect(cards.map((c) => c.key)).toEqual(["overdue_followups", "due_today"]);
  });

  it("a buyer-only caller (no sells) never sees a sells-gated card", () => {
    const cards = availableKpiCards({ buys: true, sells: false });
    expect(cards.some((c) => c.key === "overdue_followups" || c.key === "due_today")).toBe(false);
    expect(cards).toHaveLength(6);
  });

  it("a caller with both stances sees the full eight-card catalog", () => {
    expect(availableKpiCards({ buys: true, sells: true })).toHaveLength(8);
  });
});
