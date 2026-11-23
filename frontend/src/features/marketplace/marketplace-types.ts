/**
 * Marketplace preview model. It mirrors the Dynamic Product Schema design in
 * docs/marketplace/MARKETPLACE.md §3 (fields, options, colors, per-type field
 * config, product/variant values) so the UI is generated from a schema rather
 * than written per product type. Everything fed into it today is clearly
 * labelled sample data.
 */
export type Locale = "ar" | "en";
export type Bilingual = Record<Locale, string>;

export const TYPE_KEYS = [
  "wallpaper",
  "wood_alternative",
  "marble_alternative",
  "sheeboard",
  "cornice",
  "corner_trim",
  "panels",
  "skirting",
  "interior_doors",
  "armored_doors",
  "vinyl_flooring",
  "spc_flooring",
  "curtains",
  "posters",
  "paints",
] as const;
export type TypeKey = (typeof TYPE_KEYS)[number];

export type SaleUnit = "roll" | "board" | "piece" | "bar" | "linear_meter" | "square_meter" | "pack";

/** `measurement` values are numbers stored in millimetres (the canonical unit). */
/** `weight` values are numbers stored in GRAMS (canonical unit), shown as g / kg. */
export type FieldValueType = "option" | "boolean" | "measurement" | "color" | "weight";

export type FieldOption = { key: string; name: Bilingual };

export type SchemaField = {
  key: string;
  valueType: FieldValueType;
  name: Bilingual;
  /** product = describes the product; variant = differs per sellable SKU */
  scope: "product" | "variant";
  required: boolean;
  filterable: boolean;
  /** may select between variants on the product page */
  variantAxis: boolean;
  /** option-type fields only (color uses the shared colour catalog) */
  options?: FieldOption[];
};

export type FieldValue = string | number | boolean;

export type PreviewVariant = {
  id: string;
  sku: string;
  priceEgp: number;
  /** units in stock (sample numbers) */
  stock: number;
  values: Record<string, FieldValue>;
};

export type PreviewOffer = {
  kind: "regular" | "flash";
  referencePriceEgp: number;
};

export type PreviewProduct = {
  id: string;
  slug: string;
  type: TypeKey;
  name: Bilingual;
  description: Bilingual;
  brand?: string;
  unit: SaleUnit;
  minOrderQty: number;
  qtyStep: number;
  /** 1–4 images; the first is the cover (seller upload limit) */
  images: string[];
  /** product-scope field values */
  values: Record<string, FieldValue>;
  variants: PreviewVariant[];
  offer?: PreviewOffer;
  /** ISO date, sample */
  publishedAt: string;
  /** seller-written bullet points shown under the description (optional) */
  highlights?: Record<Locale, string[]>;
  /** optional photo per colour key for the colour picker (falls back to the catalogue hex) */
  swatchImages?: Record<string, string>;
  /** units sold — SAMPLE number used only to order the preview by best sellers */
  salesCount?: number;
};

export type ColorEntry = { key: string; name: Bilingual; hex: string };
