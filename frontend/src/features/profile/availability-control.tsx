"use client";

import { useActionState, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, InlineError } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/controls";
import { ClockIcon, MinusCircleIcon } from "@/components/ui/icons";
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
 * THREE STATES. A professional who has never answered is NOT SPECIFIED — not "unavailable" — and sees both choices;
 * the database records the first explicit "unavailable" just like an "available" (see availability-state.ts).
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
 * THE AGE LINE TOLERATES A SERVER/CLIENT DIFFERENCE, deliberately (`suppressHydrationWarning`, then the node is replaced on mount):
 * "3 minutes ago" computed on the server and again in the browser can differ by a minute, and an un-suppressed
 * difference is a React hydration error that discards the server markup. (Original note follows.)
 *
 * THE TIME IS RENDERED CLIENT-SIDE HERE, deliberately. `formatRelativeTime`
 * compares against `now()`, so a server-rendered "3 days ago" would freeze at
 * whatever the page was built; this component is already client-side for the
 * form, so it re-derives the age on mount. The public page has no such control
 * and renders the age on the server, where a per-request `force-dynamic` render
 * makes it accurate at delivery.
 */
export function AvailabilityControl({ availability, variant = "default" }: { availability: Availability; /** "cards": two side-by-side choice cards (engineer profile completion). Same server round trip and states. */ variant?: "default" | "cards" }) {
  const { t, locale } = useI18n();
  const [state, submit, pending] = useActionState(setAvailabilityAction, INITIAL);
  // The age is relative to NOW, and the page is server-rendered then hydrated a moment later (often across a minute
  // boundary). Hydration tolerates the difference on that one line; keying it by `mounted` then REPLACES the node after
  // mount, so it shows the browser's own clock. (Re-rendering alone would leave React's stale server text in place.)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { state: current, updatedAt } = availability;
  const available = current === "available";
  const unknown = current === "unknown";

  if (variant === "cards") {
    const unavailableChosen = current === "unavailable";
    // A radio ring appears on both cards whenever the person is NOT currently available (nothing, or "unavailable", chosen).
    const rings = !available;
    const ring = (on: boolean) => (rings ? <span className="engineer-status-ring" data-on={on} aria-hidden="true" /> : null);
    const availableBody = (
      <>
        {ring(false)}
        <span className="engineer-status-text">
          <span className="engineer-status-title">
            <span aria-hidden="true" className="engineer-status-dot" data-tone="available" />
            <span data-availability-state={available ? "available" : undefined}>{t("profile.availability.available")}</span>
          </span>
          {updatedAt ? (
            <span key={mounted ? "client" : "server"} className="engineer-status-sub" suppressHydrationWarning>
              <ClockIcon size={16} aria-hidden="true" />
              {t("profile.availability.updated", { when: formatRelativeTime(updatedAt, locale) })}
            </span>
          ) : null}
        </span>
      </>
    );
    const unavailableBody = (
      <>
        {ring(unavailableChosen)}
        <span className="engineer-status-title" data-availability-state={unavailableChosen ? "unavailable" : undefined}>
          <MinusCircleIcon size={26} aria-hidden="true" />
          {t("profile.availability.markUnavailable")}
        </span>
      </>
    );
    return (
      <div className="flex flex-col gap-sm" data-testid="availability-cards">
        <div role="radiogroup" aria-label={t("profile.availability.title")} className="engineer-status-grid">
          {available ? (
            <div role="radio" aria-checked="true" className="engineer-status-card" data-tone="available" data-selected="true">{availableBody}</div>
          ) : (
            <form action={submit} className="contents">
              <input type="hidden" name="available" value="1" />
              <button type="submit" role="radio" aria-checked="false" disabled={pending} className="engineer-status-card" data-tone="available" data-selected="false">{availableBody}</button>
            </form>
          )}
          {unavailableChosen ? (
            <div role="radio" aria-checked="true" className="engineer-status-card" data-tone="unavailable" data-selected="true">{unavailableBody}</div>
          ) : (
            <form action={submit} className="contents">
              <input type="hidden" name="available" value="0" />
              <button type="submit" role="radio" aria-checked="false" disabled={pending} className="engineer-status-card" data-tone="unavailable" data-selected="false">{unavailableBody}</button>
            </form>
          )}
        </div>
        {unknown ? <p className="text-label text-fg-secondary">{t("profile.availability.notSpecifiedHint")}</p> : null}
        {!state.ok && state.code ? <InlineError>{t(state.code)}</InlineError> : null}
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-pill ${available ? "bg-success" : unknown ? "border border-strong" : "bg-fg-muted"}`}
            />
            <p className="font-medium text-fg" data-availability-state={current}>
              {t(available ? "profile.availability.available" : unknown ? "profile.availability.notSpecified" : "profile.availability.unavailable")}
            </p>
          </div>
          <p key={mounted ? "client" : "server"} className="text-label text-fg-muted" suppressHydrationWarning>
            {updatedAt
              ? t("profile.availability.updated", { when: formatRelativeTime(updatedAt, locale) })
              : t("profile.availability.notSpecifiedHint")}
          </p>
        </div>

        {/* NOT SPECIFIED offers BOTH answers — neither is the "other" one, and declaring "unavailable" is a real
            choice the database records. Once declared, only the opposite is offered. */}
        <div className="flex shrink-0 flex-wrap gap-2">
          {current !== "available" ? (
            <form action={submit}>
              <input type="hidden" name="available" value="1" />
              <SubmitButton variant="primary" size="sm">
                {t("profile.availability.markAvailable")}
              </SubmitButton>
            </form>
          ) : null}
          {current !== "unavailable" ? (
            <form action={submit}>
              <input type="hidden" name="available" value="0" />
              <SubmitButton variant="outline" size="sm">
                {t("profile.availability.markUnavailable")}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </div>

      {/* What the flag does and — just as important — what it does not. Testers
          read an availability switch as a calendar or as a login state; saying so
          once here is cheaper than the support conversation. */}
      <p className="max-w-prose text-label text-fg-secondary">{t("profile.availability.explainer")}</p>

      {!state.ok && state.code ? <InlineError>{t(state.code)}</InlineError> : null}
    </Card>
  );
}
