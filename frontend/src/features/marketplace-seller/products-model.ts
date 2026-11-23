/**
 * The seller's Marketplace product list, as the page shows it — pure, so the
 * stock rules, filters and paging are testable without a database.
 *
 * ONE ROW PER PRODUCT. A product's variants are summarised: its SKUs, its
 * lowest active price ("from"), and the units AVAILABLE to sell (on hand minus
 * reserved) across its active variants at active stock locations.
 */

/** Below this many sellable units a product counts as low on stock. */
export const LOW_STOCK_THRESHOLD = 10;

/** Rows per page. */
export const SELLER_PRODUCTS_PAGE_SIZE = 20;

export const PRODUCT_STATUSES = ["draft", "published", "unpublished", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const STOCK_STATES = ["in", "low", "out"] as const;
export type StockState = (typeof STOCK_STATES)[number];

/**
 * What the row's status pill says. Stock trumps publication: a published
 * product with nothing to sell is, to the seller, first of all "out of stock".
 */
export type DisplayState = "out" | "low" | ProductStatus;

export type SellerProductRow = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  typeKey: string | null;
  typeNameAr: string | null;
  typeNameEn: string | null;
  status: ProductStatus;
  skus: string[];
  fromPrice: number | null;
  quantity: number;
  /**
   * Where an inline − / + may act: exactly one active variant held at most at one
   * active location. Anything with more variants or locations is edited on the
   * product page, where the variant and location are explicit.
   */
  inlineStock: { variantId: string; locationId: string | null; onHand: number; reserved: number; available: number } | null;
  /** Object key of the primary product image, if one is confirmed. */
  primaryImageKey: string | null;
};

/** The raw shape returned by the page's single nested read. */
export type RawProduct = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  description_en: string | null;
  status: string;
  marketplace_product_types: { key: string; name_ar: string; name_en: string } | null;
  marketplace_product_images?: { object_key: string; is_primary: boolean; variant_id: string | null; upload_state: string; status: string }[];
  marketplace_product_variants: {
    id: string;
    sku: string;
    price_egp: number | string;
    status: string;
    marketplace_inventory_levels: {
      location_id: string;
      on_hand: number | null;
      reserved: number | null;
      available: number | null;
      marketplace_stock_locations: { is_active: boolean } | null;
    }[];
  }[];
};

export function toRow(p: RawProduct): SellerProductRow {
  const active = p.marketplace_product_variants.filter((v) => v.status === "active");
  const prices = active.map((v) => Number(v.price_egp)).filter((n) => Number.isFinite(n));
  const quantity = active.reduce(
    (sum, v) =>
      sum +
      v.marketplace_inventory_levels.reduce(
        (s, l) => s + (l.marketplace_stock_locations?.is_active ? Math.max(0, l.available ?? 0) : 0),
        0,
      ),
    0,
  );
  const status = (PRODUCT_STATUSES as readonly string[]).includes(p.status) ? (p.status as ProductStatus) : "draft";
  let inlineStock: SellerProductRow["inlineStock"] = null;
  if (active.length === 1) {
    const v = active[0]!;
    const levels = v.marketplace_inventory_levels.filter((l) => l.marketplace_stock_locations?.is_active);
    if (levels.length === 0) inlineStock = { variantId: v.id, locationId: null, onHand: 0, reserved: 0, available: 0 };
    else if (levels.length === 1) {
      const l = levels[0]!;
      inlineStock = { variantId: v.id, locationId: l.location_id, onHand: l.on_hand ?? 0, reserved: l.reserved ?? 0, available: l.available ?? 0 };
    }
  }
  const primary = (p.marketplace_product_images ?? []).find(
    (i) => i.is_primary && !i.variant_id && i.upload_state === "confirmed" && i.status !== "rejected",
  );
  return {
    id: p.id,
    slug: p.slug,
    nameAr: p.name_ar,
    nameEn: p.name_en,
    descriptionAr: p.description_ar,
    descriptionEn: p.description_en,
    typeKey: p.marketplace_product_types?.key ?? null,
    typeNameAr: p.marketplace_product_types?.name_ar ?? null,
    typeNameEn: p.marketplace_product_types?.name_en ?? null,
    status,
    skus: active.map((v) => v.sku),
    fromPrice: prices.length ? Math.min(...prices) : null,
    quantity,
    inlineStock,
    primaryImageKey: primary?.object_key ?? null,
  };
}

