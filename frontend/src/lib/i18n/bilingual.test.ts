import { describe, expect, it } from "vitest";

import { resolveBilingualText } from "./bilingual";

describe("resolveBilingualText", () => {
  it("prefers the Arabic value for Arabic UI when it exists", () => {
    expect(resolveBilingualText("ar", "Cairo Ceramics", "معرض سيراميك القاهرة", "Cairo Ceramics")).toBe(
      "معرض سيراميك القاهرة",
    );
  });

  it("prefers the English value for English UI when it exists", () => {
    expect(resolveBilingualText("en", "Cairo Ceramics", "معرض سيراميك القاهرة", "Cairo Ceramics Showroom")).toBe(
      "Cairo Ceramics Showroom",
    );
  });

  it("falls back to the original stored value when the preferred translation is absent", () => {
    expect(resolveBilingualText("ar", "Cairo Ceramics", null, "Cairo Ceramics")).toBe("Cairo Ceramics");
    expect(resolveBilingualText("en", "Cairo Ceramics", "معرض سيراميك القاهرة", undefined)).toBe("Cairo Ceramics");
  });

  it("falls back when the preferred translation is empty/whitespace-only rather than genuinely absent", () => {
    // An owner who cleared the field back to empty should read as "not entered",
    // not as "the name is now blank".
    expect(resolveBilingualText("ar", "Cairo Ceramics", "   ", "Cairo Ceramics")).toBe("Cairo Ceramics");
  });

  it("never touches the untranslated language's own value", () => {
    // Entering only an Arabic name must not change what English UI shows.
    expect(resolveBilingualText("en", "Cairo Ceramics", "معرض سيراميك القاهرة", null)).toBe("Cairo Ceramics");
  });
});
