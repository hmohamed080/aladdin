/**
 * The Marketplace product form's data model — shared by the server pages and the
 * client form, pure and testable. The DATABASE decides which fields a product
 * type has (`marketplace_product_type_attributes`); this file only describes how
 * a form holds those fields and turns them into the save payload.
 */

export const SELLING_UNITS = ["piece", "roll", "board", "bar", "linear_meter", "square_meter", "pack"] as const;
export type SellingUnit = (typeof SELLING_UNITS)[number];

export type AttributeDataType = "option" | "multi_option" | "number" | "measurement" | "boolean" | "text";

export type AttributeOption = { key: string; nameAr: string; nameEn: string; swatchHex: string | null };

export type AttributeField = {
  key: string;
  nameAr: string;
  nameEn: string;
  dataType: AttributeDataType;
  unitAr: string | null;
  unitEn: string | null;
  level: "product" | "variant";
  required: boolean;
  options: AttributeOption[];
};

export type ProductTypeSchema = {
  key: string;
  nameAr: string;
  nameEn: string;
  categoryKey: string;
  categoryNameAr: string;
  categoryNameEn: string;
  fields: AttributeField[];
};

/** A form value: option key, list of option keys, yes/no, or the typed text of a number / text field. */
export type AttrValue = string | string[] | boolean | null;

export type VariantDraft = {
  /** Stable client id for React keys; never sent. */
  uid: string;
  id?: string;
  sku: string;
  sellingUnit: SellingUnit | "";
  price: string;
  status: "active" | "inactive";
  attributes: Record<string, AttrValue>;
  /** New variants only: units to enter at the main stock location after the first save. */
  initialQty: string;
};

export type ProductDraft = {
  id?: string;
  organizationId: string;
  typeKey: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  brand: string;
  externalRef: string;
  slug: string;
  /** Units at or below which the owner is notified (per product); the empty string keeps the stored value. */
  lowStockThreshold: string;
  attributes: Record<string, AttrValue>;
  variants: VariantDraft[];
};

/**
 * Row ids for variants added in the browser. Rows that exist at first render use
 * a DETERMINISTIC id (the variant id, or "new-0") so the server-rendered HTML and
 * the browser agree; only rows added later by a click take one from this counter.
 */
let uidCounter = 0;
export function newUid(): string {
  uidCounter += 1;
  return `new-${uidCounter}`;
}

export function emptyVariant(uid: string = newUid()): VariantDraft {
  return { uid, sku: "", sellingUnit: "", price: "", status: "active", attributes: {}, initialQty: "" };
}

export function fieldsAt(schema: ProductTypeSchema | undefined, level: "product" | "variant"): AttributeField[] {
  return schema ? schema.fields.filter((f) => f.level === level) : [];
}

/** A value the form considers "not filled in". */
export function isEmptyValue(v: AttrValue | undefined): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** One form value as the RPC expects it, or undefined to leave the field unset. */
export function toPayloadValue(field: AttributeField, v: AttrValue | undefined): unknown {
  if (isEmptyValue(v)) return undefined;
  switch (field.dataType) {
    case "number":
    case "measurement": {
      const n = Number(String(v).trim());
      return Number.isFinite(n) ? n : String(v); // let the server name the invalid field
    }
    case "boolean":
      return v === true || v === "true";
    case "multi_option":
      return Array.isArray(v) ? v : [String(v)];
    default:
      return typeof v === "string" ? v.trim() : v;
  }
}

function attributesPayload(fields: AttributeField[], values: Record<string, AttrValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = toPayloadValue(f, values[f.key]);
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/** The `marketplace_seller_product_save` payload. Only fields the type defines are sent. */
export function toSavePayload(draft: ProductDraft, schema: ProductTypeSchema | undefined): Record<string, unknown> {
  const productFields = fieldsAt(schema, "product");
  const variantFields = fieldsAt(schema, "variant");
  return {
    // The type is always sent: it can be changed on an existing product and the category follows it.
    ...(draft.id ? { id: draft.id, product_type_key: draft.typeKey } : { organization_id: draft.organizationId, product_type_key: draft.typeKey }),
    ...(draft.lowStockThreshold.trim() !== "" ? { low_stock_threshold: draft.lowStockThreshold.trim() } : {}),
    name_ar: draft.nameAr.trim(),
    name_en: draft.nameEn.trim(),
    description_ar: draft.descriptionAr.trim(),
    description_en: draft.descriptionEn.trim(),
    brand: draft.brand.trim(),
    external_ref: draft.externalRef.trim(),
    slug: draft.slug.trim().toLowerCase(),
    attributes: attributesPayload(productFields, draft.attributes),
    variants: draft.variants.map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      sku: v.sku.trim(),
      selling_unit: v.sellingUnit,
      price_egp: v.price.trim(),
      status: v.status,
      attributes: attributesPayload(variantFields, v.attributes),
    })),
  };
}

