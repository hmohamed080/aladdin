import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { sanitizeSearchTerm } from "./sales";

/**
 * The INSTALLER side of Jobs: discovery, and the caller's own candidacies.
 *
 * Two read seams, both from Increment 6, and neither of them takes a user id.
 * `open_job_opportunities` resolves the caller from `auth.uid()` inside its
 * definer to compute `has_applied`; `my_job_applications` resolves it to decide
 * which rows exist at all. So there is no parameter here that could be pointed
 * at somebody else's applications, and nothing in this file re-implements an
 * authority check — a filter can narrow what the database already allows and can
 * never widen it.
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

export type OpportunityFilters = {
  /** Free text over title, description and the posting organization's name. */
  search?: string;
  /** A canonical trade KEY, never an id — ids differ per environment. */
  tradeKey?: string;
  /** The governorate exactly as some poster typed it (the column is free text). */
  governorate?: string;
  /** "no" = not yet applied, "yes" = already applied, undefined = both. */
  applied?: "yes" | "no";
};

/**
 * Open opportunities, newest published first.
 *
 * Ordering is `published_at desc` and nothing else: it is the one ordering that
 * is both deterministic and honest here. Every alternative the reference pack
 * shows — nearest, best paid, most applied to — needs either geography the
 * domain does not hold or a competitor count the poster's side deliberately does
 * not publish.
 */
export async function listJobOpportunities(
  supabase: DB,
  f: OpportunityFilters = {},
): Promise<OpportunityRow[]> {
  let q = supabase
    .from("open_job_opportunities")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(LIST_LIMIT);

  const term = f.search ? sanitizeSearchTerm(f.search) : "";
  if (term) {
    q = q.or(
      `title.ilike.%${term}%,description.ilike.%${term}%,poster_org_name.ilike.%${term}%`,
    );
  }
  if (f.tradeKey) q = q.eq("trade_key", f.tradeKey);
  if (f.governorate) q = q.eq("governorate", f.governorate);
  if (f.applied === "yes") q = q.eq("has_applied", true);
  if (f.applied === "no") q = q.eq("has_applied", false);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
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
