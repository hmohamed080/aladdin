"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { isLocale } from "@/lib/i18n/locales";
import { CHOICES_BY_KEY, INVITED_EMPLOYEE_KEY } from "@/lib/onboarding/account-types";

/**
 * Shared-onboarding step writers. Each autosaves on explicit Continue and advances
 * to the next step. All authorization, step ordering, EG-phone format, and the
 * account-type intent rules live in the security-definer RPCs (auth.uid()-derived);
 * these actions only validate shape and map errors to translation keys. Expected
 * validation errors return `{ ok:false, code }` so the client keeps its input.
 */
export type OnboardingActionState = { ok: boolean; code?: string };

const displayNameSchema = z.string().trim().min(1).max(80);
// Egyptian mobile: 01 + operator (0/1/2/5) + 8 digits.
const egPhoneSchema = z.string().trim().regex(/^01[0125]\d{8}$/);

/** Step 1 — Basic Profile: display name + preferred locale. */
export async function saveProfileAction(_prev: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> {
  const name = displayNameSchema.safeParse(formData.get("displayName"));
  if (!name.success) return { ok: false, code: "onboarding.error.displayName" };

  const localeRaw = formData.get("locale");
  const locale = typeof localeRaw === "string" && isLocale(localeRaw) ? localeRaw : "en";

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("onboarding_save_profile", {
    p_display_name: name.data,
    p_locale: locale,
  });
  if (error) return { ok: false, code: "onboarding.error.saveFailed" };

  // Keep the UI locale cookie in step with the saved preference.
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/onboarding/contact");
}

/** Step 2 — Contact: an UNVERIFIED Egyptian mobile (no OTP). */
export async function saveContactAction(_prev: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> {
  const phone = egPhoneSchema.safeParse(formData.get("phone"));
  if (!phone.success) return { ok: false, code: "onboarding.error.phone" };

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("onboarding_save_contact", { p_phone: phone.data });
  if (error) {
    if ((error.message ?? "").toLowerCase().includes("profile step first")) {
      redirect("/onboarding/profile");
    }
    return { ok: false, code: "onboarding.error.phone" };
  }
  redirect("/onboarding/account-type");
}

/** Step 3 — Account-Type Selection: records INTENT and reaches the handoff. */
export async function selectAccountTypeAction(_prev: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> {
  const choiceKey = formData.get("choice");
  if (typeof choiceKey !== "string" || choiceKey.length === 0) {
    return { ok: false, code: "onboarding.error.selectType" };
  }
  // The invitation-only employee path can never be chosen through public registration.
  if (choiceKey === INVITED_EMPLOYEE_KEY) {
    return { ok: false, code: "onboarding.error.invitedOnly" };
  }
  const choice = CHOICES_BY_KEY[choiceKey];
  if (!choice) return { ok: false, code: "onboarding.error.selectType" };

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("onboarding_select_account_type", {
    p_track: choice.track,
    p_account_type: choice.accountType ?? undefined,
  });
  if (error) {
    if ((error.message ?? "").toLowerCase().includes("contact step first")) {
      redirect("/onboarding/contact");
    }
    return { ok: false, code: "onboarding.error.saveFailed" };
  }
  redirect("/onboarding/complete");
}

/** Resolve the current locale for server components that render onboarding chrome. */
export async function currentOnboardingLocale() {
  const store = await cookies();
  return resolveLocale(store.get(LOCALE_COOKIE)?.value);
}
