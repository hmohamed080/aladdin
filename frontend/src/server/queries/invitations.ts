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
  emailMasked: string | null;
  matchesCaller: boolean;
};

export async function lookupInvitation(token: string): Promise<InvitationView> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("invitation_lookup", { p_token: token });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    return { status: "invalid", organizationName: null, emailMasked: null, matchesCaller: false };
  }
  const status = row.status as InvitationView["status"];
  return {
    status: (["invalid", "pending", "accepted", "revoked", "expired"] as const).includes(status)
      ? status
      : "invalid",
    organizationName: row.organization_name ?? null,
    emailMasked: row.email_masked ?? null,
    matchesCaller: Boolean(row.matches_caller),
  };
}
