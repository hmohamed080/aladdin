import { describe, expect, it } from "vitest";
import { fromStoredValue, missingRequired, toSavePayload, type ProductDraft, type ProductTypeSchema } from "./form-model";

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

  it("updates by id and never resends the organization or the type", () => {
    const p = toSavePayload(draft({ id: "p-1" }), schema);
    expect(p.id).toBe("p-1");
    expect(p).not.toHaveProperty("organization_id");
    expect(p).not.toHaveProperty("product_type_key");
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
