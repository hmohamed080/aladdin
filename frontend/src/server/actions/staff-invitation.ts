"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { authFormWithinLimit } from "@/lib/auth/form-limits";
import { getServerSupabase } from "@/lib/supabase/server";
import { markPasswordAttachedAuthoritatively, saveVerifiedBirthDate } from "@/lib/supabase/admin-server";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { captchaTokenFrom, isCaptchaFailure } from "@/server/auth/captcha";
import { type GoTrueError, isAccountExistsError, isRateLimitError, padToRegistrationFloor } from "@/server/auth/signup-guards";
import { staffInvitationErrorCode } from "@/server/auth/staff-invitation-errors";
import { clearStaffInvitationToken, readStaffInvitationToken } from "@/server/auth/staff-invitation-token";
import {
  displayNameSchema,
  emailSchema,
  parseBirthDate,
  registrationIssueCode,
  staffRegistrationSchema,
} from "@/features/auth-password-preview/password-policy";

/**
 * Admin Staff invitations: the inviter's actions, and the invited person's registration and acceptance.
 *
 * Every decision that matters is made by the database (supabase/migrations/20261105090001_admin_staff_invitations.sql). These actions only
 * carry the verified session to it. They never take the token, the actor, the role rank or the e-mail identity from the browser: the token
 * is read from the httpOnly handoff cookie, the actor is the session, and identity is the Auth-confirmed e-mail. Nothing here logs a token,
 * an address, a password or a response body.
 *
 * Registration reuses the marketplace flow's building blocks: the same Turnstile token judged by GoTrue, the same password / name / birth-date
 * rules (staffRegistrationSchema), the same consent types, signUp() with the password set atomically, the same 6-digit e-mail code, and the same
 * enumeration and timing normalization (server/auth/signup-guards.ts). It deliberately has NO account type and NO username: staff are never
 * given a marketplace persona.
 */
export type StaffInvitationState = { ok: boolean; code?: string; email?: string; token?: string; expiresAt?: string };

const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;
const OTP = /^\d{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPTCHA_REQUIRED = "authPasswordPreview.error.captchaRequired";
const CAPTCHA_REJECTED = "authPasswordPreview.error.captchaRejected";
const RATE_LIMITED = "authPasswordPreview.error.rateLimited";
const GENERIC = "staffInvitation.error.generic";
const ENTRY_PATH = "/auth/staff-invitation";

// ---------------------------------------------------------------------------
// Inviter side (admin_staff.manage, judged by the database)
// ---------------------------------------------------------------------------
export async function createStaffInvitationAction(_prev: StaffInvitationState, formData: FormData): Promise<StaffInvitationState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const roleId = String(formData.get("roleId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!email.success) return { ok: false, code: "staffInvitation.error.invalidEmail" };
  if (!UUID.test(roleId)) return { ok: false, code: "staffInvitation.error.roleNotAssignable", email: email.data };
  if (reason.length < 10) return { ok: false, code: "staffInvitation.error.reasonRequired", email: email.data };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_staff_invite", { p_email: email.data.toLowerCase(), p_role_id: roleId, p_reason: reason });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, code: staffInvitationErrorCode(error), email: email.data };
  }
  const token = (data as Record<string, unknown>).token;
  const expiresAt = (data as Record<string, unknown>).expires_at;
  if (typeof token !== "string") return { ok: false, code: GENERIC, email: email.data };
  revalidatePath("/admin/staff");
  // The one-time token is returned to the inviter's browser exactly once, in this response. It is not stored, logged or revalidated anywhere.
  return { ok: true, email: email.data, token, expiresAt: typeof expiresAt === "string" ? expiresAt : undefined };
}

export async function revokeStaffInvitationAction(_prev: StaffInvitationState, formData: FormData): Promise<StaffInvitationState> {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID.test(id)) return { ok: false, code: GENERIC };
  if (reason.length < 10) return { ok: false, code: "staffInvitation.error.reasonRequired" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("admin_staff_invitation_revoke", { p_id: id, p_reason: reason });
  if (error) return { ok: false, code: staffInvitationErrorCode(error) };
  revalidatePath("/admin/staff");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Invited person: registration (no persona, no username), e-mail verification, acceptance
// ---------------------------------------------------------------------------
export async function requestStaffSignUp(_prev: StaffInvitationState, formData: FormData): Promise<StaffInvitationState> {
  if (!authFormWithinLimit(formData)) return { ok: false, code: "authPasswordPreview.error.passwordTooLong" };
  const token = await readStaffInvitationToken();
  if (!token) return { ok: false, code: "staffInvitation.error.invalid" };

  const field = (name: string) => formData.get(name) ?? "";
  const parsed = staffRegistrationSchema.safeParse({
    displayName: field("displayName"),
    email: field("email"),
    password: field("password"),
    birthDate: field("birthDate"),
  });
  if (!parsed.success) return { ok: false, code: registrationIssueCode(parsed.error.issues[0]) };
  if (!CONSENT_TYPES.every((type) => formData.get(`consent_${type}`) === "on")) {
    return { ok: false, code: "authPasswordPreview.error.consentRequired", email: parsed.data.email };
  }
  // No token, no signUp(): GoTrue judges the Turnstile token itself (single validation).
  const captchaToken = captchaTokenFrom(formData);
  if (!captchaToken) return { ok: false, code: CAPTCHA_REQUIRED, email: parsed.data.email };

  const supabase = await getServerSupabase();
  // Only the address the invitation was issued to may register through it. Answered only to the holder of a live invitation.
  const { data: matches, error: checkError } = await supabase.rpc("staff_invitation_registration_check", {
    p_token: token,
    p_email: parsed.data.email,
  });
  if (checkError) return { ok: false, code: GENERIC, email: parsed.data.email };
  if (matches !== true) return { ok: false, code: "staffInvitation.error.emailMismatch", email: parsed.data.email };

  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const callStart = Date.now();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: parsed.data.displayName, birth_date: parsed.data.birthDate, locale }, captchaToken },
  });
  if (error) {
    if (isCaptchaFailure(error as GoTrueError)) return { ok: false, code: CAPTCHA_REJECTED, email: parsed.data.email };
    if (isRateLimitError(error as GoTrueError)) return { ok: false, code: RATE_LIMITED, email: parsed.data.email };
    if ((error as GoTrueError).code === "weak_password") return { ok: false, code: "authPasswordPreview.error.passwordRejected", email: parsed.data.email };
    // An address that already has a confirmed account answers exactly like a new registration (no enumeration); the page tells the person to sign in instead.
    if (isAccountExistsError(error as GoTrueError)) {
      await padToRegistrationFloor(callStart);
      return { ok: true, code: "authPasswordPreview.info.codeSent", email: parsed.data.email };
    }
    console.error(`staff registration: sign_up failed (status ${error.status ?? "unknown"}, code ${error.code ?? "unknown"})`);
    return { ok: false, code: "authPasswordPreview.error.sendFailed", email: parsed.data.email };
  }
  await padToRegistrationFloor(callStart);
  return { ok: true, code: "authPasswordPreview.info.codeSent", email: parsed.data.email };
}

