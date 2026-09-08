"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { mapOrgI18nError } from "@/server/actions/error-mapping";
import type { FormState } from "@/server/actions/sales-forms";

/**
 * Server Actions backing the Settings page's organization/branch bilingual
 * identity forms. No authorization decision is made here — `organization_
 * update_i18n`/`branch_update_i18n` decide, this only translates the
 * outcome to a stable key and revalidates `/b2b/settings` on success.
 *
 * Fields are sent AS TYPED (including empty strings) — the RPCs themselves
 * normalize whitespace-only input to null, so there is no reason to
 * duplicate that logic here.
 */

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export async function updateOrganizationI18nAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const orgId = str(fd, "orgId");
  if (!orgId) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("organization_update_i18n", {
    p_org_id: orgId,
    p_name_ar: str(fd, "nameAr"),
    p_name_en: str(fd, "nameEn"),
    p_timezone: str(fd, "timezone"),
  });
  if (error) return { ok: false, code: mapOrgI18nError(error) };

  revalidatePath("/b2b/settings");
  return { ok: true, code: "settings.orgUpdated" };
}

export async function updateBranchI18nAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const branchId = str(fd, "branchId");
  if (!branchId) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("branch_update_i18n", {
    p_branch_id: branchId,
    p_name_ar: str(fd, "nameAr"),
    p_name_en: str(fd, "nameEn"),
    p_address_ar: str(fd, "addressAr"),
    p_address_en: str(fd, "addressEn"),
    p_timezone: str(fd, "timezone"),
  });
  if (error) return { ok: false, code: mapOrgI18nError(error) };

  revalidatePath("/b2b/settings");
  return { ok: true, code: "settings.branchUpdated" };
}
