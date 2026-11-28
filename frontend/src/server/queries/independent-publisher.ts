import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import { cachedReference } from "@/server/cache/reference";
import type {
  IndependentProductRow,
  IndependentPublisherView,
  CategoryOption,
} from "@/features/independent-publishing/model";
import { asRequestStatus, asPublisherStatus } from "@/features/independent-publishing/model";

/**
 * Presentation data for the independent professional's own publishing screen. Every read is a
 * `auth.uid()`-derived RPC or an RLS-scoped table read (the owner sees only their own publisher's rows);
 * nothing here grants authority and every writer re-checks it in the database.
 */
export async function loadMyIndependentPublisher(): Promise<IndependentPublisherView | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("my_independent_publisher");
  if (error || !data || data.length === 0) return null;
  const r = data[0]!;
  const kind = r.eligible_kind === "contractor" || r.eligible_kind === "engineer" ? r.eligible_kind : null;
  return {
    eligibleKind: kind,
    publisherId: r.publisher_id,
    status: asPublisherStatus(r.status),
    displayName: r.display_name,
    requestStatus: asRequestStatus(r.request_status),
    reason: r.reason,
    canRequest: r.can_request,
  };
}

export async function loadIndependentProducts(publisherId: string): Promise<IndependentProductRow[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, sku, status, version, unit, category_code, published_at, archived_at")
    .eq("publisher_id", publisherId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return [];
  const ids = (data ?? []).map((p) => p.id);
  const auds = ids.length
    ? await supabase.from("product_audiences").select("product_id, audience").in("product_id", ids)
    : { data: [] as Array<{ product_id: string; audience: string }> };
  const byProduct = new Map<string, string[]>();
  for (const a of auds.data ?? []) byProduct.set(a.product_id, [...(byProduct.get(a.product_id) ?? []), a.audience]);
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    code: p.sku,
    status: p.status === "published" ? "published" : "draft",
    version: p.version,
    unit: p.unit,
    categoryCode: p.category_code,
    archived: p.archived_at !== null,
    audiences: byProduct.get(p.id) ?? [],
  }));
}

export async function loadCategoryOptions(): Promise<CategoryOption[]> {
  return cachedReference("product-categories", async () => {
    const supabase = await getServerSupabase();
    const { data } = await supabase
      .from("product_categories")
      .select("code, label_en, label_ar")
      .eq("is_active", true)
      .order("sort_order");
    return (data ?? []).map((c) => ({ code: c.code, labelEn: c.label_en, labelAr: c.label_ar }));
  });
}
