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
function getAdminClient(): SupabaseClient<Database> {
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
  });
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
}): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.rpc("pending_registration_save", {
    p_user_id: params.userId,
    p_username: params.username,
    p_audience_kind: params.audienceKind,
    p_audience_value: params.audienceValue,
  });
  if (error) {
    console.error(`Failed to stage pending registration for ${params.userId}: ${error.message}`);
  }
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

async function createPhonePasswordUser(params: { loginAlias: string; password: string; fullName: string }, source: string): Promise<CraftsmanUserCreation> {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: params.loginAlias,
    password: params.password,
    email_confirm: true,
    user_metadata: { full_name: params.fullName, locale: "ar" },
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

/**
 * Re-keys a phone-login account: the internal login alias (the auth email) follows the account's new phone.
 * Only called after the caller proved the current password, and always paired with `profile_set_phone`
 * (whose DB guard requires the alias and the profile phone to agree). Returns the reason on failure so the
 * caller can restore the previous alias.
 */
export async function rekeyLoginAlias(userId: string, newAlias: string): Promise<{ ok: true } | { ok: false; reason: "exists" | "failed" }> {
  const admin = getAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { email: newAlias, email_confirm: true });
  if (!error) return { ok: true };
  const code = (error as { code?: string }).code;
  if (code === "email_exists" || code === "user_already_exists") return { ok: false, reason: "exists" };
  console.error(`phone re-key: alias update failed (code ${code ?? "unknown"})`);
  return { ok: false, reason: "failed" };
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

// ---------------------------------------------------------------------------
// Public Marketplace image delivery (Migration 09,
// docs/marketplace/catalog-launch.md §Public media delivery). One more narrowly
// scoped service-role call site: the public product pages need image bytes for
// an ANONYMOUS visitor, and Marketplace images live in a private bucket with no
// anonymous read policy. `marketplace_public_image_ref` is granted to
// service_role ONLY and returns a reference only while EVERY publication
// condition holds (media flag on, image verified + byte-validated, product
// published, seller enabled, type/category active, variant active). The bytes
// are proxied by `/marketplace/media/[imageId]`; the browser never sees a
// bucket, key, signed URL or this key.
// ---------------------------------------------------------------------------

export type PublicMarketplaceImage = { bytes: ArrayBuffer; mimeType: string; sha256: string | null };

/** Returns the bytes of a currently publishable Marketplace image, or null for every other case (one answer for all refusals). */
export async function loadPublicMarketplaceImage(imageId: string): Promise<PublicMarketplaceImage | null> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("marketplace_public_image_ref", { p_image_id: imageId });
  const ref = Array.isArray(data) ? data[0] : null;
  if (error || !ref?.object_key || !ref.storage_bucket) return null;
  const { data: blob, error: dlError } = await admin.storage.from(ref.storage_bucket).download(ref.object_key);
  if (dlError || !blob) return null;
  return { bytes: await blob.arrayBuffer(), mimeType: ref.mime_type || "application/octet-stream", sha256: ref.checksum_sha256 };
}

/** Durable shared phone-auth limiter. Only service_role can consume buckets. */
export async function consumePhoneAuthLimit(action: "sign-in" | "sign-up", ipKey: string, phoneKey: string): Promise<boolean> {
  const { data, error } = await getAdminClient().rpc("phone_auth_consume_limit", {
    p_action: action, p_ip_key: ipKey, p_phone_key: phoneKey,
  });
  if (error) throw new Error("phone auth limiter unavailable");
  return data === true;
}
