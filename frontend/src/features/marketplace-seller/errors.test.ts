import { describe, expect, it } from "vitest";
import { errorKey, parseSellerError } from "./errors";

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

describe("PR 7 codes", () => {
  it("knows the low-stock refusal and no longer exposes publication blockers", () => {
    expect(errorKey("low_stock_invalid")).toBe("marketplaceSeller.error.low_stock_invalid");
    expect(parseSellerError("mp:low_stock_invalid")).toEqual({ code: "low_stock_invalid" });
  });

  it("turns a publish refused for missing payment or delivery into one plain store-setup message", () => {
    expect(parseSellerError("publication blocked: seller_no_payment_method, seller_no_delivery")).toEqual({ code: "store_setup_missing" });
    expect(parseSellerError("publication blocked: seller_no_delivery")).toEqual({ code: "store_setup_missing" });
    expect(parseSellerError("publication blocked: no_active_variant")).toEqual({ code: "unexpected" });
    expect(errorKey("store_setup_missing")).toBe("marketplaceSeller.error.store_setup_missing");
  });
});
