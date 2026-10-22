import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";
import { isCraftsmanLoginAlias } from "@/lib/auth/craftsman-login-alias";
import { toCanonicalPhone, splitE164 } from "@/lib/contact/phone";
import type { CountryCode } from "libphonenumber-js";
import { checkNewPassword, toAsciiDigits } from "@/features/installer-phone-auth/validation";
import { getInstallerSecurityAdminClient } from "@/lib/supabase/admin-server";
import type { Database } from "@/types/database.types";

/**
 * Installer (phone + password account) SENSITIVE CHANGES: change the login phone, change the password.
 *
 * This module is the orchestration over the database contracts that already exist:
 *   PR #88  account_password_confirm  current-password check (one 5-in-15-minutes budget per account) issuing a
 *                                     single-use receipt bound to (user, operation, target) - the ONLY password proof
 *   M3      installer_phone_change_*  journal + settle-by-observation for the two-system alias re-key
 *   M4      identity_password_change_authorize / _audit, and the journal-driven phone audit
 * It owns no rule the database owns. It has NO cookie access: the caller (the Server Action) resolves the trusted
 * session and passes the verified actor plus two session operations in, which is also what makes it testable against a
 * real GoTrue without a Next request.
 *
 * TRUST. The user id and the login alias come only from the authenticated session (never a form). The current
 * password is checked by the database (account_password_confirm, called through the caller's OWN session, so the
 * receipt is bound to auth.uid() and cannot be minted for anyone else). Nothing here returns, logs or stores a password,
 * token, receipt id or the internal alias; responses carry only translation keys.
 *
 * V1 PRODUCT DECISION: the current password is enough to change the phone. The new number is NOT verified (the
 * database leaves profiles.phone_verified_at NULL) - nothing here sets or implies otherwise.
 */

export type SecurityResult = { ok: true; code: string } | { ok: false; code: string; retryAfterSeconds?: number };

export const SECURITY_CODES = {
  phoneDone: "installerSecurity.phone.done",
  passwordDone: "installerSecurity.password.done",
  sessionExpired: "installerSecurity.error.sessionExpired",
  notInstaller: "installerSecurity.error.notInstaller",
  passwordRequired: "installerSecurity.error.passwordRequired",
  wrongPassword: "installerSecurity.error.wrongPassword",
  locked: "installerSecurity.error.locked",
  busy: "installerSecurity.error.busy",
  unavailable: "installerSecurity.error.unavailable",
  verificationExpired: "installerSecurity.error.verificationExpired",
  phoneInvalid: "installerSecurity.error.phoneInvalid",
  phoneSame: "installerSecurity.error.phoneSame",
  phoneUnavailable: "installerSecurity.error.phoneUnavailable",
  phoneInProgress: "installerSecurity.error.phoneInProgress",
  phoneNotConfirmed: "installerSecurity.error.phoneNotConfirmed",
  phoneFailed: "installerSecurity.error.phoneFailed",
  needsAttention: "installerSecurity.error.needsAttention",
  passwordMismatch: "installerSecurity.error.passwordMismatch",
  passwordSame: "installerSecurity.error.passwordSame",
  passwordRejected: "installerSecurity.error.passwordRejected",
  passwordNotConfirmed: "installerSecurity.error.passwordNotConfirmed",
} as const;

/** The verified caller. `loginEmail` is the internal alias: it is used server-side only and never leaves this module. */
export type SecurityActor = { userId: string; loginEmail: string; displayName: string | null };

type AuthError = { status?: number; code?: string; name?: string } | null;

/**
 * What the caller's OWN session can do: pick up a new identity, end every OTHER session, and change its own password.
 *
 * The password is changed through the caller's session (`auth.updateUser`), NOT the Admin API: verified against the real
 * GoTrue, an Admin API password update revokes EVERY session of the user including the one making the request, while a
 * user-scoped update keeps it and lets `signOut({ scope: "others" })` end the rest. It sends BOTH `password` and
 * `current_password`: with GoTrue's native require-current-password setting on (a deployment requirement - see
 * docs/frontend/installer-phone-auth.md) GoTrue verifies the current password atomically with the update, so a direct call
 * that omits it is rejected by Auth itself, not only by this code. (With the setting off the parameter is ignored.)
 */
