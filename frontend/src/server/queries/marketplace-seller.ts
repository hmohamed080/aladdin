import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { isMarketplacePreviewEnabled } from "@/lib/env";

export type MarketplaceSellerStatus = "pending" | "approved" | "suspended" | "revoked";

/**
 * The active organization's Marketplace seller status, or null when it was never
 * put through seller enablement.
 *
 * Read under the caller's own session: RLS lets a member see only the safe
 * columns of their OWN organization's account, so this can never reveal another
 * showroom's standing. Returns null while the Marketplace preview flag is off, so
 * a closed environment shows no trace of the module.
 *
 * This decides what the workspace SHOWS. It is not the authorization: every
 * Marketplace write re-checks the seller's standing in the database.
 */
export async function loadMarketplaceSellerStatus(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<MarketplaceSellerStatus | null> {
  if (!isMarketplacePreviewEnabled()) return null;
  const { data, error } = await supabase
    .from("marketplace_seller_accounts")
    .select("status")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return data.status as MarketplaceSellerStatus;
}
