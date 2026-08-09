"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  CONSUMER_INTENTS,
  CONSUMER_BUDGETS,
  AVAILABILITIES,
  INDIVIDUAL_PROFESSIONAL_TYPES,
} from "@/lib/onboarding/persona-fields";
import type { Database } from "@/types/database.types";

/**
 * Individual persona onboarding writers (Sprint 7.4). Each is a thin, shape-only
 * validator over a trusted security-definer RPC — all authorization (verified
 * caller), the consumer-vs-professional track gate, EG-locality/enum rules, the
 * required-field check on submit, and the hand-off to the account-upgrade workflow
 * live in the database. `save*` persist the accumulated wizard state and return a
 * result so the client can advance; `complete`/`submit` reach a terminal + redirect.
 * State lives in the DB (hydrated on load) — there is no client store.
 */
export type IndividualActionState = { ok: boolean; code?: string };

const OK: IndividualActionState = { ok: true };
const strArray = z.array(z.string().trim().min(1).max(80)).max(40).optional();
const shortText = z.string().trim().max(120).nullish();

/* ---------------------------------- Consumer ---------------------------------- */

const consumerSchema = z.object({
  intent: z.enum(CONSUMER_INTENTS).nullish(),
  interests: strArray,
  governorate: z.string().trim().max(80).nullish(),
  city: z.string().trim().max(80).nullish(),
  budget: z.enum(CONSUMER_BUDGETS).nullish(),
});
export type ConsumerInput = z.input<typeof consumerSchema>;

/** Persist the (accumulated, all-optional) consumer answers. No redirect. */
export async function saveConsumer(input: ConsumerInput): Promise<IndividualActionState> {
  const parsed = consumerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "onboarding.error.saveFailed" };
  const v = parsed.data;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("individual_save_consumer", {
    p_intent: v.intent ?? undefined,
    p_interests: v.interests ?? undefined,
    p_governorate: v.governorate ?? undefined,
    p_city: v.city ?? undefined,
    p_budget: v.budget ?? undefined,
  });
  if (error) return { ok: false, code: "onboarding.error.saveFailed" };
  return OK;
}

/** Persist final consumer answers, reach the consumer handoff, and show it. */
export async function completeConsumer(input: ConsumerInput): Promise<IndividualActionState> {
  const saved = await saveConsumer(input);
  if (!saved.ok) return saved;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("individual_complete_consumer");
  if (error) return { ok: false, code: "onboarding.error.saveFailed" };
  redirect("/onboarding/consumer");
}

/* -------------------------------- Professional -------------------------------- */

const professionalSchema = z.object({
  concreteType: z.enum(INDIVIDUAL_PROFESSIONAL_TYPES as [string, ...string[]]),
  headline: shortText,
  yearsExperience: z.number().int().min(0).max(70).nullish(),
  specialization: z.string().trim().max(80).nullish(),
  bio: z.string().trim().max(1000).nullish(),
  services: strArray,
  additionalServices: strArray,
  languages: strArray,
  availability: z.enum(AVAILABILITIES).nullish(),
  serviceAreas: strArray,
  offersRemote: z.boolean().optional(),
  governorate: z.string().trim().max(80).nullish(),
  city: z.string().trim().max(80).nullish(),
  maxTravelKm: z.number().int().min(0).max(2000).nullish(),
});
export type ProfessionalInput = z.input<typeof professionalSchema>;
type AccountType = Database["public"]["Enums"]["account_type"];

/** Persist the accumulated professional profile (also writes profiles.*). No redirect. */
export async function saveProfessional(input: ProfessionalInput): Promise<IndividualActionState> {
  const parsed = professionalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "onboarding.error.saveFailed" };
  const v = parsed.data;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("individual_save_professional", {
    p_concrete_type: v.concreteType as AccountType,
    p_headline: v.headline ?? undefined,
    p_years_experience: v.yearsExperience ?? undefined,
    p_specialization: v.specialization ?? undefined,
    p_bio: v.bio ?? undefined,
    p_services: v.services ?? undefined,
    p_additional_services: v.additionalServices ?? undefined,
    p_languages: v.languages ?? undefined,
    p_availability: v.availability ?? undefined,
    p_service_areas: v.serviceAreas ?? undefined,
    p_offers_remote: v.offersRemote ?? false,
    p_governorate: v.governorate ?? undefined,
    p_city: v.city ?? undefined,
    p_max_travel_km: v.maxTravelKm ?? undefined,
  });
  if (error) return { ok: false, code: "onboarding.error.saveFailed" };
  return OK;
}

/** Persist, then advance the wizard to the review route. */
export async function saveProfessionalAndReview(input: ProfessionalInput): Promise<IndividualActionState> {
  const saved = await saveProfessional(input);
  if (!saved.ok) return saved;
  redirect("/onboarding/professional/review");
}

/**
 * Submit the professional profile for review. The RPC validates the required
 * fields, stamps completion, and hands off to the trusted upgrade/review workflow
 * (a 'submitted' verification) — the account type is never applied here. On a
 * required-field failure the caller is bounced back to complete the wizard.
 */
export async function submitProfessional(): Promise<IndividualActionState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("individual_submit_professional");
  if (error) {
    // A required-field violation means the wizard is not actually complete.
    redirect("/onboarding/professional");
  }
  redirect("/onboarding/professional/review");
}
