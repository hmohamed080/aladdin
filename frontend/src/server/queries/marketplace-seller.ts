import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { isMarketplacePreviewEnabled } from "@/lib/env";

export type MarketplaceSellerStatus = "pending" | "approved" | "suspended" | "rejected" | "revoked";

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

export type MarketplaceSellerStanding = {
  status: MarketplaceSellerStatus;
  /** The owner-facing message of the latest decision (preset or custom), in both languages. Never the internal reason. */
  messageAr: string | null;
  messageEn: string | null;
};

/**
 * The standing plus the message the platform team wrote to the owner. Reads only the columns a member may see (status and the
 * owner-facing message); the internal reason is not granted to any client role.
 */
export async function loadMarketplaceSellerStanding(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<MarketplaceSellerStanding | null> {
  if (!isMarketplacePreviewEnabled()) return null;
  const { data, error } = await supabase
    .from("marketplace_seller_accounts")
    .select("status, owner_message_ar, owner_message_en")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return { status: data.status as MarketplaceSellerStatus, messageAr: data.owner_message_ar, messageEn: data.owner_message_en };
}
