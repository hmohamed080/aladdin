/**
 * Pure rules of the admin seller table. They mirror app.marketplace_seller_transition (the database is the gate; this only
 * decides which buttons to draw and which fields to ask for).
 */
export type SellerTransition = "approve" | "reject" | "suspend" | "revoke" | "reinstate";

export type EligibilityInput = {
  eligible: boolean;
  orgType: string;
  orgStatus: string;
  orgDeleted: boolean;
};

/** The transitions the database allows from each state. Approving or reinstating needs an eligible organization. */
export function allowedTransitions(status: string | null, eligible: boolean): SellerTransition[] {
  switch (status) {
    case null:
      return eligible ? ["approve"] : [];
    case "pending":
      return eligible ? ["approve", "reject"] : ["reject"];
    case "rejected":
    case "revoked":
      // neither is terminal: an admin can approve the organization again
      return eligible ? ["approve"] : [];
    case "approved":
      return ["suspend", "revoke"];
    case "suspended":
      return eligible ? ["reinstate", "revoke"] : ["revoke"];
    default:
      return [];
  }
}

/** The internal reason is required for everything except approve. */
export function reasonRequired(action: SellerTransition): boolean {
  return action !== "approve";
}

export type EligibilityIssue = "deleted" | "notActive" | "wrongType";

/** What is missing when an organization is not an eligible showroom (empty when it is eligible). */
export function eligibilityIssues(row: EligibilityInput): EligibilityIssue[] {
  if (row.eligible) return [];
  const issues: EligibilityIssue[] = [];
  if (row.orgDeleted) issues.push("deleted");
  if (row.orgStatus !== "active") issues.push("notActive");
  if (row.orgType !== "showroom_dealer") issues.push("wrongType");
  return issues;
}

export type PresetRow = {
  id: string;
  action: string;
  labelAr: string;
  labelEn: string;
  textAr: string;
  textEn: string;
  isActive: boolean;
  sortOrder: number;
};

/** The owner-message choice sent with a transition: a preset, custom text in BOTH languages, or nothing. */
export type OwnerMessage = { presetId: string | null; messageAr: string | null; messageEn: string | null };

export const OWNER_MESSAGE_MAX = 300;
