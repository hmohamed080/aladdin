import "server-only";
import { z } from "zod";
import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import { collectionSchema } from "@/features/engineer/collection-model";

export const loadEngineerCollections = cache(async () => {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("engineer_collections_read");
  if (error) throw error;
  return z.array(collectionSchema).parse(data);
});

/** Re-resolve titles through public projections; never retain stale private profile data. */
export async function resolveCollectionEntries(
  entries: { type: string; id: string }[],
) {
  const unique = [
    ...new Map(entries.map((e) => [`${e.type}:${e.id}`, e])).values(),
  ];
  if (unique.length > 60) {
    const resolved: Awaited<ReturnType<typeof resolveCollectionBatch>> = [];
    for (let offset = 0; offset < unique.length; offset += 60) {
      resolved.push(
        ...(await resolveCollectionBatch(unique.slice(offset, offset + 60))),
      );
    }
    return resolved;
  }
  return resolveCollectionBatch(unique);
}

async function resolveCollectionBatch(entries: { type: string; id: string }[]) {
  const supabase = await getServerSupabase();
  const ids = (type: string) =>
    entries.filter((e) => e.type === type).map((e) => e.id);
  const [profiles, organizations, products, portfolio] = await Promise.all([
    ids("profile").length
      ? supabase
          .from("profile_public_directory")
          .select("id, display_name")
          .in("id", ids("profile"))
      : null,
    ids("organization").length
      ? supabase
          .from("organization_public_directory")
          .select("id, name")
          .in("id", ids("organization"))
      : null,
    ids("product").length
      ? supabase.rpc("catalog_products").in("id", ids("product"))
      : null,
    ids("portfolio").length
      ? supabase
          .from("public_portfolio_items")
          .select("id, title")
          .in("id", ids("portfolio"))
      : null,
  ]);
  for (const result of [profiles, organizations, products, portfolio])
    if (result?.error) throw result.error;
  return entries.map((e) => ({
    ...e,
    title:
      e.type === "profile"
        ? profiles?.data?.find((r) => r.id === e.id)?.display_name
        : e.type === "organization"
          ? organizations?.data?.find((r) => r.id === e.id)?.name
          : e.type === "product"
            ? products?.data?.find((r) => r.id === e.id)?.name
            : portfolio?.data?.find((r) => r.id === e.id)?.title,
    href:
      e.type === "profile"
        ? `/p/${e.id}`
        : e.type === "organization"
          ? `/home/engineer/products?supplier=${e.id}`
          : e.type === "product"
            ? `/home/engineer/requests/new?product=${e.id}`
            : `/p/media/${e.id}`,
  }));
}
