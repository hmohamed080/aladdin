import type { DeliveryPlace, DeliveryRate } from "@/server/actions/marketplace-seller";

/**
 * The showroom's delivery setup has two steps, each on its own page:
 *   1. AREAS  — WHERE it delivers: whole governorates and/or single areas inside a governorate.
 *   2. PRICES — WHAT it charges for each of those places (a blank price = not set yet, so buyers cannot
 *               choose delivery there).
 * This module is the pure part of both screens (no React, no network).
 */

/** What the database stores for one place. */
export type StoredRate = {
  governorate_key: string;
  area_key: string | null;
  fee_egp: number | string | null;
  duration_min_days?: number | null;
  duration_max_days?: number | null;
  next_day_available?: boolean;
  next_day_fee_egp?: number | string | null;
  free_shipping_min_egp?: number | string | null;
};

/** The showroom-wide delivery settings as the database returns them. */
export type StoredSettings = {
  preparation_days: number | null;
  order_cutoff_time: string | null;
  free_shipping_min_egp: number | string | null;
  pickup_instructions: string | null;
};
export const EMPTY_SETTINGS: StoredSettings = { preparation_days: null, order_cutoff_time: null, free_shipping_min_egp: null, pickup_instructions: null };

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

/** One covered place with the terms being typed (blank = not set). */
export type PriceRow = {
  key: string;
  governorate: string;
  area: string;
  fee: string;
  minDays: string;
  maxDays: string;
  nextDay: boolean;
  nextDayFee: string;
  freeMin: string;
};
export type PriceField = "fee" | "duration" | "nextDayFee" | "freeMin";
export type PriceProblem = { row: number; field?: PriceField };

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

/** A whole number of days from 0 to `max` (Arabic digits accepted). */
export function parseDays(input: string, max = 30): number | null {
  const s = normalizeFee(input);
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n <= max ? n : null;
}

/** A free-shipping minimum order value: more than 0, up to 1,000,000 EGP, at most two decimals. */
export function parseMinimum(input: string): number | null {
  const s = normalizeFee(input);
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 1000000 ? n : null;
}

const numText = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)));

/** Governorates first, each followed by its areas, in the order the database returned them. */
export function priceRowsFrom(rates: readonly StoredRate[]): PriceRow[] {
  return rates.map((r, i) => ({
    key: `p${i}`,
    governorate: r.governorate_key,
    area: r.area_key ?? "",
    fee: numText(r.fee_egp),
    minDays: numText(r.duration_min_days),
    maxDays: numText(r.duration_max_days),
    nextDay: Boolean(r.next_day_available),
    nextDayFee: numText(r.next_day_fee_egp),
    freeMin: numText(r.free_shipping_min_egp),
  }));
}

/** Blank is allowed (not set); anything typed must be valid. Duration needs both bounds, min <= max. */
export function validatePrices(rows: readonly PriceRow[]): PriceProblem[] {
  const problems: PriceProblem[] = [];
  rows.forEach((r, i) => {
    const row = i + 1;
    if (r.fee.trim() !== "" && parseFee(r.fee) === null) problems.push({ row, field: "fee" });
    const min = r.minDays.trim() === "" ? undefined : parseDays(r.minDays);
    const max = r.maxDays.trim() === "" ? undefined : parseDays(r.maxDays);
    const oneBlank = (r.minDays.trim() === "") !== (r.maxDays.trim() === "");
    if (oneBlank || min === null || max === null || (min !== undefined && max !== undefined && min > max)) problems.push({ row, field: "duration" });
    if (r.nextDay && parseFee(r.nextDayFee) === null) problems.push({ row, field: "nextDayFee" });
    if (r.freeMin.trim() !== "" && parseMinimum(r.freeMin) === null) problems.push({ row, field: "freeMin" });
  });
  return problems;
}

export type PlaceTerms = DeliveryRate & {
  duration_min_days: number | null;
  duration_max_days: number | null;
  next_day_available: boolean;
  next_day_fee_egp: number | null;
  free_shipping_min_egp: number | null;
};

export function toPrices(rows: readonly PriceRow[]): PlaceTerms[] {
  return rows.map((r) => ({
    governorate_key: r.governorate,
    area_key: r.area || null,
    fee_egp: r.fee.trim() === "" ? null : parseFee(r.fee),
    duration_min_days: r.minDays.trim() === "" ? null : parseDays(r.minDays),
    duration_max_days: r.maxDays.trim() === "" ? null : parseDays(r.maxDays),
    next_day_available: r.nextDay,
    next_day_fee_egp: r.nextDay ? parseFee(r.nextDayFee) : null,
    free_shipping_min_egp: r.freeMin.trim() === "" ? null : parseMinimum(r.freeMin),
  }));
}

/** How many covered places still have no price. */
export const unpricedCount = (rates: readonly StoredRate[]) => rates.filter((r) => r.fee_egp === null || r.fee_egp === undefined).length;

/* ------------------------------------------------------------- showroom-wide */

export type SettingsForm = { prep: string; cutoff: string; freeMin: string; pickupNote: string };
export type SettingsProblem = "prep" | "cutoff" | "freeMin" | "pickupNote";

export const settingsFormFrom = (s: StoredSettings): SettingsForm => ({
  prep: numText(s.preparation_days),
  cutoff: s.order_cutoff_time ?? "",
  freeMin: numText(s.free_shipping_min_egp),
  pickupNote: s.pickup_instructions ?? "",
});

export function validateSettings(f: SettingsForm): SettingsProblem[] {
  const out: SettingsProblem[] = [];
  if (f.prep.trim() !== "" && parseDays(f.prep) === null) out.push("prep");
  if (f.cutoff.trim() !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.cutoff.trim())) out.push("cutoff");
  if (f.freeMin.trim() !== "" && parseMinimum(f.freeMin) === null) out.push("freeMin");
  if (f.pickupNote.trim().length > 300) out.push("pickupNote");
  return out;
}

/** Every key is sent, so a blank box clears the stored value. */
export function toSettings(f: SettingsForm): Record<string, unknown> {
  return {
    preparation_days: f.prep.trim() === "" ? null : parseDays(f.prep),
    order_cutoff_time: f.cutoff.trim() === "" ? null : f.cutoff.trim(),
    free_shipping_min_egp: f.freeMin.trim() === "" ? null : parseMinimum(f.freeMin),
    pickup_instructions: f.pickupNote.trim() === "" ? null : f.pickupNote.trim(),
  };
}
