import { describe, expect, it } from "vitest";

import {
  filterPreviewOpportunities,
  PREVIEW_OPPORTUNITIES,
  type PreviewFilters,
} from "./preview-data";

const defaults: Omit<PreviewFilters, "sort"> = {
  trades: new Set(),
  maxBudget: 10_000,
  duration: "all" as const,
  radiusKm: 50,
  savedOnly: false,
  savedIds: new Set<string>(),
};

describe("filterPreviewOpportunities", () => {
  it("shows the newest opportunities first by default", () => {
    const result = filterPreviewOpportunities(PREVIEW_OPPORTUNITIES, {
      ...defaults,
      sort: "newest",
    });

    expect(result.map((opportunity) => opportunity.postedHoursAgo)).toEqual(
      [...result].map((opportunity) => opportunity.postedHoursAgo).sort((a, b) => a - b),
    );
  });

  it("combines trade, budget, distance, duration, and saved filters", () => {
    const result = filterPreviewOpportunities(PREVIEW_OPPORTUNITIES, {
      ...defaults,
      trades: new Set(["spc"]),
      maxBudget: 5_000,
      radiusKm: 3,
      duration: "medium",
      savedOnly: true,
      savedIds: new Set(["spc-villa", "marble-bathroom"]),
      sort: "newest",
    });

    expect(result.map((opportunity) => opportunity.id)).toEqual(["spc-villa"]);
  });

  it("supports nearest, highest-budget, and highest-match sorting", () => {
    const nearest = filterPreviewOpportunities(PREVIEW_OPPORTUNITIES, { ...defaults, sort: "nearest" });
    const highestBudget = filterPreviewOpportunities(PREVIEW_OPPORTUNITIES, { ...defaults, sort: "highest" });
    const highestMatch = filterPreviewOpportunities(PREVIEW_OPPORTUNITIES, { ...defaults, sort: "demanded" });

    expect(nearest[0]?.distanceKm).toBe(Math.min(...PREVIEW_OPPORTUNITIES.map((item) => item.distanceKm)));
    expect(highestBudget[0]?.budget).toBe(Math.max(...PREVIEW_OPPORTUNITIES.map((item) => item.budget)));
    expect(highestMatch[0]?.matchPercent).toBe(Math.max(...PREVIEW_OPPORTUNITIES.map((item) => item.matchPercent)));
  });
});
