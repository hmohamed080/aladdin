import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  consumerCompleteness,
  professionalCompleteness,
  type Completeness,
  type CompletenessInput,
} from "@/lib/profile/completeness";
import type { Database } from "@/types/database.types";

type PersonaType = Database["public"]["Enums"]["persona_type"];
type OnboardingTrack = Database["public"]["Enums"]["onboarding_track"];
type AffiliationStatus = Database["public"]["Enums"]["affiliation_request_status"];
type ReferralStatus = Database["public"]["Enums"]["referral_status"];

/**
 * Everything the ONE personal surface (`/home`) needs, for either persona.
 *
 * The variant is chosen by the caller's onboarding TRACK, and the persona label
 * by the professional's declared concrete type falling back to the canonical
 * `users.primary_account_type`. That fallback matters: the canonical persona is
 * only written by the approved+applied upgrade workflow, so between submission and
 * approval it is still null — the declared type is what the account actually is,
 * and the separate verification state says how far the platform has gone in
 * trusting the claim.
 *
 * FOUR INDEPENDENT STATES, never merged into one number or one badge:
 *   * account status       — is the account usable? (it is, from onboarding onward)
 *   * profile completeness — how much of the profile is filled in
 *   * personal verification— how far the platform trusts the professional claim
 *   * showroom affiliation — whether a salesperson may use a showroom's B2B tools
 *
 * None of them gates this page.
 */

/** The trust state of the caller's professional claim — independent of access. */
export type VerificationState =
  | "not_verified"
  | "pending"
  | "verified"
  | "rejected"
  | "needs_more_info";

/** One request to be affiliated with an existing showroom. */
export type Affiliation = {
  requestId: string;
  organizationId: string;
  organizationName: string;
  branchName: string | null;
  status: AffiliationStatus;
  reason: string | null;
  /** True when this affiliation came out of a referral the caller submitted. */
  viaReferral: boolean;
};

/** One referred showroom candidate awaiting (or past) platform review. */
export type Referral = {
  id: string;
  displayName: string | null;
  governorate: string | null;
  city: string | null;
  status: ReferralStatus;
  reason: string | null;
  organizationId: string | null;
};

/**
 * A salesperson's affiliation picture. Deliberately a separate object from
 * `completeness` and `verification`: the Pilot's first testers read a pending
 * showroom connection as a locked account, which it never is.
 */
export type SalesAffiliation = {
  /** Showrooms the caller can already work in (ACTIVE membership). */
  active: { organizationId: string; name: string }[];
  /** Open and decided requests to join an existing showroom. */
  requests: Affiliation[];
  /** Referred candidates the caller submitted (or has a draft of). */
  referrals: Referral[];
};

/**
 * What the professional currently says about taking work (§8).
 *
 * A SEPARATE object from `completeness` and `verification`, for the same reason
 * those two are separate from each other: it is a fifth independent state and
 * merging it into any of them would imply a relationship that does not exist.
 * Availability is not progress, not trust, and not access — an unavailable
 * professional is fully verified, fully complete and fully able to use every
 * surface. It gates nothing.
 *
 * `updatedAt` is null until the person first sets it. That is displayed as
 * "never set" rather than as a stale date, because "unavailable since the
 * beginning of time" is a claim they never made.
 *
 * NOT `professional.availability` — that is the one-off LEAD TIME chosen during
 * onboarding (`within_week`/`within_month`/`flexible`), which is private and
 * means something else. Both exist; they are labelled differently everywhere.
 */
export type Availability = {
  available: boolean;
  /** When it last CHANGED — stamped by the database, never by the client. */
  updatedAt: string | null;
};

