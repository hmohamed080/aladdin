"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { isCraftsmanLoginAlias } from "@/lib/auth/craftsman-login-alias";

/**
 * Changing the sign-in email, in two steps — never one:
 *   1. the caller proves they still hold the account PASSWORD (a fresh
 *      password check, whatever the age of the session), then Supabase Auth
 *      mails a 6-digit code to the CURRENT address and another to the NEW one;
 *   2. both codes are verified. Only then does the email change, and every
 *      OTHER session of the account is signed out.
 * The two-address confirmation is GoTrue's own setting (`double_confirm_changes`)
 * and is the real protection: the password check here does not cover a direct
 * call to Auth. The old address then gets Auth's "email changed" notice.
 * Phone-registered accounts have no real email (an internal login key stands in)
 * and cannot use this.
 */

export type EmailChangeState = {
  step: "start" | "code" | "done";
  email?: string;
  /** Which of the two codes Auth has already accepted; an accepted code cannot be sent again. */
  confirmed?: { current: boolean; next: boolean };
  code?: "invalid" | "same" | "password" | "unavailable" | "throttled" | "phone_account" | "token" | "error";
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE = /^\d{6}$/;

export async function startEmailChangeAction(_prev: EmailChangeState, fd: FormData): Promise<EmailChangeState> {
  // Not named "email": browsers autofill that name with the CURRENT address.
  const email = String(fd.get("newEmail") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!EMAIL.test(email) || email.length > 254 || !password) return { step: "start", email, code: "invalid" };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { step: "start", code: "error" };
  if (isCraftsmanLoginAlias(user.email)) return { step: "start", email, code: "phone_account" };
  if (user.email.toLowerCase() === email) return { step: "start", email, code: "same" };

  // Step-up: a fresh password check, not trust in the existing session.
  const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password });
  if (authError) return { step: "start", email, code: authError.status === 429 ? "throttled" : "password" };

  const { error } = await supabase.auth.updateUser({ email });
  if (error) {
    if (error.status === 429) return { step: "start", email, code: "throttled" };
    // An address another account already holds is refused; the wording never names whose it is.
    return { step: "start", email, code: error.status === 422 ? "unavailable" : "error" };
  }
  return { step: "code", email };
}

export async function confirmEmailChangeAction(prev: EmailChangeState, fd: FormData): Promise<EmailChangeState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { step: "start", code: "error" };
  const confirmed = { current: false, next: false, ...(prev.email === email ? prev.confirmed : undefined) };
  const pending = (code: EmailChangeState["code"]): EmailChangeState => ({ step: "code", email, confirmed: { ...confirmed }, code });

  const tokens = { current: String(fd.get("currentToken") ?? "").trim(), next: String(fd.get("token") ?? "").trim() };
  const sides = (["current", "next"] as const).filter((side) => !confirmed[side]);
  if (sides.some((side) => !CODE.test(tokens[side]))) return pending("token");

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { step: "start", code: "error" };

  for (const side of sides) {
    const address = side === "current" ? user.email : email;
    const { error } = await supabase.auth.verifyOtp({ email: address, token: tokens[side], type: "email_change" });
    if (error) return pending(error.status === 429 ? "throttled" : "token");
    confirmed[side] = true;
  }

  // Auth is the authority on whether the change happened.
  const {
    data: { user: after },
  } = await supabase.auth.getUser();
  if (after?.email?.toLowerCase() !== email) return { step: "start", email, code: "error" };

  // The sign-in email changed: end every other session of this account.
  await supabase.auth.signOut({ scope: "others" });
  revalidatePath("/home/settings");
  revalidatePath("/home/settings/email");
  return { step: "done", email };
}
