"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Input, SubmitButton } from "@/components/ui/controls";
import { saveMediaLimitAction } from "@/server/actions/media-limits";
import type { FormState } from "@/server/actions/sales-forms";
import type { MediaKind } from "@/lib/media/limits";

const INITIAL: FormState = { ok: false };

/**
 * One place's editor. Presentation only: the server action and the database re-check the permission, the reason, the hard
 * ceiling and the floor. The bounds are announced to assistive technology so a typo is caught before the round trip.
 */
export function MediaLimitRow({ kind, place, label, currentMb, defaultMb, ceilingMb, floorMb, changedLabel }: {
  kind: MediaKind; place: string; label: string; currentMb: string; defaultMb: string; ceilingMb: string; floorMb: string; changedLabel: string | null;
}) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(saveMediaLimitAction, INITIAL);
  const id = `ml-${kind}-${place}`;
  return (
    <form action={formAction} className="grid items-end gap-md border-b border-strong py-md md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.2fr)_minmax(0,2fr)_auto]" data-testid={`media-limit-${kind}-${place}`}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="place" value={place} />
      <div>
        <p className="text-body font-medium text-fg">{label}</p>
        {changedLabel ? <p className="text-label text-fg-muted">{changedLabel}</p> : null}
      </div>
      <p className="text-body text-fg" dir="ltr"><span className="text-label text-fg-muted md:hidden">{t("mediaLimits.columns.current")}: </span>{currentMb}</p>
      <p className="text-body text-fg-secondary" dir="ltr"><span className="text-label text-fg-muted md:hidden">{t("mediaLimits.columns.default")}: </span>{defaultMb}</p>
      <p className="text-body text-fg-secondary" dir="ltr"><span className="text-label text-fg-muted md:hidden">{t("mediaLimits.columns.ceiling")}: </span>{ceilingMb}</p>
      <div>
        <label htmlFor={`${id}-mb`} className="sr-only">{t("mediaLimits.columns.change")}</label>
        <Input id={`${id}-mb`} name="megabytes" inputMode="decimal" dir="ltr" required pattern="[0-9]{1,5}(\.[0-9]{1,2})?" placeholder={t("mediaLimits.columns.change")} aria-describedby={`${id}-bounds`} />
        <span id={`${id}-bounds`} className="sr-only">{floorMb} – {ceilingMb}</span>
      </div>
      <div>
        <label htmlFor={`${id}-reason`} className="sr-only">{t("mediaLimits.columns.reason")}</label>
        <Input id={`${id}-reason`} name="reason" required minLength={3} maxLength={500} dir="auto" placeholder={t("mediaLimits.columns.reason")} />
      </div>
      <SubmitButton pendingLabel={t("mediaLimits.saving")}>{t("mediaLimits.save")}</SubmitButton>
      {state.code ? (
        <p role="status" className={`md:col-span-full ${state.ok ? "text-body text-success" : "text-body text-danger"}`} data-testid={`media-limit-message-${kind}-${place}`}>
          {t(state.code)}
        </p>
      ) : null}
    </form>
  );
}
