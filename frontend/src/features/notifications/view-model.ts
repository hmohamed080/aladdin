import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { formatMoney, formatRelativeTime } from "@/lib/ui/format";

/**
 * PERSISTED ROW -> UI-READY ROW. Presentation only.
 *
 * Nothing here decides what a notification MEANS. The meaning was decided in the
 * database, inside the same transaction as the state change that caused it, and
 * is carried by `event_type`, `title_key`, `body_key`, `params` and `deep_link`.
 * This module's whole job is to turn those five stored facts into a title, a
 * body, a timestamp and a destination in the reader's language.
 *
 * WHY THE ROW CARRIES KEYS AND NOT SENTENCES
 * Arabic is an MVP release language and a reader's locale can change AFTER a row
 * is written. Storing "Nile Ceramics sent you a quotation" would freeze one
 * language into a permanent record; storing
 * `notifications.quotation.submitted.title` + `{supplier_name}` does not. That
 * is also why this file never builds a sentence of its own: an English string
 * assembled here would be exactly the leak the schema was shaped to prevent.
 */

/**
 * The twenty-one event types `ck_notifications_event_type_known` permits.
 *
 * Duplicated from the CHECK constraint deliberately: the constraint keeps bad
 * rows OUT of the table, and this list decides which rows the UI has real copy
 * for. They are the same vocabulary today, and the day they diverge — a
 * migration adds a seventeenth event and ships before the translations do — is
 * exactly the day this list has to earn its keep.
 *
 * `message.sent` is the only one whose subject type varies per row (a
 * conversation inherits its transaction's subject), which changes nothing here:
 * the view model reads keys and params, never the subject.
 *
 * The `job.*` events are the newest. `job.application.*` were the first whose
 * recipient is a PERSON rather than a capability-holding membership — an
 * individual installer, named by `job_applications.applicant_user_id`. The three
 * `job.assignment.*` events are the first to go BOTH ways: `completed` reaches
 * the installer alone, `ready` reaches the organization's `job.manage` holders,
 * and `cancelled` reaches whichever party did not cause it. None of that changes
 * anything here — the view model reads keys and params and never a recipient.
 *
 * `job.assignment.cancelled` is the one event whose params must be identical on
 * both of its paths, because the organization's copy cannot name the
 * organization to itself. Its copy therefore uses `{job_title}` and `{reason}`
 * only, which the placeholder test below enforces.
 */
export const KNOWN_NOTIFICATION_EVENTS = [
  "rfq.submitted",
  "rfq.cancelled",
  "quotation.submitted",
  "quotation.accepted",
  "quotation.rejected",
  "order.created",
  "order.started",
  "order.completed",
  "order.cancelled",
  "project.created",
  "project.activated",
  "project.completed",
  "verification.approved",
  "verification.rejected",
  "verification.changes_requested",
  "message.sent",
  "job.application.accepted",
  "job.application.rejected",
  "job.assignment.ready",
  "job.assignment.completed",
  "job.assignment.cancelled",
  "job.review.received",
] as const;

export type KnownNotificationEvent = (typeof KNOWN_NOTIFICATION_EVENTS)[number];

const KNOWN = new Set<string>(KNOWN_NOTIFICATION_EVENTS);

export function isKnownNotificationEvent(value: string): value is KnownNotificationEvent {
  return KNOWN.has(value);
}

/**
 * The one key this module may substitute for a missing one.
 *
 * It is a real bilingual catalog entry, NOT a sentence invented in TypeScript:
 * it renders as Arabic for an Arabic reader exactly like every other row. See
 * the degradation note on `toNotificationView` for why a visible neutral row
 * beats a silently dropped one.
 */
export const NOTIFICATION_FALLBACK_TITLE_KEY = "notifications.fallback.title";

/** The subset of the persisted row the view model reads. */
export type NotificationSource = {
  id: string;
  event_type: string;
  deep_link: string;
  title_key: string;
  body_key: string | null;
  params: unknown;
  read_at: string | null;
  created_at: string;
  organization_id: string | null;
};

