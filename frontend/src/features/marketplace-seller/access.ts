import type { MarketplaceSellerStatus } from "@/server/queries/marketplace-seller";

/**
 * What a B2C seller page may show for the ACTIVE organization's seller status.
 *
 *   allow      — approved seller: the page renders.
 *   notice     — pending, suspended, rejected or revoked: the business was put
 *                through enablement, so it is told where it stands rather than
 *                shown a 404 (rejected and revoked are reversible: the owner can
 *                ask again after a rejection, an admin can approve again).
 *   not-found  — never enabled, or the Marketplace preview is closed: the route
 *                does not exist for this organization.
 *
 * Pure so it can be tested without a request. The status itself is read per
 * request for the organization that is active NOW, so switching organization
 * re-evaluates it; and the database re-checks seller standing on every write.
 */
export type SellerPageAccess = "allow" | "notice" | "not-found";

export function sellerPageAccess(status: MarketplaceSellerStatus | null): SellerPageAccess {
  if (status === "approved") return "allow";
  if (status === "pending" || status === "suspended" || status === "rejected" || status === "revoked") return "notice";
  return "not-found";
}
