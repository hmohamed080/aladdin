import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The signed-in person, as the account CHROME needs to describe them.
 *
 * This is deliberately thin. The profile menu shows who you are signed in as —
 * a name and the contact that was verified — and nothing else. It is not a
 * profile loader, it does not read completeness, persona, verification state or
 * memberships, and it must not grow into one: those belong to the surfaces that
 * act on them, and pulling them into the header would put a multi-table read on
 * every authenticated page.
 *
 * WHY THE CONTACT IS EITHER/OR
 * Authentication is passwordless and a user verifies exactly ONE primary contact
 * at sign-up — WhatsApp OTP or email (see the canonical auth model). So a real
 * account may legitimately have no email at all, and a menu that renders an
 * "email" row unconditionally would show an empty line to every phone-verified
 * user. What is shown is whichever contact the account actually has.
 *
 * `cache()`d per render so a layout that also renders a header pays for one
 * identity read, not two.
 */
export type AccountIdentity = {
  userId: string;
  /** The profile display name, when one has been set. */
  displayName: string | null;
  /** The verified primary contact — an email address or a phone number. */
  contact: string | null;
  contactKind: "email" | "phone" | null;
};

export const loadAccountIdentity = cache(async function loadAccountIdentity(): Promise<AccountIdentity | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const email = user.email?.trim() || null;
  const phone = user.phone?.trim() || null;

  return {
    userId: user.id,
    displayName: profile?.display_name?.trim() || null,
    contact: email ?? phone,
    contactKind: email ? "email" : phone ? "phone" : null,
  };
});

/**
 * Initials for the avatar disc. Two letters, taken from word starts, so an
 * Arabic name and a Latin one are treated identically — no transliteration, no
 * image pipeline, and no broken <img> when a user has never uploaded a photo.
 *
 * Pure and exported so the client menu and any server-rendered trigger derive
 * the SAME two characters rather than each inventing their own rule.
 */
export function initialsOf(name: string | null | undefined, fallback: string | null | undefined): string {
  const source = name?.trim() || fallback?.trim() || "";
  if (!source) return "?";
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}
