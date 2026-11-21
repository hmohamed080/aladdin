"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { MIB } from "@/lib/media/upload-limits";
import { validateLimitInput } from "@/lib/media/limits";
import { invalidateMediaLimitCache } from "@/server/media/limits";
import type { FormState } from "@/server/actions/sales-forms";

/**
 * Super Admin: change the upload limit of one place. The actor is the session user (the RPC reads auth.uid()), the permission is
 * judged by the database (admin_media_limit_set: media_limits.manage), and the hard ceiling, the floor and the mandatory reason are
 * enforced there too: this action only reshapes the form and maps the refusals to messages.
 */
const NUMBER = /^[0-9]{1,5}(\.[0-9]{1,2})?$/;

export async function saveMediaLimitAction(_previous: FormState, fd: FormData): Promise<FormState> {
  const kind = String(fd.get("kind") ?? "");
  const place = String(fd.get("place") ?? "");
  const megabytes = String(fd.get("megabytes") ?? "").trim();
  const reason = String(fd.get("reason") ?? "").trim();
  if (kind !== "image" && kind !== "video") return { ok: false, code: "mediaLimits.errors.unknownPlace" };
  if (!NUMBER.test(megabytes)) return { ok: false, code: "mediaLimits.errors.number" };
  if (reason.length < 3 || reason.length > 500) return { ok: false, code: "mediaLimits.errors.reason" };
  const bytes = Math.round(Number(megabytes) * MIB);
  const check = validateLimitInput(kind, place, bytes);
  if (!check.ok) {
    return { ok: false, code: { unknown_place: "mediaLimits.errors.unknownPlace", not_a_number: "mediaLimits.errors.number", above_ceiling: "mediaLimits.errors.aboveCeiling", below_floor: "mediaLimits.errors.belowFloor" }[check.code] };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_media_limit_set", { p_kind: kind, p_place: place, p_max_bytes: bytes, p_reason: reason });
  if (error) {
    if (error.code === "42501") return { ok: false, code: "mediaLimits.errors.forbidden" };
    if (error.code === "22023") {
      if (/exceeds the platform ceiling/.test(error.message)) return { ok: false, code: "mediaLimits.errors.aboveCeiling" };
      if (/below the minimum/.test(error.message)) return { ok: false, code: "mediaLimits.errors.belowFloor" };
      if (/unknown place/.test(error.message)) return { ok: false, code: "mediaLimits.errors.unknownPlace" };
      if (/reason/.test(error.message)) return { ok: false, code: "mediaLimits.errors.reason" };
    }
    return { ok: false, code: "mediaLimits.errors.unavailable" };
  }
  invalidateMediaLimitCache();
  revalidatePath("/admin/media-limits");
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  return { ok: true, code: changed ? "mediaLimits.saved" : "mediaLimits.unchanged" };
}
