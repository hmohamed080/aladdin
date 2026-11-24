import { describe, expect, it } from "vitest";
import { editDistance, normalizeSearch, searchPlaces } from "./place-search";

const top = (q: string) => searchPlaces(q)[0];

describe("normalizeSearch", () => {
  it("folds Arabic spelling variants, diacritics and digits", () => {
    expect(normalizeSearch("المعادى")).toBe(normalizeSearch("المعادي"));
    expect(normalizeSearch("القاهرة")).toBe(normalizeSearch("القاهره"));
    expect(normalizeSearch("الإسكندرية")).toBe(normalizeSearch("الاسكندريه"));
    expect(normalizeSearch("مَدِينَة")).toBe("مدينه");
    expect(normalizeSearch("  Nasr   City!! ")).toBe("nasr city");
    expect(normalizeSearch("١٠ رمضان")).toBe("10 رمضان");
  });
});

describe("editDistance", () => {
  it("is exact inside the bound and gives up beyond it", () => {
    expect(editDistance("maadi", "maadi", 2)).toBe(0);
    expect(editDistance("maadi", "madi", 2)).toBe(1);
    expect(editDistance("maadi", "zzzzz", 2)).toBeGreaterThan(2);
  });
});

describe("searchPlaces", () => {
  it("needs two characters", () => {
    expect(searchPlaces("m")).toEqual([]);
    expect(searchPlaces("")).toEqual([]);
  });

  it("finds an area in English and in Arabic, with its governorate", () => {
    expect(top("maadi")).toMatchObject({ gov: "cairo", area: "maadi" });
    expect(top("المعادي")).toMatchObject({ gov: "cairo", area: "maadi" });
    expect(top("maadi cairo")).toMatchObject({ gov: "cairo", area: "maadi" });
  });

  it("tolerates Arabic spelling variants", () => {
    expect(top("المعادى")).toMatchObject({ gov: "cairo", area: "maadi" });
    expect(top("الاسكندريه")?.gov).toBe("alexandria");
  });

  it("tolerates a typo and a missing letter", () => {
    expect(top("maadie")).toMatchObject({ gov: "cairo", area: "maadi" });
    expect(top("nasr cty")).toMatchObject({ gov: "cairo", area: "nasr-city" });
    expect(top("hliopolis")).toMatchObject({ gov: "cairo", area: "heliopolis" });
  });

  it("matches a prefix and a governorate on its own", () => {
    expect(searchPlaces("new cai").map((s) => s.area)).toContain("new-cairo");
    expect(top("giza")).toMatchObject({ gov: "giza", area: null });
  });

  it("returns nothing for gibberish and never the 'other city' entry", () => {
    expect(searchPlaces("qqqqzzzz")).toEqual([]);
    expect(searchPlaces("other city").some((s) => s.area === "other")).toBe(false);
  });

  it("caps the list", () => {
    expect(searchPlaces("ca", 3).length).toBeLessThanOrEqual(3);
  });
});
