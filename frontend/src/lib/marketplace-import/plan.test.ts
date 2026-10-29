import { describe, expect, it } from "vitest";
import { buildPlan, matchImages, normalizeNumber, normalizeSku, type ImportConfig } from "./plan";

const header = ["الكود", "القسم", "القسم الفرعي", "السعر", "المخزون الكلي"];

function config(over: Partial<ImportConfig> = {}): ImportConfig {
  return {
    headerRow: 0,
    groupBySuffix: true,
    fields: {
      code: { kind: "column", column: 0 },
      product_type: { kind: "constant", value: "wallpaper" },
      name_ar: { kind: "template", template: "ورق حائط {2} {0}" },
      name_en: { kind: "template", template: "Wallpaper {0}" },
      description_ar: { kind: "none" },
      description_en: { kind: "none" },
      brand: { kind: "none" },
      selling_unit: { kind: "constant", value: "roll" },
      price: { kind: "column", column: 3 },
      quantity: { kind: "column", column: 4 },
    },
    ...over,
  };
}

describe("normalizeNumber", () => {
  it("reads Arabic-Indic digits and separators", () => {
    expect(normalizeNumber("١٬٢٥٠")).toBe("1250");
    expect(normalizeNumber("٣٠٠٫٥")).toBe("300.5");
    expect(normalizeNumber("1,250.0")).toBe("1250");
  });
});

describe("normalizeSku", () => {
  it("keeps the code recognisable and valid", () => {
    expect(normalizeSku("106:Jaguar:161-003")).toBe("106-Jaguar-161-003");
    expect(normalizeSku("  A & B  12 ")).toBe("A-B-12");
    expect(normalizeSku("ورق")).toBe("");
  });
});

describe("buildPlan", () => {
  const grid = [
    header,
    ["106:Jaguar:161-003", "ورق حائط", "Jaguar", "٧٥٠", "١٢"],
    ["106:Jaguar:161-004", "ورق حائط", "Jaguar", "٧٥٠", "٠"],
    ["200:Solo:9", "ورق حائط", "Solo", "٣٠٠", "5"],
    ["catalogue:Jaguar", "ورق حائط", "Jaguar", "٠", "1"],
    ["", "", "", "", ""],
  ];

  it("groups -N suffixes into one product, keeps singles alone, refuses price 0", () => {
    const plan = buildPlan(grid, config());
    expect(plan.variantRows).toBe(3);
    expect(plan.products).toBe(2);
    expect(plan.singleVariantProducts).toBe(1);
    expect(plan.rows[0]).toMatchObject({ row_number: 2, sku: "106-Jaguar-161-003", external_ref: "106-Jaguar-161", price: "750", quantity: "12" });
    expect(plan.rows[0]!.name_ar).toBe("ورق حائط Jaguar 106:Jaguar:161-003");
    expect(plan.rejected).toEqual([{ row_number: 5, code: "price_invalid", field: "price", detail: "0" }]);
  });

  it("without grouping every code is its own product", () => {
    expect(buildPlan(grid, config({ groupBySuffix: false })).products).toBe(3);
  });

  it("refuses two codes that normalise to the same SKU", () => {
    const plan = buildPlan([header, ["A:1", "", "", "10", "1"], ["A 1", "", "", "10", "1"]], config());
    expect(plan.rows).toHaveLength(1);
    expect(plan.rejected[0]?.code).toBe("sku_collision");
  });
});

describe("matchImages", () => {
  const plan = buildPlan(
    [header, ["106:Jaguar:161-003", "", "", "750", "1"], ["106:Jaguar:161-004", "", "", "750", "1"]],
    config(),
  );
  it("matches by code, SKU or product reference and reports the rest", () => {
    const r = matchImages(
      [
        { fileName: "photos/106-Jaguar-161-003_1.jpg", size: 10 },
        { fileName: "106-Jaguar-161_02.JPEG", size: 10 },
        { fileName: "unknown_1.png", size: 10 },
        { fileName: "notes.txt", size: 10 },
      ],
      plan.rows,
    );
    expect(r.matched.map((m) => [m.registeredName, m.target])).toEqual([
      ["106-Jaguar-161_02.jpg", "product"],
      ["106-Jaguar-161-003_01.jpg", "variant"],
    ]);
    expect(r.unmatched).toEqual(["unknown_1.png"]);
    expect(r.unsupported).toEqual(["notes.txt"]);
  });
});

describe("attributes", () => {
  it("reads attr:<key> columns and fixed attributes, the column winning", () => {
    const grid = [
      ["code", "price", "attr:color", "attr:roll_width", "attr:washable"],
      ["W-1", "100", "beige", "٥٣٠", "نعم"],
      ["W-2", "100", "", "530", "no"],
    ];
    const plan = buildPlan(grid, {
      ...config({ groupBySuffix: false }),
      fixedAttributes: "material_wallpaper=non_woven\ncolor=white\nbad key=1",
      fields: { ...config().fields, price: { kind: "column", column: 1 }, quantity: { kind: "none" } },
    });
    expect(plan.rows[0]!.attributes).toEqual({ material_wallpaper: "non_woven", color: "beige", roll_width: "530", washable: true });
    expect(plan.rows[1]!.attributes).toEqual({ material_wallpaper: "non_woven", color: "white", roll_width: "530", washable: false });
  });
});
