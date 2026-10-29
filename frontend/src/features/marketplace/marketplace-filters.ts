import { typeSchemas } from "./marketplace-schema";
import type { FieldValue, PreviewProduct, PreviewVariant, SchemaField, TypeKey } from "./marketplace-types";
import { TYPE_KEYS } from "./marketplace-types";

export type SortKey = "newest" | "best_selling" | "price_asc" | "price_desc";

export type Filters = {
  type: TypeKey | null;
  q: string;
  sort: SortKey;
  inStockOnly: boolean;
  /** option / color keys, and "true" for yes/no fields — OR within a field */
  choices: Record<string, string[]>;
  /** measurement ranges in MILLIMETRES (the canonical unit); inclusive */
  ranges: Record<string, { min?: number; max?: number }>;
  /** offer kinds to show (OR); empty = no offer filter */
  offers: ("regular" | "flash")[];
  /** price bounds in EGP, inclusive, applied to the variant price */
  priceMin?: number;
  priceMax?: number;
  /** 1-based results page */
  page: number;
};

export const PAGE_SIZE = 12;

export const emptyFilters = (): Filters => ({ type: null, q: "", sort: "newest", inStockOnly: false, choices: {}, ranges: {}, offers: [], page: 1 });

/** Filterable fields for the active type (all types when none is active share only fields with the same key). */
export function filterableFields(type: TypeKey | null): SchemaField[] {
  if (!type) return [];
  return typeSchemas[type].filter((f) => f.filterable);
}

export const isPurchasable = (v: PreviewVariant) => v.stock > 0;

const MM_PER_CM = 10;
export const mmToCm = (mm: number) => mm / MM_PER_CM;
export const cmToMm = (cm: number) => cm * MM_PER_CM;

function valueMatchesChoice(value: FieldValue | undefined, wanted: string[]): boolean {
  if (value === undefined) return false;
  return wanted.some((w) => String(value) === w);
}

function inRange(value: FieldValue | undefined, r: { min?: number; max?: number }): boolean {
  if (typeof value !== "number") return false;
  if (r.min !== undefined && value < r.min) return false;
  if (r.max !== undefined && value > r.max) return false;
  return true;
}

/**
 * Semantics (docs/marketplace §5): AND between filter fields, OR within a
 * multi-select field. Product-scope fields test the product; variant-scope
 * fields must ALL be satisfied by ONE AND THE SAME variant.
 */
export function matchingVariants(product: PreviewProduct, f: Filters): PreviewVariant[] {
  const fields = typeSchemas[product.type];
  const scopeOf = (key: string) => fields.find((x) => x.key === key)?.scope;

  for (const [key, wanted] of Object.entries(f.choices)) {
    if (wanted.length === 0 || scopeOf(key) !== "product") continue;
    if (!valueMatchesChoice(product.values[key], wanted)) return [];
  }
  return product.variants.filter((v) => {
    if (f.inStockOnly && !isPurchasable(v)) return false;
    if (f.priceMin !== undefined && v.priceEgp < f.priceMin) return false;
    if (f.priceMax !== undefined && v.priceEgp > f.priceMax) return false;
    for (const [key, wanted] of Object.entries(f.choices)) {
      if (wanted.length === 0 || scopeOf(key) !== "variant") continue;
      if (!valueMatchesChoice(v.values[key], wanted)) return false;
    }
    for (const [key, r] of Object.entries(f.ranges)) {
      if (scopeOf(key) !== "variant") continue;
      if (!inRange(v.values[key], r)) return false;
    }
    return true;
  });
}

/** A choice filter whose field does not exist for the product's type excludes it (no silent pass). */
function productPassesChoicesForUnknownFields(product: PreviewProduct, f: Filters): boolean {
  const known = new Set(typeSchemas[product.type].map((x) => x.key));
  for (const [key, wanted] of Object.entries(f.choices)) if (wanted.length > 0 && !known.has(key)) return false;
  for (const key of Object.keys(f.ranges)) if (!known.has(key)) return false;
  return true;
}

export type ListedProduct = {
  product: PreviewProduct;
  variants: PreviewVariant[];
  /** lowest price among matching purchasable variants (fallback: among matching) */
  fromPriceEgp: number;
  purchasable: boolean;
  priceVaries: boolean;
};

