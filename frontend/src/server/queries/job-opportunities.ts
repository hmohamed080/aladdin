import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { sanitizeSearchTerm } from "./sales";

/**
 * The INSTALLER side of Jobs: discovery, and the caller's own candidacies.
 *
 * The read seams, and none of them takes a user id. `job_opportunities_page` /
 * `job_opportunities_total` (the board) and `job_matches` (the Overall Match) resolve the caller from
 * `auth.uid()` inside the database; `my_job_applications` resolves it to decide which rows exist at all.
 * So there is no parameter here that could be pointed at somebody else, and nothing in this file
 * re-implements an authority check — a filter or a cursor can narrow what the database already allows
 * and can never widen it.
 *
 * THE TRADE FILTER IS NOT AN AUTHORITY (O5). `open_job_opportunities` applies no
 * trade filter of its own, and nothing here reads `user_trades`. A professional
 * may narrow the list to their own trade because that is convenient; the default
 * is everything, and an off-trade job is opened and applied for through exactly
 * the same path as any other. If a future version of this file ever consults the
 * caller's declared trades to decide what to SHOW by default, that is the bug.
 */

type DB = SupabaseClient<Database>;

export type OpportunityRow = Database["public"]["Views"]["open_job_opportunities"]["Row"];
/**
 * One row of the PAGED board (`job_opportunities_page`): the discovery columns, whether the caller has applied /
 * saved it, its canonical location keys, its optional required specialty, the two ORDERING tiers (Near me = location
 * only, Best match = trade + specialty only) and the canonical Overall Match breakdown with stable reason codes.
 */
export type BoardOpportunityRow = Database["public"]["Functions"]["job_opportunities_page"]["Returns"][number];
export type MyApplicationRow = Database["public"]["Views"]["my_job_applications"]["Row"];
export type JobApplicationStatus = Database["public"]["Enums"]["job_application_status"];

/** The four candidacy states, in lifecycle order. */
export const APPLICATION_STATUSES = [
  "submitted",
  "accepted",
  "rejected",
  "withdrawn",
] as const;

const LIST_LIMIT = 100;
/** The row cap of `listJobOpportunities`. A result shorter than this is the COMPLETE set. */
export const OPPORTUNITY_LIST_LIMIT = LIST_LIMIT;
/** The database refuses a page larger than this (one extra row is read to learn whether another page exists). */
const DB_PAGE_MAX = 101;

/** Real buckets over `expected_duration_days`. A job with no stated duration is in none of them. */
export type OpportunityDuration = "short" | "medium" | "long";
/**
 * The orderings of the board, all applied INSIDE the database statement (`job_opportunities_page`):
 *   newest    published_at DESC, id DESC
 *   highest   offered_amount DESC (NULLS LAST — vacuous, the column is NOT NULL), published_at DESC, id DESC
 *   nearest   LOCATION tier ASC, published_at DESC, id DESC — 0 same city, 1 same primary governorate,
 *             2 another declared service area, 3 the rest. Canonical keys only; no GPS, no distance, no Overall Match.
 */
export type OpportunitySort = "newest" | "highest" | "nearest";

/** Inclusive day bounds of each duration bucket. `long` is open-ended. */
export const DURATION_BUCKETS: Record<OpportunityDuration, { min?: number; max?: number }> = {
  short: { max: 2 },
  medium: { min: 3, max: 5 },
  long: { min: 6 },
};

export type OpportunityFilters = {
  /** Free text over title, description and the posting organization's name. */
  search?: string;
  /** A canonical trade KEY, never an id — ids differ per environment. */
  tradeKey?: string;
  /** Several canonical trade keys (any of). Empty/undefined = ALL trades. */
  tradeKeys?: readonly string[];
  /** A catalogue governorate KEY. Every job stores the same key (`jobs.governorate_key`); nothing is resolved from text at read time. */
  governorateKey?: string;
  /** A catalogue city KEY inside `governorateKey` (`other` is the catalogue's own entry). */
  cityKey?: string;
  /** "no" = not yet applied, "yes" = already applied, undefined = both. */
  applied?: "yes" | "no";
  /** Real numeric bounds on `offered_amount`, in EGP, both inclusive and both optional. No ceiling is assumed. */
  minAmount?: number;
  maxAmount?: number;
  duration?: OpportunityDuration;
  /** Only the opportunities the CALLER has saved — a predicate inside the database statement, so there is no list to cap. */
  saved?: boolean;
  /** Defaults to "newest". */
  sort?: OpportunitySort;
  /** Row cap of `listJobOpportunities`. Defaults to `LIST_LIMIT`. */
  limit?: number;
};

