import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import {
  consumerCompleteness,
  professionalCompleteness,
  type Completeness,
  type CompletenessInput,
} from "@/lib/profile/completeness";
import type { Database } from "@/types/database.types";

type AccountType = Database["public"]["Enums"]["account_type"];
type OnboardingTrack = Database["public"]["Enums"]["onboarding_track"];

/**
 * Everything the ONE personal surface (`/home`) needs, for either persona.
 *
 * The variant is chosen by the caller's onboarding TRACK, and the persona label
 * by the professional's declared concrete type falling back to the canonical
 * `users.primary_account_type`. That fallback matters: the canonical type is only
 * written by the approved+applied upgrade workflow, so between submission and
 * approval a professional's canonical type is still the default consumer one —
 * the declared type is what the account actually is, and the separate
 * verification state says how far the platform has gone in trusting the claim.
 *
 * Verification is reported alongside completeness, never folded into it, and
 * neither gates anything on this page.
 */

/** The trust state of the caller's professional claim — independent of access. */
export type VerificationState =
  | "not_verified"
  | "pending"
  | "verified"
  | "rejected"
  | "needs_more_info";

export type PersonalHomeData = {
  variant: "consumer" | "professional";
  displayName: string;
  /** The persona to label the account with (professional variant only). */
  accountType: AccountType;
  phone: string | null;
  completeness: Completeness;
  verification: { state: VerificationState; reason: string | null; decidedAt: string | null };
  consumer: CompletenessInput["consumer"];
  professional: CompletenessInput["professional"] & { additionalServices: string[] };
};

/** Map the verification row's status to the trust state the UI shows. */
function verificationStateFor(status: string | null | undefined): VerificationState {
  switch (status) {
    case "approved":
      return "verified";
    case "rejected":
      return "rejected";
    case "needs_more_info":
      return "needs_more_info";
    case "submitted":
    case "under_review":
      return "pending";
    default:
      // No request, a never-submitted draft, or an expired one — nothing the
      // platform has vouched for yet.
      return "not_verified";
  }
}

export async function loadPersonalHome(): Promise<PersonalHomeData | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: userRow }, { data: progress }, { data: io }, { data: ver }] =
    await Promise.all([
      supabase.from("profiles").select("display_name, headline, bio, languages").eq("user_id", user.id).maybeSingle(),
      supabase.from("users").select("primary_account_type").eq("id", user.id).maybeSingle(),
      supabase.from("onboarding_progress").select("phone, selected_track").eq("user_id", user.id).maybeSingle(),
      supabase.from("individual_onboarding").select("*").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("verifications")
        .select("status, reason, decided_at")
        .eq("user_id", user.id)
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const track: OnboardingTrack | null = progress?.selected_track ?? null;
  const canonicalType: AccountType = userRow?.primary_account_type ?? "end_consumer";
  const declaredType = io?.prof_concrete_type ?? null;

  const input: CompletenessInput = {
    displayName: profile?.display_name ?? null,
    phone: progress?.phone ?? null,
    consumer: {
      intent: io?.consumer_intent ?? null,
      interests: io?.consumer_interests ?? [],
      governorate: io?.consumer_governorate ?? null,
      city: io?.consumer_city ?? null,
      budget: io?.consumer_budget ?? null,
    },
    professional: {
      concreteType: declaredType,
      headline: profile?.headline ?? null,
      yearsExperience: io?.prof_years_experience ?? null,
      specialization: io?.prof_specialization ?? null,
      bio: profile?.bio ?? null,
      services: io?.prof_services ?? [],
      languages: profile?.languages ?? [],
      availability: io?.prof_availability ?? null,
      serviceAreas: io?.prof_service_areas ?? [],
      offersRemote: io?.prof_offers_remote ?? false,
      governorate: io?.prof_governorate ?? null,
      city: io?.prof_city ?? null,
      maxTravelKm: io?.prof_max_travel_km ?? null,
    },
  };

  const variant = track === "professional" ? "professional" : "consumer";

  return {
    variant,
    displayName: profile?.display_name?.trim() ?? "",
    accountType: declaredType ?? canonicalType,
    phone: input.phone,
    completeness: variant === "professional" ? professionalCompleteness(input) : consumerCompleteness(input),
    verification: {
      state: verificationStateFor(ver?.status),
      reason: ver?.reason ?? null,
      decidedAt: ver?.decided_at ?? null,
    },
    consumer: input.consumer,
    professional: { ...input.professional, additionalServices: io?.prof_additional_services ?? [] },
  };
}
