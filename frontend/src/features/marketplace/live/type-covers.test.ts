import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PRODUCTS_TYPES, COVERED_TYPE_KEYS, HERO_TYPES, typeCover } from "./type-covers";

/** The sixteen product types of the Marketplace taxonomy (migrations 08, 10 and 11). Add a key here with its cover. */
const PRODUCT_TYPES = [
  "wallpaper", "wood_alternative", "marble_alternative", "sheeboard", "cornice", "corner_trim", "wall_panel", "skirting",
  "interior_door", "armored_door", "vinyl_flooring", "spc_flooring", "hdf_flooring", "curtain", "poster", "paint",
];

const publicFile = (url: string) => path.resolve(__dirname, "../../../../public", url.replace(/^\//, ""));

describe("storefront type covers ship with the frontend", () => {
  it("every product type has a cover", () => {
    for (const key of PRODUCT_TYPES) expect(typeCover(key), key).not.toBeNull();
    expect([...COVERED_TYPE_KEYS].sort()).toEqual([...PRODUCT_TYPES].sort());
  });

  it("each cover is a small webp file that exists in /public (no database, no sample catalogue, no heavy png)", () => {
    for (const key of PRODUCT_TYPES) {
      const url = typeCover(key)!;
      expect(url, key).toMatch(/^\/preview\/landing\/marketplace\/type-[a-z-]+\.webp$/);
      const file = publicFile(url);
      expect(existsSync(file), `${key}: ${file}`).toBe(true);
      expect(statSync(file).size, key).toBeLessThan(200 * 1024);
    }
  });

  it("an unknown type gets no cover (the strip shows an icon) instead of a wrong photo", () => {
    expect(typeCover("not_a_type")).toBeNull();
  });

  it("the All-products tile and the hero use covered types only", () => {
    for (const key of [...ALL_PRODUCTS_TYPES, ...HERO_TYPES]) expect(typeCover(key), key).not.toBeNull();
  });
});
