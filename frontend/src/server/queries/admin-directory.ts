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
  const { data, error } = await supabase.rpc("admin_users_directory", {
    p_search: p.search ?? undefined,
    p_status: p.status ?? undefined,
    p_account_type: p.accountType ?? undefined,
    p_verification: p.verification ?? undefined,
    p_governorate: p.governorate ?? undefined,
    p_sort: p.sort,
    p_page: p.page,
    p_page_size: p.pageSize,
  });
  if (error) return fail("admin_users_directory", error);
  const page = mapUsersPage(data);
  return page ? ({ ok: true, data: page } as const) : fail("admin_users_directory (shape)", data);
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

export type OrganizationRegistration = {
  phone: string | null;
  email: string | null;
  legalName: string | null;
  description: string | null;
  /** Activity keys (public.activities.key) the business registered with, in catalogue order. */
  activities: string[];
  /** Registered location and detailed address, per live branch (the first is the primary branch). */
  branches: { id: string; governorate: string | null; city: string | null; cityCustomName: string | null; address: string | null }[];
};

/**
 * The business details captured at registration (and kept editable in the business's own Settings): contact,
 * legal name, description, activities, and each branch's location and address. None of it is part of the
 * `admin_organization_detail` contract, so it is read directly under the caller's own platform RLS
 * (`organizations.read`, the same read the classic Organization page used); a row the caller cannot see
 * yields empty values.
 */
export async function loadOrganizationRegistration(supabase: Client, orgId: string): Promise<OrganizationRegistration> {
  const [org, activities, branches] = await Promise.all([
    supabase
      .from("organizations")
      .select("contact_phone, contact_email, legal_name, description")
      .eq("id", orgId)
      .maybeSingle(),
    supabase.from("organization_activities").select("activities(key, sort_order)").eq("organization_id", orgId),
    supabase
      .from("branches")
      .select("id, governorate_key, city_key, city_custom_name, address_ar, address_en")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  const keyed = (activities.data ?? [])
    .map((r) => (Array.isArray(r.activities) ? r.activities[0] : r.activities))
    .filter((a): a is { key: string; sort_order: number } => Boolean(a?.key))
    .sort((a, b) => a.sort_order - b.sort_order);
  return {
    phone: org.data?.contact_phone ?? null,
    email: org.data?.contact_email ?? null,
    legalName: org.data?.legal_name ?? null,
    description: org.data?.description ?? null,
    activities: keyed.map((a) => a.key),
    branches: (branches.data ?? []).map((b) => ({
      id: b.id,
      governorate: b.governorate_key,
      city: b.city_key,
      cityCustomName: b.city_custom_name,
      address: b.address_ar ?? b.address_en,
    })),
  };
}
