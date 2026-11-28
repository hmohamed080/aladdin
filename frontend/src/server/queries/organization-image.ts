import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { applicationMediaUrl } from "@/lib/storage/media-url";
import { edgeConfig, privateMediaUrl } from "@/server/storage/edge-ticket";

/**
 * Current business image through an application route (or the media Worker for an
 * R2 row while edge delivery is on). The caller-scoped RPC checks membership here
 * and delivery rechecks it before returning private bytes.
 */
export async function loadOrganizationImageUrl(supabase: SupabaseClient<Database>, orgId: string): Promise<string | null> {
  const { data: key, error } = await supabase.rpc("organization_image_current", { p_org_id: orgId });
  if (error || !key) return null;
  if (!edgeConfig()) return applicationMediaUrl("organization", key);
  const { data: providers, error: providerError } = await supabase.rpc("organization_media_read_providers",
    { p_namespace: "organization", p_keys: [key] });
  const provider = !providerError && providers && typeof providers === "object" && !Array.isArray(providers) ? providers[key] : undefined;
  if (provider === undefined) return null;
  return privateMediaUrl(supabase, "organization", key, provider === "r2" ? "r2" : "supabase");
}
