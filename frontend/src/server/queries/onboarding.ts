import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type OnboardingTrack = Database["public"]["Enums"]["onboarding_track"];
export type AccountTypeValue = Database["public"]["Enums"]["account_type"];

/**
 * The signed-in caller's saved onboarding data, for pre-filling the step forms and
 * rendering the handoff. Reads the shared profile, identity locale, verified email
 * (read-only on the contact step), and the self-owned onboarding_progress row.
 * Never trusts client input; returns null when signed out.
 */
export type OnboardingData = {
  email: string;
  displayName: string;
  locale: "en" | "ar";
  phone: string | null;
  selectedTrack: OnboardingTrack | null;
  selectedAccountType: AccountTypeValue | null;
};

export async function getOnboardingData(): Promise<OnboardingData | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: userRow }, { data: progress }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
    supabase.from("users").select("locale").eq("id", user.id).maybeSingle(),
    supabase
      .from("onboarding_progress")
      .select("phone, selected_track, selected_account_type")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return {
    email: user.email ?? "",
    displayName: profile?.display_name ?? "",
    locale: userRow?.locale === "ar" ? "ar" : "en",
    phone: progress?.phone ?? null,
    selectedTrack: progress?.selected_track ?? null,
    selectedAccountType: progress?.selected_account_type ?? null,
  };
}

/**
 * The signed-in caller's saved individual persona onboarding answers (Sprint 7.4),
 * used to hydrate the consumer / professional flow wizards so state lives in the DB
 * (not a client store) and resumes across refresh / sign-out. Includes the reused
 * profile columns (headline / bio / languages) and the selected account type from
 * the shared step. Returns null when signed out.
 */
export type ConsumerAnswers = {
  intent: string | null;
  interests: string[];
  governorate: string | null;
  city: string | null;
  budget: string | null;
  completedAt: string | null;
};

export type ProfessionalAnswers = {
  concreteType: AccountTypeValue | null;
  headline: string | null;
  yearsExperience: number | null;
  specialization: string | null;
  bio: string | null;
  services: string[];
  additionalServices: string[];
  languages: string[];
  availability: string | null;
  serviceAreas: string[];
  offersRemote: boolean;
  governorate: string | null;
  city: string | null;
  maxTravelKm: number | null;
  completedAt: string | null;
};

export type IndividualOnboardingData = {
  selectedTrack: OnboardingTrack | null;
  selectedAccountType: AccountTypeValue | null;
  consumer: ConsumerAnswers;
  professional: ProfessionalAnswers;
};

/**
 * The signed-in caller's open BUSINESS-CREATION draft, used to hydrate the flow so
 * state lives in the DB and resumes across refresh / sign-out.
 * `selectedAccountType` is the business type chosen at registration — it carries
 * into the draft so the concrete type is never asked twice. Returns null when
 * signed out.
 *
 * There is no owner confirmation: creating a business makes the creator its owner.
 */
export type BusinessAnswers = {
  legalName: string | null;
  displayName: string | null;
  orgType: AccountTypeValue | null;
  description: string | null;
  governorate: string | null;
  city: string | null;
  primaryBranchName: string | null;
  organizationId: string | null;
  completedAt: string | null;
};

export type BusinessOnboardingData = {
  selectedTrack: OnboardingTrack | null;
  selectedAccountType: AccountTypeValue | null;
  /** The OPEN draft's id — the resume handle and the creation idempotency key. */
  draftId: string | null;
  business: BusinessAnswers;
};

/**
 * Hydrate the caller's OPEN business-creation draft (there is at most one; a
 * completed draft is history, and its business is read from `organizations`).
 * Returning the draft id is what lets the wizard resume and lets submit be
 * idempotent — the client never has to identify a business by its name.
 */
export async function getBusinessOnboardingData(): Promise<BusinessOnboardingData | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: progress }, { data: draft }] = await Promise.all([
    supabase
      .from("onboarding_progress")
      .select("selected_track, selected_account_type")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("business_creation_drafts")
      .select("*")
      .eq("user_id", user.id)
      .is("completed_at", null)
      .maybeSingle(),
  ]);

  return {
    selectedTrack: progress?.selected_track ?? null,
    selectedAccountType: progress?.selected_account_type ?? null,
    draftId: draft?.id ?? null,
    business: {
      legalName: draft?.legal_name ?? null,
      displayName: draft?.display_name ?? null,
      orgType: draft?.org_type ?? null,
      description: draft?.description ?? null,
      governorate: draft?.governorate ?? null,
      city: draft?.city ?? null,
      primaryBranchName: draft?.primary_branch_name ?? null,
      organizationId: draft?.organization_id ?? null,
      completedAt: draft?.completed_at ?? null,
    },
  };
}

export async function getIndividualOnboardingData(): Promise<IndividualOnboardingData | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: progress }, { data: profile }, { data: io }] = await Promise.all([
    supabase
      .from("onboarding_progress")
      .select("selected_track, selected_account_type")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("profiles").select("headline, bio, languages").eq("user_id", user.id).maybeSingle(),
    supabase.from("individual_onboarding").select("*").eq("user_id", user.id).maybeSingle(),
  ]);

  return {
    selectedTrack: progress?.selected_track ?? null,
    selectedAccountType: progress?.selected_account_type ?? null,
    consumer: {
      intent: io?.consumer_intent ?? null,
      interests: io?.consumer_interests ?? [],
      governorate: io?.consumer_governorate ?? null,
      city: io?.consumer_city ?? null,
      budget: io?.consumer_budget ?? null,
      completedAt: io?.consumer_completed_at ?? null,
    },
    professional: {
      concreteType: io?.prof_concrete_type ?? null,
      headline: profile?.headline ?? null,
      yearsExperience: io?.prof_years_experience ?? null,
      specialization: io?.prof_specialization ?? null,
      bio: profile?.bio ?? null,
      services: io?.prof_services ?? [],
      additionalServices: io?.prof_additional_services ?? [],
      languages: profile?.languages ?? [],
      availability: io?.prof_availability ?? null,
      serviceAreas: io?.prof_service_areas ?? [],
      offersRemote: io?.prof_offers_remote ?? false,
      governorate: io?.prof_governorate ?? null,
      city: io?.prof_city ?? null,
      maxTravelKm: io?.prof_max_travel_km ?? null,
      completedAt: io?.professional_completed_at ?? null,
    },
  };
}
