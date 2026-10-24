"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { AVAILABILITIES } from "@/lib/onboarding/persona-fields";

/**
 * Saves the approved Installer profile page (`/home/profile`, design `/preview/installer-account`) in one go, through
 * the same RPCs each piece already uses elsewhere:
 *
 *   * name                      -> profile_set_display_name
 *   * specialties               -> user_trades_set (the complete set; the first is primary)
 *   * years, about, availability,
 *     governorate and city      -> individual_save_professional (merged over the saved answers, because that RPC
 *                                  writes every column it is given)
 *   * governorate, city and the
 *     other governorates        -> user_service_areas_set (the canonical "where" Overall Match reads)
 *
 * Every step is a complete-set write, so saving twice converges.
 */

const KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const PHONE_LIKE = /(?:\+?\d[\s-]?){7,}/;

const schema = z.object({
  displayName: z.string().trim().min(1).max(80),
  yearsExperience: z.number().int().min(0).max(70),
  tradeKeys: z.array(z.string().regex(KEY)).max(20),
  governorate: z.string().regex(KEY).nullable(),
  city: z.string().regex(KEY).nullable(),
  /** The city typed in by hand when the list does not have it. */
  customCity: z.string().trim().max(80).nullable(),
  bio: z.string().trim().max(250),
  availability: z.enum(AVAILABILITIES).nullable(),
  otherGovernorates: z.array(z.string().regex(KEY)).max(30),
});

export type InstallerProfileInput = z.input<typeof schema>;
export type InstallerProfileResult = { ok: true } | { ok: false; code: "invalid" | "phoneInBio" | "name" | "trades" | "profile" | "areas" };

export async function saveInstallerProfileAction(input: InstallerProfileInput): Promise<InstallerProfileResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const v = parsed.data;
  if (PHONE_LIKE.test(v.bio)) return { ok: false, code: "phoneInBio" };

  const supabase = await getServerSupabase();

  const name = await supabase.rpc("profile_set_display_name", { p_display_name: v.displayName });
  if (name.error) return { ok: false, code: "name" };

  if (v.tradeKeys.length > 0) {
    const trades = await supabase.rpc("user_trades_set", { p_trade_keys: v.tradeKeys, p_primary_key: v.tradeKeys[0] });
    if (trades.error) return { ok: false, code: "trades" };
  }

  const current = (await getIndividualOnboardingData())?.professional;
  const cityText = v.city === "other" ? v.customCity : v.city;
  const profile = await supabase.rpc("individual_save_professional", {
    p_concrete_type: "installer_technician",
    p_headline: current?.headline ?? undefined,
    p_years_experience: v.yearsExperience,
    p_specialization: current?.specialization ?? undefined,
    p_bio: v.bio,
    p_services: current?.services ?? undefined,
    p_additional_services: current?.additionalServices ?? undefined,
    p_languages: current?.languages ?? undefined,
    p_availability: v.availability ?? undefined,
    p_service_areas: current?.serviceAreas ?? undefined,
    p_offers_remote: current?.offersRemote ?? false,
    p_governorate: v.governorate ?? undefined,
    p_city: cityText ?? undefined,
    p_max_travel_km: current?.maxTravelKm ?? undefined,
  });
  if (profile.error) return { ok: false, code: profile.error.code === "22023" ? "invalid" : "profile" };

  if (v.governorate) {
    const areas = [
      { governorate_key: v.governorate, city_key: v.city && v.city !== "other" ? v.city : null },
      ...[...new Set(v.otherGovernorates)].filter((g) => g !== v.governorate).map((g) => ({ governorate_key: g, city_key: null })),
    ];
    const saved = await supabase.rpc("user_service_areas_set", { p_primary_governorate_key: v.governorate, p_areas: areas });
    if (saved.error) return { ok: false, code: "areas" };
  }

  revalidatePath("/home", "layout");
  return { ok: true };
}