/** Product-level required fields still empty — shown as hints, never as a save blocker for a draft. */
export function missingRequired(draft: ProductDraft, schema: ProductTypeSchema | undefined): string[] {
  if (!schema) return [];
  const missing: string[] = [];
  for (const f of fieldsAt(schema, "product")) if (f.required && isEmptyValue(draft.attributes[f.key])) missing.push(f.key);
  for (const v of draft.variants) {
    if (v.status !== "active") continue;
    for (const f of fieldsAt(schema, "variant")) {
      if (f.required && isEmptyValue(v.attributes[f.key])) missing.push(`${v.sku.trim() || "?"}:${f.key}`);
    }
  }
  return missing;
}

/** Converts a stored value (from `marketplace_seller_product_get`) back to a form value. */
export function fromStoredValue(field: AttributeField | undefined, v: unknown): AttrValue {
  if (v === null || v === undefined) return null;
  if (field?.dataType === "boolean") return v === true;
  if (field?.dataType === "multi_option") return Array.isArray(v) ? v.map(String) : [String(v)];
  return String(v);
}

/** What the page knows beyond the draft when it validates. */
export type FormContext = {
  /** An active variant already holds sellable units (saved products). */
  storedStock: boolean;
  /** At least one image is chosen (queued on a new product, confirmed on a saved one). */
  hasImage: boolean;
};

/**
 * EVERY required field of the product page, as the ids the form highlights in red. Pure and shared by Save,
 * Save as draft and Publish: the same list drives what is red and what blocks a save. Specification fields come
 * from the type (the database decides which are required); the rest are the conditions publication needs
 * (name, SKU, unit, price, stock, a main image) so a seller never meets a separate "readiness" list.
 */
export function requiredIssues(draft: ProductDraft, schema: ProductTypeSchema | undefined, ctx: FormContext): Set<string> {
  const issues = new Set<string>();
  if (!draft.typeKey) issues.add("type");
  if (!draft.nameAr.trim()) issues.add("nameAr");
  if (!draft.nameEn.trim()) issues.add("nameEn");
  const active = draft.variants.filter((v) => v.status === "active");
  if (active.length === 0) issues.add("variants");
  for (const f of fieldsAt(schema, "product")) if (f.required && isEmptyValue(draft.attributes[f.key])) issues.add(`attr:${f.key}`);
  let newStock = false;
  for (const v of draft.variants) {
    if (v.status !== "active") continue;
    if (!v.sku.trim()) issues.add(`v:${v.uid}:sku`);
    if (!v.sellingUnit) issues.add(`v:${v.uid}:unit`);
    const price = Number(v.price.trim());
    if (!v.price.trim() || !Number.isFinite(price) || price <= 0) issues.add(`v:${v.uid}:price`);
    for (const f of fieldsAt(schema, "variant")) if (f.required && isEmptyValue(v.attributes[f.key])) issues.add(`v:${v.uid}:${f.key}`);
    if (!v.id && Number.parseInt(v.initialQty, 10) > 0) newStock = true;
  }
  if (!ctx.storedStock && !newStock) issues.add("stock");
  if (!ctx.hasImage) issues.add("images");
  const thr = draft.lowStockThreshold.trim();
  if (thr !== "" && !/^[0-9]{1,6}$/.test(thr)) issues.add("lowStock");
  return issues;
}

/**
 * Conditions that only PUBLISHING needs (owner decision, 2026-11-24): a draft is saved with the product fields alone, so a
 * seller can start a product, leave, and add the stock and photos later. They stay red on the page as hints, and Publish
 * (and the database publication gate) still require them.
 */
export const PUBLICATION_ONLY_ISSUES: ReadonlySet<string> = new Set(["stock", "images"]);

/** The issues that block "Save as draft": every required product field, but not stock or images. */
export function draftBlockingIssues(issues: ReadonlySet<string>): Set<string> {
  return new Set([...issues].filter((id) => !PUBLICATION_ONLY_ISSUES.has(id)));
}

/** The seller-level publish conditions the product page shows as required rows (they are set on the store pages). */
export type StoreSetup = { paymentReady: boolean; deliveryReady: boolean };

/** True when Publish can be offered: approved by the review, the server says nothing blocks it, and the status allows it. */
export function canOfferPublish(state: { status: string; canPublish: boolean } | null): boolean {
  return Boolean(state && state.canPublish && (state.status === "draft" || state.status === "unpublished"));
}
