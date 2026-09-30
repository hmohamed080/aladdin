import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { OrgsDirectoryParams, UsersDirectoryParams } from "@/features/admin-preview/directory-params";
import {
  mapOrgDetail,
  mapOrgsPage,
  mapUserDetail,
  mapUsersPage,
  type AdminOrgDetail,
  type AdminUserDetail,
} from "@/features/admin-preview/directory-mappers";

/**
 * Admin Core Phase 1B-A — the canonical Users / Organizations read surface.
 *
 * Each loader is ONE call to a self-guarding security-definer RPC
 * (20260930090002_admin_users_organizations_read.sql). Search, filters, sort
 * and pagination run in the database over the full dataset; nothing here
 * filters or pages rows in JavaScript. The RPCs require a PLATFORM-scoped
 * `users.read` / `organizations.read`, so a scoped assignment gets an error
 * here, never a silently narrowed or widened list.
 *
 * Failures come back as `{ ok: false }` (the page renders a generic error
 * state); the database message is never shown to the reader.
 */

type Client = SupabaseClient<Database>;

export type Loaded<T> = { ok: true; data: T } | { ok: false };

function fail(scope: string, error: unknown): { ok: false } {
  console.error(`[admin-directory] ${scope} failed`, error);
  return { ok: false };
}

export async function loadUsersDirectory(supabase: Client, p: UsersDirectoryParams) {
  const { data, error } = await supabase.rpc("admin_users_list", {
    p_search: p.search ?? undefined,
    p_status: p.status ?? undefined,
    p_account_type: p.accountType ?? undefined,
    p_verification: p.verification ?? undefined,
    p_governorate: p.governorate ?? undefined,
    p_sort: p.sort,
    p_page: p.page,
    p_page_size: p.pageSize,
  });
  if (error) return fail("admin_users_list", error);
  const page = mapUsersPage(data);
  return page ? ({ ok: true, data: page } as const) : fail("admin_users_list (shape)", data);
}

export async function loadOrganizationsDirectory(supabase: Client, p: OrgsDirectoryParams) {
  const { data, error } = await supabase.rpc("admin_organizations_list", {
    p_search: p.search ?? undefined,
    p_status: p.status ?? undefined,
    p_org_type: p.orgType ?? undefined,
    p_sort: p.sort,
    p_page: p.page,
    p_page_size: p.pageSize,
  });
  if (error) return fail("admin_organizations_list", error);
  const page = mapOrgsPage(data);
  return page ? ({ ok: true, data: page } as const) : fail("admin_organizations_list (shape)", data);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `{ ok: true, data: null }` means "no such user" (the page 404s). */
export async function loadUserDetail(supabase: Client, userId: string): Promise<Loaded<AdminUserDetail | null>> {
  if (!UUID.test(userId)) return { ok: true, data: null };
  const { data, error } = await supabase.rpc("admin_user_detail", { p_user_id: userId });
  if (error) return fail("admin_user_detail", error);
  if (data === null) return { ok: true, data: null };
  const detail = mapUserDetail(data);
  return detail ? { ok: true, data: detail } : fail("admin_user_detail (shape)", data);
}

/** `{ ok: true, data: null }` means "no such (non-deleted) organization" (the page 404s). */
export async function loadOrganizationDetail(supabase: Client, orgId: string): Promise<Loaded<AdminOrgDetail | null>> {
  if (!UUID.test(orgId)) return { ok: true, data: null };
  const { data, error } = await supabase.rpc("admin_organization_detail", { p_organization_id: orgId });
  if (error) return fail("admin_organization_detail", error);
  if (data === null) return { ok: true, data: null };
  const detail = mapOrgDetail(data);
  return detail ? { ok: true, data: detail } : fail("admin_organization_detail (shape)", data);
}
