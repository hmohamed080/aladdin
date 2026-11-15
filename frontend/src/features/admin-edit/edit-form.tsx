"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/primitives";
import { Input, LabeledField, SubmitButton, Textarea } from "@/components/ui/controls";
import type { FormState } from "@/server/actions/sales-forms";
import type { EditField } from "@/lib/admin/edit/fields";

const INITIAL: FormState = { ok: false };

export type EditFormField = EditField & { value: string | boolean };
export type EditFormMedia = { key: string; labelKey: string; present: boolean };

/**
 * Admin edit form (Option A). Presentation fields only; media is remove-only (a checkbox, never an upload). The reason is
 * required. The form sends `f_<field>` entries and `remove_<media>` flags; the server action reduces them to an allow-listed
 * patch and refuses anything else (contact and legal fields never appear here and are refused by name if forged in).
 */
export function EditForm({
  subjectId,
  fields,
  media,
  action,
}: {
  subjectId: string;
  fields: readonly EditFormField[];
  media: readonly EditFormMedia[];
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(action, INITIAL);
  const err = (key: string) => (state.fieldErrors?.[key] ? t(state.fieldErrors[key]!) : undefined);

  return (
    <Card>
      <form action={dispatch} className="flex flex-col gap-md" data-testid="admin-edit-form">
        <input type="hidden" name="subjectId" value={subjectId} />
        {fields.map((f) => {
          const id = `edit-${f.key}`;
          const label = t(`admin.profileEdit.fields.${f.key}`);
          if (f.kind === "boolean") {
            return (
              <label key={f.key} htmlFor={id} className="flex items-center gap-2 text-body">
                <input type="hidden" name={`f_${f.key}__present`} value="1" />
                <input id={id} type="checkbox" name={`f_${f.key}`} defaultChecked={f.value === true} />
                {t("admin.profileEdit.availableForWork")}
              </label>
            );
          }
          return (
            <LabeledField key={f.key} label={label} htmlFor={id} error={err(f.key)}>
              {f.kind === "textarea" ? (
                <Textarea id={id} name={`f_${f.key}`} rows={4} maxLength={f.max} defaultValue={String(f.value ?? "")} />
              ) : (
                <Input id={id} name={`f_${f.key}`} maxLength={f.max} defaultValue={String(f.value ?? "")} required={f.required} />
              )}
            </LabeledField>
          );
        })}
        {media.map((m) =>
          m.present ? (
            <label key={m.key} className="flex items-center gap-2 text-body">
              <input type="checkbox" name={`remove_${m.key}`} />
              {t(m.labelKey)}
            </label>
          ) : null,
        )}
        <LabeledField label={t("admin.profileEdit.reasonLabel")} htmlFor="edit-reason" error={err("reason")}>
          <Textarea id="edit-reason" name="reason" rows={3} maxLength={500} placeholder={t("admin.profileEdit.reasonPlaceholder")} required />
        </LabeledField>
        {state.code ? (
          <p role="status" className={state.ok ? "text-body text-success" : "text-body text-danger"} data-testid="admin-edit-status">
            {t(state.code)}
          </p>
        ) : null}
        <div>
          <SubmitButton>{t("admin.profileEdit.submit")}</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
