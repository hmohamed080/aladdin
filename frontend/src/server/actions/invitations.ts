"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Accept an organization invitation as the signed-in, email-verified invitee.
 * Authorization, the email-match rule, single-use, and the bridge into the
 * existing membership model all live in the `invitation_accept` RPC (security
 * definer, auth.uid()-derived). On success we hand off to `/onboarding`, which
 * resolves the now-active membership.
 */
export type InviteState = { ok: boolean; code?: string };

const tokenSchema = z.string().trim().min(24).max(128);

export async function acceptInvitation(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = tokenSchema.safeParse(formData.get("token"));
  if (!parsed.success) return { ok: false, code: "invite.error.invalid" };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "invite.error.signInFirst" };

  const { error } = await supabase.rpc("invitation_accept", { p_token: parsed.data });
  if (error) {
    // Map the RPC's guard errors to safe, translated messages (no enumeration).
    const message = (error.message ?? "").toLowerCase();
    if (message.includes("different email")) return { ok: false, code: "invite.error.wrongEmail" };
    if (message.includes("expired")) return { ok: false, code: "invite.error.expired" };
    if (message.includes("already been used")) return { ok: false, code: "invite.error.used" };
    if (message.includes("no longer valid")) return { ok: false, code: "invite.error.revoked" };
    return { ok: false, code: "invite.error.generic" };
  }
  redirect("/onboarding");
}