export function listProducts(all: PreviewProduct[], f: Filters, locale: "ar" | "en"): ListedProduct[] {
  const q = f.q.trim().toLowerCase();
  const out: ListedProduct[] = [];
  for (const product of all) {
    if (f.type && product.type !== f.type) continue;
    if (q) {
      const hay = `${product.name[locale]} ${product.name.ar} ${product.name.en} ${product.brand ?? ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    if (f.offers.length > 0 && !(product.offer && f.offers.includes(product.offer.kind))) continue;
    if (!productPassesChoicesForUnknownFields(product, f)) continue;
    const variants = matchingVariants(product, f);
    if (variants.length === 0) continue;
    const buyable = variants.filter(isPurchasable);
    const pool = buyable.length > 0 ? buyable : variants;
    const prices = pool.map((v) => v.priceEgp);
    out.push({
      product,
      variants,
      fromPriceEgp: Math.min(...prices),
      purchasable: buyable.length > 0,
      priceVaries: new Set(prices).size > 1,
    });
  }
  const bySort: Record<SortKey, (a: ListedProduct, b: ListedProduct) => number> = {
    newest: (a, b) => b.product.publishedAt.localeCompare(a.product.publishedAt),
    best_selling: (a, b) => (b.product.salesCount ?? 0) - (a.product.salesCount ?? 0),
    price_asc: (a, b) => a.fromPriceEgp - b.fromPriceEgp,
    price_desc: (a, b) => b.fromPriceEgp - a.fromPriceEgp,
  };
  return out.sort(bySort[f.sort]);
}

/* ------------------------------ URL state ------------------------------ */

const SORTS: SortKey[] = ["newest", "best_selling", "price_asc", "price_desc"];

/**
 * Shareable URL grammar: ?type=&q=&sort=&stock=1&offer=regular,flash&pmin=&pmax=&page=
 * &a.<field>=k1,k2&r.<field>=<minCm>-<maxCm>
 * Unknown keys are dropped, never errors.
 */
export function parseFilters(params: URLSearchParams): Filters {
  const f = emptyFilters();
  const type = params.get("type");
  if (type && (TYPE_KEYS as readonly string[]).includes(type)) f.type = type as TypeKey;
  f.q = (params.get("q") ?? "").slice(0, 80);
  const sort = params.get("sort") as SortKey | null;
  if (sort && SORTS.includes(sort)) f.sort = sort;
  f.inStockOnly = params.get("stock") === "1";
  // Colour is shared by every type, so it can also filter the all-types listing.
  const allowed = new Set([...filterableFields(f.type).map((x) => x.key), "color"]);
  const offers = (params.get("offer") ?? "").split(",").filter((x): x is "regular" | "flash" => x === "regular" || x === "flash");
  f.offers = [...new Set(offers)];
  const num = (v: string | null) => (v !== null && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);
  const priceMin = num(params.get("pmin"));
  const priceMax = num(params.get("pmax"));
  if (priceMin !== undefined) f.priceMin = priceMin;
  if (priceMax !== undefined) f.priceMax = priceMax;
  const page = Number(params.get("page"));
  if (Number.isInteger(page) && page > 1 && page < 1000) f.page = page;
  for (const [name, raw] of params.entries()) {
    if (name.startsWith("a.")) {
      const key = name.slice(2);
      if (allowed.has(key)) f.choices[key] = raw.split(",").filter(Boolean).slice(0, 20);
    } else if (name.startsWith("r.")) {
      const key = name.slice(2);
      if (!allowed.has(key)) continue;
      const [lo, hi] = raw.split("-");
      const min = lo ? Number(lo) : undefined;
      const max = hi ? Number(hi) : undefined;
      const range: { min?: number; max?: number } = {};
      if (min !== undefined && Number.isFinite(min)) range.min = cmToMm(min);
      if (max !== undefined && Number.isFinite(max)) range.max = cmToMm(max);
      if (range.min !== undefined || range.max !== undefined) f.ranges[key] = range;
    }
  }
  return f;
}

export function serializeFilters(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.type) p.set("type", f.type);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.sort !== "newest") p.set("sort", f.sort);
  if (f.inStockOnly) p.set("stock", "1");
  if (f.offers.length > 0) p.set("offer", f.offers.join(","));
  if (f.priceMin !== undefined) p.set("pmin", String(f.priceMin));
  if (f.priceMax !== undefined) p.set("pmax", String(f.priceMax));
  if (f.page > 1) p.set("page", String(f.page));
  for (const [key, vals] of Object.entries(f.choices)) if (vals.length > 0) p.set(`a.${key}`, vals.join(","));
  for (const [key, r] of Object.entries(f.ranges)) {
    if (r.min === undefined && r.max === undefined) continue;
    p.set(`r.${key}`, `${r.min !== undefined ? mmToCm(r.min) : ""}-${r.max !== undefined ? mmToCm(r.max) : ""}`);
  }
  return p;
}

/** Options actually present in the sample catalogue for a field (keeps filter lists honest). */
export function presentOptionKeys(all: PreviewProduct[], type: TypeKey, field: SchemaField): string[] {
  const seen = new Set<string>();
  for (const p of all) {
    if (p.type !== type) continue;
    if (field.scope === "product") {
      const v = p.values[field.key];
      if (v !== undefined) seen.add(String(v));
    } else {
      for (const variant of p.variants) {
        const v = variant.values[field.key];
        if (v !== undefined) seen.add(String(v));
      }
    }
  }
  return [...seen];
}
