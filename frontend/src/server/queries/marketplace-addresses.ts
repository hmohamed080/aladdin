import "server-only";

import type { SavedAddress } from "@/features/marketplace-addresses/address-model";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The signed-in buyer's saved addresses and phone state (Marketplace PR 10). Both RPCs are bound to the caller in the database.
 * Personal data: the values returned here go to the caller's own page only, never to a log, a URL or another user.
 */
export type BuyerAddressesState = {
  addresses: SavedAddress[];
  /** The account's OWN primary phone (E.164) or null, and whether the phone verification authority has proven it. */
  accountPhone: string | null;
  accountPhoneVerified: boolean;
};

export async function loadBuyerAddresses(): Promise<BuyerAddressesState | null> {
  const supabase = await getServerSupabase();
  const [list, phone] = await Promise.all([supabase.rpc("marketplace_buyer_addresses"), supabase.rpc("marketplace_buyer_phone_status")]);
  if (list.error || phone.error) return null;
  const items = (list.data as { items?: SavedAddress[] } | null)?.items ?? [];
  const status = (phone.data ?? {}) as { phone_e164?: string | null; verified?: boolean };
  return { addresses: items, accountPhone: status.phone_e164 ?? null, accountPhoneVerified: status.verified === true };
}
