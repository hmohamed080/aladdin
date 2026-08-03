"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Passwordless Email-OTP sign-in (Supabase Auth). Two steps: request a one-time
 * code, then verify it. No passwords, no SMS, no service-role. WhatsApp OTP is a
 * future integration sprint. Actions return a small `{ ok, code }` result whose
 * `code` is a translation key the client renders in the active locale.
 */

export type AuthState = { ok: boolean; code?: string; email?: string };

const emailSchema = z.string().trim().email();
const otpSchema = z.string().trim().regex(/^\d{6}$/);

/** Step 1 — send a 6-digit code to the email. */
export async function requestEmailOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, code: "auth.error.invalidEmail" };

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: true },
  });
  if (error) return { ok: false, code: "auth.error.sendFailed", email: parsed.data };
  return { ok: true, code: "auth.info.codeSent", email: parsed.data };
}

/** Step 2 — verify the code, establish the session cookie, and continue. */
export async function verifyEmailOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const token = otpSchema.safeParse(formData.get("token"));
  if (!email.success) return { ok: false, code: "auth.error.invalidEmail" };
  if (!token.success) return { ok: false, code: "auth.error.invalidCode", email: email.data };

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.verifyOtp({
    email: email.data,
    token: token.data,
    type: "email",
  });
  if (error) return { ok: false, code: "auth.error.verifyFailed", email: email.data };

  const nextParam = formData.get("next");
  const next = typeof nextParam === "string" && nextParam.startsWith("/b2b") ? nextParam : "/b2b";
  redirect(next);
}

/** Sign out and return to the sign-in screen. */
export async function signOut(): Promise<void> {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/auth/sign-in");
}