export type SessionOps = {
  refreshSession(): Promise<void>;
  endOtherSessions(): Promise<void>;
  updatePassword(password: string, currentPassword: string): Promise<{ error: AuthError }>;
};

type AuthAdmin = Pick<SupabaseClient<Database>["auth"]["admin"], "updateUserById">;

/** What PR #88's account_password_confirm answered. */
export type ConfirmOutcome =
  | { ok: true; receipt: string }
  | { ok: false; reason: "wrong_password" | "locked" | "no_password" | "unavailable"; retryAfterSeconds?: number };

/** The operations this module confirms (the database accepts exactly these targets for them). */
export type ConfirmOperation = "primary_phone.change" | "password.change";

export type SecurityDeps = {
  /** Service-role client for the M3/M4 RPCs. */
  rpc: Pick<SupabaseClient<Database>, "rpc">;
  /** Auth Admin API (updateUserById). */
  admin: AuthAdmin;
  /**
   * PR #88's current-password confirmation, called through the CALLER's session (account_password_confirm is granted to
   * `authenticated` and binds the receipt to auth.uid()).
   */
  confirmPassword(operation: ConfirmOperation, target: string, password: string): Promise<ConfirmOutcome>;
  /**
   * Only used to ANSWER an unknown password-update outcome (does the NEW password work now?). Isolated, non-persisting.
   * `upstreamFailed` is set when the answer is "could not check" (Auth rate limit / outage) rather than "no".
   */
  verifyPassword(input: { email: string; password: string; expectedUserId: string }, signal: { upstreamFailed: boolean }): Promise<boolean>;
  newId(): string;
};

type RpcClient = Pick<SupabaseClient<Database>, "rpc">;

/** account_password_confirm through a user-scoped client; never throws, never returns the password. */
export async function confirmPasswordAsUser(user: RpcClient, operation: ConfirmOperation, target: string, password: string): Promise<ConfirmOutcome> {
  const { data, error } = await user.rpc("account_password_confirm", { p_password: password, p_operation: operation, p_target: target });
  if (error) {
    diag("account_password_confirm", error);
    return { ok: false, reason: "unavailable" };
  }
  const row = (data ?? {}) as { ok?: boolean; receipt?: string; reason?: string; retry_at?: string };
  if (row.ok === true && typeof row.receipt === "string" && UUID.test(row.receipt)) return { ok: true, receipt: row.receipt };
  if (row.reason === "wrong_password") return { ok: false, reason: "wrong_password" };
  if (row.reason === "no_password") return { ok: false, reason: "no_password" };
  if (row.reason === "locked") {
    const until = row.retry_at ? Date.parse(row.retry_at) : Number.NaN;
    const retryAfterSeconds = Number.isFinite(until) ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 900;
    return { ok: false, reason: "locked", retryAfterSeconds };
  }
  return { ok: false, reason: "unavailable" };
}

