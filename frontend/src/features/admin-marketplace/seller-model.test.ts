import { describe, expect, it } from "vitest";
import { allowedTransitions, eligibilityIssues, reasonRequired } from "./seller-model";

describe("allowedTransitions", () => {
  it("lets an admin approve a never-reviewed, pending, rejected or revoked organization (rejected and revoked are not terminal)", () => {
    for (const status of [null, "pending", "rejected", "revoked"]) {
      expect(allowedTransitions(status, true)).toContain("approve");
    }
  });

  it("offers Approve again after a revoke, and never Reinstate for a revoked seller", () => {
    expect(allowedTransitions("revoked", true)).toEqual(["approve"]);
  });

  it("only a pending request can be rejected", () => {
    expect(allowedTransitions("pending", true)).toEqual(["approve", "reject"]);
    for (const status of [null, "approved", "suspended", "rejected", "revoked"]) {
      expect(allowedTransitions(status, true)).not.toContain("reject");
    }
  });

  it("keeps suspend / revoke for an approved seller and reinstate / revoke for a suspended one", () => {
    expect(allowedTransitions("approved", true)).toEqual(["suspend", "revoke"]);
    expect(allowedTransitions("suspended", true)).toEqual(["reinstate", "revoke"]);
  });

  it("never offers approve or reinstate for an organization that is not eligible", () => {
    expect(allowedTransitions(null, false)).toEqual([]);
    expect(allowedTransitions("pending", false)).toEqual(["reject"]);
    expect(allowedTransitions("rejected", false)).toEqual([]);
    expect(allowedTransitions("revoked", false)).toEqual([]);
    expect(allowedTransitions("suspended", false)).toEqual(["revoke"]);
  });
});

describe("reasonRequired", () => {
  it("is required for reject, suspend, revoke and reinstate and optional for approve", () => {
    expect(reasonRequired("approve")).toBe(false);
    for (const a of ["reject", "suspend", "revoke", "reinstate"] as const) expect(reasonRequired(a)).toBe(true);
  });
});

describe("eligibilityIssues", () => {
  const base = { eligible: false, orgType: "showroom_dealer", orgStatus: "active", orgDeleted: false };

  it("is empty for an eligible organization", () => {
    expect(eligibilityIssues({ ...base, eligible: true })).toEqual([]);
  });

  it("names what is missing: not active, wrong type, deleted", () => {
    expect(eligibilityIssues({ ...base, orgStatus: "suspended" })).toEqual(["notActive"]);
    expect(eligibilityIssues({ ...base, orgType: "supplier" })).toEqual(["wrongType"]);
    expect(eligibilityIssues({ ...base, orgDeleted: true })).toEqual(["deleted"]);
    expect(eligibilityIssues({ ...base, orgDeleted: true, orgStatus: "archived", orgType: "importer" })).toEqual(["deleted", "notActive", "wrongType"]);
  });
});
