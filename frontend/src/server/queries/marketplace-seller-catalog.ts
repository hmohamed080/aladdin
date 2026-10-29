import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { MARKETPLACE_IMAGE_BUCKET } from "@/features/marketplace-seller/errors";
import type { AttributeDataType, ProductTypeSchema } from "@/features/marketplace-seller/form-model";

type Client = SupabaseClient<Database>;

/**
 * Every active product type with the fields the DATABASE defines for it
 * (`marketplace_product_type_attributes`), in the type's own order. Read under
 * the caller's session: the taxonomy is readable reference data.
 */
export async function loadProductTypeSchemas(supabase: Client): Promise<ProductTypeSchema[]> {
  const [{ data: types }, { data: mappings }] = await Promise.all([
    supabase
      .from("marketplace_product_types")
      .select("id, key, name_ar, name_en, sort_order, marketplace_categories!inner(key, name_ar, name_en, is_active)")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("marketplace_product_type_attributes")
      .select(
        "product_type_id, level, is_required, sort_order, name_ar_override, name_en_override, " +
          "marketplace_attribute_definitions!inner(key, name_ar, name_en, data_type, display_unit_ar, display_unit_en, is_active, " +
          "marketplace_attribute_options(key, name_ar, name_en, swatch_hex, is_active, sort_order))",
      )
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  type Mapping = {
    product_type_id: string;
    level: "product" | "variant";
    is_required: boolean;
    name_ar_override: string | null;
    name_en_override: string | null;
    marketplace_attribute_definitions: {
      key: string;
      name_ar: string;
      name_en: string;
      data_type: string;
      display_unit_ar: string | null;
      display_unit_en: string | null;
      is_active: boolean;
      marketplace_attribute_options: { key: string; name_ar: string; name_en: string; swatch_hex: string | null; is_active: boolean; sort_order: number }[];
    };
  };
  const rows = ((mappings ?? []) as unknown as Mapping[]).filter((m) => m.marketplace_attribute_definitions.is_active);

  return (types ?? [])
    .filter((t) => (t.marketplace_categories as unknown as { is_active: boolean }).is_active)
    .map((t) => {
      const cat = t.marketplace_categories as unknown as { key: string; name_ar: string; name_en: string };
      return {
        key: t.key,
        nameAr: t.name_ar,
        nameEn: t.name_en,
        categoryKey: cat.key,
        categoryNameAr: cat.name_ar,
        categoryNameEn: cat.name_en,
        fields: rows
          .filter((m) => m.product_type_id === t.id)
          .map((m) => {
            const d = m.marketplace_attribute_definitions;
            return {
              key: d.key,
              nameAr: m.name_ar_override ?? d.name_ar,
              nameEn: m.name_en_override ?? d.name_en,
              dataType: d.data_type as AttributeDataType,
              unitAr: d.display_unit_ar,
              unitEn: d.display_unit_en,
              level: m.level,
              required: m.is_required,
              options: d.marketplace_attribute_options
                .filter((o) => o.is_active)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((o) => ({ key: o.key, nameAr: o.name_ar, nameEn: o.name_en, swatchHex: o.swatch_hex })),
            };
          }),
      };
    });
}

export type SellerProductImage = {
  id: string;
  variantId: string | null;
  objectKey: string;
  sortOrder: number;
  isPrimary: boolean;
  status: "pending" | "verified" | "rejected";
  uploadState: "awaiting_upload" | "confirmed";
  url: string | null;
};

export type SellerProductDetail = {
  id: string;
  organizationId: string;
  productTypeKey: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  brand: string | null;
  externalRef: string | null;
  slug: string;
  status: "draft" | "published" | "unpublished" | "archived";
  attributes: Record<string, unknown>;
  variants: {
    id: string;
    sku: string;
    selling_unit: string;
    price_egp: number;
    status: "active" | "inactive";
    attributes: Record<string, unknown>;
    stock: { location_id: string; location_name_ar: string; location_name_en: string; location_active: boolean; on_hand: number; reserved: number; available: number }[];
  }[];
  images: SellerProductImage[];
  blockers: string[];
  /** Images the seller removed whose bytes are not confirmed deleted yet (retryable). */
  pendingRemovals: { imageId: string; variantId: string | null }[];
};

/** Lifetime of the signed URLs shown to the seller. Short on purpose: see the note on deleted images in docs. */
export const IMAGE_URL_TTL_SECONDS = 300;

/** The seller''s own product for editing (the RPC enforces membership), with short-lived image URLs. */
export async function loadSellerProduct(supabase: Client, productId: string): Promise<SellerProductDetail | null> {
  const { data, error } = await supabase.rpc("marketplace_seller_product_get", { p_product_id: productId });
  if (error || !data) return null;
  const p = data as Record<string, unknown>;
  const rawImages = (p.images ?? []) as {
    id: string;
    variant_id: string | null;
    object_key: string;
    sort_order: number;
    is_primary: boolean;
    status: SellerProductImage["status"];
    upload_state: SellerProductImage["uploadState"];
  }[];
  const confirmedKeys = rawImages.filter((i) => i.upload_state === "confirmed").map((i) => i.object_key);
  const urls = new Map<string, string>();
  if (confirmedKeys.length) {
    const { data: signed } = await supabase.storage.from(MARKETPLACE_IMAGE_BUCKET).createSignedUrls(confirmedKeys, IMAGE_URL_TTL_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return {
    id: String(p.id),
    organizationId: String(p.organization_id),
    productTypeKey: String(p.product_type_key),
    nameAr: String(p.name_ar),
    nameEn: String(p.name_en),
    descriptionAr: (p.description_ar as string | null) ?? null,
    descriptionEn: (p.description_en as string | null) ?? null,
    brand: (p.brand as string | null) ?? null,
    externalRef: (p.external_ref as string | null) ?? null,
    slug: String(p.slug),
    status: p.status as SellerProductDetail["status"],
    attributes: (p.attributes ?? {}) as Record<string, unknown>,
    variants: (p.variants ?? []) as SellerProductDetail["variants"],
    images: rawImages.map((i) => ({
      id: i.id,
      variantId: i.variant_id,
      objectKey: i.object_key,
      sortOrder: i.sort_order,
      isPrimary: i.is_primary,
      status: i.status,
      uploadState: i.upload_state,
      url: urls.get(i.object_key) ?? null,
    })),
    blockers: (p.blockers ?? []) as string[],
    pendingRemovals: await loadPendingRemovals(supabase, productId),
  };
}

/** The organization's active stock locations (RLS: members only). */
export async function loadStockLocations(supabase: Client, organizationId: string) {
  const { data } = await supabase
    .from("marketplace_stock_locations")
    .select("id, name_ar, name_en")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at");
  return data ?? [];
}

async function loadPendingRemovals(supabase: Client, productId: string): Promise<SellerProductDetail["pendingRemovals"]> {
  const { data } = await supabase.rpc("marketplace_seller_images_pending_removal", { p_product_id: productId });
  return ((data ?? []) as { image_id: string; variant_id: string | null }[]).map((r) => ({ imageId: r.image_id, variantId: r.variant_id }));
}
