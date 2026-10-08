import type { DashboardOpportunityMode } from "@/server/queries/job-opportunities";

/**
 * THE INSTALLER DASHBOARD'S "Opportunities for you" STRIP: how the three quick filters in the approved
 * presentation (`قريب مني` / `مناسب لمهاراتي` / `الأحدث` with its Newest / Oldest menu) map onto the database's real
 * orderings. There is no separate dashboard ranking: each choice is an ordering of the SAME paging function the Jobs
 * board reads (`job_opportunities_page`), and each means ONE thing:
 *   قريب مني          Near me      LOCATION only (canonical keys: city, primary governorate, another service area)
 *   مناسب لمهاراتي    Best match   TRADE + SPECIALTY only — not location, not availability
 *   الأحدث            Newest       published date
 * The card still DISPLAYS the Overall Match percentage (trade + specialty + location + availability).
 */

/** What the quick filters offer. */
export type DashboardSort = "match" | "distance" | "recent";
export type DashboardDateOrder = "newest" | "oldest";

/** The strip is a glance, not a board: this many cards, whatever the ordering. */
export const DASHBOARD_OPPORTUNITY_COUNT = 3;

/** The approved default (the first quick filter, pressed on arrival). */
export const DEFAULT_DASHBOARD_SORT: DashboardSort = "match";
export const DEFAULT_DASHBOARD_DATE_ORDER: DashboardDateOrder = "newest";

export function dashboardModeFor(sort: DashboardSort, dateOrder: DashboardDateOrder): DashboardOpportunityMode {
  if (sort === "match") return "best";
  if (sort === "distance") return "nearest";
  return dateOrder === "oldest" ? "oldest" : "newest";
}

/** The reverse, for a mode that arrived over the wire. */
export function dashboardChoiceFor(mode: DashboardOpportunityMode): { sort: DashboardSort; dateOrder: DashboardDateOrder } {
  if (mode === "best") return { sort: "match", dateOrder: "newest" };
  if (mode === "nearest") return { sort: "distance", dateOrder: "newest" };
  return { sort: "recent", dateOrder: mode === "oldest" ? "oldest" : "newest" };
}
