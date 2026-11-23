import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { LiveProduct } from "./live-product";
import type { PublicAttribute, PublicProduct } from "./public-contract";

const length = (value: number): PublicAttribute => ({
  key: "length", name_ar: "الطول", name_en: "Length", data_type: "measurement", unit_kind: "length", unit_ar: null, unit_en: null, value,
});

// A product-level `length` AND a variant-level `length` (e.g. demo-corner-trim-1) used to share one React key.
const product: PublicProduct = {
  slug: "demo-corner-trim-1", name_ar: "كورنيش", name_en: "Corner trim", description_ar: null, description_en: null, brand: null,
  product_type_key: "trim", product_type_name_ar: "كرانيش", product_type_name_en: "Trim",
  category_key: "c", category_name_ar: "قسم", category_name_en: "Category", seller_name: "Nile Interiors", cover_image_id: null,
  attributes: [length(2900)],
  variants: [{ sku: "T-1", selling_unit: "piece", price_egp: 100, purchasable: true, attributes: [length(600)] }],
  images: [],
};

afterEach(() => vi.restoreAllMocks());

describe("LiveProduct specifications", () => {
  it("renders two attributes sharing a key without a duplicate-key warning", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <I18nProvider locale="en" dir="ltr">
        <LiveProduct product={product} />
      </I18nProvider>,
    );
    expect(screen.getAllByText("Length")).toHaveLength(2);
    expect(screen.getByText("290 cm")).toBeInTheDocument();
    expect(screen.getByText("60 cm")).toBeInTheDocument();
    const duplicateKey = error.mock.calls.filter((c) => String(c[0]).includes("same key"));
    expect(duplicateKey).toEqual([]);
  });
});