export async function verifyStaffSignUp(_prev: StaffInvitationState, formData: FormData): Promise<StaffInvitationState> {
  if (!authFormWithinLimit(formData)) return { ok: false, code: "authPasswordPreview.error.passwordTooLong" };
  const email = emailSchema.safeParse(formData.get("email"));
  const code = formData.get("token");
  if (!email.success) return { ok: false, code: "authPasswordPreview.error.invalidEmail" };
  if (typeof code !== "string" || !OTP.test(code)) return { ok: false, code: "authPasswordPreview.error.invalidCode", email: email.data };
  // A verified account is only useful here if the handoff cookie still names an invitation.
  if (!(await readStaffInvitationToken())) return { ok: false, code: "staffInvitation.error.invalid", email: email.data };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.verifyOtp({ email: email.data, token: code, type: "signup" });
  if (error || !data.user) {
    const failure = (error ?? {}) as GoTrueError;
    return { ok: false, code: isRateLimitError(failure) ? RATE_LIMITED : "authPasswordPreview.error.invalidCode", email: email.data };
  }
  await markPasswordAttachedAuthoritatively(data.user.id);
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  // Best-effort, exactly as in the marketplace flow: a bookkeeping hiccup never undoes a verified, credentialed session.
  await supabase.rpc("record_consent", { p_types: [...CONSENT_TYPES], p_locale: locale });
  const name = displayNameSchema.safeParse(data.user.user_metadata?.display_name);
  if (name.success) await supabase.rpc("profile_set_display_name", { p_display_name: name.data });
  const birth = parseBirthDate(data.user.user_metadata?.birth_date);
  if (birth.ok) {
    try {
      await saveVerifiedBirthDate(data.user.id, birth.value);
    } catch {
      console.error("staff registration: birth_date step failed");
    }
  }
  // No account type, no username, no pending registration, no onboarding: straight to the invitation, where the person explicitly accepts.
  redirect(ENTRY_PATH);
}

export async function acceptStaffInvitationAction(): Promise<StaffInvitationState> {
  const token = await readStaffInvitationToken();
  if (!token) return { ok: false, code: "staffInvitation.error.invalid" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("staff_invitation_accept", { p_token: token });
  if (error) return { ok: false, code: staffInvitationErrorCode(error) };
  await clearStaffInvitationToken();
  // The assignment and, for a fresh dedicated account, the activation are committed. Admin staff land on /admin.
  redirect("/admin");
}
