import { describe, expect, it } from "vitest";
import { attributeText } from "./live-format";
import { liveCopy } from "./live-copy";
import type { PublicAttribute } from "./public-contract";

const attr = (over: Partial<PublicAttribute>): PublicAttribute => ({
  key: "length", name_ar: "الطول", name_en: "Length", data_type: "measurement", unit_kind: "length", unit_ar: null, unit_en: null, value: 0, ...over,
});

describe("marketplace copy (owner walkthrough Part 4A)", () => {
  it("drops the tax note, the not-yet-purchasable sentence and the sort/view controls", () => {
    for (const locale of ["ar", "en"] as const) {
      const t = liveCopy[locale] as Record<string, unknown>;
      expect(t.taxNote).toBeUndefined();
      expect(t.honestNote).toBeUndefined();
      expect(t.sort).toBeUndefined();
      expect(t.gridView).toBeUndefined();
    }
  });

  it("names the breadcrumb root «المتجر»", () => {
    expect(liveCopy.ar.back).toBe("المتجر");
  });
});

describe("measurement display", () => {
  it("shows a length stored in millimetres as centimetres with its unit", () => {
    expect(attributeText(attr({ value: 600 }), "en")).toBe("60 cm");
    expect(attributeText(attr({ value: 600 }), "ar")).toContain("سم");
  });

  it("shows weight and volume in readable units", () => {
    expect(attributeText(attr({ unit_kind: "weight", value: 2500 }), "en")).toBe("2.5 kg");
    expect(attributeText(attr({ unit_kind: "volume", value: 750 }), "en")).toBe("750 ml");
  });
});
