import { describe, expect, it } from "vitest";
import { mapCommerceError } from "@/server/actions/error-mapping";
import { formatMoney, formatQuantity, PRODUCT_CATEGORIES, PRODUCT_UNITS } from "./constants";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

/** Resolve a dotted key against a message catalog, or undefined if missing. */
function resolve(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

describe("mapCommerceError", () => {
  it("maps optimistic-concurrency conflicts", () => {
    expect(mapCommerceError({ code: "40001" })).toBe("commerce.errors.conflict");
    expect(mapCommerceError({ message: "quotation was modified concurrently" })).toBe(
      "commerce.errors.conflict",
    );
  });

  it("maps commerce-specific lifecycle errors", () => {
    expect(mapCommerceError({ message: "a live quotation already exists for this RFQ" })).toBe(
      "commerce.errors.quotationExists",
    );
    expect(mapCommerceError({ message: "an RFQ needs at least one item" })).toBe(
      "commerce.errors.rfqNeedsItem",
    );
    expect(mapCommerceError({ message: "price every line before submitting" })).toBe(
      "commerce.errors.quotationNeedsPrices",
    );
    expect(
      mapCommerceError({ message: "product is not a published product of the supplier organization" }),
    ).toBe("commerce.errors.productNotPublished");
    expect(mapCommerceError({ message: "an organization cannot send an RFQ to itself" })).toBe(
      "commerce.errors.selfRfq",
    );
  });

  it("maps a generic permission denial and an unknown fallback", () => {
    expect(mapCommerceError({ code: "42501", message: "catalog.write required" })).toBe(
      "commerce.errors.denied",
    );
    expect(mapCommerceError({ message: "connection reset" })).toBe("states.genericRetry");
    expect(mapCommerceError(null)).toBe("states.genericRetry");
  });

  it("only ever returns keys that exist in BOTH message catalogs", () => {
    const samples = [
      { code: "40001" },
      { message: "a live quotation already exists for this RFQ" },
      { message: "an RFQ needs at least one item" },
      { message: "price every line before submitting" },
      { message: "product is not a published product of the supplier organization" },
      { message: "an organization cannot send an RFQ to itself" },
      { message: "only a draft RFQ can be edited" },
      { message: "only a submitted quotation can be decided" },
      { code: "42501" },
      { message: "unknown" },
    ];
    for (const e of samples) {
      const key = mapCommerceError(e);
      expect(typeof resolve(en, key), `en missing ${key}`).toBe("string");
      expect(typeof resolve(ar, key), `ar missing ${key}`).toBe("string");
    }
  });
});

describe("commerce formatters", () => {
  it("formats EGP money and handles null/invalid", () => {
    expect(formatMoney(null, "en")).toBe("—");
    expect(formatMoney("not-a-number", "en")).toBe("—");
    expect(formatMoney(30000, "en")).toContain("30,000");
    expect(formatMoney(250.5, "en")).toContain("250.5");
  });

  it("formats quantities without forcing decimals", () => {
    expect(formatQuantity(120, "en")).toBe("120");
    expect(formatQuantity("12.50", "en")).toContain("12.5");
  });
});

describe("commerce enums have full bilingual label coverage", () => {
  it("every category and unit has an en + ar label", () => {
    for (const c of PRODUCT_CATEGORIES) {
      expect(typeof resolve(en, `commerce.categories.${c}`), `en category ${c}`).toBe("string");
      expect(typeof resolve(ar, `commerce.categories.${c}`), `ar category ${c}`).toBe("string");
    }
    for (const u of PRODUCT_UNITS) {
      expect(typeof resolve(en, `commerce.units.${u}`), `en unit ${u}`).toBe("string");
      expect(typeof resolve(ar, `commerce.units.${u}`), `ar unit ${u}`).toBe("string");
    }
  });
});