export function stockState(quantity: number): StockState {
  if (quantity <= 0) return "out";
  if (quantity < LOW_STOCK_THRESHOLD) return "low";
  return "in";
}

export function displayState(row: SellerProductRow): DisplayState {
  const s = stockState(row.quantity);
  // A draft or archived product is not on sale, so its stock is not the headline.
  if (row.status === "published" && s !== "in") return s;
  return row.status;
}

export type SellerProductStats = { total: number; published: number; draft: number; lowStock: number };

/** Counts over the WHOLE catalogue, never the filtered view. */
export function productStats(rows: readonly SellerProductRow[]): SellerProductStats {
  return {
    total: rows.length,
    published: rows.filter((r) => r.status === "published").length,
    draft: rows.filter((r) => r.status === "draft").length,
    // Low, not out: the tile links to the `stock=low` filter, so it counts exactly what that shows.
    lowStock: rows.filter((r) => r.status !== "archived" && stockState(r.quantity) === "low").length,
  };
}

export type SellerProductFilters = {
  q?: string;
  type?: string;
  status?: ProductStatus;
  stock?: StockState;
};

/** Validates URL input against what the page offers — never passed through raw. */
export function parseFilters(sp: Record<string, string | undefined>, typeKeys: readonly string[]): SellerProductFilters {
  const q = sp.q?.trim() || undefined;
  const type = sp.type && typeKeys.includes(sp.type) ? sp.type : undefined;
  const status = (PRODUCT_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as ProductStatus) : undefined;
  const stock = (STOCK_STATES as readonly string[]).includes(sp.stock ?? "") ? (sp.stock as StockState) : undefined;
  return { q, type, status, stock };
}

export function applyFilters(rows: readonly SellerProductRow[], f: SellerProductFilters): SellerProductRow[] {
  const needle = f.q?.toLocaleLowerCase();
  return rows.filter((r) => {
    if (f.type && r.typeKey !== f.type) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.stock && stockState(r.quantity) !== f.stock) return false;
    if (needle) {
      const hay = [r.nameAr, r.nameEn, ...r.skus].map((s) => s.toLocaleLowerCase());
      if (!hay.some((s) => s.includes(needle))) return false;
    }
    return true;
  });
}

export function paginate<T>(rows: readonly T[], requested: string | undefined, size = SELLER_PRODUCTS_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const n = Number.parseInt(requested ?? "1", 10);
  const page = Number.isFinite(n) ? Math.min(Math.max(n, 1), pageCount) : 1;
  return { page, pageCount, items: rows.slice((page - 1) * size, page * size) };
}

/** One item of `marketplace_seller_products_page` (Migration 09, server-side paging). */
export type PagedProduct = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  description_en: string | null;
  status: string;
  type_key: string | null;
  type_name_ar: string | null;
  type_name_en: string | null;
  skus: string[];
  variant_count: number;
  from_price: number | string | null;
  quantity: number | string;
  inline_stock: { variant_id: string; location_id: string | null; on_hand: number; reserved: number; available: number } | null;
  cover_key: string | null;
};

export type PagedProducts = {
  total: number;
  stats: { total: number; published: number; draft: number; low_stock: number; out_of_stock: number; variants: number };
  items: PagedProduct[];
};

export function fromPaged(p: PagedProduct): SellerProductRow & { variantCount: number } {
  const status = (PRODUCT_STATUSES as readonly string[]).includes(p.status) ? (p.status as ProductStatus) : "draft";
  const s = p.inline_stock;
  return {
    id: p.id,
    slug: p.slug,
    nameAr: p.name_ar,
    nameEn: p.name_en,
    descriptionAr: p.description_ar,
    descriptionEn: p.description_en,
    typeKey: p.type_key,
    typeNameAr: p.type_name_ar,
    typeNameEn: p.type_name_en,
    status,
    skus: p.skus ?? [],
    variantCount: Number(p.variant_count ?? 0),
    fromPrice: p.from_price === null ? null : Number(p.from_price),
    quantity: Number(p.quantity ?? 0),
    inlineStock: s
      ? { variantId: s.variant_id, locationId: s.location_id, onHand: Number(s.on_hand), reserved: Number(s.reserved), available: Number(s.available) }
      : null,
    primaryImageKey: p.cover_key,
  };
}

/** Page numbers to draw: first, last, and a window around the current page (null = gap). */
export function pageWindow(page: number, pageCount: number, radius = 2): (number | null)[] {
  const out: (number | null)[] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    if (n === 1 || n === pageCount || Math.abs(n - page) <= radius) out.push(n);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}
