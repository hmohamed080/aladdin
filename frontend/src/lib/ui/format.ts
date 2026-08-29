import type { Locale } from "@/lib/i18n/locales";

/**
 * THE ONE FORMATTING LAYER.
 *
 * Every user-facing number, money figure, percentage, date and duration in the
 * product is formatted here. Not "supply-side numbers" or "report numbers" —
 * all of them. A second copy of this logic anywhere is a bug, because the whole
 * point is that two figures sitting on the same row are shaped by the same
 * rules.
 *
 * WHY THE LOCALE TAG IS SPELLED OUT
 * `ar-EG` alone is ambiguous in practice: CLDR's default numbering system for
 * Egypt has moved between `arab` and `latn` across ICU versions, and the runtime
 * that renders a page (Node on the server, the browser's own ICU on the client,
 * a CI container with a trimmed ICU build) does not have to agree with the one
 * this was written against. That is exactly how an Arabic dashboard ends up
 * printing ١٬٢٣٤ in one panel and 1,234 in the next. `-u-nu-arab` pins the
 * numbering system as part of the tag, so every runtime produces the same digits.
 *
 * The alternative — formatting with a Latin locale and then substituting digits
 * by hand — also mangles the grouping separator, the decimal mark, the currency
 * placement and the bidi marks Intl emits around them. It is not a shortcut, it
 * is a different (wrong) answer.
 *
 * WHAT MUST NOT COME THROUGH HERE
 * Technical identifiers. An order reference (`ORD-1256`), a SKU, a UUID, an
 * email, a URL or a phone number is a STRING that happens to contain digits —
 * it is copied, searched, read down a phone line and matched against another
 * system. Reshaping its digits changes the identifier. Identifiers render
 * verbatim; see `formatIdentifier`.
 */

/**
 * The BCP-47 tag used for every `Intl` construction in the app.
 *
 * `en-EG` rather than `en-GB` for numbers because the money is Egyptian and the
 * grouping/decimal conventions are the ones a reader in Egypt expects; the
 * digits are Latin either way.
 */
export function localeTag(locale: Locale): string {
  return locale === "ar" ? "ar-EG-u-nu-arab" : "en-EG";
}

/**
 * `Intl` constructors are among the most expensive calls in the standard
 * library, and a table of fifty rows with four money columns builds two hundred
 * of them per render. They are immutable, so one instance per (tag, options)
 * pair is reused for the lifetime of the process.
 */
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

