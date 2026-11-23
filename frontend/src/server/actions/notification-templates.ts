"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { validateTemplateTexts } from "@/lib/notifications/templates";
import type { FormState } from "@/server/actions/sales-forms";

/**
 * Super Admin: edit or reset one notification template. The actor is the session user (the RPC reads auth.uid()), the permission is
 * judged by the database (admin_notification_template_set / _reset: notification_templates.manage), and the variable check, the
 * lengths and the mandatory reason are enforced there too: this action only reshapes the form and maps the refusals to messages.
 */
function mapRpcError(error: { code?: string; message?: string }): string {
  if (error.code === "42501") return "notificationTemplates.errors.forbidden";
  if (error.code === "22023") {
    if (/undeclared variable/.test(error.message ?? "")) return "notificationTemplates.errors.variable";
    if (/unknown template/.test(error.message ?? "")) return "notificationTemplates.errors.unknown";
    if (/reason/.test(error.message ?? "")) return "notificationTemplates.errors.reason";
    return "notificationTemplates.errors.length";
  }
  return "notificationTemplates.errors.unavailable";
}

export async function saveNotificationTemplateAction(_previous: FormState, fd: FormData): Promise<FormState> {
  const key = String(fd.get("key") ?? "");
  const intent = String(fd.get("intent") ?? "save");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(key)) return { ok: false, code: "notificationTemplates.errors.unknown" };
  if (reason.length < 3 || reason.length > 500) return { ok: false, code: "notificationTemplates.errors.reason" };
  const supabase = await getServerSupabase();

  if (intent === "reset") {
    const { data, error } = await supabase.rpc("admin_notification_template_reset", { p_key: key, p_reason: reason });
    if (error) return { ok: false, code: mapRpcError(error) };
    revalidatePath("/admin/notification-templates");
    return { ok: true, code: (data as { changed?: boolean } | null)?.changed === false ? "notificationTemplates.unchanged" : "notificationTemplates.reset" };
  }

  const texts = {
    titleAr: String(fd.get("title_ar") ?? "").trim(),
    bodyAr: String(fd.get("body_ar") ?? "").trim(),
    titleEn: String(fd.get("title_en") ?? "").trim(),
    bodyEn: String(fd.get("body_en") ?? "").trim(),
  };
  const variables = String(fd.get("variables") ?? "").split(",").filter(Boolean);
  const check = validateTemplateTexts(texts, variables);
  if (!check.ok) return { ok: false, code: check.code === "variable" ? "notificationTemplates.errors.variable" : "notificationTemplates.errors.length" };

  const { data, error } = await supabase.rpc("admin_notification_template_set", {
    p_key: key,
    p_title_ar: texts.titleAr,
    p_body_ar: texts.bodyAr,
    p_title_en: texts.titleEn,
    p_body_en: texts.bodyEn,
    p_reason: reason,
  });
  if (error) return { ok: false, code: mapRpcError(error) };
  revalidatePath("/admin/notification-templates");
  return { ok: true, code: (data as { changed?: boolean } | null)?.changed === false ? "notificationTemplates.unchanged" : "notificationTemplates.saved" };
}

const PRESET_ACTIONS = ["approve", "reject", "suspend", "reinstate", "revoke", "image_reject"];

/**
 * Super Admin: create or edit one owner-message preset of the Marketplace seller transitions (admin_marketplace_seller_preset_save,
 * notification_templates.manage). Presets are deactivated, never deleted, so an old event keeps its meaning. The database judges the
 * permission, the lengths and the reason; this reshapes the form and maps the refusals.
 */
export async function saveSellerPresetAction(_previous: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("id") ?? "").trim() || null;
  const action = String(fd.get("action") ?? "");
  const text = (name: string) => String(fd.get(name) ?? "").trim();
  const reason = text("reason");
  const sort = Number.parseInt(String(fd.get("sort_order") ?? "0"), 10);
  if (!PRESET_ACTIONS.includes(action)) return { ok: false, code: "notificationTemplates.presets.errors.action" };
  if (reason.length < 3 || reason.length > 500) return { ok: false, code: "notificationTemplates.errors.reason" };
  if (!text("label_ar") || !text("label_en") || !text("text_ar") || !text("text_en")
      || text("label_ar").length > 80 || text("label_en").length > 80 || text("text_ar").length > 300 || text("text_en").length > 300) {
    return { ok: false, code: "notificationTemplates.presets.errors.length" };
  }
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("admin_marketplace_seller_preset_save", {
    p_id: id as string,
    p_action: action,
    p_label_ar: text("label_ar"),
    p_label_en: text("label_en"),
    p_text_ar: text("text_ar"),
    p_text_en: text("text_en"),
    p_is_active: fd.get("is_active") === "on",
    p_sort_order: Number.isFinite(sort) ? sort : 0,
    p_reason: reason,
  });
  if (error) {
    const code = error.code === "42501" ? "notificationTemplates.errors.forbidden"
      : error.code === "22023" ? "notificationTemplates.presets.errors.length"
      : "notificationTemplates.errors.unavailable";
    return { ok: false, code };
  }
  revalidatePath("/admin/notification-templates");
  revalidatePath("/admin/marketplace");
  revalidatePath("/admin/marketplace/media");
  return { ok: true, code: "notificationTemplates.presets.saved" };
}
