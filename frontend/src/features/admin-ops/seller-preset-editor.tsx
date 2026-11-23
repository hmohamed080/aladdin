"use client";

import { useI18n } from "@/lib/i18n/context";
import { Input, Select, SubmitButton } from "@/components/ui/controls";
import { saveSellerPresetAction } from "@/server/actions/notification-templates";
import { useKeptFormAction } from "./use-kept-form-action";

const FIELDS = ["action", "label_ar", "label_en", "text_ar", "text_en", "sort_order", "reason"] as const;
const ACTIONS = ["approve", "reject", "suspend", "reinstate", "revoke", "image_reject"] as const;

export type SellerPresetValue = {
  id: string | null;
  action: string;
  labelAr: string;
  labelEn: string;
  textAr: string;
  textEn: string;
  isActive: boolean;
  sortOrder: number;
};

/**
 * One owner-message preset of the Marketplace seller transitions (or the blank form that creates one). Presentation only: the
 * Server Action and the database re-check the permission, the lengths and the mandatory reason. A preset is switched off, never
 * deleted, so an old decision keeps its meaning.
 */
export function SellerPresetEditor({ preset }: { preset: SellerPresetValue }) {
  const { t } = useI18n();
  const { state, formAction, valueOf } = useKeptFormAction(saveSellerPresetAction, FIELDS);
  const key = preset.id ?? "new";
  const id = `sp-${key}`;
  return (
    <form action={formAction} className="flex flex-col gap-md border-b border-strong py-lg" data-testid={`seller-preset-${key}`}>
      {preset.id ? <input type="hidden" name="id" value={preset.id} /> : null}
      <div className="grid gap-md md:grid-cols-3">
        <div className="flex flex-col gap-sm">
          <label htmlFor={`${id}-action`} className="text-label text-fg-muted">{t("notificationTemplates.presets.fields.action")}</label>
          <Select id={`${id}-action`} name="action" defaultValue={valueOf("action", preset.action) ?? "reject"}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{t(`adminMarketplace.sellers.action.${a}`)}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-sm">
          <label htmlFor={`${id}-order`} className="text-label text-fg-muted">{t("notificationTemplates.presets.fields.order")}</label>
          <Input id={`${id}-order`} name="sort_order" inputMode="numeric" dir="ltr" defaultValue={valueOf("sort_order", String(preset.sortOrder))} />
        </div>
        <label className="flex items-center gap-sm self-end text-body text-fg">
          <input type="checkbox" name="is_active" defaultChecked={preset.isActive} />
          {t("notificationTemplates.presets.fields.active")}
        </label>
      </div>
      <div className="grid gap-md md:grid-cols-2">
        <div className="flex flex-col gap-sm" dir="rtl" lang="ar">
          <label htmlFor={`${id}-label-ar`} className="text-label text-fg-muted">{t("notificationTemplates.presets.fields.labelAr")}</label>
          <Input id={`${id}-label-ar`} name="label_ar" required maxLength={80} defaultValue={valueOf("label_ar", preset.labelAr)} />
          <label htmlFor={`${id}-text-ar`} className="text-label text-fg-muted">{t("notificationTemplates.presets.fields.textAr")}</label>
          <Input id={`${id}-text-ar`} name="text_ar" required maxLength={300} defaultValue={valueOf("text_ar", preset.textAr)} />
        </div>
        <div className="flex flex-col gap-sm" dir="ltr" lang="en">
          <label htmlFor={`${id}-label-en`} className="text-label text-fg-muted">{t("notificationTemplates.presets.fields.labelEn")}</label>
          <Input id={`${id}-label-en`} name="label_en" required maxLength={80} defaultValue={valueOf("label_en", preset.labelEn)} />
          <label htmlFor={`${id}-text-en`} className="text-label text-fg-muted">{t("notificationTemplates.presets.fields.textEn")}</label>
          <Input id={`${id}-text-en`} name="text_en" required maxLength={300} defaultValue={valueOf("text_en", preset.textEn)} />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-reason`} className="text-label text-fg-muted">{t("notificationTemplates.fields.reason")}</label>
        <Input id={`${id}-reason`} name="reason" required minLength={3} maxLength={500} dir="auto" placeholder={t("notificationTemplates.reasonHint")} defaultValue={valueOf("reason")} />
      </div>
      <div>
        <SubmitButton pendingLabel={t("notificationTemplates.saving")}>
          {preset.id ? t("notificationTemplates.presets.save") : t("notificationTemplates.presets.add")}
        </SubmitButton>
      </div>
      {state.code ? (
        <p role="status" className={state.ok ? "text-body text-success" : "text-body text-danger"} data-testid={`seller-preset-message-${key}`}>
          {t(state.code)}
        </p>
      ) : null}
    </form>
  );
}
