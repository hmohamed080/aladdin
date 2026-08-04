import { describe, expect, it } from "vitest";
import { mapSalesError, isStaleVersion } from "./error-mapping";

describe("mapSalesError", () => {
  it("maps a duplicate-phone unique violation", () => {
    expect(mapSalesError({ code: "23505" })).toBe("states.duplicatePhone");
    expect(mapSalesError({ message: "a customer with this phone already exists" })).toBe(
      "states.duplicatePhone",
    );
  });

  it("maps a stale-version serialization failure to the conflict key", () => {
    expect(mapSalesError({ code: "40001" })).toBe("leads.conflict");
    expect(mapSalesError({ message: "lead was modified concurrently" })).toBe("leads.conflict");
  });

  it("maps a missing lost reason", () => {
    expect(mapSalesError({ message: "a reason is required when marking a lead lost" })).toBe(
      "leads.lostReasonRequired",
    );
  });

  it("maps branch-scope and cross-tenant denials", () => {
    expect(mapSalesError({ message: "branch not in caller scope" })).toBe("states.branchDenied");
    expect(mapSalesError({ message: "cannot assign to another tenant's branch" })).toBe(
      "states.branchDenied",
    );
  });

  it("maps an assignee/branch mismatch", () => {
    expect(mapSalesError({ message: "assignee cannot access this branch" })).toBe(
      "states.assigneeBranch",
    );
  });

  it("maps an assign-capability denial", () => {
    expect(mapSalesError({ message: "sales.assign required" })).toBe("states.assignDenied");
  });

  it("maps a generic permission denial (42501)", () => {
    expect(mapSalesError({ code: "42501", message: "sales.write required" })).toBe(
      "states.salesWriteDenied",
    );
    expect(mapSalesError({ message: "not a member of this organization" })).toBe(
      "states.salesWriteDenied",
    );
  });

  it("falls back to a retryable message for unknown errors", () => {
    expect(mapSalesError({ message: "connection reset" })).toBe("states.genericRetry");
    expect(mapSalesError(null)).toBe("states.genericRetry");
  });
});

describe("isStaleVersion", () => {
  it("detects optimistic-concurrency conflicts", () => {
    expect(isStaleVersion({ code: "40001" })).toBe(true);
    expect(isStaleVersion({ message: "modified concurrently" })).toBe(true);
    expect(isStaleVersion({ code: "42501" })).toBe(false);
  });
});
