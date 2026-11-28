"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { SECURITY_CODES, defaultSecurityDeps, performPasswordChange, performPhoneChange, type SecurityResult } from "@/server/auth/installer-security";
import { resolveSecuritySession } from "@/server/auth/security-session";

/**
 * Installer (phone + password account) security changes - the Server Actions the Settings page will call.
 *
 * THIN ON PURPOSE: this file resolves the trusted session and shapes the response; the rules live in
 * `@/server/auth/installer-security` (orchestration) and in the database contracts (PR #88's current-password
 * confirmation, the M3 journal and the M4 audit). The user id and the login
 * alias come ONLY from the authenticated session read here - no form field can supply or override either - and the
 * response carries only a translation key (never the alias, a token or a password).
 */
export type InstallerSecurityState = { ok: boolean; code?: string; retryAfterSeconds?: number };

const field = (fd: FormData, name: string): unknown => fd.get(name) ?? undefined;

function toState(result: SecurityResult): InstallerSecurityState {
  return result.ok
    ? { ok: true, code: result.code }
    : { ok: false, code: result.code, ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}) };
}

function revalidateAccount() {
  for (const path of ["/home", "/home/settings", "/home/profile"]) revalidatePath(path);
}

/** Change the sign-in phone: new country + number + CURRENT password. The new number stays UNVERIFIED. */
export async function changeInstallerPhone(_prev: InstallerSecurityState, fd: FormData): Promise<InstallerSecurityState> {
  try {
    const supabase = await getServerSupabase();
    const { actor, session } = await resolveSecuritySession(supabase);
    const result = await performPhoneChange(defaultSecurityDeps(supabase), actor, session, {
      countryIso2: field(fd, "countryIso2"),
      national: field(fd, "national"),
      password: field(fd, "currentPassword"),
      requestId: field(fd, "requestId"),
    });
    if (result.ok) revalidateAccount();
    return toState(result);
  } catch {
    console.error("installer security: phone change aborted unexpectedly");
    return { ok: false, code: SECURITY_CODES.unavailable };
  }
}

/** Change the password: current + new + confirmation. The login phone is untouched; other sessions end. */
export async function changeInstallerPassword(_prev: InstallerSecurityState, fd: FormData): Promise<InstallerSecurityState> {
  try {
    const supabase = await getServerSupabase();
    const { actor, session } = await resolveSecuritySession(supabase);
    const result = await performPasswordChange(defaultSecurityDeps(supabase), actor, session, {
      currentPassword: field(fd, "currentPassword"),
      newPassword: field(fd, "newPassword"),
      confirmPassword: field(fd, "confirmNewPassword"),
    });
    if (result.ok) revalidateAccount();
    return toState(result);
  } catch {
    console.error("installer security: password change aborted unexpectedly");
    return { ok: false, code: SECURITY_CODES.unavailable };
  }
}
