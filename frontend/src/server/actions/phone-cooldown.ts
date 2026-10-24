"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import type { FormState } from "@/server/actions/sales-forms";

/**
 * Support: lift the 30-day cooldown on a released second-phone number. `admin_phone_cooldown_override`
 * re-checks `phones.cooldown_override`, requires a reason, writes an immutable override row and the audit event.
 */
const E164 = /^\+[1-9][0-9]{7,14}$/;

export async function overridePhoneCooldownAction(_p: FormState, fd: FormData): Promise<FormState> {
  const phone = String(fd.get("phone") ?? "").trim();
  const reason = String(fd.get("reason") ?? "").trim();
  if (!E164.test(phone)) return { ok: false, code: "phoneCooldown.errors.invalid" };
  if (reason.length < 1 || reason.length > 500) return { ok: false, code: "phoneCooldown.errors.reasonRequired" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("admin_phone_cooldown_override", { p_phone: phone, p_reason: reason });
  if (error) {
    if (error.code === "42501") return { ok: false, code: "phoneCooldown.errors.forbidden" };
    if (error.message?.includes("not in cooldown")) return { ok: false, code: "phoneCooldown.errors.notInCooldown" };
    return { ok: false, code: "phoneCooldown.errors.generic" };
  }
  revalidatePath("/admin/phone-cooldowns");
  return { ok: true, code: "phoneCooldown.done" };
}
