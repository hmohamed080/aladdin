/**
 * Shapes and limits of the public Marketplace RPCs (Migrations 09/10), shared by
 * the server loaders and the client storefront. No runtime dependencies.
 */

export type PublicCard = {
  slug: string;
  name_ar: string;
  name_en: string;
  brand: string | null;
  product_type_key: string;
  product_type_name_ar: string;
  product_type_name_en: string;
  category_key: string;
  category_name_ar: string;
  category_name_en: string;
  seller_name: string;
  from_price_egp: number | null;
  in_stock: boolean;
  variant_count: number;
  image_id: string | null;
  /** distinct swatch colours of the active variants */
  colors: string[];
};

export type PublicPage = { total: number; limit: number; offset: number; items: PublicCard[] };

export type FacetType = { key: string; name_ar: string; name_en: string; count: number };
export type FacetCategory = FacetType & { types: FacetType[] };
export type FacetOption = { key: string; name_ar: string; name_en: string; swatch_hex: string | null; count: number };
export type FacetFilter = { key: string; name_ar: string; name_en: string; options: FacetOption[] };
export type Facets = { categories: FacetCategory[]; price: { min: number | null; max: number | null }; filters: FacetFilter[] };

export type AttrValue =
  | { key: string; name_ar: string; name_en: string; swatch_hex: string | null }
  | number
  | boolean
  | string
  | null;

export type PublicAttribute = {
  key: string;
  name_ar: string;
  name_en: string;
  data_type: string;
  unit_kind: string | null;
  unit_ar: string | null;
  unit_en: string | null;
  value: AttrValue;
};

export type PublicVariant = {
  sku: string;
  selling_unit: string;
  price_egp: number;
  purchasable: boolean;
  attributes: PublicAttribute[];
};

export type PublicProduct = {
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  description_en: string | null;
  brand: string | null;
  product_type_key: string;
  product_type_name_ar: string;
  product_type_name_en: string;
  category_key: string;
  category_name_ar: string;
  category_name_en: string;
  seller_name: string;
  cover_image_id: string | null;
  attributes: PublicAttribute[];
  variants: PublicVariant[];
  images: { image_id: string; is_primary: boolean; alt_text_ar: string | null; alt_text_en: string | null; variant_sku: string | null }[];
};

export const PUBLIC_PAGE_SIZE = 24;
export const PUBLIC_SORTS = ["newest", "price_asc", "price_desc"] as const;
export type PublicSort = (typeof PUBLIC_SORTS)[number];

/* ---------- guest cart (Migration 12) ---------- */

/** Most lines the cart quote accepts (the RPC refuses more); the cart refuses to grow past it. */
export const CART_MAX_LINES = 50;
/** One line never asks for more than this, whatever the showroom stocks (matches the RPC's availability cap). */
export const CART_MAX_QTY = 9999;

/** A cart line as the browser stores it: the product and variant are named by their public slug and SKU. */
export type CartRef = { slug: string; sku: string };
export type StoredCartLine = CartRef & { qty: number };

export type CartQuoteLine =
  | ({ status: "unavailable" } & CartRef)
  | ({
      status: "ok";
      name_ar: string;
      name_en: string;
      brand: string | null;
      selling_unit: string;
      price_egp: number;
      /** how many the showroom can supply right now (capped at CART_MAX_QTY) */
      available: number;
      /** index into `sellers` */
      seller: number;
      image_id: string | null;
      attributes: PublicAttribute[];
    } & CartRef);

export type CartDelivery =
  | { status: "available"; fee_egp: number }
  | { status: "not_available" }
  | { status: "needs_area" };

export type CartSeller = { index: number; name: string; pickup_available: boolean; delivery: CartDelivery };

export type CartQuote = { lines: CartQuoteLine[]; sellers: CartSeller[] };
