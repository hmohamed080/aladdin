import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  meets,
  NO_ADMIN_ACCESS,
  parseAdminAccess,
  requirementFor,
  type AdminAccess,
  type AdminRequirement,
} from "@/lib/permissions/admin";

/**
 * The caller's Admin authority, loaded ONCE per request from
 * `admin_my_access()` — which resolves `admin_role_assignments` exactly as every
 * RPC guard and RLS policy does. There is no second source: nothing in the app
 * reads `platform_role_grants` (a write-only compatibility bridge — see
 * docs/admin/ADMIN_RBAC_ARCHITECTURE.md §6).
 *
 * Fails closed: any error (signed out, RPC failure) is "no access".
 */
export const loadAdminAccess = cache(async (): Promise<AdminAccess> => {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NO_ADMIN_ACCESS;
  const { data, error } = await supabase.rpc("admin_my_access");
  if (error) return NO_ADMIN_ACCESS;
  return parseAdminAccess(data);
});

/** The Admin console door: non-staff are sent to their own landing. */
export async function requireAdminStaff(): Promise<AdminAccess> {
  const access = await loadAdminAccess();
  if (!access.isStaff) redirect("/");
  return access;
}

/**
 * Page-level guard for a direct URL. Staff who lack the permission get a
 * non-disclosing 404 (the route neither confirms nor denies what is behind it);
 * non-staff never reach this far — `requireAdminStaff` redirects them first.
 */
export async function requireAdminPermission(requirement: AdminRequirement): Promise<AdminAccess> {
  const access = await requireAdminStaff();
  if (!meets(access, requirement)) notFound();
  return access;
}

/** Same guard, keyed by the route table in lib/permissions/admin.ts. */
export async function requireAdminRoute(pathname: string): Promise<AdminAccess> {
  return requireAdminPermission(requirementFor(pathname));
}