function numberFormat(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const tag = localeTag(locale);
  const key = `${tag}|${JSON.stringify(options)}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(tag, options);
    numberFormats.set(key, f);
  }
  return f;
}

function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const tag = localeTag(locale);
  const key = `${tag}|${JSON.stringify(options)}`;
  let f = dateFormats.get(key);
  if (!f) {
    // Gregorian is pinned for the same reason the numbering system is: `ar-EG`
    // does not select the Hijri calendar today, but the business runs on
    // Gregorian delivery dates and that must not depend on an ICU default.
    f = new Intl.DateTimeFormat(tag, { calendar: "gregory", ...options });
    dateFormats.set(key, f);
  }
  return f;
}

/** The dash every formatter shows for an absent value, so columns stay aligned. */
export const EMPTY = "—";

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------------- */
/* Counts, quantities, plain numbers                                          */
/* ------------------------------------------------------------------------- */

/**
 * Any plain user-facing number: a KPI count, a badge count, a table quantity, a
 * page number, a chart value, the figure in "12 orders".
 *
 * This is the function the app was missing, and its absence is the whole bug. A
 * bare `{count}` in JSX stringifies through `Number.prototype.toString`, which is
 * locale-blind and always emits Latin digits — so an Arabic page printed ١٢ in
 * the panels that happened to route through `Intl` and 12 in the ones that did
 * not, on the same screen.
 */
export function formatNumber(
  value: number | string | null | undefined,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  return numberFormat(locale, options ?? { maximumFractionDigits: 2 }).format(n);
}

/**
 * A whole-number count — records in a list, items on an order, a notification
 * badge. Separate from `formatNumber` so a computed average cannot silently
 * print itself as "12.5 orders".
 */
export function formatCount(value: number | string | null | undefined, locale: Locale): string {
  return formatNumber(value, locale, { maximumFractionDigits: 0 });
}

/** Plain quantity — trailing zeros trimmed, so `3.00` reads as `3`. */
export function formatQuantity(value: number | string | null | undefined, locale: Locale): string {
  return formatNumber(value, locale, { maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------------- */
/* Money                                                                      */
/* ------------------------------------------------------------------------- */

/** Locale-aware EGP money — the exact figure, right for a table cell or a field. */
export function formatMoney(value: number | string | null | undefined, locale: Locale): string {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  return numberFormat(locale, {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Money for a chart axis or a KPI tile, shortened (`EGP 1.1M`).
 *
 * Long-form currency is right for a table cell, where the exact figure is the
 * point. On an axis bound or a dense tile it wraps and pushes the plot around,
 * so the magnitude is what gets shown and the precise number stays one click
 * away on the record itself.
 */
export function formatCompactMoney(
  value: number | string | null | undefined,
  locale: Locale,
): string {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  return numberFormat(locale, {
    style: "currency",
    currency: "EGP",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/* ------------------------------------------------------------------------- */
/* Percentages                                                                */
/* ------------------------------------------------------------------------- */

/**
 * A whole-number percentage in the reader's own numerals.
 *
 * Takes 0–100, not 0–1, because every caller in this app has already computed a
 * percentage before it gets here. Money already goes through `Intl`, so in Arabic
 * it renders as ٦٢٦٫٦ — and a legend row reading "٦٢٦٫٦ ألف ج.م  57%" mixes two
 * numeral systems on one line. Anything that sits beside formatted money must be
 * formatted the same way.
 */
export function formatPercent(value: number | null | undefined, locale: Locale): string {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  return numberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(n / 100);
}

/* ------------------------------------------------------------------------- */
/* Dates and times                                                            */
/* ------------------------------------------------------------------------- */

/** Locale-aware date (Gregorian; Arabic uses Egypt locale with Arabic-Indic digits). */
export function formatDate(iso: string | null | undefined, locale: Locale): string {
  const d = parse(iso);
  if (!d) return EMPTY;
  return dateFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

/**
 * Day and month, no year — the OPERATIONAL date.
 *
 * `formatDate` renders "12 Sep 2026", which is the right answer on a record
 * page and the wrong one in a dashboard column: it is ~78px of 13px type, and a
 * queue row that has to carry a name, a buyer, a quantity and a status cannot
 * spend that on a year the reader already knows. Truncating it is worse than
 * shortening it — "Sep 12, 2…" is not a shorter date, it is a date that has to
 * be reconstructed.
 *
 * The year is dropped rather than abbreviated because these are near-term
 * working dates (a required-by, a validity, a promised dispatch) where the year
 * is never the ambiguous part, and the full date is one click away on the record
 * every one of these rows links to. Do NOT use this where a date can be years
 * old or years out — an audit trail, a contract term, a birth date.
 */
export function formatDateShort(iso: string | null | undefined, locale: Locale): string {
  const d = parse(iso);
  if (!d) return EMPTY;
  return dateFormat(locale, { day: "2-digit", month: "short" }).format(d);
}

export function formatDateTime(iso: string | null | undefined, locale: Locale): string {
  const d = parse(iso);
  if (!d) return EMPTY;
  return dateFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** A clock time on its own — "14:30" / "١٤:٣٠". */
export function formatTime(iso: string | null | undefined, locale: Locale): string {
  const d = parse(iso);
  if (!d) return EMPTY;
  return dateFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A month bucket key (`2026-03`) as a short axis label.
 *
 * Parsed as UTC midday rather than midnight: `new Date("2026-03-01")` is UTC, and
 * a viewer in a negative offset would render it as February.
 */
export function formatMonth(ym: string, locale: Locale): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return dateFormat(locale, { month: "short" }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/**
 * "in 3 days" / "خلال ٣ أيام" — the distance between an ISO instant and now.
 *
 * `Intl.RelativeTimeFormat` gets the numerals AND the Arabic dual/plural forms
 * right ("يومين", not "٢ أيام"), which a message template with a `{count}` slot
 * cannot.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  locale: Locale,
  now: Date = new Date(),
): string {
  const then = parse(iso);
  if (!then) return EMPTY;

  const seconds = (then.getTime() - now.getTime()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  const tag = localeTag(locale);
  let rtf = relativeFormats.get(tag);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    relativeFormats.set(tag, rtf);
  }

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds), "second");
}

/* ------------------------------------------------------------------------- */
/* Technical identifiers — the exception                                      */
/* ------------------------------------------------------------------------- */

/**
 * An identifier passes through UNCHANGED, in every locale.
 *
 * `ORD-1256`, a SKU, a UUID, a VAT number, an email, a URL. These are not
 * quantities: they are looked up, dictated over the phone, pasted into another
 * system and compared character for character. Rendering `ORD-١٢٥٦` in the Arabic
 * UI would produce a reference that does not match the record it names.
 *
 * It is a function rather than "just don't call a formatter" so that the intent
 * is greppable, and so a reviewer can tell the difference between a number
 * someone deliberately left alone and one someone forgot.
 */
export function formatIdentifier(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  return String(value);
}

/* ------------------------------------------------------------------------- */
/* Domain tone helpers — the shared UI vocabulary, not formatting              */
/* ------------------------------------------------------------------------- */

/** Badge tone for a lead status. */
export function statusTone(status: string): "neutral" | "success" | "danger" | "info" {
  switch (status) {
    case "won":
      return "success";
    case "lost":
      return "danger";
    case "archived":
      return "neutral";
    default:
      return "info";
  }
}

export function priorityTone(priority: string): "neutral" | "warning" | "danger" {
  switch (priority) {
    case "urgent":
      return "danger";
    case "high":
      return "warning";
    default:
      return "neutral";
  }
}

export const LEAD_STAGES = [
  "new",
  "contacted",
  "qualified",
  "proposal_pending",
  "decision_pending",
] as const;

export const SALES_SOURCES = [
  "referral",
  "walk_in",
  "phone",
  "whatsapp",
  "website",
  "campaign",
  "other",
] as const;

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
