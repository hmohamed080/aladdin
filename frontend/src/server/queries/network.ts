import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Reads for the installer's Network — organizations DERIVED from completed
 * `job_assignments`, and nothing else.
 *
 * Both projections are scoped to `auth.uid()` inside their SECURITY DEFINER
 * readers and take no id parameter, so nothing here can be pointed at another
 * professional's history. I/O ONLY: the aggregate numbers on the network page
 * (organizations worked with, repeat organizations, trades represented) are
 * derived from the SAME array this file returns, in `lib/network/summary.ts` —
 * the `summarizeReviews` precedent, so a count and a list cannot disagree.
 */

type DB = SupabaseClient<Database>;

export type NetworkOrganization = {
  orgId: string;
  orgName: string;
  completedCount: number;
  firstCompletedAt: string;
  lastCompletedAt: string;
  /** Sorted, canonical trade keys — historical labels, never filtered on `is_active`. */
  tradeKeys: string[];
  latestJobTitle: string | null;
  latestAssignmentId: string | null;
  /** Visible reviews only — suppressed ones never reach this column (§9). */
  reviewCount: number;
};

export type NetworkWorkHistoryRow = {
  assignmentId: string;
  orgId: string;
  orgName: string;
  jobTitle: string;
  tradeKey: string;
  agreedAmount: number;
  agreedCurrency: string;
  completedAt: string;
};

type OrgRow = Database["public"]["Views"]["my_network_organizations"]["Row"];
type WorkRow = Database["public"]["Views"]["my_network_work_history"]["Row"];

function toOrganization(r: OrgRow): NetworkOrganization | null {
  // Every view column is nullable to the type generator regardless of what the
  // underlying function guarantees. Narrowing on what a card cannot render
  // without means a malformed row is skipped rather than drawn half blank.
  if (!r.org_id || !r.org_name || r.completed_count === null) return null;
  if (!r.first_completed_at || !r.last_completed_at) return null;
  return {
    orgId: r.org_id,
    orgName: r.org_name,
    completedCount: r.completed_count,
    firstCompletedAt: r.first_completed_at,
    lastCompletedAt: r.last_completed_at,
    tradeKeys: r.trade_keys ?? [],
    latestJobTitle: r.latest_job_title,
    latestAssignmentId: r.latest_assignment_id,
    reviewCount: r.review_count ?? 0,
  };
}

function toWorkHistory(r: WorkRow): NetworkWorkHistoryRow | null {
  if (!r.assignment_id || !r.org_id || !r.org_name || !r.job_title || !r.trade_key) return null;
  if (r.agreed_amount === null || !r.agreed_currency || !r.completed_at) return null;
  return {
    assignmentId: r.assignment_id,
    orgId: r.org_id,
    orgName: r.org_name,
    jobTitle: r.job_title,
    tradeKey: r.trade_key,
    agreedAmount: r.agreed_amount,
    agreedCurrency: r.agreed_currency,
    completedAt: r.completed_at,
  };
}

/**
 * Every organization the caller has at least one COMPLETED job_assignment
 * with — one row each, newest relationship first.
 *
 * `cache()`d per render: `/home/network` reads it, and so does the Profile
 * Hub's Network module in the same tree.
 */
export const listMyNetworkOrganizations = cache(async function listMyNetworkOrganizations(
  supabase: DB,
): Promise<NetworkOrganization[]> {
  const { data, error } = await supabase
    .from("my_network_organizations")
    .select("*")
    .order("last_completed_at", { ascending: false })
    .order("org_id", { ascending: true });
  if (error) throw error;
  return (data ?? []).flatMap((r) => {
    const org = toOrganization(r);
    return org ? [org] : [];
  });
});

/**
 * One organization of the caller's real network, by id.
 *
 * Null means "not a real relationship, or not yours" — the org-detail route
 * treats both the same way `getMyAssignment` does: the id in the URL is a
 * lookup key, never the authority.
 */
export async function getNetworkOrganization(
  supabase: DB,
  orgId: string,
): Promise<NetworkOrganization | null> {
  const all = await listMyNetworkOrganizations(supabase);
  return all.find((o) => o.orgId === orgId) ?? null;
}

/** The caller's completed work with one organization, newest first. */
export async function listNetworkWorkHistory(
  supabase: DB,
  orgId: string,
): Promise<NetworkWorkHistoryRow[]> {
  const { data, error } = await supabase
    .from("my_network_work_history")
    .select("*")
    .eq("org_id", orgId)
    .order("completed_at", { ascending: false })
    .order("assignment_id", { ascending: true });
  if (error) throw error;
  return (data ?? []).flatMap((r) => {
    const row = toWorkHistory(r);
    return row ? [row] : [];
  });
}
