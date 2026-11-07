"use client";

import { useI18n } from "@/lib/i18n/context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LabeledField, Textarea } from "@/components/ui/controls";
import { setWhatsappOtpDeliveryAction } from "@/server/actions/whatsapp-otp-settings";
import { cn } from "@/lib/ui/cn";

/**
 * The Super Admin switch for WhatsApp code sending. Presentation only: the state, the version and the missing prerequisites all come from
 * the Worker via the server page; the action re-reads them, the database re-checks the permission and signs a one-request grant, and the
 * Worker persists the flag and its audit row. Nothing here is the source of truth, so a stale tab can only ever be refused.
 *
 * Every change opens a confirmation that asks for a reason (recorded with the actor, the old and the new value). Turning ON is disabled
 * while the Worker reports a missing prerequisite; turning OFF is always available so it can never be blocked in an incident.
 */
export function WhatsappOtpDeliverySwitch({ enabled, version, blockers }: { enabled: boolean; version: number; blockers: readonly string[] }) {
  const { t } = useI18n();
  const blocked = !enabled && blockers.length > 0;
  const next = enabled ? "off" : "on";

  return (
    <div className="flex flex-col gap-xs" data-testid="whatsapp-otp-delivery-switch">
      <ConfirmDialog
        trigger={enabled ? t("whatsappOtp.delivery.turnOff") : t("whatsappOtp.delivery.turnOn")}
        title={enabled ? t("whatsappOtp.delivery.confirmOffTitle") : t("whatsappOtp.delivery.confirmOnTitle")}
        body={enabled ? t("whatsappOtp.delivery.confirmOffBody") : t("whatsappOtp.delivery.confirmOnBody")}
        confirmLabel={enabled ? t("whatsappOtp.delivery.confirmOff") : t("whatsappOtp.delivery.confirmOn")}
        confirmVariant={enabled ? "danger" : "primary"}
        formAction={setWhatsappOtpDeliveryAction}
        renderTrigger={({ open }) => (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t("whatsappOtp.runtime.delivery")}
            aria-describedby="otp-delivery-help" /* the helper line the page renders under the runtime grid */
            disabled={blocked}
            onClick={open}
            data-testid="whatsapp-otp-delivery-toggle"
            className={cn(
              "relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill border transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
              "disabled:cursor-not-allowed disabled:opacity-50",
              enabled ? "border-success bg-success" : "border-strong bg-surface-hover",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-block h-5 w-5 rounded-pill bg-surface shadow-sm transition-transform",
                // logical offsets keep the knob on the correct side in RTL
                enabled ? "ltr:translate-x-6 rtl:-translate-x-6" : "ltr:translate-x-1 rtl:-translate-x-1",
              )}
            />
          </button>
        )}
      >
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="enabled" value={next} />
        <LabeledField label={t("whatsappOtp.delivery.reason")} htmlFor="otp-delivery-reason" hint={t("whatsappOtp.delivery.reasonHint")}>
          <Textarea id="otp-delivery-reason" name="reason" rows={3} required minLength={10} maxLength={500} dir="auto" />
        </LabeledField>
      </ConfirmDialog>
    </div>
  );
}
