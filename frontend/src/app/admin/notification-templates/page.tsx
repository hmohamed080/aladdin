import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/ui/format";
import { can } from "@/lib/permissions/admin";
import { requireAdminRoute } from "@/server/authorization/admin";
import { AdminHeader } from "@/features/admin/parts";
import { Card, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { NotificationTemplateEditor } from "@/features/admin-ops/notification-template-editor";

export const dynamic = "force-dynamic";

type EventRow = { id: number; at: string; template_key: string; action: string; actor_id: string; reason: string };

/**
 * In-app notification templates (Arabic + English). `notification_templates.view` (Administrator and higher) opens the page; the
 * editors appear only for `notification_templates.manage` (Super Admin). The database decides on every read and every change
 * (admin_notification_templates, admin_notification_template_set); the route rule and the hidden editors are convenience, never the gate.
 */
export default async function NotificationTemplatesPage() {
  const access = await requireAdminRoute("/admin/notification-templates");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const supabase = await getServerSupabase();

  const [templates, history] = await Promise.all([
    supabase.rpc("admin_notification_templates"),
    supabase.rpc("admin_notification_template_events", { p_limit: 30 }),
  ]);
  const header = <AdminHeader locale={locale} title={t("notificationTemplates.title")} subtitle={t("notificationTemplates.subtitle")} />;
  if (templates.error?.code === "42501" || history.error?.code === "42501") {
    return <StatePanel tone="danger" title={t("notificationTemplates.errors.forbidden")} />;
  }
  if (templates.error || history.error) {
    return <div className="flex flex-col gap-lg">{header}<StatePanel tone="danger" title={t("notificationTemplates.errors.unavailable")} /></div>;
  }

  const rows = templates.data ?? [];
  const events = (history.data ?? []) as EventRow[];
  const canManage = can(access, "notification_templates.manage");

  const actorIds = [...new Set(events.map((e) => e.actor_id))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
    for (const r of data ?? []) names.set(r.user_id, r.display_name);
  }
  const who = (id: string) => names.get(id) || id.slice(0, 8);
  // events arrive newest first: the first one per template is its latest change
  const lastChange = new Map<string, string>();
  for (const e of events) if (!lastChange.has(e.template_key)) lastChange.set(e.template_key, e.at);

  return (
    <div className="flex flex-col gap-lg" data-testid="admin-notification-templates">
      {header}
      {canManage ? null : <StatePanel tone="neutral" title={t("notificationTemplates.viewOnly")} />}
      <Card>
        <SectionTitle>{t("notificationTemplates.listTitle")}</SectionTitle>
        <div className="mt-md">
          {rows.map((row) => {
            const label = t(`notificationTemplates.template.${row.key}`);
            const at = lastChange.get(row.key);
            return canManage ? (
              <NotificationTemplateEditor
                key={row.key}
                templateKey={row.key}
                label={label}
                variables={row.variables}
                texts={{ titleAr: row.title_ar, bodyAr: row.body_ar, titleEn: row.title_en, bodyEn: row.body_en }}
                isEdited={row.is_edited}
                changedLabel={at ? t("notificationTemplates.changed", { when: formatDateTime(at, locale) }) : null}
              />
            ) : (
              <div key={row.key} className="flex flex-col gap-sm border-b border-strong py-md" data-testid={`notification-template-${row.key}`}>
                <p className="text-body font-medium text-fg">{label}</p>
                <p className="text-body text-fg" dir="rtl" lang="ar">{row.title_ar} — {row.body_ar}</p>
                <p className="text-body text-fg" dir="ltr" lang="en">{row.title_en} — {row.body_en}</p>
              </div>
            );
          })}
        </div>
      </Card>
      <ul className="list-disc ps-lg text-label text-fg-muted">
        <li>{t("notificationTemplates.notes.snapshot")}</li>
        <li>{t("notificationTemplates.notes.variables")}</li>
        <li>{t("notificationTemplates.notes.default")}</li>
      </ul>
      <Card>
        <SectionTitle>{t("notificationTemplates.history.title")}</SectionTitle>
        {events.length === 0 ? (
          <p className="mt-md text-body text-fg-muted">{t("notificationTemplates.history.empty")}</p>
        ) : (
          <ul className="mt-md flex flex-col gap-sm" data-testid="notification-template-history">
            {events.map((e) => (
              <li key={e.id} className="text-body text-fg">
                <span className="font-medium">{t(`notificationTemplates.template.${e.template_key}`)}</span>{" "}
                {t(`notificationTemplates.history.${e.action === "reset" ? "reset" : "set"}`)}{" "}
                {t("notificationTemplates.history.by")} {who(e.actor_id)} · <span className="text-fg-muted">{formatDateTime(e.at, locale)}</span>
                <span className="block text-label text-fg-muted" dir="auto">{e.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
