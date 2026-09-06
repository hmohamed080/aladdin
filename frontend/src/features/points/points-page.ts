import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import {
  getPointsBalance,
  listPointsEntries,
  resolveEntryOrganizationNames,
  resolveHistoryLimit,
  POINTS_HISTORY_LIMIT,
  POINTS_HISTORY_MAX,
} from "@/server/queries/points";
import { toPointsEntryViews, type PointsEntryView } from "./view-model";

/**
 * Everything a Points page needs, resolved once for BOTH surfaces.
 *
 * Points are the caller's own standing, so the same page belongs in two places:
 * the business workspace (`/b2b/points`, shipped) and the personal home
 * (`/home/points`, this increment) — because an organization-less installer or
 * engineer holds Points exactly as a showroom's salesperson does, and until now
 * had nowhere to read them (`/b2b/layout.tsx` redirects an org-less caller away).
 *
 * WHAT LIVES HERE IS THE PART THAT MUST NOT DIVERGE: which reads happen, the
 * failure contract, the view mapping, and the "more" rule. What does NOT live
 * here is chrome — the workspace page uses the dense `PageHeader`/`Panel`
 * primitives, the personal page uses `HomeHeader`/`HomeSection`, and neither is
 * more correct than the other for the surface it sits on.
 *
 * ONE TRY AROUND BOTH READS, deliberately, and carried over verbatim from the
 * shipped page: they answer one question between them, and a confident balance
 * above a silently empty history — or an empty state that is really a failed
 * query — would be a page that lies about the ledger. Either read failing means
 * the page says so.
 *
 * NO USER ID CROSSES THIS BOUNDARY. `getPointsBalance` calls `points_balance()`
 * with no argument so it defaults to `auth.uid()`, and `listPointsEntries` adds
 * no ownership filter because `points_ledger`'s owner policy already decided. The
 * personal route therefore gains no read the workspace route did not already
 * have, and neither can be pointed at someone else.
 */
export type PointsPageData =
  | { ok: true; balance: number; views: PointsEntryView[]; moreHref: string | null }
  | { ok: false };

export async function loadPointsPage(
  supabase: SupabaseClient<Database>,
  opts: {
    /** The `?show=` parameter, validated by `resolveHistoryLimit`. */
    show: string | string[] | undefined;
    locale: Locale;
    t: TranslateFn;
    /** Route this page is rendered at — the "more" link must return to it. */
    basePath: string;
  },
): Promise<PointsPageData> {
  const limit = resolveHistoryLimit(opts.show);

  try {
    const [balance, entries] = await Promise.all([
      getPointsBalance(supabase),
      listPointsEntries(supabase, { limit }),
    ]);
    // Organization captions resolve through a plain caller-scoped read; a name
    // that does not resolve is OMITTED, never invented.
    const orgNames = await resolveEntryOrganizationNames(supabase, entries);

    return {
      ok: true,
      balance,
      views: toPointsEntryViews(entries, opts.t, opts.locale, orgNames),
      /* "More" appears only when the page is actually full AND the cap can still
         rise. A link that loads the same rows again is worse than no link. */
      moreHref:
        entries.length >= limit && limit < POINTS_HISTORY_MAX
          ? `${opts.basePath}?show=${Math.min(limit + POINTS_HISTORY_LIMIT, POINTS_HISTORY_MAX)}`
          : null,
    };
  } catch {
    return { ok: false };
  }
}
