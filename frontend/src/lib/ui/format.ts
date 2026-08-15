import type { Locale } from "@/lib/i18n/locales";

/** Locale-aware date/time formatting (Gregorian; Arabic uses Egypt locale). */
export function formatDate(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
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
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { month: "short" }).format(
    new Date(Date.UTC(y, m - 1, 15)),
  );
}

/**
 * Money for a chart axis or tile, shortened (`EGP 1.1M`).
 *
 * Long-form currency is right for a table cell, where the exact figure is the
 * point. On an axis bound or a dense tile it wraps and pushes the plot around,
 * so the magnitude is what gets shown and the precise number stays one click
 * away on the record itself.
 */
export function formatCompactMoney(value: number | string | null, locale: Locale): string {
  if (value === null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    style: "currency",
    currency: "EGP",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/**
 * A whole-number percentage in the reader's own numerals.
 *
 * Money already goes through `Intl`, so in Arabic it renders as ٦٢٦٫٦ — and a
 * legend row showing "٦٢٦.٦ ألف ج.م  57%" mixes two numeral systems on one line.
 * Percentages that sit beside formatted money must be formatted the same way.
 */
export function formatPercent(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

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
