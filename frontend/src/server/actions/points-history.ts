"use server";

import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { toPointsEntryViews, type PointsEntryView } from "@/features/points/view-model";
import {
  isValidPointsCursor,
  listPointsHistoryPage,
  resolveEntryOrganizationNames,
  type PointsHistoryCursor,
  type PointsHistoryFilter,
} from "@/server/queries/points";

/**
 * The Installer Points history (approved design): one keyset page of the caller's own ledger for a period, an activity
 * and a result, with the exact matching total. Every input is re-validated; rows are scoped by the ledger's owner policy.
 */
export type PointsHistoryPageResult =
  | { ok: true; views: PointsEntryView[]; next: PointsHistoryCursor | null; total: number }
  | { ok: false };

const EVENTS = new Set(["referral.organization_approved", "admin.adjustment"]);

export async function loadPointsHistoryAction(filter: PointsHistoryFilter, cursor: PointsHistoryCursor | null): Promise<PointsHistoryPageResult> {
  if (!filter || typeof filter !== "object") return { ok: false };
  if (filter.month !== null && (typeof filter.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(filter.month))) return { ok: false };
  if (filter.event !== null && !EVENTS.has(filter.event)) return { ok: false };
  if (filter.result !== "all" && filter.result !== "earned" && filter.result !== "deducted") return { ok: false };
  if (cursor !== null && !isValidPointsCursor(cursor)) return { ok: false };
  try {
    const supabase = await getServerSupabase();
    const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
    const page = await listPointsHistoryPage(supabase, { month: filter.month, event: filter.event, result: filter.result }, cursor);
    const names = await resolveEntryOrganizationNames(supabase, page.rows);
    return { ok: true, views: toPointsEntryViews(page.rows, createTranslator(locale), locale, names), next: page.next, total: page.total };
  } catch {
    return { ok: false };
  }
}
