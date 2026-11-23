import type { MarketplaceSellerStatus } from "@/server/queries/marketplace-seller";

/**
 * What a B2C seller page may show for the ACTIVE organization's seller status.
 *
 *   allow      — approved seller: the page renders.
 *   notice     — pending or suspended: the business was put through enablement,
 *                so it is told why it cannot sell rather than shown a 404.
 *   not-found  — never enabled, revoked, or the Marketplace preview is closed:
 *                the route does not exist for this organization.
 *
 * Pure so it can be tested without a request. The status itself is read per
 * request for the organization that is active NOW, so switching organization
 * re-evaluates it; and the database re-checks seller standing on every write.
 */
export type SellerPageAccess = "allow" | "notice" | "not-found";

export function sellerPageAccess(status: MarketplaceSellerStatus | null): SellerPageAccess {
  if (status === "approved") return "allow";
  if (status === "pending" || status === "suspended") return "notice";
  return "not-found";
}
