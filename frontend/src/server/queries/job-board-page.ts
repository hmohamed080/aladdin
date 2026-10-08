import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { JobCardVM, BoardFilters } from "@/features/installer-job-opportunities-preview/view-model";
import { toJobCardVMs } from "@/features/home/installer-jobs-data";
import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { toJobBoardSearch, toOpportunityQuery, type ProductionSort } from "@/lib/installer/job-board-filters";
import { InvalidCursorError, decodeJobCursor, encodeJobCursor } from "@/server/pagination/cursor";
import { listJobOpportunityPage } from "./job-opportunities";

type DB = SupabaseClient<Database>;

/**
 * ONE PAGE of the opportunity board, ready to draw — the single loader behind both the first
 * render (`/home/jobs`, `cursor` null) and every "Show more" (`loadMoreJobsAction`), so a later
 * page can never be built differently from the first.
 *
 * KEYSET PAGING INSIDE THE DATABASE. The page is the `limit` rows AFTER the position the opaque `cursor`
 * names, in the sort's total order, produced by ONE database statement (`job_opportunities_page`) that
 * applies discoverability, the filters, the sort, the cursor and the LIMIT together — it never builds the
 * discoverable set. There is no offset anywhere: a job published, removed or re-ranked while a viewer
 * pages cannot make a page repeat or skip a row.
 *
 * THE EXACT TOTAL is asked for only on the first page (no cursor) — a first render, a filter change, a
 * sort change, switching saved/all all start a new question and so a new first page. A "Show more" page
 * returns `total: null` and the board keeps the number it already has; a count is never paid per appended
 * page, and a slightly stale count is acceptable until the next refresh (the rows themselves are always
 * current).
 *
 * Every card carries the caller's canonical Overall Match breakdown and whether they saved it, straight from
 * the same row — nothing is looked up per card.
 */
export async function loadJobBoardPage(
  supabase: DB,
  filters: BoardFilters,
  sort: ProductionSort,
  cursor: string | null,
  limit: number,
  t: TranslateFn,
  locale: Locale,
): Promise<{ cards: JobCardVM[]; total: number | null; savedIds: string[]; nextCursor: string | null }> {
  const question = toJobBoardSearch(filters, sort);
  const after = cursor === null ? null : decodeJobCursor(cursor, sort, question);
  if (cursor !== null && !after) throw new InvalidCursorError();
  const page = await listJobOpportunityPage(
    supabase,
    { ...toOpportunityQuery(filters, sort), saved: filters.saved || undefined },
    limit,
    after,
    { withTotal: cursor === null },
  );
  const cards = toJobCardVMs(page.rows, t, locale);
  const savedIds = page.rows.filter((row) => row.is_saved).map((row) => row.id);
  return { cards, total: page.total, savedIds, nextCursor: page.next ? encodeJobCursor(page.next, question) : null };
}
