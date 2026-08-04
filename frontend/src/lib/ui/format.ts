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
