import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Safe, anti-enumeration lookup of an organization invitation by its token. Wraps
 * the `invitation_lookup` RPC, which returns only a masked email + the org display
 * name + a resolved state — never the raw email or the organization id. Callable
 * whether or not the visitor is signed in.
 */
export type InvitationView = {
  status: "invalid" | "pending" | "accepted" | "revoked" | "expired";
  organizationName: string | null;
  /** Which contact it was addressed to, so the entry copy can name it. */
  channel: "email" | "phone" | null;
  /** Masked — enough to recognize your own address, useless to a stranger. */
  contactMasked: string | null;
  matchesCaller: boolean;
};

const INVALID: InvitationView = {
  status: "invalid",
  organizationName: null,
  channel: null,
  contactMasked: null,
  matchesCaller: false,
};

export async function lookupInvitation(token: string): Promise<InvitationView> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("invitation_lookup", { p_token: token });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return INVALID;
  const status = row.status as InvitationView["status"];
  return {
    status: (["invalid", "pending", "accepted", "revoked", "expired"] as const).includes(status)
      ? status
      : "invalid",
    organizationName: row.organization_name ?? null,
    channel: row.channel === "phone" ? "phone" : row.channel === "email" ? "email" : null,
    contactMasked: row.contact_masked ?? null,
    matchesCaller: Boolean(row.matches_caller),
  };
}