type PageArgs = Database["public"]["Functions"]["job_opportunities_page"]["Args"];
type TotalArgs = Database["public"]["Functions"]["job_opportunities_total"]["Args"];

/** The filters, as the database's own parameters. Only what is set is sent; nothing here names a user. */
function filterArgs(f: OpportunityFilters): TotalArgs {
  const tradeKeys = [...new Set([...(f.tradeKey ? [f.tradeKey] : []), ...(f.tradeKeys ?? [])])];
  const bucket = f.duration ? DURATION_BUCKETS[f.duration] : undefined;
  const term = f.search ? sanitizeSearchTerm(f.search) : "";
  const finite = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? n : undefined);
  return {
    p_search: term || undefined,
    p_trade_keys: tradeKeys.length ? tradeKeys : undefined,
    p_governorate_key: f.governorateKey || undefined,
    p_city_key: f.governorateKey && f.cityKey ? f.cityKey : undefined,
    p_min_amount: finite(f.minAmount),
    p_max_amount: finite(f.maxAmount),
    p_min_duration: bucket?.min,
    p_max_duration: bucket?.max,
    p_applied: f.applied === "yes" ? true : f.applied === "no" ? false : undefined,
    p_saved: f.saved ? true : undefined,
  };
}

/**
 * Open opportunities, newest published first by default — one page of the database, never a view-wide read.
 * Used for small flat lists (global search suggestions, the home preview), capped at `limit` (default 100).
 */
