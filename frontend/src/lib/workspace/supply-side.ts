/**
 * COMMERCE STANCE — which end of the value chain an organization works from.
 *
 * The RFQ → quote → order chain has exactly two seats, and every commerce record
 * in the database already names both: `requester_org_id` and `supplier_org_id`.
 * The query layer has always been able to read a chain from either seat (`listRfqs`,
 * `listQuotations`, `listOrders` all take a side). What was missing was a derived
 * answer to "which seat does THIS workspace sit in by default" — so every surface
 * defaulted to the buyer's, which is right for a Showroom and wrong for a
 * Distributor.
 *
 * That default is what `commerceStance` supplies, and it is a PRESENTATION
 * DEFAULT ONLY:
 *
 *   - It never grants or withholds authority. Capabilities, membership, branch
 *     scope and RLS decide what a caller may do; this decides which of the two
 *     views they land on and what the module is called.
 *   - It never hides the other seat. A Distributor still buys raw materials and a
 *     Showroom still sells to its own customers, so both perspectives stay
 *     reachable on every commerce surface — the stance chooses which one LEADS.
 *   - It is derived from `organizations.org_type`, never stored, never mirrored
 *     onto the user, and never treated as a person's identity (see
 *     PRODUCT_DIRECTION_GUIDE: business classification belongs to the
 *     Organization).
 *
 * TERMINOLOGY WARNING
 * `supplier` here is the internal `org_type` identifier and the internal name of
 * the seller SEAT. It is never user-facing copy: English says "Distributor",
 * Arabic says "الموزع". Nothing in this module produces display text.
 *
 * Pure module — no server imports — so the rules are unit-testable and safe to
 * import from client components.
 */

/** The `org_type` values that sell into the chain rather than buy from it. */
export const SUPPLY_SIDE_ORG_TYPES = ["supplier", "manufacturer", "importer", "wholesaler"] as const;

export type SupplySideOrgType = (typeof SUPPLY_SIDE_ORG_TYPES)[number];

/**
 * Which seat this organization leads from.
 *
 * "seller" for the supply-side family, "buyer" for everyone else — showrooms,
 * contracting companies, design offices, and any organization whose type is
 * missing or unrecognised. Buyer is the safe default because it is the stance the
 * workspace was built around: an unknown type degrades to the surface that has
 * been in front of pilot users longest, never to a half-populated one.
 */
export type CommerceStance = "buyer" | "seller";

export function isSupplySide(orgType: string | null | undefined): orgType is SupplySideOrgType {
  return SUPPLY_SIDE_ORG_TYPES.includes(orgType as SupplySideOrgType);
}

export function commerceStance(orgType: string | null | undefined): CommerceStance {
  return isSupplySide(orgType) ? "seller" : "buyer";
}

/**
 * The side of a commerce record this stance reads from by default.
 *
 * The query layer's own vocabulary is `"requester" | "supplier"`, so this is the
 * single point where a stance is translated into it. Keeping the mapping in one
 * function means a page never hand-rolls `stance === "seller" ? "supplier" : ...`
 * and no surface can drift into reading the wrong seat.
 */
export function defaultCommerceSide(stance: CommerceStance): "requester" | "supplier" {
  return stance === "seller" ? "supplier" : "requester";
}

/**
 * The copy VARIANT a supply-side workspace should read in.
 *
 * Distributor, Manufacturer and Importer share one workspace and one set of
 * workflows; what differs is how each one talks about what it supplies — a
 * manufacturer says "what you make", an importer "what you import", a distributor
 * "what you distribute". That is a message-bundle choice, not a code path, so it
 * resolves to a key rather than to different components.
 *
 * `wholesaler` deliberately shares the distributor voice: it is the same
 * reseller-supply relationship, and the product has no approved separate
 * terminology for it.
 */
export type SupplyVoice = "distributor" | "manufacturer" | "importer";

export function supplyVoice(orgType: string | null | undefined): SupplyVoice {
  if (orgType === "manufacturer") return "manufacturer";
  if (orgType === "importer") return "importer";
  return "distributor";
}
