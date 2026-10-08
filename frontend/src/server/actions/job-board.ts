"use server";

import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { JOB_PAGE_STEP, parseJobBoardParams } from "@/lib/installer/job-board-filters";
import { loadJobBoardPage } from "@/server/queries/job-board-page";
import type { JobCardVM } from "@/features/installer-job-opportunities-preview/view-model";

/**
 * "Show more" on the opportunity board: the NEXT page of the same question, by CURSOR.
 *
 * The client sends the canonical query string of the board (filters + sort — what the URL carries)
 * and the opaque cursor the previous page returned. The query string is re-validated here exactly as
 * the page validates the URL; the cursor is decoded and checked against that question and sort (a
 * hand-made or stale one is refused, not trusted); and the page is read through the same loader the
 * first render uses. The cursor is a position in the caller's own result — it widens nothing:
 * discoverability is applied by the database on every page (`job_opportunities_page`), scoped by the caller's session.
 *
 * There is no offset and no ceiling: the board can keep appending until `nextCursor` is null. A "Show more" reply carries
 * `total: null` — the exact total is computed once per question (the first page) and the board keeps it.
 */
export type LoadMoreJobsResult =
  | { ok: true; cards: JobCardVM[]; total: number | null; savedIds: string[]; nextCursor: string | null }
  | { ok: false };

export async function loadMoreJobsAction(search: string, cursor: string): Promise<LoadMoreJobsResult> {
  if (typeof search !== "string" || search.length > 2000 || typeof cursor !== "string" || cursor.length === 0 || cursor.length > 600) return { ok: false };
  try {
    const { filters, sort } = parseJobBoardParams(Object.fromEntries(new URLSearchParams(search)));
    const store = await cookies();
    const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
    const supabase = await getServerSupabase();
    const page = await loadJobBoardPage(supabase, filters, sort, cursor, JOB_PAGE_STEP, createTranslator(locale), locale);
    return { ok: true, ...page };
  } catch {
    return { ok: false };
  }
}
