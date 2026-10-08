/**
 * OVERALL MATCH — how the frontend PRESENTS what the database decided.
 *
 * The score is computed in ONE place: `app.job_match_rows` (supabase/migrations/20261007090005_overall_match.sql),
 * reached through `job_opportunities_page` (every card) and `job_matches` (job detail). It returns four component
 * points, the total, and a stable REASON CODE per component. This file does exactly two things with that:
 *
 *   1. names the level of the percentage (Excellent / Strong / Good / Partial / Low);
 *   2. turns each reason code into a localized sentence for the breakdown.
 *
 * It NEVER recomputes a score or a component. The total is the database's `overall_percent`, and the lines are the
 * database's points and reasons — so a card, the dashboard and the detail page cannot disagree, and the SQL stores
 * no localized text.
 *
 * Presentation only. Nothing here, or anywhere, may use a match to hide a job, block opening it, or block applying.
 */

export type TradeReason = "trade_matches" | "trade_mismatch" | "no_declared_trade";
export type SpecialtyReason = "specialty_matches" | "specialty_missing" | "no_specialty_required" | "trade_mismatch";
export type LocationReason =
  | "same_city"
  | "primary_governorate"
  | "other_service_area"
  | "outside_service_area"
  | "no_service_area"
  | "job_location_unknown";
export type AvailabilityReason =
  | "availability_not_declared"
  | "not_available_for_work"
  | "available_no_dates"
  | "window_covers"
  | "window_not_covering"
  | "no_window_declared";

/** The database's answer for one (caller, job). Field names mirror the SQL columns. */
export type MatchBreakdown = {
  overallPercent: number;
  tradePoints: number;
  specialtyPoints: number;
  locationPoints: number;
  /** NULL = NOT DECLARED: the caller never said whether they are available. It is not a 0, and it is not "unavailable". */
  availabilityPoints: number | null;
  tradeReason: TradeReason;
  specialtyReason: SpecialtyReason;
  locationReason: LocationReason;
  availabilityReason: AvailabilityReason;
};

/** The columns, exactly as `job_matches` / `job_opportunities_page` return them. */
export type MatchColumns = {
  overall_percent: number;
  trade_points: number;
  specialty_points: number;
  location_points: number;
  availability_points: number | null;
  trade_reason: string;
  specialty_reason: string;
  location_reason: string;
  availability_reason: string;
};

export function toMatchBreakdown(row: MatchColumns): MatchBreakdown {
  return {
    overallPercent: row.overall_percent,
    tradePoints: row.trade_points,
    specialtyPoints: row.specialty_points,
    locationPoints: row.location_points,
    availabilityPoints: row.availability_points ?? null,
    tradeReason: row.trade_reason as TradeReason,
    specialtyReason: row.specialty_reason as SpecialtyReason,
    locationReason: row.location_reason as LocationReason,
    availabilityReason: row.availability_reason as AvailabilityReason,
  };
}

/** The component maxima, as approved. They sum to 100. */
export const MATCH_MAX = { trade: 50, specialty: 20, location: 15, availability: 15 } as const;

export type MatchLevel = "excellent" | "strong" | "good" | "partial" | "low";

/** 90-100 Excellent · 75-89 Strong · 60-74 Good · 40-59 Partial · 0-39 Low. */
export function matchLevel(percent: number): MatchLevel {
  if (percent >= 90) return "excellent";
  if (percent >= 75) return "strong";
  if (percent >= 60) return "good";
  if (percent >= 40) return "partial";
  return "low";
}

const LEVEL_LABEL: Record<MatchLevel, { ar: string; en: string }> = {
  excellent: { ar: "توافق ممتاز", en: "Excellent match" },
  strong: { ar: "توافق قوي", en: "Strong match" },
  good: { ar: "توافق جيد", en: "Good match" },
  partial: { ar: "توافق جزئي", en: "Partial match" },
  low: { ar: "توافق ضعيف", en: "Low match" },
};

export function matchLevelLabel(percent: number, locale: "ar" | "en"): string {
  return LEVEL_LABEL[matchLevel(percent)][locale];
}

/** What the availability line says in place of "x/15" when the caller never declared it. */
export const NOT_SPECIFIED = { ar: "غير محدد", en: "Not specified" } as const;

/** The call to action beside a not-specified availability line. */
export const ADD_AVAILABILITY = { ar: "حدّد توفرك", en: "Add your availability" } as const;

/** Explains the percentage while availability is not specified: points earned out of 100, nothing invented. */
export const NOT_SPECIFIED_NOTE = {
  ar: "تُحتسب النسبة الآن من النقاط التي حصلت عليها فقط، وتكتمل عند تحديد توفرك.",
  en: "Your score counts only the points earned so far, and completes once you add your availability.",
} as const;

/** The heading of the breakdown: "Overall Match" / "نسبة التوافق". */
export const MATCH_TITLE = { ar: "نسبة التوافق", en: "Overall Match" } as const;

