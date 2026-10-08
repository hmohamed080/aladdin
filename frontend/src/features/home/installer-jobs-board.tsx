"use client";

import { useMemo, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/controls";
import { HeartFilledIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { InstallerJobOpportunitiesView } from "@/features/installer-job-opportunities-preview/installer-job-opportunities-view";
import type { BoardFilters, BoardSort, JobCardVM, TradeOption } from "@/features/installer-job-opportunities-preview/view-model";
import { toJobBoardSearch, type ProductionSort } from "@/lib/installer/job-board-filters";
import { jobPageLabel } from "@/features/home/installer-jobs-data";
import { loadMoreJobsAction } from "@/server/actions/job-board";
import { setJobSavedAction } from "@/server/actions/saved-jobs";
import { useCursorPages } from "./use-cursor-pages";

const PRODUCTION_SORTS: readonly BoardSort[] = ["newest", "highest", "nearest"];

/**
 * The real `/home/jobs` board: the shared View, controlled by the URL.
 *
 * The server page has already run the real query for these `filters`, `sort` and
 * page size (`shown`). A change here is only a navigation to the new canonical URL
 * — `replace`, so the back button is not buried under every checkbox — after which
 * the server renders the new result. No board state lives in this component.
 * Changing a filter or the sort starts again from the first page; "show more" and
 * "show fewer" keep both and only move the page size, without scrolling to the top.
 *
 * SAVED OPPORTUNITIES are persisted, not local: the heart shows what the database
 * holds (`savedIds`), a tap shows the new state at once, calls the real action, and
 * reverts with an alert if it fails. The "Saved" button is just `saved=1` in the URL.
 */
export function InstallerJobsBoard({
  opportunities,
  filters,
  sort,
  search,
  total,
  nextCursor,
  tradeOptions,
  subtitle,
  notice,
  headerAction,
  savedIds,
  savedCount,
  unavailableSaved,
}: {
  /** The FIRST page the server rendered; later pages are appended here. */
  opportunities: readonly JobCardVM[];
  filters: BoardFilters;
  sort: ProductionSort;
  /** The canonical query string of this board (filters + sort): the question the next page is asked of. */
  search: string;
  /** How many opportunities match (exact). */
  total: number;
  /** The opaque cursor of the page after the first (null when the first page is the whole result). */
  nextCursor: string | null;
  tradeOptions: readonly TradeOption[];
  subtitle: string;
  notice?: ReactNode;
  headerAction: ReactNode;
  /** The caller's saved opportunities that are still on the board. */
  savedIds: readonly string[];
  /** How many of them there are (exact). */
  savedCount: number;
  /** Saved jobs the caller still has but that are no longer on the board. */
  unavailableSaved: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useI18n();
  const ar = locale === "ar";
  const [pending, startTransition] = useTransition();
  // The URL (via the server) is the authority, but a control must answer the tap at once:
  // the optimistic value shows immediately and settles to whatever the server renders.
  const [shownFilters, setShownFilters] = useOptimistic(filters);
  const [shownSort, setShownSort] = useOptimistic(sort);

  const go = (nextFilters: BoardFilters, nextSort: ProductionSort) => {
    const qs = toJobBoardSearch(nextFilters, nextSort);
    startTransition(() => {
      setShownFilters(nextFilters);
      setShownSort(nextSort);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  // PAGED APPEND BY CURSOR. The server rendered the first page and the cursor of the one after it; "Show more"
  // asks the database for the page AFTER the last one shown and appends it. The appended pages belong to ONE
  // first page: when the question changes (a new URL) or the server's first page changes, they are dropped and
  // the board starts again from page one. "Show fewer" drops the last appended page.
  const pageKey = `${search}|${opportunities.map((o) => o.id).join(",")}`;
  const pages = useCursorPages<JobCardVM, string[]>({
    resetKey: pageKey,
    first: opportunities,
    firstNext: nextCursor,
    firstTotal: total,
    fetchPage: async (cursor) => {
      const result = await loadMoreJobsAction(search, cursor);
      return result.ok ? { ok: true, items: result.cards, next: result.nextCursor, total: result.total, extra: result.savedIds } : { ok: false };
    },
  });
  const cards = pages.items;
  const knownTotal = pages.total;
  const loading = pages.loading;
  const loadError = pages.error;

  // Saved state: what the server (and each appended page) reported, with the viewer's own taps layered on top
  // until the server catches up (a new `savedIds` key) or a save fails.
  const allSavedIds = useMemo(() => [...savedIds, ...pages.extras.flat()], [savedIds, pages.extras]);
  const serverKey = allSavedIds.join(",");
  const [local, setLocal] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const [saveError, setSaveError] = useState(false);
  const ids: ReadonlySet<string> = local && local.key === serverKey ? local.ids : new Set(allSavedIds);
  const shownSavedCount = Math.max(0, savedCount + (ids.size - allSavedIds.length));

  const toggleSaved = (id: string) => {
    const next = !ids.has(id);
    const nextIds = new Set(ids);
    if (next) nextIds.add(id);
    else nextIds.delete(id);
    setSaveError(false);
    setLocal({ key: serverKey, ids: nextIds });
    void setJobSavedAction(id, next).then((result) => {
      if (!result.ok) {
        setLocal(null);
        setSaveError(true);
        return;
      }
      router.refresh();
    });
  };

  const notices = [
    saveError ? (
      <span key="error" role="alert" className="font-medium text-danger">
        {ar ? "تعذّر تحديث الفرص المحفوظة. حاول مرة أخرى." : "Could not update your saved opportunities. Please try again."}
      </span>
    ) : null,
    loadError ? (
      <span key="load" role="alert" className="font-medium text-danger">
        {ar ? "تعذّر تحميل المزيد من الفرص. حاول مرة أخرى." : "Could not load more opportunities. Please try again."}
      </span>
    ) : null,
    shownFilters.saved && unavailableSaved > 0 ? (
      <span key="unavailable">
        {ar
          ? `${new Intl.NumberFormat("ar-EG").format(unavailableSaved)} من فرصك المحفوظة لم تعد متاحة.`
          : `${unavailableSaved} of your saved ${unavailableSaved === 1 ? "opportunity is" : "opportunities are"} no longer available.`}
      </span>
    ) : null,
    notice ? <span key="notice">{notice}</span> : null,
  ].filter(Boolean);

  return (
    <InstallerJobOpportunitiesView
      scroll="page"
      opportunities={cards}
      countLabel={jobPageLabel(cards.length, knownTotal, locale)}
      filters={shownFilters}
      onFiltersChange={(next) => go(next, shownSort)}
      sort={shownSort}
      onSortChange={(next) => go(shownFilters, next === "highest" || next === "nearest" ? next : "newest")}
      sortOptions={PRODUCTION_SORTS}
      tradeOptions={tradeOptions}
      subtitle={subtitle}
      notice={notices.length ? <span className="flex flex-col gap-0.5">{notices}</span> : undefined}
      saves={{ ids, onToggle: toggleSaved }}
      headerAction={
        <div className="flex flex-wrap items-center gap-sm self-start tablet:self-auto">
          <Button
            variant={shownFilters.saved ? "primary" : "outline"}
            size="sm"
            className="gap-2"
            aria-pressed={shownFilters.saved}
            onClick={() => go({ ...shownFilters, saved: !shownFilters.saved }, shownSort)}
          >
            <HeartFilledIcon size={15} className={shownFilters.saved ? undefined : "text-danger"} />
            {ar ? "الفرص المحفوظة" : "Saved opportunities"}
            <span className="tabular-nums" data-testid="saved-count">{new Intl.NumberFormat(ar ? "ar-EG" : "en-EG").format(shownSavedCount)}</span>
          </Button>
          {headerAction}
        </div>
      }
      pending={pending || loading}
      paging={{
        total: knownTotal,
        hasMore: pages.hasMore,
        canShowFewer: pages.canShowFewer,
        onShowMore: () => void pages.showMore(),
        onShowFewer: pages.showFewer,
      }}
    />
  );
}
