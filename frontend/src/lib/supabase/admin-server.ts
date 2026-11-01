import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv, parseServerEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/** The one authoritative security flag canonical password auth stamps into `app_metadata` — never `user_metadata`. The value keeps its historical `preview` wording: it is stored on existing accounts and must not change. */
export const PASSWORD_SET_FLAG = "aladdin_pw_preview_password_set";

/**
 * ADMIN client — service-role key, bypasses RLS entirely, holds full Auth
 * admin privileges. NEVER exposed to the browser (the `server-only` import
 * guard above makes importing this file from a Client Component a build
 * error, not just a convention).
 *
 * Introduced (while password auth was still a preview) for writing `app_metadata`. Supabase's regular
 * (non-admin) client can only write `user_metadata`, which the account's own
 * owner can edit via `auth.updateUser({data})` — it is NOT authoritative for
 * any security-sensitive resume decision
 * (docs/frontend/auth-password-preview.md §Authoritative password-state
 * tracking). `app_metadata` can only be written through the Auth admin API,
 * which requires the service-role key.
 *
 * This is the FIRST service-role caller in this codebase —
 * `frontend/.env.example` previously documented "no runtime caller today;
 * leave UNSET in staging" for `SUPABASE_SERVICE_ROLE_KEY`. Flagged
 * explicitly here and in the review report, not introduced silently. Usage
 * is restricted to two narrow, explicitly-scoped call sites: writing that one
 * `app_metadata` key (`markPasswordAttachedAuthoritatively`) and staging a
 * pre-confirmation pending-registration row via the `service_role`-only
 * `public.pending_registration_save` RPC (`savePendingRegistration`,
 * Increment 6 — needed because the caller has no session yet at that point,
 * so no RLS-scoped RPC call could reach `auth.uid()`). Never used for
 * anything else.
 */
function getAdminClient(timeoutMs?: number): SupabaseClient<Database> {
  const publicEnv = readPublicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = parseServerEnv({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Required for canonical password auth's authoritative " +
        "app_metadata writes (registration, migration, recovery) — see docs/frontend/auth-password-preview.md " +
        "§Authoritative password-state tracking. Get the local value from `supabase status` and add it to " +
        "frontend/.env.local yourself; this value is never read or logged by any Claude Code tool call.",
    );
  }
  return createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // An optional per-request deadline. Without one a hung GoTrue call would hang the caller; with one an aborted call
    // is "outcome unknown" (it may still have been processed), which callers of a time-boxed client must handle.
    ...(timeoutMs ? { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }) } } : {}),
  });
}

/** How long one Auth Admin API call of an installer security change may take before its outcome is treated as unknown. */
export const INSTALLER_SECURITY_ADMIN_TIMEOUT_MS = 15_000;

/**
 * The service-role client for the installer phone / password CHANGE operations (`server/auth/installer-security.ts`):
 * the `installer_phone_change_*` and `identity_password_change_*` RPCs plus `auth.admin.updateUserById`. Time-boxed, so
 * a hung Auth call ends as "outcome unknown" (settled later by observation) instead of hanging the request.
 */
export function getInstallerSecurityAdminClient(): SupabaseClient<Database> {
  return getAdminClient(INSTALLER_SECURITY_ADMIN_TIMEOUT_MS);
}

/**
 * The service-role client for the contact-email claim RPCs (`contact_email_*`, service_role only by design: the server
 * mints the token and passes the session user). Use it for nothing else.
 */
export function getContactEmailAdminClient(): SupabaseClient<Database> {
  return getAdminClient();
}

/**
 * Stages a pending-registration row (username + chosen top-level account
 * type) for a just-`signUp()`'d, still-unconfirmed user, via
 * `public.pending_registration_save` — granted to `service_role` ONLY (see
 * `supabase/migrations/20260924090006_pending_registrations.sql`), so this
 * admin client is the only caller that can ever exercise it. Never stores a
 * password. Best-effort by design: a failure here does not fail
 * registration — `verifyPasswordSignUp` falls back to the
 * `username_pending`/`account_type_pending` recovery screen
 * (`finish-registration/page.tsx`) if nothing was staged, or staging was
 * lost to a slow/failed write, exactly as it does for a genuinely expired
 * pending row.
 */