export async function listJobOpportunities(
  supabase: DB,
  f: OpportunityFilters = {},
): Promise<BoardOpportunityRow[]> {
  const { data, error } = await supabase.rpc("job_opportunities_page", {
    ...filterArgs(f),
    p_sort: f.sort ?? "newest",
    p_limit: Math.min(Math.max(Math.floor(f.limit ?? LIST_LIMIT), 1), DB_PAGE_MAX),
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * The orderings of the installer DASHBOARD's "Opportunities for you" strip. A strip, not a board: it shows a
 * handful, so it is a bounded top-N read of the SAME paging function the board uses and needs no cursor.
 *   best     BEST MATCH — TRADE + SPECIALTY ONLY (70 trade + specialty / 50 trade only / 0), newest breaking ties.
 *            It does not look at location or availability.
 *   nearest  NEAR ME — LOCATION ONLY: same city, primary governorate, another declared area, the rest.
 *   newest   published_at DESC
 *   oldest   published_at ASC
 * Every mode lists every discoverable job — a low or zero match is still listed and still applicable — and every
 * ordering ends on the id, so the strip is deterministic. The cards still DISPLAY the Overall Match.
 */
export type DashboardOpportunityMode = "best" | "nearest" | "newest" | "oldest";
export const DASHBOARD_OPPORTUNITY_MODES: readonly DashboardOpportunityMode[] = ["best", "nearest", "newest", "oldest"];

export async function listDashboardOpportunities(
  supabase: DB,
  mode: DashboardOpportunityMode,
  limit: number,
): Promise<BoardOpportunityRow[]> {
  const { data, error } = await supabase.rpc("job_opportunities_page", {
    p_sort: mode,
    p_limit: Math.min(Math.max(Math.floor(limit), 1), DB_PAGE_MAX),
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Where the NEXT page of the board starts: the ordering keys of the last row already shown. It is a position in
 * the sort order, never a row count, so rows inserted, removed or re-ranked while a viewer pages cannot make a page
 * repeat or skip a row. One shape per sort, each ending on `publishedAt` then `id` (the id breaks every tie):
 *
 *   newest   published_at DESC, id DESC
 *   highest  offered_amount DESC, published_at DESC, id DESC
 *   nearest  location tier ASC, published_at DESC, id DESC
 *
 * A cursor only ever narrows a position inside what the database already allows this caller to see; the database
 * applies discoverability to every page regardless of the cursor, so a forged one cannot widen anything.
 */
export type JobKeyset =
  | { sort: "newest"; publishedAt: string; id: string }
  | { sort: "highest"; amount: number; publishedAt: string; id: string }
  | { sort: "nearest"; tier: number; publishedAt: string; id: string };

/** The keyset of a row, for the sort it was read under. Throws when the row lacks a key (published jobs always have both). */
export function keysetOf(
  sort: OpportunitySort,
  row: Pick<BoardOpportunityRow, "id" | "published_at" | "offered_amount" | "proximity_tier">,
): JobKeyset {
  if (!row.id || !row.published_at) throw new Error("an opportunity without an id or a publication time cannot anchor a page");
  if (sort === "highest") return { sort, amount: Number(row.offered_amount), publishedAt: row.published_at, id: row.id };
  if (sort === "nearest") return { sort, tier: Number(row.proximity_tier), publishedAt: row.published_at, id: row.id };
  return { sort: "newest", publishedAt: row.published_at, id: row.id };
}

/** The keyset as the database's cursor parameters. */
function cursorArgs(after: JobKeyset | null): Partial<PageArgs> {
  if (!after) return {};
  if (after.sort === "highest") return { p_after_id: after.id, p_after_published_at: after.publishedAt, p_after_amount: after.amount };
  if (after.sort === "nearest") return { p_after_id: after.id, p_after_published_at: after.publishedAt, p_after_tier: after.tier };
  return { p_after_id: after.id, p_after_published_at: after.publishedAt };
}

/**
 * One REAL page of the board: up to `size` rows AFTER the keyset `after` (the first page when it is null) of the
 * filtered, ordered set, and the keyset of the next page (null when this page is the last). The whole question —
 * discoverability, filters, sort, cursor and LIMIT — is ONE database statement that walks a partial index in sort
 * order and stops after a page, so page 20 costs what page 1 costs and nothing materialises the discoverable set.
 *
 * THE EXACT TOTAL is a separate, deliberately rarer read. It is asked for only when `withTotal` is set — the first
 * page, a filter change, a sort change, switching saved/all — and the board keeps it while later pages append, so a
 * count is never paid per appended page. (`null` is "not asked", never zero.)
 *
 * `next` is known without a count: one extra row is read.
 */
export async function listJobOpportunityPage(
  supabase: DB,
  f: OpportunityFilters,
  size: number,
  after: JobKeyset | null = null,
  options: { withTotal?: boolean } = {},
): Promise<{ rows: BoardOpportunityRow[]; total: number | null; next: JobKeyset | null }> {
  const sort = f.sort ?? "newest";
  if (after && after.sort !== sort) throw new Error("the cursor belongs to a different ordering");
  const take = Math.min(Math.max(Math.floor(size), 1), DB_PAGE_MAX - 1);
  const [rowsRes, totalRes] = await Promise.all([
    supabase.rpc("job_opportunities_page", { ...filterArgs(f), p_sort: sort, p_limit: take + 1, ...cursorArgs(after) }),
    options.withTotal ? supabase.rpc("job_opportunities_total", filterArgs(f)) : Promise.resolve(null),
  ]);
  if (rowsRes.error) throw rowsRes.error;
  if (totalRes?.error) throw totalRes.error;
  const fetched = rowsRes.data ?? [];
  const rows = fetched.slice(0, take);
  const last = rows[rows.length - 1];
  return {
    rows,
    total: totalRes ? Number(totalRes.data ?? rows.length) : null,
    next: fetched.length > take && last ? keysetOf(sort, last) : null,
  };
}

/** Does the caller have a service location the catalogue recognises? Only used to explain why Nearest shows newest-first. */
export async function callerHasServiceLocation(supabase: DB): Promise<boolean> {
  const { data, error } = await supabase.rpc("caller_has_service_location");
  if (error) throw error;
  return data === true;
}

/**
 * How many open opportunities the caller has not applied to yet.
 *
 * A count, not a sample: the dashboard previews only a few cards, and a
 * headline derived from the cards on screen would claim "3" whatever the real
 * number is. `head: true` fetches no rows. Same view, same definer, so it can
 * never disagree with the list about what is discoverable.
 */
export async function countOpenJobOpportunities(supabase: DB): Promise<number> {
  const { count, error } = await supabase
    .from("open_job_opportunities")
    .select("id", { count: "exact", head: true })
    .eq("has_applied", false);
  if (error) throw error;
  return count ?? 0;
}

/**
 * The governorates that currently have work in them.
 *
 * `jobs.governorate` is FREE TEXT the poster types, not a key from the
 * onboarding location catalog — so it cannot be labelled through
 * `onboarding.consumer.governorates.*` (that would print the message path) and
 * the filter cannot offer a fixed option list. The honest option list is the one
 * derived from the openings that actually exist, in the words the posters used.
 *
 * One extra read, on one page. It is what stops the filter offering a place with
 * nothing in it.
 */
export async function listOpportunityGovernorates(supabase: DB): Promise<string[]> {
  const { data, error } = await supabase
    .from("open_job_opportunities")
    .select("governorate")
    .limit(LIST_LIMIT);
  if (error) throw error;
  const seen = new Set<string>();
  for (const r of data ?? []) if (r.governorate) seen.add(r.governorate);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * One opportunity, if it is still discoverable.
 *
 * Null covers three different situations that are one situation to this layer:
 * the job never existed, it is no longer open, or its poster is no longer
 * verified. The route decides what to say, and for an applicant it says it by
 * falling back to their own application record.
 */
export const getJobOpportunity = cache(async function getJobOpportunity(
  supabase: DB,
  jobId: string,
): Promise<OpportunityRow | null> {
  const { data, error } = await supabase
    .from("open_job_opportunities")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
});

/**
 * The caller's own candidacies, newest first.
 *
 * Deliberately NOT filtered on the job still being discoverable. That is the
 * whole reason this projection exists separately from the one above: an
 * application is a record of something the caller did, and it must stay legible
 * after the job is awarded elsewhere, closed, cancelled, or its poster's
 * verification lapses.
 */
export async function listMyApplications(
  supabase: DB,
  status?: JobApplicationStatus,
): Promise<MyApplicationRow[]> {
  let q = supabase
    .from("my_job_applications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** The caller's own candidacy for one job, if they have one. */
export const getMyApplicationForJob = cache(async function getMyApplicationForJob(
  supabase: DB,
  jobId: string,
): Promise<MyApplicationRow | null> {
  const { data, error } = await supabase
    .from("my_job_applications")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
});

/** How many candidacies sit in each state — the tracking page's filter counts. */
export function countApplicationsByStatus(
  rows: readonly MyApplicationRow[],
): Record<JobApplicationStatus, number> {
  const out = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<
    JobApplicationStatus,
    number
  >;
  for (const r of rows) if (r.status) out[r.status] += 1;
  return out;
}

/**
 * May this candidacy be sent again?
 *
 * Mirrors `job_application_submit`'s two gates for a `withdrawn` row, and holds
 * the same line it does: `accepted` and `rejected` are decisions, and neither is
 * resubmittable. The server enforces all of it — this only decides whether to
 * OFFER the action, because an "Apply again" button that is guaranteed to be
 * refused is worse than no button.
 *
 * `job_status === 'open'` is necessary and not sufficient: the poster must also
 * still be verified, which this layer cannot see from the application row. The
 * discoverability half is answered by whether the job is still in
 * `open_job_opportunities`, which the route already knows.
 */
export function canReapply(
  application: Pick<MyApplicationRow, "status" | "job_status">,
  jobIsDiscoverable: boolean,
): boolean {
  return application.status === "withdrawn" && application.job_status === "open" && jobIsDiscoverable;
}

/**
 * Which of these jobs are still discoverable.
 *
 * The tracking page needs this to decide whether "Apply again" would work, and
 * an application row cannot answer it: `job_status = 'open'` is visible there,
 * but the poster's CURRENT verification is not — and that is the second gate
 * `job_application_submit` applies. Asking discovery directly is the only honest
 * answer, and it is one small read for the whole page rather than one per row.
 *
 * Returns a Set so the caller does a lookup, not a scan.
 */
export async function discoverableJobIds(
  supabase: DB,
  jobIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from("open_job_opportunities")
    .select("id")
    .in("id", ids);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.id).filter((id): id is string => Boolean(id)));
}
