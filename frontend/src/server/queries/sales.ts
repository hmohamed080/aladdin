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
const STAGE_COUNT_SCAN_LIMIT = 2000;

/**
 * Neutralize a free-text search term before it is interpolated into a PostgREST
 * `.or()` filter. PostgREST filter grammar treats `,` `(` `)` as structure and
 * `%` `_` `*` `\` as LIKE/ilike wildcards; a bare `"` can also break value
 * quoting. We whitelist letters (incl. Arabic), digits, whitespace and a few
 * benign contact characters, so no metacharacter can reach the filter grammar.
 * RLS remains the security boundary — this only prevents malformed/injected
 * filters, never widens access.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s@.+#-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

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
    const term = sanitizeSearchTerm(f.search);
    // Name (trigram) OR phone fragment; both stay within RLS scope. The term is
    // sanitized so it cannot inject PostgREST filter grammar or LIKE wildcards.
    if (term) q = q.or(`display_name.ilike.%${term}%,primary_phone.ilike.%${term}%`);
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

export async function getFollowUp(supabase: DB, id: string): Promise<FollowUpRow | null> {
  const { data, error } = await supabase
    .from("follow_up_tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listFollowUpsForCustomer(
  supabase: DB,
  customerId: string,
): Promise<FollowUpRow[]> {
  const { data, error } = await supabase
    .from("follow_up_tasks")
    .select("*")
    .eq("customer_id", customerId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(100);
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
// Every cockpit widget takes the ACTIVE organization id (and optional branch id)
// so the selected workspace narrows the whole dashboard. RLS still scopes what
// is visible; these filters only ensure org A's cockpit never shows org B's rows
// when a caller belongs to more than one organization, and that a chosen branch
// narrows counts/leads/activities/follow-ups consistently. `null` branch = the
// caller's full authorized scope in that org (org-wide, or all assigned branches).

/** Active-lead counts by stage, narrowed to the active org (+ branch). */
export async function stageCounts(
  supabase: DB,
  orgId: string,
  branchId?: string | null,
): Promise<{ stage: string; lead_count: number }[]> {
  // The `sales_lead_stage_counts` view aggregates by org only (no branch axis),
  // so to keep branch narrowing honest we tally active leads from the base table
  // (RLS-scoped). Pilot volumes sit well under the scan cap; an exact-at-scale
  // aggregate RPC is the future upgrade (TECHNICAL_DEBT).
  let q = supabase
    .from("leads")
    .select("stage")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .limit(STAGE_COUNT_SCAN_LIMIT);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, error } = await q;
  if (error) throw error;
  const tally = new Map<string, number>();
  for (const row of data ?? []) {
    const stage = (row.stage ?? "new") as string;
    tally.set(stage, (tally.get(stage) ?? 0) + 1);
  }
  return [...tally.entries()].map(([stage, lead_count]) => ({ stage, lead_count }));
}

export async function myOpenLeads(
  supabase: DB,
  orgId: string,
  branchId?: string | null,
): Promise<LeadRow[]> {
  let q = supabase
    .from("sales_my_open_leads")
    .select("*")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(25);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as LeadRow[];
}

export async function overdueFollowUps(
  supabase: DB,
  orgId: string,
  branchId?: string | null,
): Promise<FollowUpRow[]> {
  let q = supabase
    .from("sales_overdue_follow_ups")
    .select("*")
    .eq("organization_id", orgId)
    .order("due_at", { ascending: true })
    .limit(25);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as FollowUpRow[];
}

export async function followUpsDueToday(
  supabase: DB,
  orgId: string,
  branchId?: string | null,
): Promise<FollowUpRow[]> {
  let q = supabase
    .from("sales_follow_ups_due_today")
    .select("*")
    .eq("organization_id", orgId)
    .order("due_at", { ascending: true })
    .limit(25);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as FollowUpRow[];
}

export async function recentActivities(
  supabase: DB,
  orgId: string,
  branchId?: string | null,
): Promise<ActivityRow[]> {
  let q = supabase
    .from("sales_recent_activities")
    .select("*")
    .eq("organization_id", orgId)
    .limit(15);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ActivityRow[];
}

// ---- Assignable members (for assignment dropdowns) -------------------------
export type OrgMember = { membershipId: string; displayName: string };

/**
 * `null` on the wire is the org-wide bucket (a null `branch_id` record); the
 * RPC's own uuid parameter is nullable, so this is only a naming convenience.
 */
type BranchId = string | null;

function isPermissionDenied(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "42501"
  );
}