export async function savePendingRegistration(params: {
  userId: string;
  username: string;
  audienceKind: "organization_type" | "persona_type";
  audienceValue: string;
}): Promise<boolean> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("pending_registration_save", {
    p_user_id: params.userId,
    p_username: params.username,
    p_audience_kind: params.audienceKind,
    p_audience_value: params.audienceValue,
  });
  if (error) {
    console.error(`Failed to stage pending registration for ${params.userId}: ${error.message}`);
    return false;
  }
  // true = the 30-minute username lease is held (20261028090003). false never
  // changes the caller's response: the name is re-asked after verification.
  return data === true;
}

/**
 * The one authoritative write canonical password auth performs: stamps
 * `app_metadata.aladdin_pw_preview_password_set = true` for `userId`, via a
 * read-merge-write (Supabase's admin `updateUserById` REPLACES the whole
 * `app_metadata` object rather than deep-merging it, so a naive write would
 * silently destroy Supabase's own `provider`/`providers` bookkeeping fields
 * that already live there).
 */
export async function markPasswordAttachedAuthoritatively(userId: string): Promise<void> {
  const admin = getAdminClient();
  const { data, error: getError } = await admin.auth.admin.getUserById(userId);
  if (getError || !data.user) {
    throw new Error(`Could not load user ${userId} for authoritative app_metadata write: ${getError?.message}`);
  }
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...data.user.app_metadata, [PASSWORD_SET_FLAG]: true },
  });
  if (error) {
    throw new Error(`Failed to record authoritative password-set state for ${userId}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Installer/technician phone + password flow
// (docs/frontend/installer-phone-auth.md,
// server/actions/installer-phone-auth.ts). Three more narrowly-scoped
// service-role call sites:
//   * a phone-uniqueness pre-check that must see EVERY account's canonical
//     phone (the caller has no session yet, and RLS rightly hides other
//     people's profiles);
//   * creating the Auth user with its internal login alias already confirmed
//     and the audit-only `registration_source` in `app_metadata`;
//   * deleting that same just-created user when initialization fails, so a
//     half-initialized account is never left behind.
// None of them ever logs the phone, the alias, or the password.
// ---------------------------------------------------------------------------

/**
 * Stored in `app_metadata.registration_source` of every phone account. The value
 * predates the flow's promotion to a permanent entry point and is kept verbatim —
 * it is DATA already written to existing accounts, not a label to modernise.
 */
export const TEMPORARY_CRAFTSMAN_REGISTRATION_SOURCE = "temporary_craftsman_password_flow";

/** True when ANY profile already holds this canonical E.164 phone. Throws on a lookup failure (never guesses "free"). */
export async function isCanonicalPhoneTaken(e164: string): Promise<boolean> {
  const admin = getAdminClient();
  const { data, error } = await admin.from("profiles").select("user_id").eq("phone_e164", e164).limit(1);
  if (error) throw new Error(`canonical phone lookup failed (code ${error.code ?? "unknown"})`);
  return (data ?? []).length > 0;
}

export type CraftsmanUserCreation =
  | { ok: true; userId: string }
  | { ok: false; reason: "exists" | "rate_limited" | "rejected" | "failed" };

/**
 * Creates the Supabase Auth user for the installer phone flow. The password goes to
 * GoTrue exactly once, here, and is hashed by GoTrue (bcrypt) — it is never
 * stored or logged by this application. `email_confirm: true` marks the
 * INTERNAL alias as confirmed (it is a login key the server derived itself,
 * never a mailbox), which is what lets the account pass the existing
 * verified-caller gates without any schema change. `full_name` feeds the
 * existing `app.handle_new_user` trigger, which creates `public.users` +
 * `public.profiles` exactly as for every other account.
 */
export async function createCraftsmanPasswordUser(params: {
  loginAlias: string;
  password: string;
  fullName: string;
}): Promise<CraftsmanUserCreation> {
  return createPhonePasswordUser(params, TEMPORARY_CRAFTSMAN_REGISTRATION_SOURCE);
}

export async function createShowroomPasswordUser(params: { loginAlias: string; password: string; fullName: string }): Promise<CraftsmanUserCreation> {
  return createPhonePasswordUser(params, "temporary_showroom_password_flow");
}

/** The mobile-number sign-up on /auth/sign-up (any account type), after its WhatsApp code was verified. */
export async function createPhoneSignUpUser(params: { loginAlias: string; password: string; fullName: string; locale: "en" | "ar" }): Promise<CraftsmanUserCreation> {
  return createPhonePasswordUser(params, "phone_whatsapp_sign_up");
}

async function createPhonePasswordUser(params: { loginAlias: string; password: string; fullName: string; locale?: "en" | "ar" }, source: string): Promise<CraftsmanUserCreation> {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: params.loginAlias,
    password: params.password,
    email_confirm: true,
    user_metadata: { full_name: params.fullName, locale: params.locale ?? "ar" },
    app_metadata: { registration_source: source, [PASSWORD_SET_FLAG]: true },
  });
  if (error || !data.user) {
    const code = (error as { code?: string } | null)?.code;
    const status = (error as { status?: number } | null)?.status;
    if (code === "email_exists" || code === "user_already_exists") return { ok: false, reason: "exists" };
    if (status === 429 || code?.startsWith("over_")) return { ok: false, reason: "rate_limited" };
    if (code === "weak_password") return { ok: false, reason: "rejected" };
    console.error(`installer phone sign-up: auth user creation failed (code ${code ?? "unknown"})`);
    return { ok: false, reason: "failed" };
  }
  return { ok: true, userId: data.user.id };
}

/** Compensating delete for a user THIS flow just created. Returns false (after a safe diagnostic) if it could not. */
export async function deleteCraftsmanPasswordUser(userId: string): Promise<boolean> {
  const admin = getAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(`phone password sign-up: rollback delete failed for user ${userId} (code ${(error as { code?: string }).code ?? "unknown"})`);
    // Only THIS request's freshly created user reaches this compensator. If
    // deletion is unavailable, quarantine it rather than permit a half-setup login.
    const { error: quarantineError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (quarantineError) console.error(`phone password sign-up: quarantine failed (code ${(quarantineError as { code?: string }).code ?? "unknown"})`);
    return false;
  }
  return true;
}

/** Durable shared phone-auth limiter. Only service_role can consume buckets. */
export async function consumePhoneAuthLimit(action: "sign-in" | "sign-up" | "email-resend", ipKey: string, phoneKey: string): Promise<boolean> {
  const { data, error } = await getAdminClient().rpc("phone_auth_consume_limit", {
    p_action: action, p_ip_key: ipKey, p_phone_key: phoneKey,
  });
  if (error) throw new Error("phone auth limiter unavailable");
  return data === true;
}

/**
 * The auth email behind a username or mobile number typed on the sign-in page,
 * so the password grant can run against it. For a phone-registered account
 * this is its internal login alias. Null when nothing matches; the caller
 * answers exactly as for a wrong password, so this never reveals which
 * usernames or numbers exist. Throws on a lookup failure (never guesses).
 */
export async function resolveSignInEmail(lookup: { username: string } | { phoneE164: string }): Promise<string | null> {
  const admin = getAdminClient();
  const query = admin.from("profiles").select("user_id").is("deleted_at", null).limit(1);
  const { data, error } = await ("username" in lookup
    ? query.eq("username_normalized", lookup.username.trim().toLowerCase())
    : query.eq("phone_e164", lookup.phoneE164));
  if (error) throw new Error(`sign-in identifier lookup failed (code ${error.code ?? "unknown"})`);
  const userId = data?.[0]?.user_id;
  if (!userId) return null;
  const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError) throw new Error(`sign-in identifier lookup failed (code ${(userError as { code?: string }).code ?? "unknown"})`);
  return user.user?.email ?? null;
}

/**
 * Stores the birthday collected at sign-up on `public.users.birth_date` — the
 * self-only row (RLS `users_select_self`), never the public profile. Called
 * only right after the account proved its email or mobile number, with a value
 * the caller has already validated (parseBirthDate). Throws on failure.
 */
export async function saveVerifiedBirthDate(userId: string, birthDate: string): Promise<void> {
  const { error } = await getAdminClient().from("users").update({ birth_date: birthDate }).eq("id", userId);
  if (error) throw new Error(`birth date save failed (code ${error.code ?? "unknown"})`);
}

// ---------------------------------------------------------------------------
// WhatsApp verification codes (public.phone_verification_challenges,
// service_role only). Only an HMAC of the code is ever stored.
// ---------------------------------------------------------------------------
export type PhoneChallenge = { id: string; phoneE164: string; codeHash: string; attempts: number; expiresAt: string; consumedAt: string | null };

/** How many sign-up codes this number was sent since `sinceIso`. Throws on a lookup failure. */
export async function countRecentPhoneChallenges(e164: string, sinceIso: string): Promise<number> {
  const { count, error } = await getAdminClient()
    .from("phone_verification_challenges")
    .select("id", { count: "exact", head: true })
    .eq("phone_e164", e164)
    .gte("created_at", sinceIso);
  if (error) throw new Error(`phone challenge count failed (code ${error.code ?? "unknown"})`);
  return count ?? 0;
}

export async function insertPhoneChallenge(row: { id: string; phoneE164: string; codeHash: string; expiresAt: string }): Promise<void> {
  const { error } = await getAdminClient().from("phone_verification_challenges").insert({
    id: row.id,
    purpose: "sign_up",
    phone_e164: row.phoneE164,
    code_hash: row.codeHash,
    expires_at: row.expiresAt,
  });
  if (error) throw new Error(`phone challenge insert failed (code ${error.code ?? "unknown"})`);
}

export async function deletePhoneChallenge(id: string): Promise<void> {
  await getAdminClient().from("phone_verification_challenges").delete().eq("id", id);
}

export async function loadPhoneChallenge(id: string): Promise<PhoneChallenge | null> {
  const { data, error } = await getAdminClient()
    .from("phone_verification_challenges")
    .select("id, phone_e164, code_hash, attempts, expires_at, consumed_at")
    .eq("id", id)
    .eq("purpose", "sign_up")
    .maybeSingle();
  if (error) throw new Error(`phone challenge load failed (code ${error.code ?? "unknown"})`);
  if (!data) return null;
  return { id: data.id, phoneE164: data.phone_e164, codeHash: data.code_hash, attempts: data.attempts, expiresAt: data.expires_at, consumedAt: data.consumed_at };
}

/**
 * Counts one guess BEFORE it is checked, as a compare-and-set on the attempt
 * number read, so two concurrent guesses can never share one attempt. False
 * when another request got there first (the caller treats it as a miss).
 */
export async function recordPhoneChallengeAttempt(id: string, seenAttempts: number): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from("phone_verification_challenges")
    .update({ attempts: seenAttempts + 1 })
    .eq("id", id)
    .eq("attempts", seenAttempts)
    .is("consumed_at", null)
    .select("id");
  if (error) throw new Error(`phone challenge attempt failed (code ${error.code ?? "unknown"})`);
  return (data ?? []).length === 1;
}

/** Marks a code used, once. False when it was already used. */
export async function consumePhoneChallenge(id: string): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from("phone_verification_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id)
    .is("consumed_at", null)
    .select("id");
  if (error) throw new Error(`phone challenge consume failed (code ${error.code ?? "unknown"})`);
  return (data ?? []).length === 1;
}
