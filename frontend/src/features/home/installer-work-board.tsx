"use client";

import { useMemo, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { InstallerMyWorkView } from "@/features/installer-my-work-preview/installer-my-work-view";
import type {
  ActiveWorkVM,
  SavedSearchStore,
  SavedWorkSearch,
  WorkRemote,
  WorkRowVM,
  WorkSearchState,
  WorkSort,
  WorkTabVM,
} from "@/features/installer-my-work-preview/view-model";
import { ALL_TAB, sanitizeWorkState, toWorkBoardSearch } from "@/lib/installer/work-board-params";
import { loadMoreWorkAction } from "@/server/actions/work-board";
import {
  createSavedSearchAction,
  deleteSavedSearchAction,
  updateSavedSearchAction,
  type SavedSearchActionResult,
} from "@/server/actions/saved-searches";
import { stateToFilters, workResultsTitle } from "./installer-work-data";
import { useCursorPages } from "./use-cursor-pages";

/** Real orderings only: the default (newest assignment first), the same reversed, and last progress report. */
const PRODUCTION_SORTS: readonly WorkSort[] = ["default", "recent-added", "oldest-first", "last-action"];

function saveErrorMessage(result: Extract<SavedSearchActionResult, { ok: false }>, ar: boolean): string {
  switch (result.code) {
    case "duplicate":
      return ar ? "يوجد بحث محفوظ بهذا الاسم بالفعل." : "You already have a saved search with that name.";
    case "limit":
      return ar ? "وصلت إلى الحد الأقصى من عمليات البحث المحفوظة. احذف بحثًا قبل إضافة آخر." : "You have reached the limit of saved searches. Delete one to add another.";
    case "invalid":
      return ar ? "تعذّر حفظ هذا البحث." : "This search could not be saved.";
    default:
      return ar ? "تعذّر حفظ البحث. حاول مرة أخرى." : "Could not save the search. Please try again.";
  }
}

/**
 * The real `/home/work` page body: the shared View, controlled by the URL.
 *
 * The server page has already asked the database for the FIRST page of exactly these
 * filters (`my_work_page`), so `rows` is that page and `total` is the exact filtered
 * count. A change of filter or sort is only a navigation to the new canonical URL —
 * `replace`, so the back button is not buried under every keystroke or checkbox —
 * after which the server renders the new first page. "Show more" asks the database for
 * the NEXT page of the same question, by cursor, and appends it (no ceiling, no offset); "Show less" drops the
 * last appended page. The appended pages belong to one first page: a new question or a
 * new first page discards them.
 *
 * SAVED SEARCHES are persisted (`saved_searches`): the list is what the server
 * rendered, a save or delete goes through the real action, and the page is
 * refreshed so the server's list takes over from the optimistic one.
 */
export function InstallerWorkBoard({
  activeWork,
  rows,
  tabs,
  state,
  search,
  total,
  nextCursor,
  companies,
  rail,
  subtitle,
  headerAction,
  savedSearches,
}: {
  activeWork: ActiveWorkVM | null;
  /** The FIRST page of the filtered, ordered assignments; later pages are appended here. */
  rows: readonly WorkRowVM[];
  tabs: readonly WorkTabVM[];
  /** The URL's state. */
  state: WorkSearchState;
  /** The canonical query string of `state`: the question the next page is asked of. */
  search: string;
  /** The exact number of assignments matching `state`. */
  total: number;
  /** The opaque cursor of the page after the first (null when the first page is the whole result). */
  nextCursor: string | null;
  /** The organizations the caller has work with. */
  companies: readonly string[];
  rail: ReactNode;
  subtitle: string;
  headerAction: ReactNode;
  savedSearches: readonly SavedWorkSearch[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useI18n();
  const ar = locale === "ar";
  const [pending, startTransition] = useTransition();
  // The URL (via the server) is the authority, but a control must answer the tap at once.
  const [shownState, setShownState] = useOptimistic(state);

  const go = (next: WorkSearchState) => {
    const clean = sanitizeWorkState(next);
    const qs = toWorkBoardSearch(clean);
    startTransition(() => {
      setShownState(clean);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  // PAGED APPEND BY CURSOR (see the header): pages loaded after the first, tied to the first page they belong to.
  const pageKey = `${search}|${rows.map((r) => r.id).join(",")}`;
  const pages = useCursorPages<WorkRowVM>({
    resetKey: pageKey,
    first: rows,
    firstNext: nextCursor,
    firstTotal: total,
    fetchPage: async (cursor) => {
      const result = await loadMoreWorkAction(search, cursor);
      return result.ok ? { ok: true, items: result.rows, next: result.nextCursor, total: result.total, extra: undefined } : { ok: false };
    },
  });
  const allRows = pages.items;
  const knownTotal = pages.total;
  const loading = pages.loading;
  const loadError = pages.error;

  const serverKey = JSON.stringify(savedSearches);
  const [local, setLocal] = useState<{ key: string; items: readonly SavedWorkSearch[] } | null>(null);
  const items = local && local.key === serverKey ? local.items : savedSearches;

  const store = useMemo<SavedSearchStore>(
    () => ({
      items,
      save: async ({ mode, id, name, state: toSave }) => {
        const filters = stateToFilters(toSave);
        const result =
          mode === "update" && id
            ? await updateSavedSearchAction(id, { name, filters })
            : await createSavedSearchAction("work", name, filters);
        if (!result.ok) return { ok: false, message: saveErrorMessage(result, ar) };
        const savedId = result.id ?? id ?? "";
        const entry: SavedWorkSearch = { id: savedId, name, state: toSave };
        setLocal({
          key: serverKey,
          items: mode === "update" && id ? items.map((item) => (item.id === id ? entry : item)) : [...items, entry],
        });
        router.refresh();
        return { ok: true, id: savedId };
      },
      remove: async (id) => {
        const result = await deleteSavedSearchAction(id);
        if (!result.ok) return { ok: false, message: saveErrorMessage(result, ar) };
        setLocal({ key: serverKey, items: items.filter((item) => item.id !== id) });
        router.refresh();
        return { ok: true };
      },
    }),
    [items, serverKey, ar, router],
  );

  const remote: WorkRemote = {
    state: shownState,
    onStateChange: (next) => go(next),
    total: knownTotal,
    companies,
    hasMore: pages.hasMore,
    canShowFewer: pages.canShowFewer,
    onShowMore: () => void pages.showMore(),
    onShowFewer: pages.showFewer,
    pending: pending || loading,
    loadError,
  };

  return (
    <InstallerMyWorkView
      activeWork={activeWork}
      rows={allRows}
      tabs={tabs}
      activeTab={shownState.tab}
      defaultTab={ALL_TAB}
      onTabChange={(key) => go({ ...shownState, tab: key })}
      rail={rail}
      sortOptions={PRODUCTION_SORTS}
      subtitle={subtitle}
      headerAction={headerAction}
      // The range is the PLANNED WORK WINDOW (starts_on -> ends_by), and the control says so.
      datePlaceholder={locale === "ar" ? "فترة التنفيذ" : "Planned period"}
      savedStore={store}
      contactMode="real"
      resultsTitle={workResultsTitle(shownState.tab, tabs, locale)}
      remote={remote}
    />
  );
}
