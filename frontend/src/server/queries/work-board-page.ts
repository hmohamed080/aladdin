import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { WorkRowVM, WorkSearchState } from "@/features/installer-my-work-preview/view-model";
import { contactsOf, toWorkRowVMs } from "@/features/home/installer-work-data";
import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { statesForTab, toWorkBoardSearch } from "@/lib/installer/work-board-params";
import { InvalidCursorError, decodeWorkCursor, encodeWorkCursor, type WorkCursorSort } from "@/server/pagination/cursor";
import { listAssignmentReviews, listMyWorkPage } from "./job-assignments";

type DB = SupabaseClient<Database>;

/**
 * ONE PAGE of the caller's work, ready to draw — the single loader behind both the first render
 * (`/home/work`, `cursor` null) and every "Show more" (`loadMoreWorkAction`). The database applies
 * the state, search, company, planned period, contact and sort and returns the `limit` rows AFTER the
 * position the opaque `cursor` names, in the sort's total order (it ends on the assignment id), plus
 * the EXACT filtered total; reviews are read for the completed rows of this page only. There is no
 * offset: an assignment arriving or moving while the installer pages cannot repeat or skip a row.
 * `total` is null only for an empty page past the end (the board already holds the exact total).
 */
export async function loadWorkBoardPage(
  supabase: DB,
  state: WorkSearchState,
  cursor: string | null,
  limit: number,
  t: TranslateFn,
  locale: Locale,
  now: Date = new Date(),
): Promise<{ rows: WorkRowVM[]; total: number | null; nextCursor: string | null }> {
  const sort = state.sort as WorkCursorSort;
  const question = toWorkBoardSearch(state);
  const after = cursor === null ? null : decodeWorkCursor(cursor, sort, question);
  if (cursor !== null && !after) throw new InvalidCursorError();
  const page = await listMyWorkPage(supabase, {
    states: statesForTab(state.tab),
    search: state.q,
    company: state.company,
    from: state.from,
    to: state.to,
    contact: state.contact as "all" | "available" | "none",
    sort,
    limit,
    after,
  });
  const reviews = await listAssignmentReviews(supabase, page.rows.filter((a) => a.status === "completed").map((a) => a.id));
  return {
    rows: toWorkRowVMs(page.rows, t, locale, now, reviews, contactsOf(page.rows)),
    total: page.total,
    nextCursor: page.next ? encodeWorkCursor(page.next, question) : null,
  };
}
