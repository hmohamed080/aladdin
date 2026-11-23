import { describe, expect, it } from "vitest";
import { normalizeFee, parseFee, priceRowsFrom, splitPlaces, toPlaces, toPrices, unpricedCount, validateAreas, validatePrices, type AreaRow, type PriceRow } from "./delivery-model";

const area = (governorate: string, a: string, key = `${governorate}${a}`): AreaRow => ({ key, governorate, area: a });
const price = (governorate: string, a: string, fee: string, key = `${governorate}${a}`): PriceRow => ({ key, governorate, area: a, fee });

describe("delivery fee input", () => {
  it("reads Arabic digits and decimal separators", () => {
    expect(normalizeFee(" ١٢٠٫٥ ")).toBe("120.5");
    expect(normalizeFee("80,25")).toBe("80.25");
  });

  it("accepts 0 up to 100,000 with at most two decimals, nothing else", () => {
    expect(parseFee("0")).toBe(0);
    expect(parseFee("80")).toBe(80);
    expect(parseFee("100000")).toBe(100000);
    expect(parseFee("١٢٠٫٥")).toBe(120.5);
    for (const bad of ["", "abc", "-1", "100001", "10.123", "1e3", "1 000", "."]) expect(parseFee(bad), bad).toBeNull();
  });
});

describe("areas: where the showroom delivers", () => {
  it("splits stored places into whole governorates and single areas", () => {
    const { governorates, areas } = splitPlaces([
      { governorate_key: "cairo", area_key: null, fee_egp: 80 },
      { governorate_key: "cairo", area_key: "maadi", fee_egp: null },
      { governorate_key: "giza", area_key: null, fee_egp: null },
    ]);
    expect(governorates).toEqual(["cairo", "giza"]);
    expect(areas).toEqual([{ key: "a0", governorate: "cairo", area: "maadi" }]);
  });

  it("needs a governorate and an area on every single-area line, and no repeats", () => {
    expect(validateAreas([area("cairo", "maadi"), area("giza", "dokki")])).toEqual([]);
    expect(validateAreas([area("", "", "a"), area("cairo", "", "b"), area("cairo", "maadi", "c"), area("cairo", "maadi", "d")])).toEqual([
      { row: 1, problem: "governorate" },
      { row: 2, problem: "area" },
      { row: 4, problem: "duplicate" },
    ]);
  });

  it("saves ticked governorates first (no area), then the single areas", () => {
    expect(toPlaces(["cairo"], [area("giza", "dokki")])).toEqual([
      { governorate_key: "cairo", area_key: null },
      { governorate_key: "giza", area_key: "dokki" },
    ]);
  });
});

describe("prices: what the showroom charges", () => {
  it("lists the covered places with their price, blank when not set", () => {
    const rows = priceRowsFrom([
      { governorate_key: "cairo", area_key: null, fee_egp: "80.00" },
      { governorate_key: "cairo", area_key: "maadi", fee_egp: null },
    ]);
    expect(rows.map((r) => [r.governorate, r.area, r.fee])).toEqual([["cairo", "", "80"], ["cairo", "maadi", ""]]);
  });

  it("allows a blank price (not set yet) but not a wrong one", () => {
    expect(validatePrices([price("cairo", "", ""), price("giza", "", "0"), price("alexandria", "", "١٢٠")])).toEqual([]);
    expect(validatePrices([price("cairo", "", "80", "a"), price("giza", "", "x", "b"), price("alexandria", "", "10.123", "c")])).toEqual([{ row: 2 }, { row: 3 }]);
  });

  it("sends a blank price as null and a typed one as a number", () => {
    expect(toPrices([price("cairo", "", ""), price("cairo", "maadi", "٩٠٫٥"), price("giza", "", "0")])).toEqual([
      { governorate_key: "cairo", area_key: null, fee_egp: null },
      { governorate_key: "cairo", area_key: "maadi", fee_egp: 90.5 },
      { governorate_key: "giza", area_key: null, fee_egp: 0 },
    ]);
  });

  it("counts the places still waiting for a price", () => {
    expect(unpricedCount([
      { governorate_key: "cairo", area_key: null, fee_egp: 0 },
      { governorate_key: "giza", area_key: null, fee_egp: null },
    ])).toBe(1);
  });
});
