"use client";

import { useActionState, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, InlineError } from "@/components/ui/primitives";
import { Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { formatDate } from "@/lib/ui/format";
import { addAvailabilityWindowAction, removeAvailabilityWindowAction, type WindowState } from "@/server/actions/service-areas";
import type { AvailabilityWindow } from "@/server/queries/service-areas";

const INITIAL: WindowState = { ok: false };

/**
 * WHEN YOU ARE FREE — the caller's declared availability windows, beside the existing "taking work" switch.
 *
 * A window is a date range the person says they can take work (open-ended when there is no end date). The Overall Match
 * compares a job's real planned dates with these windows; the flag above says whether they are taking work at all, and
 * these dates only count while it is on. Nothing is inferred from assignments or from the onboarding lead time — the
 * dates are exactly what the person wrote.
 *
 * The date inputs are the browser's own pickers (native date dialogs stay native). The list is the database's: a new
 * window appears after the server re-renders the page, and a removal is an explicit action on that row.
 */
export function AvailabilityWindows({ windows }: { windows: readonly AvailabilityWindow[] }) {
  const { t, locale } = useI18n();
  const [state, submit] = useActionState(addAvailabilityWindowAction, INITIAL);
  const [openEnded, setOpenEnded] = useState(false);
  const [removing, startRemoving] = useTransition();
  const [removeError, setRemoveError] = useState(false);

  const remove = (id: string) =>
    startRemoving(async () => {
      setRemoveError(false);
      const result = await removeAvailabilityWindowAction(id);
      if (!result.ok) setRemoveError(true);
    });

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex flex-col gap-1" data-testid="availability-windows">
        <h2 className="text-title text-fg">{t("profile.availabilityWindows.title")}</h2>
        <p className="max-w-prose text-body text-fg-secondary">{t("profile.availabilityWindows.body")}</p>
      </div>

      {windows.length === 0 ? (
        <p className="text-body text-fg-muted">{t("profile.availabilityWindows.empty")}</p>
      ) : (
        <ul className="grid gap-1.5" aria-busy={removing || undefined}>
          {windows.map((window) => (
            <li key={window.id} className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-strong/70 bg-surface-2/40 px-md py-2" data-testid="availability-window">
              <span className="text-body text-fg">
                {window.to
                  ? t("profile.availabilityWindows.range", { from: formatDate(window.from, locale), to: formatDate(window.to, locale) })
                  : t("profile.availabilityWindows.openRange", { from: formatDate(window.from, locale) })}
              </span>
              <button
                type="button"
                disabled={removing}
                aria-label={t("profile.availabilityWindows.removeAria", { from: formatDate(window.from, locale) })}
                onClick={() => remove(window.id)}
                className="min-h-9 rounded-sm px-2 text-label font-medium text-fg-secondary transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
              >
                {t("profile.availabilityWindows.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {removeError ? <InlineError>{t("profile.availabilityWindows.failed")}</InlineError> : null}

      <form action={submit} className="grid gap-sm tablet:grid-cols-[1fr_1fr_auto] tablet:items-end">
        <LabeledField label={t("profile.availabilityWindows.from")} htmlFor="window-from">
          <Input id="window-from" name="from" type="date" required />
        </LabeledField>
        <LabeledField label={t("profile.availabilityWindows.to")} htmlFor="window-to">
          <Input id="window-to" name="to" type="date" disabled={openEnded} required={!openEnded} />
        </LabeledField>
        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-label text-fg-secondary">
            <input type="checkbox" name="openEnded" value="1" checked={openEnded} onChange={(event) => setOpenEnded(event.target.checked)} />
            {t("profile.availabilityWindows.openEnded")}
          </label>
          <SubmitButton variant="outline" size="sm" pendingLabel={t("profile.availabilityWindows.adding")}>
            {t("profile.availabilityWindows.add")}
          </SubmitButton>
        </div>
      </form>
      {!state.ok && state.code ? <InlineError>{t(state.code)}</InlineError> : null}

      <p className="max-w-prose text-label text-fg-muted">{t("profile.availabilityWindows.note")}</p>
    </Card>
  );
}
