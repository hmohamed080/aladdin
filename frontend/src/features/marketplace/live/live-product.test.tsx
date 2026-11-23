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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/market/products/demo-corner-trim-1" }));

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

describe("LiveProduct v2 header", () => {
  const official: PublicProduct = {
    ...product, seller_slug: "nile", seller_official: true, stock_left: 2,
    variants: [{ sku: "T-1", selling_unit: "piece", price_egp: 100, purchasable: true, stock_left: 2, attributes: [] }],
    images: [
      { image_id: "i1", is_primary: true, alt_text_ar: null, alt_text_en: null, variant_sku: null },
      { image_id: "i2", is_primary: false, alt_text_ar: null, alt_text_en: null, variant_sku: null },
    ],
  };

  it("links the showroom above the name, marks the Official Store, and shows 'Only N left'", () => {
    render(
      <I18nProvider locale="en" dir="ltr">
        <LiveProduct product={official} />
      </I18nProvider>,
    );
    const links = screen.getAllByRole("link", { name: /Nile Interiors|Official Store/ });
    expect(links.every((l) => l.getAttribute("href") === "/market/sellers/nile")).toBe(true);
    expect(screen.getByText("Official Store")).toBeInTheDocument();
    expect(screen.getByText("Only 2 left in stock – order soon")).toBeInTheDocument();
    expect(screen.queryByText(/call|whatsapp|contact/i)).toBeNull();
  });

  it("is browse-only: no add-to-cart button unless the ordering flag is on", () => {
    const { unmount } = render(
      <I18nProvider locale="en" dir="ltr">
        <LiveProduct product={official} />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: /add to cart/i })).toBeNull();
    unmount();
    vi.stubEnv("NEXT_PUBLIC_MARKETPLACE_ORDERING", "true");
    render(
      <I18nProvider locale="en" dir="ltr">
        <LiveProduct product={official} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: /add to cart/i })).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("shows a thumbnail strip beside the large image when there are several images", () => {
    render(
      <I18nProvider locale="en" dir="ltr">
        <LiveProduct product={official} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "1 / 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2 / 2" })).toBeInTheDocument();
  });
});

