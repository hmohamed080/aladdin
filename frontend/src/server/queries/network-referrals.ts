import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

/**
 * Reads for Network referrals — attribution, never a work relationship and
 * never membership. See `supabase/migrations/20260911090001_network_referrals.sql`.
 *
 * `searchOrganizationsForReferral` REUSES `showroom_directory_search` — the
 * same RPC `/home/showroom` already uses to find an employer — rather than
 * writing a second search function. It is safe to reuse: the RPC grants
 * nothing, requires only a verified caller, and returns the same approved
 * public business-directory columns either way.
 */

type DB = SupabaseClient<Database>;
type ShowroomRow = Database["public"]["Functions"]["showroom_directory_search"]["Returns"][number];
type ReferralRow = Database["public"]["Views"]["my_network_referrals"]["Row"];

export type ReferralOrgResult = {
  id: string;
  name: string;
  orgType: string;
  isVerified: boolean;
};

/** Search organizations by name, for the "already on Aladdin" referral path. */
export async function searchOrganizationsForReferral(
  supabase: DB,
  query: string,
): Promise<ReferralOrgResult[]> {
  const { data, error } = await supabase.rpc("showroom_directory_search", { p_query: query });
  if (error) return [];
  return (data ?? []).map((o: ShowroomRow) => ({
    id: o.id,
    name: o.name,
    orgType: o.org_type,
    isVerified: o.is_verified,
  }));
}

export type NetworkReferral = {
  id: string;
  origin: "known_organization" | "new_showroom";
  organizationId: string | null;
  organizationName: string | null;
  displayName: string | null;
  governorate: string | null;
  city: string | null;
  /** The REFERRER's own typed contact — never an organization's data. */
  phone: string | null;
  note: string | null;
  status: "pending" | "joined" | "cancelled";
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
};

function toReferral(r: ReferralRow): NetworkReferral | null {
  if (!r.id || !r.origin || !r.status || !r.created_at) return null;
  return {
    id: r.id,
    origin: r.origin,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    displayName: r.display_name,
    governorate: r.governorate,
    city: r.city,
    phone: r.phone,
    note: r.note,
    status: r.status,
    decisionReason: r.decision_reason,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  };
}

/**
 * The caller's own referrals — cache()d per render, the same shape
 * `listMyNetworkOrganizations` uses, since `/home/network` reads both in one
 * tree and they must never disagree within one response.
 */
export const listMyNetworkReferrals = cache(async function listMyNetworkReferrals(
  supabase: DB,
): Promise<NetworkReferral[]> {
  const { data, error } = await supabase
    .from("my_network_referrals")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).flatMap((r) => {
    const referral = toReferral(r);
    return referral ? [referral] : [];
  });
});

/** Convenience for callers that already hold a request-scoped client. */
export async function loadMyNetworkReferrals(): Promise<NetworkReferral[]> {
  const supabase = await getServerSupabase();
  return listMyNetworkReferrals(supabase);
}
