import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv, parseServerEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/** The one authoritative security flag this preview stamps into `app_metadata` — never `user_metadata`. */
export const PASSWORD_SET_FLAG = "aladdin_pw_preview_password_set";

/**
 * ADMIN client — service-role key, bypasses RLS entirely, holds full Auth
 * admin privileges. NEVER exposed to the browser (the `server-only` import
 * guard above makes importing this file from a Client Component a build
 * error, not just a convention).
 *
 * Introduced by this preview for writing `app_metadata`. Supabase's regular
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
      "SUPABASE_SERVICE_ROLE_KEY is not set. Required locally for the password-auth preview's authoritative " +
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
 * The one authoritative write this preview performs: stamps
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
