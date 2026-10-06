import {
  DEFAULT_BOARD_FILTERS,
  type AppliedFilter,
  type BoardFilters,
  type BoardSort,
  type DurationFilter,
} from "@/features/installer-job-opportunities-preview/view-model";
import type { OpportunityFilters } from "@/server/queries/job-opportunities";

/**
 * THE JOB BOARD'S STATE IS THE URL.
 *
 * `/home/jobs?q=&trade=a,b&gov=&applied=&min=&max=&duration=&sort=` is the one
 * authority for what the board shows; the server reads it, runs the real query,
 * and the (controlled) View only ever reports changes back as a new URL. Nothing
 * here reads the viewer's declared trades — an empty `trade` means ALL trades.
 *
 * Pure, and with only TYPE imports from the server layer, so the client container
 * can use it too.
 */

export type JobBoardParams = Partial<Record<"q" | "trade" | "gov" | "applied" | "min" | "max" | "duration" | "sort", string | string[]>>;
export type ProductionSort = Extract<BoardSort, "newest" | "highest">;

const DURATIONS: readonly DurationFilter[] = ["short", "medium", "long"];

const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

function amount(value: string | string[] | undefined): number | null {
  const text = one(value).trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseJobBoardParams(sp: JobBoardParams): { filters: BoardFilters; sort: ProductionSort } {
  const applied = one(sp.applied);
  const duration = one(sp.duration);
  const tradeKeys = [...new Set(one(sp.trade).split(",").map((k) => k.trim()).filter(Boolean))];
  let minAmount = amount(sp.min);
  let maxAmount = amount(sp.max);
  // A reversed pair can only come from a hand-edited URL; read it as the range it spans.
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) [minAmount, maxAmount] = [maxAmount, minAmount];
  return {
    filters: {
      ...DEFAULT_BOARD_FILTERS,
      q: one(sp.q).trim(),
      tradeKeys,
      governorate: one(sp.gov).trim(),
      applied: applied === "yes" || applied === "no" ? (applied as AppliedFilter) : "",
      minAmount,
      maxAmount,
      duration: (DURATIONS as readonly string[]).includes(duration) ? (duration as DurationFilter) : "all",
    },
    sort: one(sp.sort) === "highest" ? "highest" : "newest",
  };
}

/** The real query for a board state. Omits everything that is at its default. */
export function toOpportunityQuery(filters: BoardFilters, sort: ProductionSort): OpportunityFilters {
  return {
    search: filters.q || undefined,
    tradeKeys: filters.tradeKeys.length ? filters.tradeKeys : undefined,
    governorate: filters.governorate || undefined,
    applied: filters.applied || undefined,
    minAmount: filters.minAmount ?? undefined,
    maxAmount: filters.maxAmount ?? undefined,
    duration: filters.duration === "all" ? undefined : (filters.duration as OpportunityFilters["duration"]),
    sort,
  };
}

/** The canonical URL query string for a board state; defaults are omitted. */
export function toJobBoardSearch(filters: BoardFilters, sort: ProductionSort): string {
  const p = new URLSearchParams();
  if (filters.q) p.set("q", filters.q);
  if (filters.tradeKeys.length) p.set("trade", filters.tradeKeys.join(","));
  if (filters.governorate) p.set("gov", filters.governorate);
  if (filters.applied) p.set("applied", filters.applied);
  if (filters.minAmount !== null) p.set("min", String(filters.minAmount));
  if (filters.maxAmount !== null) p.set("max", String(filters.maxAmount));
  if (filters.duration !== "all") p.set("duration", filters.duration);
  if (sort !== "newest") p.set("sort", sort);
  return p.toString();
}
