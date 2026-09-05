import type { NetworkOrganization } from "@/server/queries/network";

/**
 * The ONE derivation of the Network summary (§5 of the increment brief).
 *
 * Pure, and deliberately taking the SAME array the list renders rather than a
 * second query — the `summarizeReviews` precedent. Every value here is a real
 * count off `NetworkOrganization[]`; nothing is invented, scored or estimated.
 */
export type NetworkSummary = {
  /** Distinct organizations with at least one completed assignment. */
  organizationCount: number;
  /** Every completed assignment, across every organization. */
  completedTotal: number;
  /** Organizations with two or more completed assignments. */
  repeatCount: number;
  /** Distinct trades worked, across the whole network. */
  tradeCount: number;
  /** The most recent completed work of all — null when the network is empty. */
  latestRelationshipAt: string | null;
};

export function summarizeNetwork(organizations: readonly NetworkOrganization[]): NetworkSummary {
  const trades = new Set<string>();
  let completedTotal = 0;
  let repeatCount = 0;
  let latestRelationshipAt: string | null = null;

  for (const org of organizations) {
    completedTotal += org.completedCount;
    if (org.completedCount >= 2) repeatCount += 1;
    for (const key of org.tradeKeys) trades.add(key);
    if (!latestRelationshipAt || org.lastCompletedAt > latestRelationshipAt) {
      latestRelationshipAt = org.lastCompletedAt;
    }
  }

  return {
    organizationCount: organizations.length,
    completedTotal,
    repeatCount,
    tradeCount: trades.size,
    latestRelationshipAt,
  };
}