const TRADE_TEXT: Record<TradeReason, { ar: string; en: string }> = {
  trade_matches: { ar: "الحرفة مناسبة", en: "Trade matches" },
  trade_mismatch: { ar: "الحرفة غير ضمن حرفك", en: "Not one of your trades" },
  no_declared_trade: { ar: "لم تضف حرفة بعد", en: "You haven't added a trade yet" },
};

const SPECIALTY_TEXT: Record<SpecialtyReason, { ar: string; en: string }> = {
  specialty_matches: { ar: "التخصص المطلوب مناسب", en: "Specialty requirement matches" },
  specialty_missing: { ar: "لا تملك التخصص المطلوب", en: "You don't have the required specialty" },
  no_specialty_required: { ar: "لا يتطلب تخصصًا محددًا", en: "No specific specialty required" },
  trade_mismatch: { ar: "لا يُحتسب التخصص لاختلاف الحرفة", en: "Specialty isn't counted — the trade differs" },
};

const LOCATION_TEXT: Record<LocationReason, { ar: string; en: string }> = {
  same_city: { ar: "في مدينتك", en: "In your city" },
  primary_governorate: { ar: "في محافظتك", en: "In your governorate" },
  other_service_area: { ar: "في منطقة أخرى تخدمها", en: "In another area you serve" },
  outside_service_area: { ar: "خارج مناطق خدمتك", en: "Outside your service areas" },
  no_service_area: { ar: "أضف منطقة خدمة لحساب الموقع", en: "Add a service area to match location" },
  job_location_unknown: { ar: "موقع الشغل غير محدد", en: "The job's location isn't specific" },
};

const AVAILABILITY_TEXT: Record<AvailabilityReason, { ar: string; en: string }> = {
  availability_not_declared: { ar: "لم تحدد توفرك بعد", en: "You haven't said whether you're available" },
  not_available_for_work: { ar: "حددت أنك غير متاح للعمل حاليًا", en: "You've marked yourself as not taking work" },
  available_no_dates: { ar: "متاح — الشغل بدون موعد محدد", en: "Available — the job has no fixed dates" },
  window_covers: { ar: "توفرك يغطي فترة الشغل", en: "Your availability covers the job period" },
  window_not_covering: { ar: "توفرك لا يغطي فترة الشغل", en: "Your availability doesn't cover the job period" },
  no_window_declared: { ar: "أضف فترات توفرك لتتطابق مع موعد الشغل", en: "Add your available dates to match the job period" },
};

export type MatchLineKey = "trade" | "specialty" | "location" | "availability";

export type MatchLine = {
  key: MatchLineKey;
  /** Short name of the component. */
  title: string;
  /** What the database decided, in words. */
  text: string;
  /** NULL when the component is NOT SPECIFIED (availability the caller never declared) — never a 0 standing in for it. */
  points: number | null;
  max: number;
  /** Anything earned counts as met; nothing earned is not. A partial location (10/15, 5/15) is met. */
  met: boolean;
  /** True only for availability the caller has not declared: shown as "Not specified", not as 0 and not as a miss. */
  notSpecified: boolean;
  /** The stable code, for tests and analytics. */
  reason: string;
};

const LINE_TITLE: Record<MatchLineKey, { ar: string; en: string }> = {
  trade: { ar: "الحرفة", en: "Trade" },
  specialty: { ar: "التخصص", en: "Specialty" },
  location: { ar: "الموقع", en: "Location" },
  availability: { ar: "التوفر", en: "Availability" },
};

/** The breakdown, one line per component, in the order the points are earned. */
export function matchLines(match: MatchBreakdown, locale: "ar" | "en"): MatchLine[] {
  const line = (key: MatchLineKey, points: number | null, max: number, reason: string, text: { ar: string; en: string }): MatchLine => ({
    key,
    title: LINE_TITLE[key][locale],
    text: text[locale],
    points,
    max,
    met: (points ?? 0) > 0,
    notSpecified: points === null,
    reason,
  });
  return [
    line("trade", match.tradePoints, MATCH_MAX.trade, match.tradeReason, TRADE_TEXT[match.tradeReason] ?? TRADE_TEXT.trade_mismatch),
    line("specialty", match.specialtyPoints, MATCH_MAX.specialty, match.specialtyReason, SPECIALTY_TEXT[match.specialtyReason] ?? SPECIALTY_TEXT.trade_mismatch),
    line("location", match.locationPoints, MATCH_MAX.location, match.locationReason, LOCATION_TEXT[match.locationReason] ?? LOCATION_TEXT.outside_service_area),
    line("availability", match.availabilityPoints, MATCH_MAX.availability, match.availabilityReason, AVAILABILITY_TEXT[match.availabilityReason] ?? AVAILABILITY_TEXT.window_not_covering),
  ];
}
