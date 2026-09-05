import { describe, expect, it } from "vitest";
import { summarizeNetwork } from "./summary";
import type { NetworkOrganization } from "@/server/queries/network";

/**
 * The one derivation the Network summary strip and the profile hub module both
 * read from (§5 of the increment brief). Both surfaces show the same array in
 * two shapes, so a bug here is a product that contradicts itself about how
 * many organizations a professional has actually worked for.
 */
function org(over: Partial<NetworkOrganization> = {}): NetworkOrganization {
  return {
    orgId: "org-1",
    orgName: "Horizon Contracting",
    completedCount: 1,
    firstCompletedAt: "2026-06-01T00:00:00Z",
    lastCompletedAt: "2026-06-01T00:00:00Z",
    tradeKeys: ["marble_granite"],
    latestJobTitle: "Marble foyer restoration",
    latestAssignmentId: "assignment-1",
    reviewCount: 0,
    ...over,
  };
}

describe("summarizeNetwork", () => {
  it("returns all zeros and a null latest for an empty network", () => {
    const s = summarizeNetwork([]);
    expect(s).toEqual({
      organizationCount: 0,
      completedTotal: 0,
      repeatCount: 0,
      tradeCount: 0,
      latestRelationshipAt: null,
    });
  });

  it("counts one organization as one, whatever its completed count", () => {
    const s = summarizeNetwork([org({ completedCount: 5 })]);
    expect(s.organizationCount).toBe(1);
    expect(s.completedTotal).toBe(5);
  });

  it("sums completed assignments ACROSS organizations, not per-organization", () => {
    const s = summarizeNetwork([
      org({ orgId: "a", completedCount: 2 }),
      org({ orgId: "b", completedCount: 1 }),
    ]);
    expect(s.organizationCount).toBe(2);
    expect(s.completedTotal).toBe(3);
  });

  it("counts a repeat organization only at two or more completions", () => {
    const s = summarizeNetwork([
      org({ orgId: "a", completedCount: 1 }),
      org({ orgId: "b", completedCount: 2 }),
      org({ orgId: "c", completedCount: 7 }),
    ]);
    expect(s.repeatCount).toBe(2);
  });

  it("de-duplicates trades across organizations", () => {
    const s = summarizeNetwork([
      org({ orgId: "a", tradeKeys: ["marble_granite", "tiling"] }),
      org({ orgId: "b", tradeKeys: ["tiling", "electrical"] }),
    ]);
    expect(s.tradeCount).toBe(3);
  });

  it("takes the most recent completed work as the latest relationship", () => {
    const s = summarizeNetwork([
      org({ orgId: "a", lastCompletedAt: "2026-05-01T00:00:00Z" }),
      org({ orgId: "b", lastCompletedAt: "2026-08-01T00:00:00Z" }),
    ]);
    expect(s.latestRelationshipAt).toBe("2026-08-01T00:00:00Z");
  });

  it("is a pure function of its input — the same array always gives the same answer", () => {
    const rows = [org({ orgId: "a" }), org({ orgId: "b", completedCount: 2 })];
    expect(summarizeNetwork(rows)).toEqual(summarizeNetwork(rows));
  });
});
