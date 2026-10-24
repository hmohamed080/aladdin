import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import { readableMediaUrl } from "@/server/storage/edge-ticket";
import { isCraftsmanLoginAlias } from "@/lib/auth/craftsman-login-alias";
import { getCurrentUser } from "@/server/auth/session";

export type MyIdentity = {
  displayName: string;
  /** Only an explicit profile_set_display_name call sets this — never the account-creation fallback. */
  displayNameConfirmed: boolean;
  username: string | null;
  phoneCountryIso2: string | null;
  phoneNational: string | null;
  phoneE164: string | null;
  /** `profiles.phone_verified_at` is set. A phone changed through the Installer flow stays UNVERIFIED (NULL) until an OTP step exists. */
  phoneVerified: boolean;
  /** The phone is also this account's sign-in key (phone + password accounts): changing it needs the current password. */
  phoneIsLoginKey: boolean;
  avatarUrl: string | null;
  /** The current profile cover (a short-lived readable URL), or null. */
  coverUrl: string | null;
  /** A phone + password (Craftsman) account: its main phone is its login and cannot be moved here. */
  phoneLogin: boolean;
  /** The current unverified second phone reservation (V1, no OTP), or null. */
  secondaryPhone: SecondaryPhone | null;
};

export type SecondaryPhone = {
  phone: string;
  expiresAt: string;
  canRenew: boolean;
};

function mapSecondaryPhone(raw: unknown): SecondaryPhone | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.phone !== "string" || typeof r.expires_at !== "string" || r.status !== "active") return null;
  return { phone: r.phone, expiresAt: r.expires_at, canRenew: r.can_renew === true };
}

/** The caller's own shared identity fields (every audience). Scoped to the session — takes no user id. */
export const loadMyIdentity = cache(async function loadMyIdentity(): Promise<MyIdentity | null> {
  const supabase = await getServerSupabase();
  const user = await getCurrentUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "display_name, display_name_confirmed_at, username, phone_country_iso2, phone_national, phone_e164, phone_verified_at, avatar_media_id, cover_media_id",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return null;

  let avatarUrl: string | null = null;
  if (profile.avatar_media_id) {
    const { data: upload } = await supabase
      .from("avatar_uploads")
      .select("object_key")
      .eq("id", profile.avatar_media_id)
      .eq("state", "ready")
      .maybeSingle();
    if (upload?.object_key) {
      try { avatarUrl = await readableMediaUrl(supabase, "avatar", upload.object_key); }
      catch { avatarUrl = null; }
    }
  }

  let coverUrl: string | null = null;
  if (profile.cover_media_id) {
    const { data: cover } = await supabase
      .from("avatar_uploads")
      .select("object_key")
      .eq("id", profile.cover_media_id)
      .eq("state", "ready")
      .maybeSingle();
    if (cover?.object_key) {
      try { coverUrl = await readableMediaUrl(supabase, "avatar", cover.object_key); }
      catch { coverUrl = null; }
    }
  }

  const { data: secondary } = await supabase.rpc("my_secondary_phone");

  return {
    displayName: profile.display_name,
    displayNameConfirmed: profile.display_name_confirmed_at !== null,
    username: profile.username,
    phoneCountryIso2: profile.phone_country_iso2,
    phoneNational: profile.phone_national,
    phoneE164: profile.phone_e164,
    phoneVerified: profile.phone_verified_at !== null,
    phoneIsLoginKey: isCraftsmanLoginAlias(user.email),
    avatarUrl,
    coverUrl,
    phoneLogin: isCraftsmanLoginAlias(user.email),
    secondaryPhone: mapSecondaryPhone(secondary),
  };
});

export const PROFILE_COMPLETION_ITEMS = [
  "username",
  "avatar",
  "phone",
  "locality",
  "display_name",
  "headline",
  "years_experience",
  "activities",
  "bio",
  "organization_address",
  "organization_activities",
  "organization_setup",
  // Installer items (20261024090011_installer_profile_completion.sql).
  "availability",
  "location",
  "portfolio",
] as const;
export type ProfileCompletionItem = (typeof PROFILE_COMPLETION_ITEMS)[number];

export type ProfileCompletion = { percent: number; missing: ProfileCompletionItem[] };

function isCompletionItem(value: unknown): value is ProfileCompletionItem {
  return typeof value === "string" && (PROFILE_COMPLETION_ITEMS as readonly string[]).includes(value);
}

/**
 * `my_profile_completion()` — the authoritative, INFORMATIONAL calculation for
 * the persistent "Complete your profile" card. Never a gate. A failed read
 * returns null so the card simply does not render, rather than blocking the
 * page it sits on.
 */
export const loadMyProfileCompletion = cache(async function loadMyProfileCompletion(): Promise<ProfileCompletion | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("my_profile_completion");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;

  const raw = data as { percent?: unknown; missing?: unknown };
  const percent = typeof raw.percent === "number" ? raw.percent : Number(raw.percent);
  if (!Number.isFinite(percent)) return null;
  const missing = Array.isArray(raw.missing) ? raw.missing.filter(isCompletionItem) : [];
  return { percent: Math.max(0, Math.min(100, Math.round(percent))), missing };
});
