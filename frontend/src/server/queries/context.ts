import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Derives the caller's ACTIVE organization/branch context from real membership +
 * capability + branch-access data (never a client-supplied org id, never a role
 * switcher — PRODUCT_DIRECTION_GUIDE / ADR-0007). RLS already scopes every read;
 * this only picks which of the caller's own orgs/branches is "active" for the UI.
 */

export const ORG_COOKIE = "aladdin-org";
export const BRANCH_COOKIE = "aladdin-branch";

export type SalesCapability = "sales.read" | "sales.write" | "sales.assign" | "sales.manage";

export type OrgContext = {
  organizationId: string;
  organizationName: string;
  /** The caller's own active membership id in this org (for self-assignment). */
  membershipId: string;
  /** membership_capabilities for the caller in this org (+ org.manage). */
  capabilities: string[];
  /** true when the caller has org-wide sales authority. */
  canManageSales: boolean;
  /** Branches the caller can act within (empty => org-wide sees all). */
  branches: { id: string; name: string }[];
  /** When branch-limited, the active branch; null => org-wide view. */
  activeBranchId: string | null;
};

export type WorkspaceContext = {
  organizations: { id: string; name: string }[];
  active: OrgContext | null;
};

export function hasCap(ctx: OrgContext, cap: SalesCapability | "org.manage"): boolean {
  return ctx.capabilities.includes(cap);
}

/** Can the caller create/edit sales records (write) in the active org? */
export function canWrite(ctx: OrgContext): boolean {
  return ctx.canManageSales || ctx.capabilities.includes("sales.write");
}

/** Can the caller assign/reassign records? */
export function canAssign(ctx: OrgContext): boolean {
  return ctx.canManageSales || ctx.capabilities.includes("sales.assign");
}

/**
 * Pick the active organization from the caller's own orgs, honoring the cookie
 * only if it names an org the caller actually belongs to (a forged/stale cookie
 * grants nothing — it falls back to the first org).
 */
export function resolveActiveOrg<T extends { id: string }>(
  orgs: T[],
  cookieValue: string | undefined,
): T | null {
  if (orgs.length === 0) return null;
  return orgs.find((o) => o.id === cookieValue) ?? orgs[0]!;
}

/**
 * Resolve the active branch so the value shown in the UI ALWAYS matches the data
 * scope:
 *  - exactly one branch in scope → auto-select it (the cookie is irrelevant);
 *  - multiple branches → honor the cookie only if it names an in-scope branch,
 *    otherwise `null` = the caller's full scope ("all" / "all assigned");
 *  - no branch list (org-wide with no branch rows) → `null` (whole org).
 * A forged, stale, or since-removed branch cookie therefore narrows nothing it
 * shouldn't and never selects a branch outside the allowed set.
 */
export function resolveActiveBranch(
  branches: { id: string }[],
  cookieValue: string | undefined,
): string | null {
  if (branches.length === 1) return branches[0]!.id;
  if (branches.length === 0) return null;
  return cookieValue && branches.some((b) => b.id === cookieValue) ? cookieValue : null;
}

export async function loadWorkspaceContext(
  supabase: SupabaseClient<Database>,
): Promise<WorkspaceContext> {
  // The caller. A manager can SEE other members' rows via RLS, so we MUST filter
  // to the caller's own memberships — otherwise the org list duplicates and the
  // capability lookup could resolve another member's row.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { organizations: [], active: null };

  const { data: memberships, error: mErr } = await supabase
    .from("memberships")
    .select("id, organization_id, status, organizations(id, name)")
    .eq("status", "active")
    .eq("user_id", user.id);
  if (mErr) throw mErr;

  const orgs = (memberships ?? [])
    .map((m) => m.organizations)
    .filter((o): o is { id: string; name: string } => Boolean(o));

  if (orgs.length === 0) {
    return { organizations: [], active: null };
  }

  const store = await cookies();
  const activeOrg = resolveActiveOrg(orgs, store.get(ORG_COOKIE)?.value)!;

  const membership = (memberships ?? []).find((m) => m.organization_id === activeOrg.id)!;

  // Capabilities for this membership.
  const { data: caps, error: cErr } = await supabase
    .from("membership_capabilities")
    .select("capability_key")
    .eq("membership_id", membership.id);
  if (cErr) throw cErr;
  const capabilities = (caps ?? []).map((c) => c.capability_key);
  const canManageSales =
    capabilities.includes("org.manage") || capabilities.includes("sales.manage");

  // Branches the caller may act within.
  let branches: { id: string; name: string }[] = [];
  if (canManageSales || capabilities.includes("branch.manage")) {
    const { data: all, error: bErr } = await supabase
      .from("branches")
      .select("id, name")
      .eq("organization_id", activeOrg.id)
      .is("deleted_at", null)
      .order("name");
    if (bErr) throw bErr;
    branches = all ?? [];
  } else {
    const { data: assigned, error: bErr } = await supabase
      .from("membership_branch_access")
      .select("branches(id, name)")
      .eq("membership_id", membership.id);
    if (bErr) throw bErr;
    branches = (assigned ?? [])
      .map((r) => r.branches)
      .filter((b): b is { id: string; name: string } => Boolean(b));
  }

  // Active branch: single branch auto-selects; otherwise honor an in-scope
  // cookie, else null = full scope. The UI label matches (see AppShell).
  const activeBranchId = resolveActiveBranch(branches, store.get(BRANCH_COOKIE)?.value);

  return {
    organizations: orgs,
    active: {
      organizationId: activeOrg.id,
      organizationName: activeOrg.name,
      membershipId: membership.id,
      capabilities,
      canManageSales,
      branches,
      activeBranchId,
    },
  };
}
