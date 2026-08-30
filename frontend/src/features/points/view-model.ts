import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { formatDateTime, formatNumber } from "@/lib/ui/format";

/**
 * PERSISTED LEDGER ROW -> UI-READY ROW. Presentation only.
 *
 * Nothing here decides what an entry MEANS or what it is worth. Both were
 * decided in the database, inside the same transaction as the business event
 * that caused them (`docs/database/points-core.md`). This module's whole job is
 * to turn `event_type`, `points_delta`, `reverses_entry_id` and `reason_code`
 * into a title, a signed amount and a timestamp in the reader's language.
 *
 * WHAT NEVER REACHES THE SCREEN
 * `source_id`, `id`, `reverses_entry_id`, `awarded_by_user_id` and `metadata`
 * are internal identity and provenance. None is rendered, in any state,
 * including the fallback: a UUID or a raw JSON blob in a history row tells a
 * salesperson nothing and leaks the shape of the ledger to anyone reading over
 * their shoulder. `reason_code` is rendered only through the bounded map below,
 * never as its raw key.
 */

/**
 * The two event keys `ck_points_ledger_event_type_known` permits.
 *
 * Duplicated from the CHECK constraint deliberately, exactly as the notification
 * view model duplicates its own: the constraint keeps bad rows OUT of the table,
 * and this list decides which rows the UI has real copy for. The day they
 * diverge — a migration adds a third event and ships before the translations do
 * — is the day this list earns its keep, because that row still has to render.
 *
 * `admin.adjustment` is NOT an earning event. It is the administrative
 * correction primitive, and it is presented as a correction, never as something
 * the reader did to deserve points.
 */
export const KNOWN_POINTS_EVENTS = [
  "referral.organization_approved",
  "admin.adjustment",
] as const;

export type KnownPointsEvent = (typeof KNOWN_POINTS_EVENTS)[number];

const KNOWN = new Set<string>(KNOWN_POINTS_EVENTS);

export function isKnownPointsEvent(value: string): value is KnownPointsEvent {
  return KNOWN.has(value);
}

/**
 * The bounded reason vocabulary, mirroring `ck_points_ledger_reason_code_known`.
 *
 * A reason the catalog has no copy for is simply omitted rather than printed
 * raw: the row already says what happened and by how much, and an unexplained
 * `event_invalidated` in the middle of an Arabic page is worse than no caption.
 */
const KNOWN_REASON_CODES = new Set(["support_correction", "event_invalidated"]);

/** The subset of the persisted row the view model reads. Nothing else is passed in. */
export type PointsEntrySource = {
  id: string;
  event_type: string;
  points_delta: number;
  reverses_entry_id: string | null;
  reason_code: string | null;
  organization_id: string | null;
  created_at: string;
};

export type PointsEntryView = {
  /** React key only — never rendered. */
  id: string;
  title: string;
  body: string | null;
  /** Localized, sign-carrying amount: "+100" / "-40" / Arabic equivalents. */
  deltaLabel: string;
  /** Sign as data, so the UI never depends on colour alone to convey it. */
  direction: "earned" | "deducted";
  /** Screen-reader sentence: "earned 100 Points" / "100 Points deducted". */
  deltaDescription: string;
  /** "12 Sep 2026, 14:30", localized. */
  dateLabel: string;
  /** Machine-readable instant for `<time dateTime>`. */
  timestamp: string;
  /** Secondary context, present only when RLS let the name resolve. */
  organizationName: string | null;
  /** True when the neutral fallback stood in for missing copy. */
  degraded: boolean;
};

/**
 * The typographic minus, not the hyphen-minus.
 *
 * `Intl.NumberFormat` with `signDisplay: "always"` produces the correct sign for
 * each locale, which is why no sign is ever concatenated by hand here: in an
 * Arabic RTL row a hand-built "-" carries the wrong bidirectional class and can
 * reflow to the wrong end of the number.
 */
function signedAmount(delta: number, locale: Locale): string {
  return formatNumber(delta, locale, { signDisplay: "always", maximumFractionDigits: 0 });
}

/**
 * A reversal is presented as a CORRECTION, never as a rewrite.
 *
 * The original award stays in the history above it, untouched — that is the
 * point of a compensating entry, and collapsing the pair into one "adjusted"
 * row would destroy the record the ledger exists to keep. So a reversal is its
 * own row, with its own date and its own explanation.
 */
function resolveCopy(
  entry: PointsEntrySource,
  t: TranslateFn,
): { title: string; body: string | null; degraded: boolean } {
  const isReversal = entry.reverses_entry_id !== null;
  const reason =
    entry.reason_code && KNOWN_REASON_CODES.has(entry.reason_code)
      ? t(`points.reason.${entry.reason_code}`)
      : null;

  if (isReversal) {
    return { title: t("points.entry.correction.title"), body: reason, degraded: false };
  }
  if (entry.event_type === "referral.organization_approved") {
    return {
      title: t("points.entry.referral.title"),
      body: t("points.entry.referral.body"),
      degraded: false,
    };
  }
  if (entry.event_type === "admin.adjustment") {
    // One event, two directions: a manual credit and a manual debit are the same
    // administrative act. Calling the debit an "adjustment" while calling the
    // credit an "award" would imply the debit was something the reader did.
    return {
      title:
        entry.points_delta > 0
          ? t("points.entry.adjustment.title")
          : t("points.entry.correction.title"),
      body: reason,
      degraded: false,
    };
  }
  /* An event this build has no copy for. It still renders, under a real
     bilingual catalog entry rather than a sentence invented here: hiding the row
     would make the page lie, because the balance above it already counts the
     entry. A visible neutral row that does not explain itself is recoverable; a
     total nobody can account for is not. */
  return { title: t("points.entry.fallback.title"), body: null, degraded: true };
}

export function toPointsEntryView(
  entry: PointsEntrySource,
  t: TranslateFn,
  locale: Locale,
  organizationNames?: ReadonlyMap<string, string>,
): PointsEntryView {
  const { title, body, degraded } = resolveCopy(entry, t);
  const earned = entry.points_delta > 0;
  return {
    id: entry.id,
    title,
    body,
    deltaLabel: signedAmount(entry.points_delta, locale),
    direction: earned ? "earned" : "deducted",
    deltaDescription: t(earned ? "points.delta.earned" : "points.delta.deducted", {
      amount: formatNumber(Math.abs(entry.points_delta), locale, { maximumFractionDigits: 0 }),
    }),
    dateLabel: formatDateTime(entry.created_at, locale),
    timestamp: entry.created_at,
    organizationName:
      (entry.organization_id && organizationNames?.get(entry.organization_id)) || null,
    degraded,
  };
}

export function toPointsEntryViews(
  entries: readonly PointsEntrySource[],
  t: TranslateFn,
  locale: Locale,
  organizationNames?: ReadonlyMap<string, string>,
): PointsEntryView[] {
  return entries.map((e) => toPointsEntryView(e, t, locale, organizationNames));
}

/**
 * The balance, formatted — and never reinterpreted.
 *
 * No clamping, no absolute value, no dash standing in for a negative. The sign
 * comes from `Intl` so it survives Arabic RTL, and a negative total reads as
 * negative because it IS negative: product decided (D2) that a corrected
 * balance displays faithfully, since a floor at zero hides the very correction
 * a person would need in order to question it.
 */
export function formatPointsBalance(balance: number, locale: Locale): string {
  return formatNumber(balance, locale, { maximumFractionDigits: 0 });
}
