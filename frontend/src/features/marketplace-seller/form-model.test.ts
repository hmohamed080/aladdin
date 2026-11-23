import { describe, expect, it } from "vitest";
import { canOfferPublish, fromStoredValue, missingRequired, requiredIssues, toSavePayload, type ProductDraft, type ProductTypeSchema } from "./form-model";

const schema: ProductTypeSchema = {
  key: "wallpaper",
  nameAr: "ورق حائط",
  nameEn: "Wallpaper",
  categoryKey: "walls",
  categoryNameAr: "حوائط",
  categoryNameEn: "Walls",
  fields: [
    { key: "material_wallpaper", nameAr: "الخامة", nameEn: "Material", dataType: "option", unitAr: null, unitEn: null, level: "product", required: true, options: [] },
    { key: "washable", nameAr: "قابل للغسل", nameEn: "Washable", dataType: "boolean", unitAr: null, unitEn: null, level: "product", required: false, options: [] },
    { key: "color", nameAr: "اللون", nameEn: "Colour", dataType: "option", unitAr: null, unitEn: null, level: "variant", required: true, options: [] },
    { key: "roll_width", nameAr: "العرض", nameEn: "Width", dataType: "measurement", unitAr: "سم", unitEn: "cm", level: "variant", required: true, options: [] },
  ],
};

const draft = (over: Partial<ProductDraft> = {}): ProductDraft => ({
  organizationId: "org-1",
  typeKey: "wallpaper",
  nameAr: " ورق ",
  nameEn: " Paper ",
  descriptionAr: "",
  descriptionEn: "",
  brand: "",
  externalRef: "",
  slug: " My-Slug ",
  lowStockThreshold: "",
  attributes: { material_wallpaper: "vinyl_coated", washable: true, not_in_type: "x" },
  variants: [
    {
      uid: "u1",
      sku: " WP-1 ",
      sellingUnit: "roll",
      price: " 450.5 ",
      status: "active",
      attributes: { color: "beige", roll_width: "53", stray: "y" },
      initialQty: "10",
    },
  ],
  ...over,
});

describe("toSavePayload", () => {
  it("creates with organization and type, sends only the type's fields, and normalises values", () => {
    const p = toSavePayload(draft(), schema);
    expect(p).toMatchObject({
      organization_id: "org-1",
      product_type_key: "wallpaper",
      name_ar: "ورق",
      slug: "my-slug",
      attributes: { material_wallpaper: "vinyl_coated", washable: true },
    });
    expect(p.attributes).not.toHaveProperty("not_in_type");
    expect((p.variants as Record<string, unknown>[])[0]).toEqual({
      sku: "WP-1",
      selling_unit: "roll",
      price_egp: "450.5",
      status: "active",
      attributes: { color: "beige", roll_width: 53 },
    });
  });

  it("updates by id, never resends the organization, and always sends the type (it can change)", () => {
    const p = toSavePayload(draft({ id: "p-1", typeKey: "cornice" }), schema);
    expect(p.id).toBe("p-1");
    expect(p).not.toHaveProperty("organization_id");
    expect(p.product_type_key).toBe("cornice");
  });

  it("sends the per-product low-stock threshold only when typed", () => {
    expect(toSavePayload(draft(), schema)).not.toHaveProperty("low_stock_threshold");
    expect(toSavePayload(draft({ lowStockThreshold: " 7 " }), schema).low_stock_threshold).toBe("7");
  });
});

describe("missingRequired", () => {
  it("lists required fields that are still empty, product and active variants", () => {
    const base = draft().variants[0]!;
    const d = draft({ attributes: {}, variants: [{ ...base, attributes: { color: "" } }] });
    expect(missingRequired(d, schema)).toEqual(["material_wallpaper", "WP-1:color", "WP-1:roll_width"]);
  });
});

describe("fromStoredValue", () => {
  it("turns stored values back into form values", () => {
    expect(fromStoredValue(schema.fields[1], true)).toBe(true);
    expect(fromStoredValue(schema.fields[3], 53)).toBe("53");
    expect(fromStoredValue(undefined, null)).toBeNull();
  });
});

describe("requiredIssues", () => {
  const ctx = { storedStock: false, hasImage: true };
  it("is empty for a complete new product", () => {
    expect([...requiredIssues(draft(), schema, ctx)]).toEqual([]);
  });
  it("flags every missing publish condition as a field id", () => {
    const base = draft().variants[0]!;
    const d = draft({
      typeKey: "",
      nameAr: " ",
      nameEn: "",
      attributes: {},
      lowStockThreshold: "x",
      variants: [{ ...base, uid: "u9", sku: "", sellingUnit: "", price: "0", initialQty: "", attributes: {} }],
    });
    const issues = requiredIssues(d, schema, { storedStock: false, hasImage: false });
    expect([...issues].sort()).toEqual(
      [
        "attr:material_wallpaper",
        "images",
        "lowStock",
        "nameAr",
        "nameEn",
        "stock",
        "type",
        "v:u9:color",
        "v:u9:price",
        "v:u9:roll_width",
        "v:u9:sku",
        "v:u9:unit",
      ].sort(),
    );
  });
  it("accepts stock already stored on a saved product", () => {
    const base = draft().variants[0]!;
    const d = draft({ id: "p", variants: [{ ...base, id: "v1", initialQty: "" }] });
    expect(requiredIssues(d, schema, { storedStock: true, hasImage: true }).has("stock")).toBe(false);
    expect(requiredIssues(d, schema, { storedStock: false, hasImage: true }).has("stock")).toBe(true);
  });
  it("ignores inactive variants", () => {
    const base = draft().variants[0]!;
    const d = draft({ variants: [base, { ...base, uid: "u2", sku: "", status: "inactive", price: "" }] });
    expect([...requiredIssues(d, schema, ctx)]).toEqual([]);
  });
});

describe("canOfferPublish", () => {
  it("is on only for an approved, unblocked draft or unpublished product", () => {
    expect(canOfferPublish({ status: "draft", canPublish: true })).toBe(true);
    expect(canOfferPublish({ status: "unpublished", canPublish: true })).toBe(true);
    expect(canOfferPublish({ status: "published", canPublish: true })).toBe(false);
    expect(canOfferPublish({ status: "draft", canPublish: false })).toBe(false);
    expect(canOfferPublish(null)).toBe(false);
  });
});
