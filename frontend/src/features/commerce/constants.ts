import type { Database } from "@/types/database.types";

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

/**
 * Money and quantity are NOT redefined here.
 *
 * They used to be, with their own `Intl` calls and their own locale tag, which
 * is precisely how the Arabic UI ended up with two numeral systems on one page:
 * a quantity formatted by this file and a total formatted by `lib/ui/format`
 * could disagree about the numbering system. There is now ONE formatting layer
 * and this module re-exports from it, so the hundred-odd existing imports keep
 * working and no caller can pick the wrong copy.
 */
export { formatMoney, formatQuantity } from "@/lib/ui/format";
