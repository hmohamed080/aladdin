import type { DeliveryPlace, DeliveryRate } from "@/server/actions/marketplace-seller";

/**
 * The showroom's delivery setup has two steps, each on its own page:
 *   1. AREAS  — WHERE it delivers: whole governorates and/or single areas inside a governorate.
 *   2. PRICES — WHAT it charges for each of those places (a blank price = not set yet, so buyers cannot
 *               choose delivery there).
 * This module is the pure part of both screens (no React, no network).
 */

/** What the database stores for one place. */
export type StoredRate = { governorate_key: string; area_key: string | null; fee_egp: number | string | null };

/* ---------------------------------------------------------------- areas */

/** One single-area line of the areas editor (a governorate is a checkbox, not a line). */
export type AreaRow = { key: string; governorate: string; area: string };
export type AreaProblem = { row: number; problem: "governorate" | "area" | "duplicate" };

/** The two halves of the stored places: governorates that are covered as a whole, and single areas. */
export function splitPlaces(rates: readonly StoredRate[]): { governorates: string[]; areas: AreaRow[] } {
  const governorates = rates.filter((r) => !r.area_key).map((r) => r.governorate_key);
  const areas = rates
    .filter((r) => r.area_key)
    .map((r, i) => ({ key: `a${i}`, governorate: r.governorate_key, area: r.area_key as string }));
  return { governorates, areas };
}

/** Typing mistakes in the single-area lines, before anything is sent (the database checks all of it again). */
export function validateAreas(rows: readonly AreaRow[]): AreaProblem[] {
  const problems: AreaProblem[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const row = i + 1;
    if (!r.governorate) problems.push({ row, problem: "governorate" });
    else if (!r.area) problems.push({ row, problem: "area" });
    else {
      const place = `${r.governorate}/${r.area}`;
      if (seen.has(place)) problems.push({ row, problem: "duplicate" });
      seen.add(place);
    }
  });
  return problems;
}

/** The places to save: every ticked governorate, then every single area. */
export function toPlaces(governorates: readonly string[], rows: readonly AreaRow[]): DeliveryPlace[] {
  return [
    ...governorates.map((g) => ({ governorate_key: g, area_key: null })),
    ...rows.map((r) => ({ governorate_key: r.governorate, area_key: r.area })),
  ];
}

/* --------------------------------------------------------------- prices */

/** One covered place with the price being typed (blank = not set). */
export type PriceRow = { key: string; governorate: string; area: string; fee: string };
export type PriceProblem = { row: number };

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** What the showroom typed, as a plain decimal string ("١٢٠٫٥" → "120.5"). */
export function normalizeFee(input: string): string {
  return input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[٫,]/g, ".");
}

/** A fee the database accepts: 0 to 100,000 EGP with at most two decimals. */
export function parseFee(input: string): number | null {
  const s = normalizeFee(input);
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n <= 100000 ? n : null;
}

/** Governorates first, each followed by its areas, in the order the database returned them. */
export function priceRowsFrom(rates: readonly StoredRate[]): PriceRow[] {
  return rates.map((r, i) => ({
    key: `p${i}`,
    governorate: r.governorate_key,
    area: r.area_key ?? "",
    fee: r.fee_egp === null || r.fee_egp === undefined ? "" : String(Number(r.fee_egp)),
  }));
}

/** A blank price is allowed (not set); anything typed must be a valid fee. */
export function validatePrices(rows: readonly PriceRow[]): PriceProblem[] {
  const problems: PriceProblem[] = [];
  rows.forEach((r, i) => {
    if (r.fee.trim() !== "" && parseFee(r.fee) === null) problems.push({ row: i + 1 });
  });
  return problems;
}

export function toPrices(rows: readonly PriceRow[]): DeliveryRate[] {
  return rows.map((r) => ({
    governorate_key: r.governorate,
    area_key: r.area || null,
    fee_egp: r.fee.trim() === "" ? null : parseFee(r.fee),
  }));
}

/** How many covered places still have no price. */
export const unpricedCount = (rates: readonly StoredRate[]) => rates.filter((r) => r.fee_egp === null || r.fee_egp === undefined).length;
