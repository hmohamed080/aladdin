"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, InlineError } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/controls";
import { formatRelativeTime } from "@/lib/ui/format";
import { setAvailabilityAction, type AvailabilityState } from "@/server/actions/availability";
import type { Availability } from "@/server/queries/personal-home";

const INITIAL: AvailabilityState = { ok: false };

/**
 * The professional's own availability control.
 *
 * A BUTTON, NOT A SWITCH, and the reason is the failure mode rather than taste.
 * A checkbox-style switch reads as instantly applied; this one is a server round
 * trip that can be REFUSED (a non-professional identity is rejected by the
 * database trigger). A control that visibly moves and then silently snaps back is
 * worse than one that says what it is about to do and reports what happened. The
 * button therefore names the destination state — "Mark me available" — and the
 * current state is stated beside it rather than encoded in the control's own
 * position.
 *
 * IT POSTS A VALUE, NOT A TOGGLE. Two rapid submissions converge on the same
 * state instead of flipping twice, so a double-click cannot leave the person
 * claiming the opposite of what they clicked.
 *
 * NO OPTIMISTIC UPDATE. The displayed state comes from the server on the next
 * render, because the timestamp beside it is stamped by the database and an
 * optimistic flag would have to invent one. Showing a freshness the database has
 * not recorded is the same lie the write path is shaped to prevent.
 *
 * THE TIME IS RENDERED CLIENT-SIDE HERE, deliberately. `formatRelativeTime`
 * compares against `now()`, so a server-rendered "3 days ago" would freeze at
 * whatever the page was built; this component is already client-side for the
 * form, so it re-derives the age on mount. The public page has no such control
 * and renders the age on the server, where a per-request `force-dynamic` render
 * makes it accurate at delivery.
 */
export function AvailabilityControl({ availability }: { availability: Availability }) {
  const { t, locale } = useI18n();
  const [state, submit] = useActionState(setAvailabilityAction, INITIAL);

  const { available, updatedAt } = availability;
  const next = !available;

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-pill ${available ? "bg-success" : "bg-fg-muted"}`}
            />
            <p className="font-medium text-fg">
              {t(available ? "profile.availability.available" : "profile.availability.unavailable")}
            </p>
          </div>
          <p className="text-label text-fg-muted">
            {updatedAt
              ? t("profile.availability.updated", { when: formatRelativeTime(updatedAt, locale) })
              : t("profile.availability.neverSet")}
          </p>
        </div>

        <form action={submit} className="shrink-0">
          <input type="hidden" name="available" value={next ? "1" : "0"} />
          <SubmitButton variant={next ? "primary" : "outline"} size="sm">
            {t(next ? "profile.availability.markAvailable" : "profile.availability.markUnavailable")}
          </SubmitButton>
        </form>
      </div>

      {/* What the flag does and — just as important — what it does not. Testers
          read an availability switch as a calendar or as a login state; saying so
          once here is cheaper than the support conversation. */}
      <p className="max-w-prose text-label text-fg-secondary">{t("profile.availability.explainer")}</p>

      {!state.ok && state.code ? <InlineError>{t(state.code)}</InlineError> : null}
    </Card>
  );
}
