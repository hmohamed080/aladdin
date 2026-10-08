"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { CheckIcon, TargetIcon, XIcon } from "@/components/ui/icons";
import { FloatingMenu } from "@/components/ui/floating-menu";
import type { Locale } from "@/lib/i18n/locales";
import {
  ADD_AVAILABILITY,
  MATCH_TITLE,
  NOT_SPECIFIED,
  NOT_SPECIFIED_NOTE,
  matchLevel,
  matchLevelLabel,
  matchLines,
  type MatchBreakdown,
  type MatchLevel,
} from "@/lib/installer/overall-match";
import { formatNumber } from "@/lib/ui/format";
import { cn } from "@/lib/ui/cn";

const LEVEL_TONE: Record<MatchLevel, string> = {
  excellent: "bg-success text-white",
  strong: "bg-success text-white",
  good: "bg-info text-white",
  partial: "bg-warning text-fg",
  low: "bg-surface text-fg-secondary",
};

const NOTE = {
  ar: "هذه النسبة للمساعدة في الاختيار فقط ولا تمنعك من فتح الفرصة أو التقديم عليها.",
  en: "This score only helps you choose. It never stops you from opening or applying to a job.",
} as const;

/**
 * THE OVERALL MATCH, as a compact badge with its breakdown one press away.
 *
 * It draws what the database decided and nothing else: the percentage is `overall_percent`, the level names the range
 * (Excellent / Strong / Good / Partial / Low), and each line is a component's own points with the localized sentence
 * for its stable reason code (`lib/installer/overall-match.ts`). Nothing is recomputed here, so the badge on a card,
 * on the dashboard and on the job page can never disagree.
 *
 * The breakdown is a popover on the shared floating surface (portal + collision handling), opened by pressing the
 * badge — Enter / Space / click — so it works on touch and keyboard, not only on hover, and is never clipped by a card.
 */
export function MatchBadge({
  match,
  locale,
  className,
}: {
  match: MatchBreakdown;
  locale: Locale;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const level = matchLevel(match.overallPercent);
  const percent = formatNumber(match.overallPercent, locale);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-testid="match-badge"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${MATCH_TITLE[locale]} ${percent}% — ${matchLevelLabel(match.overallPercent, locale)}`}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex items-center gap-1 rounded-pill px-2.5 py-1 text-label font-semibold shadow-sm transition-opacity hover:opacity-90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          LEVEL_TONE[level],
          className,
        )}
      >
        <TargetIcon size={13} aria-hidden="true" />
        <span>{MATCH_TITLE[locale]}</span> <bdi>{percent}%</bdi>
      </button>
      <FloatingMenu
        id={panelId}
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={trigger}
        role="dialog"
        aria-label={`${MATCH_TITLE[locale]} ${percent}%`}
        placement="bottom-start"
        className="w-72 p-md"
        data-testid="match-breakdown"
      >
        <MatchBreakdownBody match={match} locale={locale} />
      </FloatingMenu>
    </>
  );
}

/** The breakdown itself: the level, then one line per component with its points. Also used whole on the job page. */
export function MatchBreakdownBody({ match, locale }: { match: MatchBreakdown; locale: Locale }) {
  const ar = locale === "ar";
  return (
    <div>
      <p className="text-body-lg font-semibold text-fg">
        <bdi>{formatNumber(match.overallPercent, locale)}%</bdi> · {matchLevelLabel(match.overallPercent, locale)}
      </p>
      <ul className="mt-sm grid gap-2">
        {matchLines(match, locale).map((line) => (
          <li key={line.key} data-testid={`match-line-${line.key}`} data-reason={line.reason} className="flex items-start gap-2 text-label text-fg">
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full",
                line.notSpecified ? "border border-strong text-fg-muted" : line.met ? "bg-success/15 text-success" : "bg-danger/10 text-danger",
              )}
            >
              {line.notSpecified ? <span className="h-px w-2 bg-fg-muted" /> : line.met ? <CheckIcon size={11} /> : <XIcon size={11} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{line.title}</span>
              <span className="text-fg-secondary"> — {line.text}</span>
              {line.notSpecified ? (
                <span className="mt-0.5 block">
                  <Link href="/home/settings" data-testid="match-add-availability" className="font-medium text-info underline underline-offset-2">
                    {ADD_AVAILABILITY[locale]}
                  </Link>
                </span>
              ) : null}
            </span>
            {/* Not specified is NOT "0/15": it earned nothing and lost nothing. */}
            <span className="shrink-0 text-fg-muted" dir={line.notSpecified ? undefined : "ltr"} data-testid={line.notSpecified ? "match-not-specified" : undefined}>
              {line.notSpecified ? NOT_SPECIFIED[locale] : <bdi>{formatNumber(line.points ?? 0, locale)}/{formatNumber(line.max, locale)}</bdi>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-sm border-t pt-sm text-caption text-fg-muted">
        {match.availabilityPoints === null ? `${NOT_SPECIFIED_NOTE[locale]} ` : ""}
        {NOTE[ar ? "ar" : "en"]}
      </p>
    </div>
  );
}
