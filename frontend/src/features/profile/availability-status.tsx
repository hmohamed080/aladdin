import { Badge } from "@/components/ui/primitives";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { formatRelativeTime } from "@/lib/ui/format";

/**
 * How availability READS — shared by the professional's own hub and by the public
 * page, so the person and the stranger are never shown different words for the
 * same state.
 *
 * UNAVAILABLE IS `neutral`, NOT `danger`. This is the load-bearing decision in
 * this file. Nothing is wrong with a professional who is not taking work — they
 * are fully verified, fully complete, and still listed. Painting that state red
 * would make the UI editorialise about a choice the product exists to let people
 * state honestly, and would push everyone toward leaving the flag on, which is
 * exactly how an availability signal becomes worthless.
 *
 * THREE STATES, NOT TWO. "Never set" is its own answer and must not collapse into
 * "unavailable": a default the person has never touched is not a claim they made,
 * and showing it as one would have the platform speaking for them (O3, from the
 * other direction). It renders with no age line, because there is no change to
 * date.
 *
 * Server components — presentational only. No control lives here, so the public
 * page ships no client JavaScript for it.
 */
export function AvailabilityBadge({ available, t }: { available: boolean; t: TranslateFn }) {
  return (
    <Badge tone={available ? "success" : "neutral"}>
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-pill ${available ? "bg-success" : "bg-fg-muted"}`}
      />
      {t(available ? "profile.availability.available" : "profile.availability.unavailable")}
    </Badge>
  );
}

/**
 * The age line: "Updated 3 days ago", or "Not set yet" when it never changed.
 *
 * `formatRelativeTime` rather than a `{count}` message template — it gets Arabic
 * dual and plural forms right ("يومين", not "٢ أيام") and the Arabic-Indic
 * numerals with it, which a template cannot.
 *
 * The age is INFORMATION, never a verdict. There is no threshold here, no "stale"
 * styling and no cutoff, because O3 forbids inventing one: the platform shows
 * when the claim was made and the reader decides what that is worth.
 */
export function AvailabilityAge({
  updatedAt,
  locale,
  t,
}: {
  updatedAt: string | null;
  locale: Locale;
  t: TranslateFn;
}) {
  return (
    <span className="text-label text-fg-muted" data-testid="availability-age">
      {updatedAt
        ? t("profile.availability.updated", { when: formatRelativeTime(updatedAt, locale) })
        : t("profile.availability.neverSet")}
    </span>
  );
}
