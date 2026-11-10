"use server";

import { classifySignInIdentifier } from "@/lib/auth/sign-in-identifier";
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

/**
 * INERT since P1 PR-2 (the application has no username any more). Kept only so the sign-up form's username field, which is being
 * removed, still compiles: it makes NO database call and always answers "unknown" (the neutral state the form already treats as "no
 * feedback"). Delete together with `features/auth-password-preview/username-check.tsx`.
 */
export async function checkUsername(_raw: unknown): Promise<UsernameCheck> {
  return { status: "unknown" };
}
