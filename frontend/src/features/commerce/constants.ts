import type { Database } from "@/types/database.types";
import type { Locale } from "@/lib/i18n/locales";

/**
 * Shared commerce constants and formatters. Enum value lists mirror the DB enums
 * exactly (product_category / product_unit); the UI maps each value to a
 * bilingual label via i18n keys `commerce.categories.*` / `commerce.units.*`.
 */
export type ProductCategory = Database["public"]["Enums"]["product_category"];
export type ProductUnit = Database["public"]["Enums"]["product_unit"];

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  "finishing",
  "construction",
  "interior_design",
  "furnishing",
  "supply",
  "tools",
  "other",
];

export const PRODUCT_UNITS: ProductUnit[] = [
  "piece",
  "box",
  "set",
  "meter",
  "square_meter",
  "linear_meter",
  "kilogram",
  "ton",
  "liter",
  "roll",
  "bag",
  "pack",
];

/** Locale-aware EGP money formatting (Egyptian pound). */
export function formatMoney(value: number | string | null, locale: Locale): string {
  if (value === null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 2,
  }).format(n);
}

/** Plain quantity formatting (trims trailing zeros for whole numbers). */
export function formatQuantity(value: number | string, locale: Locale): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    maximumFractionDigits: 2,
  }).format(n);
}
