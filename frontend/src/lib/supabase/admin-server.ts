import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv, parseServerEnv } from "@/lib/env";
import type { Database, Json } from "@/types/database.types";
import { signupCreateUserPayload, type SignupGrant } from "@/server/phone-verification/signup-service";

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
 * The WhatsApp OTP limit RPCs. Every one of them is service_role ONLY by design (see 20261103090001): the app server verifies the session,
 * derives the actor, reads the current settings from the Worker's signed endpoint and passes them in; the database checks that actor's
 * effective permissions. Named helpers, not a general client, so nothing else can borrow the service role through this door.
 */
type RpcOutcome<T> = { data: T | null; code: string | null; message: string | null };
async function whatsappOtpRpc<T>(call: (c: SupabaseClient<Database>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<RpcOutcome<T>> {
  const { data, error } = await call(getAdminClient(15_000));
  return { data: error ? null : (data as T), code: error?.code ?? null, message: error?.message ?? null };
}

export function whatsappOtpSettingsBegin(a: { actor: string; expectedVersion: number; old: Json; next: Json; reason: string }) {
  return whatsappOtpRpc<{ request_id: string; actor_id: string; ceiling_changed: boolean; reason: string; grant: string; grant_expires: number }>((c) =>
    c.rpc("admin_whatsapp_otp_settings_begin", { p_actor: a.actor, p_expected_version: a.expectedVersion, p_old: a.old, p_new: a.next, p_reason: a.reason }),
  );
}

export function whatsappOtpSettingsFinish(a: { actor: string; request: string; status: "applied" | "failed"; version?: number; code?: string }) {
  return whatsappOtpRpc<string>((c) =>
    c.rpc("admin_whatsapp_otp_settings_finish", { p_actor: a.actor, p_request: a.request, p_status: a.status, p_version: a.version, p_code: a.code }),
  );
}

export function whatsappOtpDeliveryBegin(a: { actor: string; expectedVersion: number; old: boolean | null; next: boolean; reason: string }) {
  return whatsappOtpRpc<{ request_id: string; actor_id: string; reason: string; grant: string; grant_expires: number }>((c) =>
    c.rpc("admin_whatsapp_otp_delivery_begin", { p_actor: a.actor, p_expected_version: a.expectedVersion, p_old: a.old, p_new: a.next, p_reason: a.reason }),
  );
}

export function whatsappOtpDeliveryFinish(a: { actor: string; request: string; status: "applied" | "failed"; version?: number; code?: string }) {
  return whatsappOtpRpc<string>((c) =>
    c.rpc("admin_whatsapp_otp_delivery_finish", { p_actor: a.actor, p_request: a.request, p_status: a.status, p_version: a.version, p_code: a.code }),
  );
}

export function whatsappOtpDeliveryReconcile(applied: Json, drift: Json = null) {
  return whatsappOtpRpc<{ applied: number; abandoned: number; unmatched: number }>((c) => c.rpc("admin_whatsapp_otp_delivery_reconcile", drift ? { p_applied: applied, p_drift: drift } : { p_applied: applied }));
}

export function whatsappOtpDeliveryAuthorized() {
  return whatsappOtpRpc<{ enabled: boolean; version: number }>((c) => c.rpc("admin_whatsapp_otp_delivery_authorized"));
}

export function whatsappOtpSettingsReconcile(applied: Json) {
  return whatsappOtpRpc<{ applied: number; abandoned: number; unmatched: number }>((c) => c.rpc("admin_whatsapp_otp_settings_reconcile", { p_applied: applied }));
}

/**
 * The Admin backup-control RPCs (20261107090006). Every mutation is service_role ONLY by design: the app server verifies the
 * session, derives the actor and spends a current-password receipt; the database re-checks that actor's effective
 * permissions. Named helpers, not a general client, so nothing else can borrow the service role through this door.
 */
export function adminBackupRequest(a: { actor: string; kind: "backup" | "restore_test"; reason: string; receipt: string }) {
  return whatsappOtpRpc<{ id: string; environment: string; kind: string; trigger: string }>((c) =>
    c.rpc("admin_backup_request", { p_actor: a.actor, p_kind: a.kind, p_reason: a.reason, p_receipt: a.receipt }),
  );
}

export function adminBackupMarkDispatched(a: {
  actor: string;
  run: string;
  ok: boolean;
  githubRunId?: number;
  githubRunUrl?: string;
  code?: string;
}) {
  return whatsappOtpRpc<string>((c) =>
    c.rpc("admin_backup_mark_dispatched", {
      p_actor: a.actor,
      p_run: a.run,
      p_ok: a.ok,
      p_github_run_id: a.githubRunId,
      p_github_run_url: a.githubRunUrl,
      p_code: a.code,
    }),
  );
}

export function adminBackupReconcile(a: {
  actor: string;
  run: string;
  status: "running" | "succeeded" | "failed" | "skipped" | "unknown";
  conclusion: string | null;
  summary: Json;
  githubRunId: number;
  githubRunUrl: string;
}) {
  return whatsappOtpRpc<string>((c) =>
    c.rpc("admin_backup_reconcile", {
      p_actor: a.actor,
      p_run: a.run,
      p_status: a.status,
      p_conclusion: a.conclusion ?? "unknown",
      p_summary: a.summary,
      p_github_run_id: a.githubRunId,
      p_github_run_url: a.githubRunUrl,
    }),
  );
}

export function adminBackupUpdateSchedule(a: {
  actor: string;
  acceptanceSchedule: "off" | "daily" | "weekly";
  config: Json;
  productionRestoreScheduleEnabled: boolean;
  expectedVersion: number;
  reason: string;
  receipt: string;
}) {
  return whatsappOtpRpc<number>((c) =>
    c.rpc("admin_backup_update_schedule", {
      p_actor: a.actor,
      p_acceptance_schedule: a.acceptanceSchedule,
      p_config: a.config,
      p_production_restore_schedule_enabled: a.productionRestoreScheduleEnabled,
      p_expected_version: a.expectedVersion,
      p_reason: a.reason,
      p_receipt: a.receipt,
    }),
  );
}

export function adminBackupActivate(a: { actor: string; enabled: boolean; confirmation: string; reason: string; receipt: string }) {
  return whatsappOtpRpc<boolean>((c) =>
    c.rpc("admin_backup_activate", {
      p_actor: a.actor,
      p_enabled: a.enabled,
      p_confirmation: a.confirmation,
      p_reason: a.reason,
      p_receipt: a.receipt,
    }),
  );
}

export function whatsappOtpNotificationRecord(a: { eventKey: string; kind: string; sourceEnv: string; occurredAt: number; stats: Json }) {
  return whatsappOtpRpc<{ status: "recorded" | "duplicate"; recipients: number }>((c) =>
    c.rpc("whatsapp_otp_notification_record", { p_event_key: a.eventKey, p_kind: a.kind, p_source_env: a.sourceEnv, p_occurred_at: a.occurredAt, p_stats: a.stats }),
  );
}

/**
 * Stages a pending-registration row (the chosen top-level account type only) for a just-`signUp()`'d, still-unconfirmed user, via
 * `public.pending_registration_save` - granted to `service_role` ONLY (see
 * `supabase/migrations/20260924090006_pending_registrations.sql`), so this admin client is the only caller that can ever exercise it.
 * Never stores a password. Best-effort by design: a failure here does not fail registration; `verifyPasswordSignUp` falls back to the
 * finish-registration recovery screen if nothing was staged.
 *
 * P1 PR-B: there is no username, so the call goes to the username-less overload added by M3a (`pending_registration_save(uuid,
 * activity_audience_kind, text, integer)`) and sends NO `p_username`. supabase-js binds by NAME, which is what keeps the call unambiguous
 * next to the old five-argument function until M3b drops it. Apply M3a to the target database BEFORE deploying this code: on a database
 * without it the call fails (logged and ignored, like any lost staging write) and registration falls back to the finish-registration screen.
 */
export async function savePendingRegistration(params: {
  userId: string;
  audienceKind: "organization_type" | "persona_type";
  audienceValue: string;
}): Promise<boolean> {
  const admin = getAdminClient();
  const { error } = await admin.rpc("pending_registration_save", {
    p_user_id: params.userId,
    p_audience_kind: params.audienceKind,
    p_audience_value: params.audienceValue,
  });
  if (error) {
    console.error(`Failed to stage pending registration for ${params.userId}: ${error.message}`);
    return false;
  }
  return true;
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
 * Creates the Supabase Auth user for the mobile-number sign-up (any account type) — and is the ONLY creator of a phone-alias account.
 *
 * It needs a GRANT: the single-use proof the phone verification authority returned after the WhatsApp code was checked. The payload comes
 * from `signupCreateUserPayload` (one place, shared with the integration tests), which puts `phone_signup_grant` and
 * `phone_signup_registration` in `app_metadata` — never `user_metadata`, which the account owner can edit. The database alias guard
 * (migration 20261030090002) refuses an alias account created without a valid grant, so a caller that bypasses this function gets nothing.
 *
 * The password goes to GoTrue exactly once, here, and is hashed by GoTrue (bcrypt) — it is never stored or logged by this application.
 * `email_confirm: true` marks the INTERNAL alias as confirmed (it is a login key the server derived, never a mailbox).
 * `registration_source` and the password-set flag are kept in `app_metadata` exactly as for existing phone accounts.
 *
 * The earlier creators that took no grant (`createCraftsmanPasswordUser`, `createShowroomPasswordUser`) were removed in R2. Existing
 * accounts keep their `registration_source` values as data; legacy phone/password SIGN-IN is untouched.
 */
export async function createPhoneSignUpUser(params: { grant: SignupGrant; password: string; fullName: string; locale: "en" | "ar" }): Promise<CraftsmanUserCreation> {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser(
    signupCreateUserPayload(params.grant, {
      password: params.password,
      fullName: params.fullName,
      locale: params.locale,
      appMetadata: { registration_source: "phone_whatsapp_sign_up", [PASSWORD_SET_FLAG]: true },
    }),
  );
  if (error || !data.user) {
    const code = (error as { code?: string } | null)?.code;
    const status = (error as { status?: number } | null)?.status;
    if (code === "email_exists" || code === "user_already_exists") return { ok: false, reason: "exists" };
    if (status === 429 || code?.startsWith("over_")) return { ok: false, reason: "rate_limited" };
    if (code === "weak_password") return { ok: false, reason: "rejected" };
    console.error(`phone sign-up: auth user creation failed (code ${code ?? "unknown"})`);
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
 * The auth email behind a mobile number typed on the sign-in page, so the password grant can run against it. For a phone-registered
 * account this is its internal login alias. Null when nothing matches; the caller answers exactly as for a wrong password, so this never
 * reveals which numbers exist. Throws on a lookup failure (never guesses). (The username lookup was removed in P1 PR-2.)
 */
export async function resolveSignInEmail(lookup: { phoneE164: string }): Promise<string | null> {
  const admin = getAdminClient();
  const { data, error } = await admin.from("profiles").select("user_id").is("deleted_at", null).eq("phone_e164", lookup.phoneE164).limit(1);
  if (error) throw new Error(`sign-in identifier lookup failed (code ${error.code ?? "unknown"})`);
  const userId = data?.[0]?.user_id;
  if (!userId) return null;
  const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError) throw new Error(`sign-in identifier lookup failed (code ${(userError as { code?: string }).code ?? "unknown"})`);
  return user.user?.email ?? null;
}
