import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Read queries for the B2B sales workspace. Every query runs through the
 * caller-scoped client, so RLS enforces tenant + branch + assignment scope in
 * the database (ADR-0008) — the UI never filters for security, only for UX. An
 * active-branch filter narrows results further but can never widen them past RLS.
 */

type DB = SupabaseClient<Database>;
export type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
export type LeadRow = Database["public"]["Tables"]["leads"]["Row"];
export type ActivityRow = Database["public"]["Tables"]["sales_activities"]["Row"];
export type FollowUpRow = Database["public"]["Tables"]["follow_up_tasks"]["Row"];

const CUSTOMER_LIST_LIMIT = 100;
const LEAD_LIST_LIMIT = 200;

// ---- Customers -------------------------------------------------------------
export type CustomerFilters = {
  orgId: string;
  branchId?: string | null;
  status?: "active" | "archived";
  search?: string;
};

export async function listCustomers(supabase: DB, f: CustomerFilters): Promise<CustomerRow[]> {
  let q = supabase
    .from("customers")
    .select("*")
    .eq("organization_id", f.orgId)
    .order("updated_at", { ascending: false })
    .limit(CUSTOMER_LIST_LIMIT);
  if (f.branchId) q = q.eq("branch_id", f.branchId);
  if (f.status) q = q.eq("status", f.status);
  if (f.search && f.search.trim()) {
    const term = f.search.trim();
    // Name (trigram) OR phone fragment; both stay within RLS scope.
    q = q.or(`display_name.ilike.%${term}%,primary_phone.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getCustomer(supabase: DB, id: string): Promise<CustomerRow | null> {
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Leads -----------------------------------------------------------------
export type LeadFilters = {
  orgId: string;
  branchId?: string | null;
  status?: "active" | "won" | "lost" | "archived";
  stage?: string;
  assigneeMembershipId?: string;
  priority?: string;
  customerId?: string;
};

export async function listLeads(supabase: DB, f: LeadFilters): Promise<LeadRow[]> {
  let q = supabase
    .from("leads")
    .select("*")
    .eq("organization_id", f.orgId)
    .order("updated_at", { ascending: false })
    .limit(LEAD_LIST_LIMIT);
  if (f.branchId) q = q.eq("branch_id", f.branchId);
  if (f.status) q = q.eq("status", f.status);
  if (f.stage) q = q.eq("stage", f.stage as LeadRow["stage"]);
  if (f.assigneeMembershipId) q = q.eq("assigned_membership_id", f.assigneeMembershipId);
  if (f.priority) q = q.eq("priority", f.priority as LeadRow["priority"]);
  if (f.customerId) q = q.eq("customer_id", f.customerId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getLead(supabase: DB, id: string): Promise<LeadRow | null> {
  const { data, error } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Activities ------------------------------------------------------------
export async function listActivitiesForLead(supabase: DB, leadId: string): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from("sales_activities")
    .select("*")
    .eq("lead_id", leadId)
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function listActivitiesForCustomer(
  supabase: DB,
  customerId: string,
): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from("sales_activities")
    .select("*")
    .eq("customer_id", customerId)
    .order("occurred_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

// ---- Follow-ups ------------------------------------------------------------
export async function listFollowUpsForLead(supabase: DB, leadId: string): Promise<FollowUpRow[]> {
  const { data, error } = await supabase
    .from("follow_up_tasks")
    .select("*")
    .eq("lead_id", leadId)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function listFollowUps(
  supabase: DB,
  orgId: string,
  branchId?: string | null,
): Promise<FollowUpRow[]> {
  let q = supabase
    .from("follow_up_tasks")
    .select("*")
    .eq("organization_id", orgId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ---- Dashboard read-models -------------------------------------------------
export async function stageCounts(
  supabase: DB,
  orgId: string,
): Promise<{ stage: string; lead_count: number }[]> {
  const { data, error } = await supabase
    .from("sales_lead_stage_counts")
    .select("stage, lead_count")
    .eq("organization_id", orgId);
  if (error) throw error;
  return (data ?? []).map((r) => ({ stage: r.stage ?? "new", lead_count: Number(r.lead_count ?? 0) }));
}

export async function myOpenLeads(supabase: DB): Promise<LeadRow[]> {
  const { data, error } = await supabase
    .from("sales_my_open_leads")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as LeadRow[];
}

export async function overdueFollowUps(supabase: DB): Promise<FollowUpRow[]> {
  const { data, error } = await supabase
    .from("sales_overdue_follow_ups")
    .select("*")
    .order("due_at", { ascending: true })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as FollowUpRow[];
}

export async function followUpsDueToday(supabase: DB): Promise<FollowUpRow[]> {
  const { data, error } = await supabase
    .from("sales_follow_ups_due_today")
    .select("*")
    .order("due_at", { ascending: true })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as FollowUpRow[];
}

export async function recentActivities(supabase: DB): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from("sales_recent_activities")
    .select("*")
    .limit(15);
  if (error) throw error;
  return (data ?? []) as ActivityRow[];
}

// ---- Assignable members (for assignment dropdowns) -------------------------
export type OrgMember = { membershipId: string; displayName: string };

/** Active members of the org the caller can see (org managers see all; scoped by RLS). */
export async function listOrgMembers(supabase: DB, orgId: string): Promise<OrgMember[]> {
  // Disambiguate the users embed — memberships has two FKs to users (user_id,
  // invited_by), so PostgREST needs the explicit relationship.
  const { data, error } = await supabase
    .from("memberships")
    .select("id, users!memberships_user_id_fkey(profiles(display_name))")
    .eq("organization_id", orgId)
    .eq("status", "active");
  if (error) throw error;
  return (data ?? []).map((m) => ({
    membershipId: m.id,
    displayName:
      (m.users as { profiles?: { display_name?: string | null } | null } | null)?.profiles
        ?.display_name ?? m.id.slice(0, 8),
  }));
}

/** Small helper: map membership ids to display names for rendering rows. */
export async function memberNameMap(
  supabase: DB,
  orgId: string,
): Promise<Map<string, string>> {
  const members = await listOrgMembers(supabase, orgId);
  return new Map(members.map((m) => [m.membershipId, m.displayName]));
}

/** Small helper: map customer ids to names for lead rows. */
export async function customerNameMap(
  supabase: DB,
  orgId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, display_name")
    .eq("organization_id", orgId)
    .limit(500);
  if (error) throw error;
  return new Map((data ?? []).map((c) => [c.id, c.display_name]));
}

/** Small helper: map branch ids to names. */
export async function branchNameMap(
  supabase: DB,
  orgId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, name")
    .eq("organization_id", orgId);
  if (error) throw error;
  return new Map((data ?? []).map((b) => [b.id, b.name]));
}
