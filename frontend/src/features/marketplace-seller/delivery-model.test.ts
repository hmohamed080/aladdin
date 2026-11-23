import { describe, expect, it } from "vitest";
import { normalizeFee, parseDays, parseFee, parseMinimum, settingsFormFrom, toSettings, validateSettings, priceRowsFrom, splitPlaces, toPlaces, toPrices, unpricedCount, validateAreas, validatePrices, type AreaRow, type PriceRow } from "./delivery-model";

const area = (governorate: string, a: string, key = `${governorate}${a}`): AreaRow => ({ key, governorate, area: a });
const price = (governorate: string, a: string, fee: string, key = `${governorate}${a}`, extra: Partial<PriceRow> = {}): PriceRow => ({
  key, governorate, area: a, fee, minDays: "", maxDays: "", nextDay: false, nextDayFee: "", freeMin: "", ...extra,
});

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
    expect(validatePrices([price("cairo", "", "80", "a"), price("giza", "", "x", "b"), price("alexandria", "", "10.123", "c")])).toEqual([{ row: 2, field: "fee" }, { row: 3, field: "fee" }]);
  });

  it("sends a blank price as null and a typed one as a number", () => {
    const none = { duration_min_days: null, duration_max_days: null, next_day_available: false, next_day_fee_egp: null, free_shipping_min_egp: null };
    expect(toPrices([price("cairo", "", ""), price("cairo", "maadi", "٩٠٫٥"), price("giza", "", "0")])).toEqual([
      { governorate_key: "cairo", area_key: null, fee_egp: null, ...none },
      { governorate_key: "cairo", area_key: "maadi", fee_egp: 90.5, ...none },
      { governorate_key: "giza", area_key: null, fee_egp: 0, ...none },
    ]);
  });

  it("reads the stored duration, next-day option and free-shipping minimum back into the row", () => {
    const [row] = priceRowsFrom([
      { governorate_key: "cairo", area_key: null, fee_egp: "60.00", duration_min_days: 1, duration_max_days: 3, next_day_available: true, next_day_fee_egp: "40.00", free_shipping_min_egp: "1000.00" },
    ]);
    expect(row).toMatchObject({ minDays: "1", maxDays: "3", nextDay: true, nextDayFee: "40", freeMin: "1000" });
  });

  it("needs both duration bounds, min not above max", () => {
    expect(validatePrices([price("a", "", "1", "a", { minDays: "1", maxDays: "3" })])).toEqual([]);
    expect(validatePrices([price("a", "", "1", "a", { minDays: "١", maxDays: "" })])).toEqual([{ row: 1, field: "duration" }]);
    expect(validatePrices([price("a", "", "1", "b", { minDays: "5", maxDays: "2" })])).toEqual([{ row: 1, field: "duration" }]);
    expect(validatePrices([price("a", "", "1", "c", { minDays: "1", maxDays: "31" })])).toEqual([{ row: 1, field: "duration" }]);
  });

  it("needs a fee when next day is on, and a positive minimum", () => {
    expect(validatePrices([price("a", "", "1", "a", { nextDay: true, nextDayFee: "" })])).toEqual([{ row: 1, field: "nextDayFee" }]);
    expect(validatePrices([price("a", "", "1", "b", { nextDay: true, nextDayFee: "0" })])).toEqual([]);
    expect(validatePrices([price("a", "", "1", "c", { freeMin: "0" })])).toEqual([{ row: 1, field: "freeMin" }]);
    const [t] = toPrices([price("a", "", "1", "d", { nextDay: true, nextDayFee: "40", minDays: "1", maxDays: "2", freeMin: "500" })]);
    expect(t).toMatchObject({ next_day_available: true, next_day_fee_egp: 40, duration_min_days: 1, duration_max_days: 2, free_shipping_min_egp: 500 });
    expect(toPrices([price("a", "", "1", "e", { nextDayFee: "40" })])[0]!.next_day_fee_egp).toBeNull();
  });

  it("counts the places still waiting for a price", () => {
    expect(unpricedCount([
      { governorate_key: "cairo", area_key: null, fee_egp: 0 },
      { governorate_key: "giza", area_key: null, fee_egp: null },
    ])).toBe(1);
  });
});

describe("showroom-wide settings", () => {
  it("parses days and minimums", () => {
    expect(parseDays("٣")).toBe(3);
    expect(parseDays("31")).toBeNull();
    expect(parseDays("1.5")).toBeNull();
    expect(parseMinimum("0")).toBeNull();
    expect(parseMinimum("1500.5")).toBe(1500.5);
    expect(parseMinimum("1000001")).toBeNull();
  });

  it("validates preparation days, minimum and the pickup note", () => {
    const ok = settingsFormFrom({ preparation_days: 2, free_shipping_min_egp: "5000.00", pickup_instructions: null });
    expect(ok).toEqual({ prep: "2", freeMin: "5000", pickupNote: "" });
    expect(validateSettings(ok)).toEqual([]);
    expect(validateSettings({ prep: "40", freeMin: "0", pickupNote: "x".repeat(301) })).toEqual(["prep", "freeMin", "pickupNote"]);
    expect(validateSettings({ prep: "", freeMin: "", pickupNote: "" })).toEqual([]);
  });

  it("sends blanks as null so the stored value is cleared", () => {
    expect(toSettings({ prep: "", freeMin: "", pickupNote: "  " })).toEqual({
      preparation_days: null, free_shipping_min_egp: null, pickup_instructions: null,
    });
    expect(toSettings({ prep: "0", freeMin: "250", pickupNote: " Ask at desk " })).toEqual({
      preparation_days: 0, free_shipping_min_egp: 250, pickup_instructions: "Ask at desk",
    });
  });
});
