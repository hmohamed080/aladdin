/**
 * THE JOB BOARD VIEW MODEL — the boundary between presentation and source.
 *
 * `InstallerJobOpportunitiesView` and the card / filter panel under it render
 * these shapes and import nothing else about where the data came from. Exactly two
 * call sites build them:
 *   - the preview wrapper, from `preview-data.ts` fixtures;
 *   - the real `/home/jobs` route, from `open_job_opportunities` rows
 *     (`features/home/installer-jobs-data.ts`).
 *
 * Every field with no real source is typed so production can only leave it
 * `null`: a skill-match percentage, a distance, a photograph. Nothing is invented
 * to fill a slot.
 */

export type JobCardVM = {
  id: string;
  title: string;
  org: string | null;
  place: string | null;
  tradeKey: string | null;
  tradeLabel: string | null;
  durationDays: number | null;
  /** Null when the opening states no budget — shown as such, never as 0. */
  amount: number | null;
  /** A finished phrase ("Posted 2 hours ago"), or null when unknown. */
  postedLabel: string | null;
  /** A photograph that genuinely belongs to this opening, or null. Production
   *  always passes null today (no job media exists); the card then draws the
   *  generic illustration for `tradeKey`. */
  image: string | null;
  hasApplied: boolean;
  href: string;
  /** Preview-only: no geolocation or skills model exists in production. */
  distanceKm: number | null;
  matchPercent: number | null;
};

export type DurationFilter = "all" | "short" | "medium" | "long";
export type BoardSort = "newest" | "highest" | "nearest" | "demanded";
export type AppliedFilter = "" | "yes" | "no";

export type BoardFilters = {
  /** Free text over title, description and the posting organization. */
  q: string;
  /** Canonical `trades.key`s. Empty = ALL trades (the default; never narrowed
   *  by the viewer's own declared trades). */
  tradeKeys: readonly string[];
  /** A governorate exactly as posters typed it, or "". */
  governorate: string;
  applied: AppliedFilter;
  /** Real numeric bounds on the offered amount, in EGP. Null = unbounded. */
  minAmount: number | null;
  maxAmount: number | null;
  duration: DurationFilter;
  /** Preview-only. */
  radiusKm: number;
};

export const DEFAULT_BOARD_FILTERS: BoardFilters = {
  q: "",
  tradeKeys: [],
  governorate: "",
  applied: "",
  minAmount: null,
  maxAmount: null,
  duration: "all",
  radiusKm: 15,
};

export type TradeOption = { key: string; label: string };

/** The interactions only the preview fixtures can honour. Their presence turns
 *  the save heart, the local Apply button, the map, the radius and the budget
 *  slider on; production never passes this. */
export type PreviewInteractions = {
  savedIds: ReadonlySet<string>;
  onToggleSaved: (id: string) => void;
  savedOnly: boolean;
  onSavedOnlyChange: (next: boolean) => void;
  appliedIds: ReadonlySet<string>;
  onApply: (id: string) => void;
  /** The preview's slider ceiling (a fixture constant, never a production rule). */
  budgetCeiling: number;
};

export function activeFilterCount(f: BoardFilters, preview: boolean, budgetCeiling = 0): number {
  const base = f.tradeKeys.length + (f.duration !== "all" ? 1 : 0);
  if (preview) {
    return base + (f.maxAmount !== null && f.maxAmount < budgetCeiling ? 1 : 0) + (f.radiusKm !== DEFAULT_BOARD_FILTERS.radiusKm ? 1 : 0);
  }
  return (
    base +
    (f.q.trim() ? 1 : 0) +
    (f.governorate ? 1 : 0) +
    (f.applied ? 1 : 0) +
    (f.minAmount !== null ? 1 : 0) +
    (f.maxAmount !== null ? 1 : 0)
  );
}
