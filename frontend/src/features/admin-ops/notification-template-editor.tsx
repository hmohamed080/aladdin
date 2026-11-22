"use client";

import { useI18n } from "@/lib/i18n/context";
import { Input, SubmitButton, Textarea } from "@/components/ui/controls";
import { saveNotificationTemplateAction } from "@/server/actions/notification-templates";
import { BODY_MAX, TITLE_MAX } from "@/lib/notifications/templates";
import { useKeptFormAction } from "./use-kept-form-action";

const FIELDS = ["title_ar", "body_ar", "title_en", "body_en", "reason"] as const;

export type TemplateEditorProps = {
  templateKey: string;
  label: string;
  variables: readonly string[];
  texts: { titleAr: string; bodyAr: string; titleEn: string; bodyEn: string };
  isEdited: boolean;
  changedLabel: string | null;
};

/**
 * One template's editor. Presentation only: the server action and the database re-check the permission, the variables, the
 * lengths and the reason. The declared variables are listed so the admin knows which {names} the template accepts.
 */
export function NotificationTemplateEditor({ templateKey, label, variables, texts, isEdited, changedLabel }: TemplateEditorProps) {
  const { t } = useI18n();
  const { state, formAction, valueOf } = useKeptFormAction(saveNotificationTemplateAction, FIELDS);
  const id = `nt-${templateKey.replaceAll(".", "-")}`;
  return (
    <form action={formAction} className="flex flex-col gap-md border-b border-strong py-lg" data-testid={`notification-template-${templateKey}`}>
      <input type="hidden" name="key" value={templateKey} />
      <input type="hidden" name="variables" value={variables.join(",")} />
      <div className="flex flex-wrap items-baseline justify-between gap-md">
        <p className="text-body font-medium text-fg">{label}</p>
        <p className="text-label text-fg-muted">
          {isEdited ? t("notificationTemplates.edited") : t("notificationTemplates.default")}
          {changedLabel ? ` · ${changedLabel}` : ""}
        </p>
      </div>
      <p className="text-label text-fg-muted">
        {t("notificationTemplates.variables")}:{" "}
        {variables.map((name) => (
          <code key={name} className="me-sm rounded-sm bg-surface px-xs" dir="ltr">{`{${name}}`}</code>
        ))}
        <span className="block">{variables.map((name) => `${t(`notificationTemplates.variable.${name}`)}`).join(" · ")}</span>
      </p>
      <div className="grid gap-md md:grid-cols-2">
        <div className="flex flex-col gap-sm" dir="rtl" lang="ar">
          <label htmlFor={`${id}-title-ar`} className="text-label text-fg-muted">{t("notificationTemplates.fields.titleAr")}</label>
          <Input id={`${id}-title-ar`} name="title_ar" required maxLength={TITLE_MAX} defaultValue={valueOf("title_ar", texts.titleAr)} />
          <label htmlFor={`${id}-body-ar`} className="text-label text-fg-muted">{t("notificationTemplates.fields.bodyAr")}</label>
          <Textarea id={`${id}-body-ar`} name="body_ar" required maxLength={BODY_MAX} rows={3} defaultValue={valueOf("body_ar", texts.bodyAr)} />
        </div>
        <div className="flex flex-col gap-sm" dir="ltr" lang="en">
          <label htmlFor={`${id}-title-en`} className="text-label text-fg-muted">{t("notificationTemplates.fields.titleEn")}</label>
          <Input id={`${id}-title-en`} name="title_en" required maxLength={TITLE_MAX} defaultValue={valueOf("title_en", texts.titleEn)} />
          <label htmlFor={`${id}-body-en`} className="text-label text-fg-muted">{t("notificationTemplates.fields.bodyEn")}</label>
          <Textarea id={`${id}-body-en`} name="body_en" required maxLength={BODY_MAX} rows={3} defaultValue={valueOf("body_en", texts.bodyEn)} />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-reason`} className="text-label text-fg-muted">{t("notificationTemplates.fields.reason")}</label>
        <Input id={`${id}-reason`} name="reason" required minLength={3} maxLength={500} dir="auto" placeholder={t("notificationTemplates.reasonHint")} defaultValue={valueOf("reason")} />
      </div>
      <div className="flex flex-wrap items-center gap-md">
        <SubmitButton name="intent" value="save" pendingLabel={t("notificationTemplates.saving")}>{t("notificationTemplates.save")}</SubmitButton>
        {isEdited ? (
          <SubmitButton name="intent" value="reset" variant="outline" pendingLabel={t("notificationTemplates.saving")}>{t("notificationTemplates.resetAction")}</SubmitButton>
        ) : null}
      </div>
      {state.code ? (
        <p role="status" className={state.ok ? "text-body text-success" : "text-body text-danger"} data-testid={`notification-template-message-${templateKey}`}>
          {t(state.code)}
        </p>
      ) : null}
    </form>
  );
}