export type NotificationView = {
  id: string;
  eventType: string;
  title: string;
  body: string | null;
  /**
   * Relative, already validated as such by `ck_notifications_deep_link`. `null`
   * when the stored value failed re-validation here — the row still shows, it
   * just does not offer a destination it cannot vouch for.
   */
  href: string | null;
  unread: boolean;
  /** "3 hours ago", localized. */
  timeAgo: string;
  /** Machine-readable instant for `<time dateTime>`. */
  timestamp: string;
  organizationId: string | null;
  /** True when the neutral fallback title stood in for missing copy. */
  degraded: boolean;
};

/**
 * `params` arrives as `Json`, so it is `unknown` until proven otherwise.
 *
 * Only scalars survive. A nested object or array in an interpolation slot is not
 * a value a sentence can contain, and `String({})` printing "[object Object]"
 * into the header is the exact class of accident this filter exists to stop.
 */
function readParams(raw: unknown): Record<string, string | number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") out[key] = value;
  }
  return out;
}

/**
 * Money is formatted HERE and passed on as a string.
 *
 * `createTranslator` localizes a `number` as a QUANTITY — digits in the reader's
 * numerals, no currency. `total` is not a quantity, it is a price, and a
 * quotation total rendering as a bare "48,500" in a sentence about an offer is
 * a different claim from "EGP 48,500.00". Formatting it before interpolation and
 * handing over a string is how the translator's own contract says to opt out of
 * re-formatting.
 */
const MONEY_PARAMS = new Set(["total"]);

function interpolationVars(
  params: Record<string, string | number>,
  locale: Locale,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = MONEY_PARAMS.has(key) ? formatMoney(value, locale) : value;
  }
  return out;
}

/**
 * A relative path is ONE leading slash then path characters.
 *
 * `ck_notifications_deep_link` already enforces this at the column, so a row
 * reaching here should always pass. The check is repeated because the cost is a
 * string comparison and the failure mode it covers — a restored dump, a direct
 * superuser insert, a future migration that relaxes the constraint — produces an
 * open redirect rather than a visual defect. Note that a naive
 * `startsWith("/")` waves `//evil.example` straight through: protocol-relative
 * is not relative.
 */
function safeDeepLink(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

/**
 * Build the view for one persisted row. NEVER returns null, and never throws.
 *
 * DEGRADATION POLICY
 * A row the UI has no copy for still renders, under a neutral translated title,
 * and still carries its deep link. The alternative — dropping it — makes the
 * header lie: `countUnread` counts rows in the database, so a dropped unread row
 * leaves a badge reading "2" over a panel showing one item, which reads as a
 * bug and hides a real event from the person it was addressed to. A visible
 * neutral row keeps the count honest and still gets the reader to the record,
 * where the actual state lives. Missing copy is a translation gap, not a reason
 * to withhold someone's mail.
 */
export function toNotificationView(
  row: NotificationSource,
  t: TranslateFn,
  locale: Locale,
  now?: Date,
): NotificationView {
  const vars = interpolationVars(readParams(row.params), locale);

  // `t()` returns the KEY itself when the catalog has no entry, so an unresolved
  // lookup is detectable without a second registry. A row is degraded when its
  // event is outside the known vocabulary OR its title key resolves to nothing —
  // either way there is no honest sentence to show, and a dotted key in the
  // header is not a sentence.
  const known = isKnownNotificationEvent(row.event_type);
  const resolvedTitle = t(row.title_key, vars);
  const degraded = !known || resolvedTitle === row.title_key;

  const title = degraded ? t(NOTIFICATION_FALLBACK_TITLE_KEY) : resolvedTitle;

  // A degraded row gets no body: the fallback title says all this module can
  // honestly say, and a body resolved from a key whose title failed would be
  // guessing which half of the copy is trustworthy.
  const resolvedBody = !degraded && row.body_key ? t(row.body_key, vars) : null;

  return {
    id: row.id,
    eventType: row.event_type,
    title,
    body: resolvedBody && resolvedBody !== row.body_key ? resolvedBody : null,
    href: safeDeepLink(row.deep_link),
    unread: row.read_at === null,
    timeAgo: formatRelativeTime(row.created_at, locale, now),
    timestamp: row.created_at,
    organizationId: row.organization_id,
    degraded,
  };
}

/** Map a page of persisted rows. The output is always the same length as the input. */
export function toNotificationViews(
  rows: readonly NotificationSource[],
  t: TranslateFn,
  locale: Locale,
  now?: Date,
): NotificationView[] {
  return rows.map((row) => toNotificationView(row, t, locale, now));
}
