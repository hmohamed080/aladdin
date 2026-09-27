import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import { AVATAR_BUCKET } from "@/lib/storage/avatar-assets";

/** How long a signed avatar read URL lives. Minted per render, never stored. */
const AVATAR_READ_URL_SECONDS = 300;

export type MyIdentity = {
  displayName: string;
  /** Only an explicit profile_set_display_name call sets this — never the account-creation fallback. */
  displayNameConfirmed: boolean;
  username: string | null;
  phoneCountryIso2: string | null;
  phoneNational: string | null;
  phoneE164: string | null;
  avatarUrl: string | null;
};

/** The caller's own shared identity fields (every audience). Scoped to the session — takes no user id. */
export const loadMyIdentity = cache(async function loadMyIdentity(): Promise<MyIdentity | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "display_name, display_name_confirmed_at, username, phone_country_iso2, phone_national, phone_e164, avatar_media_id",
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
      const { data: signed } = await supabase.storage
        .from(AVATAR_BUCKET)
        .createSignedUrl(upload.object_key, AVATAR_READ_URL_SECONDS);
      avatarUrl = signed?.signedUrl ?? null;
    }
  }

  return {
    displayName: profile.display_name,
    displayNameConfirmed: profile.display_name_confirmed_at !== null,
    username: profile.username,
    phoneCountryIso2: profile.phone_country_iso2,
    phoneNational: profile.phone_national,
    phoneE164: profile.phone_e164,
    avatarUrl,
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
  "organization_activities",
  "organization_setup",
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
