"use server";

import { randomInt } from "node:crypto";
import { classifySignInIdentifier } from "@/lib/auth/sign-in-identifier";
import { isUsernameWellFormed } from "@/lib/identity/username";
import { getServerSupabase } from "@/lib/supabase/server";
import { requestPasswordSignUp } from "@/server/actions/auth-password-preview";
import {
  requestPhoneSignUp,
  resendPhoneSignUpCode as resendPhoneCode,
  verifyPhoneSignUp as verifyPhoneCode,
  type PhoneSignUpState,
} from "@/server/auth/phone-sign-up";

/**
 * The one sign-up form's "Mobile number or email" field. An email continues
 * through the canonical email + password registration (signUp() + email
 * code); a mobile number through the WhatsApp-verified phone registration
 * (server/auth/phone-sign-up.ts). Every account type may use either.
 */
export async function requestSignUp(_prev: PhoneSignUpState, formData: FormData): Promise<PhoneSignUpState> {
  const contact = classifySignInIdentifier(formData.get("contact"));
  const echo = String(formData.get("contact") ?? "").trim();
  if (contact?.kind === "email") {
    formData.set("email", contact.value);
    const result = await requestPasswordSignUp({ ok: false }, formData);
    return { ...result, channel: "email" };
  }
  if (contact?.kind === "phone") return requestPhoneSignUp(formData, contact.value);
  return { ok: false, code: "authPasswordPreview.error.contactInvalid", email: echo };
}

export async function resendPhoneSignUpCode(_prev: PhoneSignUpState, formData: FormData): Promise<PhoneSignUpState> {
  return resendPhoneCode(formData);
}

export async function verifyPhoneSignUp(_prev: PhoneSignUpState, formData: FormData): Promise<PhoneSignUpState> {
  return verifyPhoneCode(formData);
}

export type UsernameCheck = { status: "available" | "taken" | "invalid" | "unknown"; suggestion?: string };

const USERNAME_MAX = 24;
const SUGGESTION_TRIES = 3;

/**
 * Live username check while the person types on sign-up. Asks the same
 * anon-callable `username_available` RPC the submit path uses (so it reveals
 * nothing new), and when the name is taken offers one free variant (the name
 * plus a few digits). Advisory only: the submit re-checks, and the database
 * decides on save. A lookup failure is "unknown", never "taken".
 */
export async function checkUsername(raw: unknown): Promise<UsernameCheck> {
  const username = typeof raw === "string" ? raw.trim() : "";
  if (!isUsernameWellFormed(username)) return { status: "invalid" };
  const supabase = await getServerSupabase();
  const available = async (name: string): Promise<boolean | null> => {
    const { data, error } = await supabase.rpc("username_available", { p_username: name });
    return error || typeof data !== "boolean" ? null : data;
  };
  const answer = await available(username);
  if (answer === null) return { status: "unknown" };
  if (answer) return { status: "available" };
  for (let i = 0; i < SUGGESTION_TRIES; i++) {
    const digits = String(randomInt(10, 1000));
    const candidate = `${username.slice(0, USERNAME_MAX - digits.length)}${digits}`;
    if (isUsernameWellFormed(candidate) && (await available(candidate))) return { status: "taken", suggestion: candidate };
  }
  return { status: "taken" };
}
