import Link from "next/link";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { PointsEntryView } from "@/features/points/view-model";
import { StatePanel } from "@/components/ui/primitives";
import { GaugeIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * The ledger, as a reader sees it.
 *
 * ONE ROW PER ENTRY, INCLUDING CORRECTIONS. A reversal appears in its own right,
 * above the award it corrects, and the original stays exactly as written. The
 * pair reading as two rows IS the point: collapsing them into a single adjusted
 * award would rewrite history on screen while the database refused to rewrite it
 * on disk, and the person would never learn that something had been taken back.
 *
 * The amount is never communicated by colour alone. Every row carries the sign
 * inside its text, plus a screen-reader sentence naming the direction; colour is
 * a third, redundant cue.
 */
export function PointsHistory({
  entries,
  t,
  moreHref,
}: {
  entries: readonly PointsEntryView[];
  t: TranslateFn;
  /** Present only when more rows exist beyond the current bound. */
  moreHref?: string | null;
}) {
  if (entries.length === 0) {
    return (
      <StatePanel
        icon={<GaugeIcon size={22} />}
        title={t("points.empty.title")}
        body={t("points.empty.body")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <ul className="divide-y rounded-md border bg-surface shadow-card">
        {entries.map((entry) => (
          <li
            key={entry.id}
            /* Column on a phone, row from `sm` up. At 393px the amount sits
               UNDER the label rather than competing with it for the same line,
               which is what stops a long Arabic title colliding with a signed
               number — and `min-w-0` is what lets the text column actually
               shrink instead of forcing the row wider than the viewport. */
            className="flex flex-col gap-1 p-md sm:flex-row sm:items-start sm:justify-between sm:gap-md"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-label text-fg">{entry.title}</span>
              {entry.body ? (
                <span className="text-caption text-fg-secondary">{entry.body}</span>
              ) : null}
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption text-fg-muted">
                <time dateTime={entry.timestamp}>{entry.dateLabel}</time>
                {/* Business context, shown only when the reader may still read
                    that organization. Never an ownership claim — the entry is
                    theirs either way, and it renders with or without a name. */}
                {entry.organizationName ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="min-w-0 break-words">{entry.organizationName}</span>
                  </>
                ) : null}
              </span>
            </div>
            <span
              className={cn(
                "shrink-0 text-body-lg font-medium tabular-nums",
                entry.direction === "earned" ? "text-success" : "text-danger",
              )}
            >
              {/* The visible figure already carries its sign; the sentence beside
                  it is what a screen reader announces instead of "plus one
                  hundred", which is not a fact about Points. */}
              <span aria-hidden="true">{entry.deltaLabel}</span>
              <span className="sr-only">{entry.deltaDescription}</span>
            </span>
          </li>
        ))}
      </ul>
      {/* A link, not a button: "show more" is a bounded navigation to the same
          page with a larger cap, so it works without JavaScript, is keyboard
          reachable by default, and survives a reload. */}
      {moreHref ? (
        <div>
          <Link
            href={moreHref}
            className="inline-flex items-center rounded-sm border px-md py-2 text-label font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            {t("points.history.more")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
