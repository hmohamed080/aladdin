import { getCountries } from "libphonenumber-js";
import { describe, expect, it } from "vitest";
import { COUNTRY_NAMES, countryName } from "./country-names";

describe("country names for the phone picker — data, not a platform API", () => {
  it("has an English and an Arabic name for every country the picker can offer", () => {
    for (const iso2 of getCountries()) {
      expect(COUNTRY_NAMES.en[iso2], `en ${iso2}`).toBeTruthy();
      expect(COUNTRY_NAMES.ar[iso2], `ar ${iso2}`).toBeTruthy();
    }
  });

  it("holds nothing the picker cannot offer", () => {
    const known = new Set<string>(getCountries());
    for (const locale of ["en", "ar"] as const) {
      expect(Object.keys(COUNTRY_NAMES[locale]).filter((iso2) => !known.has(iso2))).toEqual([]);
    }
  });

  it("Arabic names are Arabic and English names are Latin", () => {
    expect(countryName("ar", "EG")).toBe("مصر");
    expect(countryName("en", "EG")).toBe("Egypt");
    for (const iso2 of getCountries()) expect(COUNTRY_NAMES.ar[iso2]).toMatch(/[؀-ۿ]/);
  });

  it("pins the four countries that differ between ICU builds (Node vs a browser) to one short form", () => {
    expect([countryName("en", "HK"), countryName("en", "MO"), countryName("en", "PS"), countryName("en", "FK")]).toEqual([
      "Hong Kong",
      "Macao",
      "Palestine",
      "Falkland Islands",
    ]);
    expect([countryName("ar", "HK"), countryName("ar", "PS")]).toEqual(["هونغ كونغ", "فلسطين"]);
  });

  it("falls back to the ISO code for an unknown country, never to nothing", () => {
    expect(countryName("en", "ZZ")).toBe("ZZ");
  });
});
