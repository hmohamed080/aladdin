"use client";

import { useI18n } from "@/lib/i18n/context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LabeledField, Textarea } from "@/components/ui/controls";
import { overridePhoneCooldownAction } from "@/server/actions/phone-cooldown";

/** Lift a number's cooldown. The reason is mandatory and recorded permanently. */
export function PhoneCooldownOverride({ phone }: { phone: string }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      trigger={t("phoneCooldown.override")}
      triggerVariant="danger"
      // The status card lays out as a flex column, which stretches a child to the card's width; the action
      // keeps its intrinsic width at every breakpoint, like every other button in an Admin card.
      triggerClassName="self-start"
      title={t("phoneCooldown.overrideTitle")}
      body={t("phoneCooldown.overrideBody")}
      confirmLabel={t("phoneCooldown.override")}
      confirmVariant="danger"
      formAction={overridePhoneCooldownAction}
    >
      <input type="hidden" name="phone" value={phone} />
      <div className="mt-md">
        <LabeledField label={t("phoneCooldown.reasonLabel")} htmlFor="cooldown-reason">
          <Textarea id="cooldown-reason" name="reason" rows={3} required maxLength={500} dir="auto" />
        </LabeledField>
      </div>
    </ConfirmDialog>
  );
}
