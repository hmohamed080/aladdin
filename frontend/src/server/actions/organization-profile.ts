"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { validateBusinessLocation } from "@/lib/location/business-location";
import { mapOrgI18nError } from "@/server/actions/error-mapping";
import type { FormState } from "@/server/actions/sales-forms";

/**
 * Registration data that stays editable afterwards: the legal business name and a branch's governorate / city.
 * Thin shape validators over `organization_legal_name_set` / `branch_location_set`; authority (org.manage /
 * branch.manage, live), the verified-identity lock and the canonical location rule are decided by the database.
 */
const SETTINGS_PATHS = ["/showroom/settings", "/b2b/settings"] as const;
const LEGAL_NAME_MIN = 2;
const LEGAL_NAME_MAX = 120;

export type LegalNameResult =
  | { ok: true; value: string }
  | { ok: false; code: "invalid" | "locked" | "forbidden" | "failed" };

export async function saveLegalNameAction(orgId: string, raw: string): Promise<LegalNameResult> {
  const value = raw.trim();
  if (value.length < LEGAL_NAME_MIN || value.length > LEGAL_NAME_MAX) return { ok: false, code: "invalid" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("organization_legal_name_set", { p_org_id: orgId, p_legal_name: value });
  if (error) {
    if (error.code === "22023") return { ok: false, code: "invalid" };
    if (error.code === "42501") return { ok: false, code: error.hint === "identity_change_requires_review" ? "locked" : "forbidden" };
    return { ok: false, code: "failed" };
  }
  SETTINGS_PATHS.forEach((path) => revalidatePath(path));
  return { ok: true, value: data ?? value };
}

function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** `city` is a catalogue key; `cityCustom` is the text typed through "Other". Exactly one is required. */
export async function setBranchLocationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const branchId = field(fd, "branchId");
  if (!branchId) return { ok: false, code: "states.genericRetry" };
  const governorate = field(fd, "governorate");
  const city = field(fd, "city");
  const cityCustom = field(fd, "cityCustom");

  const checked = validateBusinessLocation(
    { governorate, city: cityCustom ? null : city, cityCustomName: cityCustom || null },
    { complete: true },
  );
  if (!checked.ok) {
    return { ok: false, code: checked.code === "cityRequired" ? "onboarding.error.cityRequired" : "onboarding.error.locationInvalid" };
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("branch_location_set", {
    p_branch_id: branchId,
    p_governorate: checked.value.governorate ?? "",
    p_city: checked.value.city ?? "",
    p_city_custom: checked.value.cityCustomName ?? "",
  });
  if (error) {
    return { ok: false, code: error.code === "22023" && !/not found/i.test(error.message ?? "") ? "onboarding.error.locationInvalid" : mapOrgI18nError(error) };
  }

  SETTINGS_PATHS.forEach((path) => revalidatePath(path));
  return { ok: true, code: "settings.branchUpdated" };
}
