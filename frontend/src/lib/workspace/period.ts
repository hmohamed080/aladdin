/**
 * The dashboard's period scope, as data.
 *
 * WHY THIS IS ITS OWN MODULE
 * The control that CHANGES the period is a client component (it pushes to the
 * router), while everything that READS one — the dashboard, its queries, the
 * comparison window — runs on the server. Had `resolvePeriod` stayed next to the
 * `<select>`, every export of that `"use client"` module would be a client
 * reference, and calling one from a server component fails at build. Keeping the
 * vocabulary here lets both sides import it without either becoming the other.
 */
export type PeriodKey = "30d" | "90d" | "365d" | "all";

export const PERIOD_DAYS: Record<Exclude<PeriodKey, "all">, number> = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

/** The URL is user input: anything not on this list is not a period. */
export function resolvePeriod(raw: string | undefined, fallback: PeriodKey = "30d"): PeriodKey {
  return raw === "30d" || raw === "90d" || raw === "365d" || raw === "all" ? raw : fallback;
}

/**
 * The window length in days, or `undefined` for "all time".
 *
 * `undefined` is the signal the query layer already understands: `supplySummary`
 * takes `compareDays?`, and no window means no comparison — which is correct,
 * because "all time" has no previous period to be measured against.
 */
export function periodDays(period: PeriodKey): number | undefined {
  return period === "all" ? undefined : PERIOD_DAYS[period];
}
