"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { validateBusinessLocation } from "@/lib/location/business-location";
import { normalizeSocialLinks, SOCIAL_PLATFORMS, type SocialLinks, type SocialPlatform } from "@/lib/onboarding/social-links";
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

export type SocialLinksResult =
  | { ok: true; links: SocialLinks }
  | { ok: false; code: "invalid" | "required" | "forbidden" | "failed" };

/** Edits the showroom's links. The database re-validates and refuses to clear the last link (`links_required`). */
export async function saveSocialLinksAction(orgId: string, raw: Partial<Record<SocialPlatform, string>>): Promise<SocialLinksResult> {
  const checked = normalizeSocialLinks(raw);
  if (!checked.ok) return { ok: false, code: "invalid" };
  const links = checked.links;
  if (!SOCIAL_PLATFORMS.some((p) => links[p] !== null)) return { ok: false, code: "required" };
  const supabase = await getServerSupabase();
  // The generated argument types are non-nullable; the RPC takes NULL for "no link".
  const nullable = (v: string | null) => v as string;
  const { data, error } = await supabase.rpc("organization_social_links_set", {
    p_org_id: orgId,
    p_facebook_url: nullable(links.facebook),
    p_instagram_url: nullable(links.instagram),
    p_tiktok_url: nullable(links.tiktok),
    p_website_url: nullable(links.website),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, code: "forbidden" };
    if (error.code === "22023") return { ok: false, code: error.hint === "links_required" ? "required" : "invalid" };
    return { ok: false, code: "failed" };
  }
  SETTINGS_PATHS.forEach((path) => revalidatePath(path));
  const payload = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const pick = (key: string, fallback: string | null) => {
    const v = payload?.[key];
    return typeof v === "string" ? v : v === null ? null : fallback;
  };
  return {
    ok: true,
    links: {
      facebook: pick("facebook_url", links.facebook),
      instagram: pick("instagram_url", links.instagram),
      tiktok: pick("tiktok_url", links.tiktok),
      website: pick("website_url", links.website),
    },
  };
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
