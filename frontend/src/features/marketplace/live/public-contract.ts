/**
 * Shapes and limits of the public Marketplace RPCs (Migrations 09/10), shared by
 * the server loaders and the client storefront. No runtime dependencies.
 */

import type { MarketplaceImageMap } from "@/lib/storage/marketplace-images";

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
  /** public slug of the showroom (its storefront); null when the organization has none */
  seller_slug?: string | null;
  /** business-verified showroom: the blue «Official Store» badge */
  seller_official?: boolean;
  from_price_egp: number | null;
  in_stock: boolean;
  /** units left when 3 or fewer (a card says "Only N left"); null otherwise, the exact stock is never published */
  stock_left?: number | null;
  /** one unit of the product ships free (flagged product, free delivery to the chosen place, or the free-shipping threshold) */
  free_shipping?: boolean;
  /** the delivery estimate, counted from today; absent in answers from before Marketplace PR 9 */
  delivery?: CardDelivery;
  variant_count: number;
  /** the SKU of the only active variant (one-click add to cart from a card); null when there are several */
  cart_sku?: string | null;
  image_id: string | null;
  /** distinct swatch colours of the active variants */
  colors: string[];
};

export type CardDelivery = {
  status: DeliveryStatus;
  configured: boolean;
  min_days: number | null;
  max_days: number | null;
  fee_egp: number | null;
  pickup_available: boolean;
};

export type PublicPage = { total: number; limit: number; offset: number; items: PublicCard[]; open?: boolean };

export type DeliveryStatus = "available" | "not_available" | "needs_area" | "pickup_only" | "none";

/**
 * The delivery-details block of the product page (`marketplace_public_delivery`): what the showroom offers one buyer
 * place, or, with no place, the range over all the places it covers. Dates are Africa/Cairo calendar days (YYYY-MM-DD).
 */
export type DeliveryTerms = {
  configured: boolean;
  status: DeliveryStatus;
  fee_egp: number | null;
  fee_min_egp: number | null;
  fee_max_egp: number | null;
  prep_days: number | null;
  min_days: number | null;
  max_days: number | null;
  earliest: string | null;
  latest: string | null;
  free_min_egp: number | null;
  next_day: { fee_egp: number; arrival: string } | null;
  pickup_available: boolean;
  pickup_instructions: string | null;
  free_shipping: boolean;
  free_reason: "product" | "free_delivery" | "threshold" | null;
  product_free: boolean;
};

export type PublicSeller = { slug: string; name: string; official: boolean; product_count: number };

/** The buyer's place: governorate key and optional area key (both from the platform's place list). */
export type BuyerPlace = { gov: string; area: string };

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
  /** units left when 3 or fewer */
  stock_left?: number | null;
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
  seller_slug?: string | null;
  seller_official?: boolean;
  stock_left?: number | null;
  ships_free?: boolean;
  /** "Made to order": returned only if defective. */
  non_returnable?: boolean;
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
      /** the showroom marked this product "free shipping" */
      free_shipping?: boolean;
    } & CartRef);

export type CartDelivery =
  | { status: "available"; fee_egp: number; free_min_egp?: number | null }
  | { status: "not_available" }
  | { status: "needs_area" };

/** How a showroom can be paid (Migration 14); `instapay` is null when it does not take InstaPay deposits. */
export type CartPaymentMethods = { cod: boolean; instapay: { deposit_percent: number } | null };

export type CartSeller = {
  index: number;
  name: string;
  pickup_available: boolean;
  delivery: CartDelivery;
  /** absent in quotes from before Migration 14 */
  payment_methods?: CartPaymentMethods;
};

/**
 * `images`: public URLs of the lines' photos, resolved on the server with the quote (one lookup for the whole
 * cart) so the browser loads each straight from the media Worker instead of asking the app route per image.
 */
export type CartQuote = { lines: CartQuoteLine[]; sellers: CartSeller[]; images?: MarketplaceImageMap };