export type PersonalHomeData = {
  variant: "consumer" | "professional";
  displayName: string;
  /** The persona to label the account with (professional variant only). */
  accountType: PersonaType;
  /** True when the persona is Salesperson — the one persona with an affiliation. */
  isSalesperson: boolean;
  phone: string | null;
  completeness: Completeness;
  verification: { state: VerificationState; reason: string | null; decidedAt: string | null };
  /** Self-declared, professional variant only. Never gates anything. */
  availability: Availability;
  consumer: CompletenessInput["consumer"];
  professional: CompletenessInput["professional"] & { additionalServices: string[] };
  /** Only loaded for a salesperson; null for every other persona. */
  sales: SalesAffiliation | null;
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

/**
 * `cache()`d per render: the personal layout derives the rail from `variant`
 * while the page it wraps renders the whole object, and this is five round trips
 * (plus a salesperson's three more). React scopes the cache to one render, so
 * nothing is shared across requests or callers.
 */
export const loadPersonalHome = cache(async function loadPersonalHome(): Promise<PersonalHomeData | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: userRow }, { data: progress }, { data: io }, { data: ver }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, headline, bio, languages, available_for_work, availability_updated_at")
        .eq("user_id", user.id)
        .maybeSingle(),
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
  const canonicalType: PersonaType | null = userRow?.primary_account_type ?? null;
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

  const accountType: PersonaType = declaredType ?? canonicalType ?? "end_consumer";

  /**
   * Which home to render. The onboarding TRACK decides when the person declared
   * one — it is their own statement about which flow they are in.
   *
   * When there is no track, fall back to the PERSONA. An identity whose canonical
   * persona is `engineer` is an engineer whether or not an onboarding row exists;
   * showing them the consumer home (and, for a Salesperson, hiding their showroom
   * affiliation entirely) is wrong. This matters for any identity created outside
   * the onboarding flow — a seeded Pilot account, an Admin-applied upgrade, or a
   * future import — none of which write `onboarding_progress`.
   */
  const variant: "consumer" | "professional" =
    track === "professional" || (track === null && accountType !== "end_consumer")
      ? "professional"
      : "consumer";
  const isSalesperson = variant === "professional" && accountType === "sales";

  return {
    variant,
    displayName: profile?.display_name?.trim() ?? "",
    accountType,
    isSalesperson,
    phone: input.phone,
    completeness: variant === "professional" ? professionalCompleteness(input) : consumerCompleteness(input),
    verification: {
      state: verificationStateFor(ver?.status),
      reason: ver?.reason ?? null,
      decidedAt: ver?.decided_at ?? null,
    },
    availability: {
      // `not null default false` in the database, so the coalesce covers only the
      // no-profile-row case rather than papering over a real null.
      available: profile?.available_for_work ?? false,
      updatedAt: profile?.availability_updated_at ?? null,
    },
    consumer: input.consumer,
    professional: { ...input.professional, additionalServices: io?.prof_additional_services ?? [] },
    // Only a salesperson has an affiliation, so only a salesperson pays for the
    // extra round trips.
    sales: isSalesperson ? await loadSalesAffiliation() : null,
  };
});

/**
 * The salesperson's affiliation state, read through the trusted RPCs.
 *
 * `active` is the only one of the three that means ACCESS: an approved request or
 * referral is *evidence*, but the ACTIVE membership is the fact. A membership since
 * suspended stops appearing here even though the historical request still reads
 * "approved" — which is exactly why the home renders `active` for "open workspace"
 * and the requests only as status.
 */
export async function loadSalesAffiliation(): Promise<SalesAffiliation> {
  const supabase = await getServerSupabase();

  const [{ data: workspaces }, { data: requests }, { data: referrals }] = await Promise.all([
    supabase.rpc("my_workspaces"),
    supabase.rpc("my_showroom_affiliations"),
    supabase.rpc("my_showroom_referrals"),
  ]);

  return {
    active: (workspaces ?? [])
      .filter((w) => w.kind === "business" && w.org_type === "showroom_dealer" && w.organization_id)
      .map((w) => ({ organizationId: w.organization_id!, name: w.name ?? "" })),
    requests: (requests ?? []).map((r) => ({
      requestId: r.request_id,
      organizationId: r.organization_id,
      organizationName: r.organization_name ?? "",
      branchName: r.branch_name ?? null,
      status: r.status,
      reason: r.decision_reason ?? null,
      viaReferral: r.via_referral ?? false,
    })),
    referrals: (referrals ?? []).map((f) => ({
      id: f.id,
      displayName: f.display_name ?? null,
      governorate: f.governorate ?? null,
      city: f.city ?? null,
      status: f.status,
      reason: f.decision_reason ?? null,
      organizationId: f.organization_id ?? null,
    })),
  };
}
