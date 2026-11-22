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