/**
 * Members active, same-org, and branch-compatible with `branchId` (null =
 * org-wide record), name-only, for ONE CRM assignment context.
 *
 * `public.profiles` RLS only lets a user read their OWN row (see
 * `profiles_select_self`, `20260802090001_identity_core.sql`) — there is no
 * policy letting one org member read a teammate's identity by a direct join.
 * A caller's own row resolves fine; every OTHER member's `profiles` embed
 * comes back null. This used to fall back to `m.id.slice(0, 8)` — the caller's
 * own membership id, truncated — which leaked a raw internal identifier into
 * the Customers/Leads/Follow-ups screens for every teammate but the caller.
 *
 * Calls `sales_assignable_members` (`20260912090001_sales_assignable_members.sql`)
 * — a minimal, security-definer read-model authorized on the SAME predicate
 * every assignment write path already requires (`sales.assign` OR org-wide
 * sales authority, i.e. `sales.manage`/`org.manage` — never
 * `org.members.manage`), filtered through the IDENTICAL branch-compatibility
 * function (`app.membership_can_access_branch`) the write RPCs use to
 * validate a chosen assignee. A name returned for `branchId` can never be
 * rejected by the corresponding write RPC for that same branch.
 *
 * Call this ONLY after confirming the caller holds assignment authority
 * (`canAssign()`, `server/queries/context.ts`) — every one of this helper's
 * call sites does. An authorization denial here is then a genuine contract
 * mismatch, not an expected "no access" case — unlike `org_members_list`
 * (the broader, `org.members.manage`-gated People-screen read-model this
 * helper deliberately does NOT call), every error is surfaced, never
 * silently swallowed into an empty list. An empty list here means "this
 * branch genuinely has no other assignable member," not "this caller
 * couldn't be checked" — a real RPC/auth failure throws instead, so a caller
 * who already passed `canAssign()` never sees an editable assignment control
 * silently rendered as if no teammates existed. (For read-only label
 * resolution by a viewer who may NOT hold assignment authority, use
 * `memberNameMap` instead — there, the same denial is an expected outcome.)
 */
export async function listOrgMembers(
  supabase: DB,
  orgId: string,
  branchId: BranchId,
): Promise<OrgMember[]> {
  // The generated RPC arg type follows the SQL parameter's `default null`
  // (nullable-with-default => optional, never `| null` — see create_customer's
  // p_branch_id for the same pattern) so a null branch is sent by OMITTING
  // the key, exactly like every other optional RPC call in this codebase,
  // never by assigning JS `null` to a `string`-typed key.
  const { data, error } = await supabase.rpc("sales_assignable_members", {
    p_org_id: orgId,
    ...(branchId !== null ? { p_branch_id: branchId } : {}),
  });
  if (error) throw error;
  return (data ?? [])
    .map((m) => ({ membershipId: m.membership_id, displayName: (m.display_name ?? "").trim() }))
    .filter((m) => m.displayName.length > 0);
}

/**
 * `listOrgMembers`, for every branch context a form may need at once — one
 * RPC call per distinct branch id (bounded by the org's own branch count, the
 * same list already shown as `org.branches`), keyed by branch id with `""` as
 * the org-wide bucket. Lets a branch-reactive assignee picker switch locally
 * with no client round trip: `customers/new`, `customers/[id]/edit`,
 * `leads/new`, and `leads/[id]/edit` all let the caller change the record's
 * branch in the same form, so the compatible-assignee set must change with it
 * rather than staying fixed to whatever branch the page first rendered.
 */
export async function listOrgMembersByBranch(
  supabase: DB,
  orgId: string,
  branchIds: BranchId[],
): Promise<Record<string, OrgMember[]>> {
  const keys = [...new Set(branchIds.map((b) => b ?? ""))];
  const entries = await Promise.all(
    keys.map(
      async (key): Promise<[string, OrgMember[]]> => [
        key,
        await listOrgMembers(supabase, orgId, key === "" ? null : key),
      ],
    ),
  );
  return Object.fromEntries(entries);
}

/**
 * Name lookup for READ-ONLY labels (list/detail views), merged across every
 * branch context given — a listing can show records assigned across several
 * different branches at once, unlike a single assignment form which only
 * ever needs one. Unlike `listOrgMembers`/`listOrgMembersByBranch`, a 42501
 * here is an EXPECTED outcome (a viewer with `sales.read`/`sales.write` but
 * none of `sales.assign`/`sales.manage`/`org.manage` legitimately can't call
 * the underlying RPC) rather than a contract mismatch, so it degrades to an
 * empty map — every id then falls through to the caller's own "—"/unassigned
 * fallback, exactly like any other unresolvable historical assignee. Any
 * OTHER error (connectivity, config, unexpected RLS) still throws.
 */
export async function memberNameMap(
  supabase: DB,
  orgId: string,
  branchIds: BranchId[],
): Promise<Map<string, string>> {
  let byBranch: Record<string, OrgMember[]>;
  try {
    byBranch = await listOrgMembersByBranch(supabase, orgId, branchIds);
  } catch (e) {
    if (isPermissionDenied(e)) return new Map();
    throw e;
  }
  const merged = new Map<string, string>();
  for (const members of Object.values(byBranch)) {
    for (const m of members) merged.set(m.membershipId, m.displayName);
  }
  return merged;
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

/**
 * Names for a KNOWN set of customer ids. Use this when the caller already holds the
 * rows it needs to label (a dashboard panel, a short list): it reads only those
 * customers instead of the organization's whole book, and returns an empty map
 * without a round trip when there is nothing to label. RLS still scopes the read.
 */
export async function customerNamesFor(
  supabase: DB,
  customerIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(customerIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("customers")
    .select("id, display_name")
    .in("id", ids);
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
