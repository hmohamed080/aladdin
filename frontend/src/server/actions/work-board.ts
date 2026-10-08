"use server";

import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { WORK_PAGE_STEP, parseWorkBoardParams } from "@/lib/installer/work-board-params";
import { loadWorkBoardPage } from "@/server/queries/work-board-page";
import type { WorkRowVM } from "@/features/installer-my-work-preview/view-model";

/**
 * "Show more" on My Work: the NEXT page of the same question, by CURSOR. The client sends the board's
 * canonical query string and the opaque cursor the previous page returned. The query string is
 * re-validated here as the page validates the URL, the cursor is decoded and checked against that
 * question and sort (a hand-made or stale one is refused), the rows are read through the same loader
 * as the first render, and `my_work_page` scopes them to the signed-in installer. There is no offset
 * and no ceiling: the board appends until `nextCursor` is null.
 */
export type LoadMoreWorkResult =
  | { ok: true; rows: WorkRowVM[]; total: number | null; nextCursor: string | null }
  | { ok: false };

export async function loadMoreWorkAction(search: string, cursor: string): Promise<LoadMoreWorkResult> {
  if (typeof search !== "string" || search.length > 2000 || typeof cursor !== "string" || cursor.length === 0 || cursor.length > 600) return { ok: false };
  try {
    const { state } = parseWorkBoardParams(Object.fromEntries(new URLSearchParams(search)));
    const store = await cookies();
    const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
    const supabase = await getServerSupabase();
    const page = await loadWorkBoardPage(supabase, state, cursor, WORK_PAGE_STEP, createTranslator(locale), locale);
    return { ok: true, ...page };
  } catch {
    return { ok: false };
  }
}
