import { describe, expect, it } from "vitest";
import { blockerParts, errorKey, parseSellerError } from "./errors";

describe("parseSellerError", () => {
  it("reads the code and detail of a seller refusal", () => {
    expect(parseSellerError("mp:sku_taken:WP-001")).toEqual({ code: "sku_taken", detail: "WP-001" });
    expect(parseSellerError("mp:seller_not_enabled")).toEqual({ code: "seller_not_enabled" });
  });

  it("never passes raw database text through", () => {
    expect(parseSellerError('duplicate key value violates unique constraint "x"')).toEqual({ code: "unexpected" });
    expect(parseSellerError(undefined)).toEqual({ code: "unexpected" });
  });

  it("maps unknown codes to the generic message", () => {
    expect(errorKey("sku_taken")).toBe("marketplaceSeller.error.sku_taken");
    expect(errorKey("something_new")).toBe("marketplaceSeller.error.unexpected");
  });
});

describe("blockerParts", () => {
  it("splits a blocker into its message key and detail", () => {
    expect(blockerParts("no_available_stock")).toEqual({ key: "marketplaceSeller.blocker.no_available_stock" });
    expect(blockerParts("missing_variant_attribute:WP-1:color")).toEqual({
      key: "marketplaceSeller.blocker.missing_variant_attribute",
      detail: "WP-1 · color",
    });
  });
});
