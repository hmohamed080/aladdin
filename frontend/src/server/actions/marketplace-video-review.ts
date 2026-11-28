"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Admin review of a Marketplace product video. Runs under the admin's own session; the SECURITY DEFINER RPC
 * re-checks marketplace_media.moderate and writes the append-only trail (the UI is never the gate).
 */
export type VideoReviewResult = { ok: true } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function reviewVideoAction(
  videoId: string,
  decision: "approve" | "reject",
  input: { reason?: string; messageAr?: string; messageEn?: string } = {},
): Promise<VideoReviewResult> {
  if (!UUID.test(videoId) || (decision !== "approve" && decision !== "reject")) return { ok: false, code: "decision_invalid" };
  const reason = (input.reason ?? "").trim();
  const messageAr = (input.messageAr ?? "").trim();
  const messageEn = (input.messageEn ?? "").trim();
  if (decision === "reject") {
    if (!reason) return { ok: false, code: "reason_required" };
    if (!messageAr || !messageEn) return { ok: false, code: "message_required" };
  }
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("admin_marketplace_video_review", {
    p_video_id: videoId,
    p_decision: decision,
    p_reason: decision === "reject" ? reason : (null as unknown as string),
    p_message_ar: decision === "reject" ? messageAr : (null as unknown as string),
    p_message_en: decision === "reject" ? messageEn : (null as unknown as string),
  });
  if (error) return { ok: false, code: videoReviewErrorCode(error) };
  revalidatePath("/admin/marketplace/videos");
  return { ok: true };
}

/** Maps the RPC refusals (`mp:<code>` messages, Postgres codes) to the stable code the page translates. */
function videoReviewErrorCode(error: { message?: string; code?: string }): string {
  const m = /mp:([a-z_]+)/.exec(error.message ?? "");
  if (m) return m[1]!;
  return error.code === "42501" ? "not_permitted" : "unexpected";
}