export function defaultSecurityDeps(user: RpcClient): SecurityDeps {
  const client = getInstallerSecurityAdminClient();
  return {
    rpc: client,
    admin: client.auth.admin,
    confirmPassword: (operation, target, password) => confirmPasswordAsUser(user, operation, target, password),
    verifyPassword: verifyPasswordIsolated,
    newId: () => globalThis.crypto.randomUUID(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Isolated, non-persisting password check. Never touches the caller's cookies; its own throwaway session is revoked.
 * Used ONLY to resolve an unknown password-update outcome; the current-password PROOF is account_password_confirm.
 */
export async function verifyPasswordIsolated(
  input: { email: string; password: string; expectedUserId: string },
  signal: { upstreamFailed: boolean },
): Promise<boolean> {
  const env = readPublicEnv();
  const isolated = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await isolated.auth.signInWithPassword({ email: input.email, password: input.password });
  if (data?.session) await isolated.auth.signOut({ scope: "local" }).catch(() => undefined);
  if (error) {
    const status = (error as { status?: number }).status;
    if (status === undefined || status === 429 || status >= 500) signal.upstreamFailed = true;
    return false;
  }
  return data.user?.id === input.expectedUserId;
}

function diag(op: string, error: { code?: string; status?: number } | null | undefined) {
  console.error(`installer security: ${op} failed (status ${error?.status ?? "unknown"}, code ${error?.code ?? "unknown"})`);
}

/**
 * Auth call outcome:
 *   applied  - success;
 *   rejected - a 4xx: GoTrue refused it before changing anything;
 *   unknown  - anything else (a 500 included - an error response does NOT prove nothing was committed - a timeout, a dropped
 *              connection, a proxy error): the call may have landed, may be in flight, or may still land.
 * An unknown outcome is never decided here: the database settles it from the authoritative alias (settlement), compensating
 * at once ONLY when the auth.users alias guard is in force (a write that has not committed can then never commit), and
 * otherwise only after the lease. No pause or second look is used as a consistency argument.
 */
type AdminOutcome = "applied" | "weak" | "rejected" | "reauth" | "wrongCurrent" | "currentRequired" | "unknown";
function classifyAuthError(error: AuthError): AdminOutcome {
  if (!error) return "applied";
  if (error.code === "weak_password") return "weak";
  if (error.code === "current_password_invalid") return "wrongCurrent";
  if (error.code === "current_password_required") return "currentRequired";
  if (error.code === "reauthentication_needed" || error.code === "reauthentication_not_valid") return "reauth";
  const status = error.status;
  if (typeof status === "number" && status >= 400 && status < 500) return "rejected";
  return "unknown"; // 500, 502/503/504, a dropped connection, an abort or a timeout say nothing about whether it committed
}

function confirmRefusal(outcome: Extract<ConfirmOutcome, { ok: false }>): SecurityResult {
  if (outcome.reason === "locked") return { ok: false, code: SECURITY_CODES.locked, retryAfterSeconds: outcome.retryAfterSeconds ?? 900 };
  if (outcome.reason === "wrong_password") return { ok: false, code: SECURITY_CODES.wrongPassword };
  return { ok: false, code: SECURITY_CODES.unavailable };
}

function requireInstaller(actor: SecurityActor | null): SecurityResult | null {
  if (!actor || !UUID.test(actor.userId)) return { ok: false, code: SECURITY_CODES.sessionExpired };
  if (!isCraftsmanLoginAlias(actor.loginEmail)) return { ok: false, code: SECURITY_CODES.notInstaller };
  return null;
}

function currentE164(loginEmail: string): string {
  return `+${(loginEmail.trim().toLowerCase().split("@")[0] ?? "").slice(1)}`;
}

async function finishSession(session: SessionOps) {
  // Best effort: the account state is already consistent. A refresh gives this session the new identity claims; ending
  // the others is the "a changed credential should not leave a stolen session valid elsewhere" rule.
  await session.refreshSession().catch(() => console.error("installer security: session refresh failed"));
  await session.endOtherSessions().catch(() => console.error("installer security: ending other sessions failed"));
}

// ---------------------------------------------------------------------------------------------------------------
// Change phone
// ---------------------------------------------------------------------------------------------------------------

type SettleRow = { state: string; resolution: string | null };

async function settle(deps: SecurityDeps, userId: string, changeId: string, finished: boolean): Promise<SettleRow | null> {
  const { data, error } = await deps.rpc.rpc("installer_phone_change_settle", {
    p_user_id: userId,
    p_change_id: changeId,
    p_attempt_finished: finished,
  });
  if (error) {
    diag("installer_phone_change_settle", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : undefined;
  return row && typeof row.state === "string" ? { state: row.state, resolution: row.resolution ?? null } : null;
}

function outcomeFromSettle(row: SettleRow | null): SecurityResult | "done" {
  if (!row) return { ok: false, code: SECURITY_CODES.phoneNotConfirmed };
  if (row.state === "done") return "done";
  if (row.state === "compensated") return { ok: false, code: SECURITY_CODES.phoneFailed };
  if (row.state === "needs_attention") return { ok: false, code: SECURITY_CODES.needsAttention };
  return { ok: false, code: SECURITY_CODES.phoneNotConfirmed }; // pending: not known yet; recovery will settle it
}

/** A change left over from a crashed or timed-out request is settled BEFORE a new one may start. */
async function resolveActiveChange(deps: SecurityDeps, userId: string): Promise<SecurityResult | null> {
  const { data, error } = await deps.rpc.rpc("installer_phone_change_status", { p_user_id: userId });
  if (error) {
    diag("installer_phone_change_status", error);
    return { ok: false, code: SECURITY_CODES.unavailable };
  }
  const active = Array.isArray(data) ? data[0] : undefined;
  if (!active) return null;
  const outcome = outcomeFromSettle(await settle(deps, userId, active.change_id, false));
  if (outcome === "done") return null; // the earlier change completed; the account is consistent again
  if (outcome.ok === false && outcome.code === SECURITY_CODES.phoneFailed) return null; // compensated: free to start again
  return outcome.ok === false && outcome.code === SECURITY_CODES.needsAttention
    ? outcome
    : { ok: false, code: SECURITY_CODES.phoneInProgress };
}

function beginErrorCode(error: { code?: string }): string {
  switch (error.code) {
    case "23505": return SECURITY_CODES.phoneUnavailable;
    case "55006": return SECURITY_CODES.phoneInProgress;
    case "42501": return SECURITY_CODES.verificationExpired;
    // The caller already passed the alias check, so "not eligible" here means the login alias and the profile phone
    // disagree (e.g. an abandoned Auth update landed late): fail closed to support, never to a generic error.
    case "55000": return SECURITY_CODES.needsAttention;
    case "22023": return SECURITY_CODES.phoneInvalid;
    default: return SECURITY_CODES.unavailable;
  }
}

export async function performPhoneChange(
  deps: SecurityDeps,
  actor: SecurityActor | null,
  session: SessionOps,
  input: { countryIso2: unknown; national: unknown; password: unknown; requestId?: unknown },
): Promise<SecurityResult> {
  const refused = requireInstaller(actor);
  if (refused || !actor) return refused ?? { ok: false, code: SECURITY_CODES.sessionExpired };

  // Input: recomputed from country + national - a client-supplied E.164 is never accepted.
  const iso = typeof input.countryIso2 === "string" ? input.countryIso2.trim().toUpperCase() : "";
  const national = typeof input.national === "string" ? toAsciiDigits(input.national).trim() : "";
  let canonical = null;
  try {
    canonical = /^[A-Z]{2}$/.test(iso) ? toCanonicalPhone(national, iso as CountryCode) : null;
  } catch {
    canonical = null;
  }
  if (!canonical || !/^\+[1-9][0-9]{6,14}$/.test(canonical.e164) || !/^[0-9]{1,15}$/.test(canonical.national)) {
    return { ok: false, code: SECURITY_CODES.phoneInvalid };
  }
  if (typeof input.password !== "string" || input.password.length === 0) return { ok: false, code: SECURITY_CODES.passwordRequired };
  if (canonical.e164 === currentE164(actor.loginEmail)) return { ok: false, code: SECURITY_CODES.phoneSame };
  const requestId = typeof input.requestId === "string" && UUID.test(input.requestId) ? input.requestId.toLowerCase() : deps.newId();

  // A leftover change from a crash / timeout is settled first.
  const blocked = await resolveActiveChange(deps, actor.userId);
  if (blocked) return blocked;

  // Current password (PR #88 confirmation, one budget per account) -> a receipt bound to THIS user and THIS exact number.
  const outcome = await deps.confirmPassword("primary_phone.change", canonical.e164, input.password);
  if (!outcome.ok) return confirmRefusal(outcome);

  // Database half: spends the receipt and moves the profile in one transaction; returns the DB-derived new alias.
  const { data: begun, error: beginError } = await deps.rpc.rpc("installer_phone_change_begin", {
    p_user_id: actor.userId,
    p_request_id: requestId,
    p_receipt_id: outcome.receipt,
    p_country_iso2: canonical.countryIso2,
    p_national: canonical.national,
    p_e164: canonical.e164,
  });
  if (beginError) return { ok: false, code: beginErrorCode(beginError) };
  const change = Array.isArray(begun) ? begun[0] : undefined;
  if (!change || typeof change.change_id !== "string" || typeof change.new_alias !== "string") return { ok: false, code: SECURITY_CODES.unavailable };

  if (change.replayed && change.state !== "pending") {
    const replay = outcomeFromSettle({ state: change.state, resolution: null });
    if (replay === "done") {
      await finishSession(session);
      return { ok: true, code: SECURITY_CODES.phoneDone };
    }
    return replay;
  }

  // Auth half: the supported Admin API. Its answer is NOT trusted for success; settle observes the real alias.
  const { error: adminError } = await deps.admin.updateUserById(actor.userId, { email: change.new_alias, email_confirm: true });
  const adminOutcome = classifyAuthError(adminError as AuthError);
  if (adminOutcome === "rejected" || adminOutcome === "weak") diag("auth admin email update", adminError as AuthError);

  // `attempt_finished` is only a hint for the conservative path (guard not in force): true when GoTrue answered with a
  // definite refusal. With the guard in force the database ignores it and compensates a still-old alias at once.
  const settled = outcomeFromSettle(await settle(deps, actor.userId, change.change_id, adminOutcome !== "unknown"));
  if (settled !== "done") return settled;

  await finishSession(session);
  return { ok: true, code: SECURITY_CODES.phoneDone };
}

// ---------------------------------------------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------------------------------------------

export async function performPasswordChange(
  deps: SecurityDeps,
  actor: SecurityActor | null,
  session: SessionOps,
  input: { currentPassword: unknown; newPassword: unknown; confirmPassword: unknown },
): Promise<SecurityResult> {
  const refused = requireInstaller(actor);
  if (refused || !actor) return refused ?? { ok: false, code: SECURITY_CODES.sessionExpired };

  const current = input.currentPassword;
  if (typeof current !== "string" || current.length === 0) return { ok: false, code: SECURITY_CODES.passwordRequired };

  // The existing policy (length first, byte limit, common / sequential / account-related), with the account's own
  // phone and name as context. Checked BEFORE any verification attempt is spent.
  const policy = checkNewPassword(input.newPassword, { phone: splitE164Canonical(currentE164(actor.loginEmail)), name: actor.displayName });
  if (!policy.ok) return { ok: false, code: policy.code };
  if (input.confirmPassword !== policy.value) return { ok: false, code: SECURITY_CODES.passwordMismatch };
  if (policy.value === current) return { ok: false, code: SECURITY_CODES.passwordSame };

  const outcome = await deps.confirmPassword("password.change", "self", current);
  if (!outcome.ok) return confirmRefusal(outcome);

  // The receipt is spent BEFORE the mutation: a replayed or expired receipt can never cause a second change.
  const { data: spent, error: spendError } = await deps.rpc.rpc("identity_password_change_authorize", { p_user_id: actor.userId, p_receipt_id: outcome.receipt });
  if (spendError) diag("identity_password_change_authorize", spendError);
  if (spent !== true) return { ok: false, code: SECURITY_CODES.verificationExpired };

  const { error } = await session.updatePassword(policy.value, current);
  let applied = classifyAuthError(error);
  if (applied === "wrongCurrent") return { ok: false, code: SECURITY_CODES.wrongPassword };
  if (applied === "currentRequired") return { ok: false, code: SECURITY_CODES.passwordRequired };
  if (applied === "unknown") {
    // The call may have landed (a 500 can follow a commit): the only authoritative answer is whether the NEW password now works.
    const probe = { upstreamFailed: false };
    const nowWorks = await deps.verifyPassword({ email: actor.loginEmail, password: policy.value, expectedUserId: actor.userId }, probe).catch(() => false);
    if (nowWorks) applied = "applied";
    else return { ok: false, code: probe.upstreamFailed ? SECURITY_CODES.passwordNotConfirmed : SECURITY_CODES.unavailable };
  }
  if (applied === "weak") return { ok: false, code: SECURITY_CODES.passwordRejected };
  if (applied === "reauth") return { ok: false, code: SECURITY_CODES.sessionExpired };
  if (applied !== "applied") {
    diag("auth password update", error);
    return { ok: false, code: SECURITY_CODES.unavailable };
  }

  // Audit (once per spent receipt) - its failure must not undo or hide a password that HAS changed.
  const { data: audited, error: auditError } = await deps.rpc.rpc("identity_password_change_audit", { p_user_id: actor.userId, p_receipt_id: outcome.receipt });
  if (auditError || audited !== true) console.error("installer security: password change audit was not recorded");

  await session.endOtherSessions().catch(() => console.error("installer security: ending other sessions failed"));
  return { ok: true, code: SECURITY_CODES.passwordDone };
}

function splitE164Canonical(e164: string) {
  const parts = splitE164(e164);
  return parts ? { countryIso2: parts.countryIso2, national: parts.national, e164 } : null;
}
