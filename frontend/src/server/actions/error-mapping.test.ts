import { describe, expect, it } from "vitest";
import { mapSalesError, mapAssetError, isStaleVersion } from "./error-mapping";

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

/**
 * Storage speaks a different dialect from the RPCs above it: no SQLSTATE, and an
 * HTTP 400 for every kind of refusal. These assertions use the exact bodies the
 * local Storage service returned during Increment 10, captured in
 * `supabase/tests/professional_asset_storage_api_test.mjs` — not the shapes the
 * documentation suggests, which differ.
 */
describe("mapAssetError", () => {
  it("maps a policy refusal — the one that covers persona, ownership and anon alike", () => {
    expect(mapAssetError({ code: "AccessDenied", message: "new row violates row-level security policy" }))
      .toBe("assets.errors.notAllowed");
    expect(mapAssetError({ message: "Access denied" })).toBe("assets.errors.notAllowed");
  });

  it("maps a rejected content type and an oversized body to their own sentences", () => {
    expect(mapAssetError({ code: "InvalidMimeType", message: "mime type image/svg+xml is not supported" }))
      .toBe("assets.errors.unsupportedType");
    expect(mapAssetError({ code: "EntityTooLarge", message: "The object exceeded the maximum allowed size" }))
      .toBe("assets.errors.tooLarge");
  });

  it("maps a hidden or missing object to `gone`, which is what a reader can act on", () => {
    expect(mapAssetError({ code: "NoSuchKey", message: "Object not found" })).toBe("assets.errors.gone");
  });

  it("maps a duplicate key to a retryable failure rather than to a denial", () => {
    // The caller cannot fix a key collision; a fresh ticket produces a new one.
    expect(mapAssetError({ code: "KeyAlreadyExists", message: "The resource already exists" }))
      .toBe("assets.errors.uploadFailed");
  });

  it("never returns a raw storage string, even for something it has never seen", () => {
    expect(mapAssetError({ message: "socket hang up" })).toBe("assets.errors.uploadFailed");
    expect(mapAssetError(null)).toBe("assets.errors.uploadFailed");
    expect(mapAssetError(undefined)).toBe("assets.errors.uploadFailed");
  });
});
