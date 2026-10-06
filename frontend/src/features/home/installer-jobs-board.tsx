"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { InstallerJobOpportunitiesView } from "@/features/installer-job-opportunities-preview/installer-job-opportunities-view";
import type { BoardFilters, BoardSort, JobCardVM, TradeOption } from "@/features/installer-job-opportunities-preview/view-model";
import { toJobBoardSearch, type ProductionSort } from "@/lib/installer/job-board-filters";

const PRODUCTION_SORTS: readonly BoardSort[] = ["newest", "highest"];

/**
 * The real `/home/jobs` board: the shared View, controlled by the URL.
 *
 * The server page has already run the real query for these `filters` and `sort`.
 * A change here is only a navigation to the new canonical URL — `replace`, so the
 * back button is not buried under every checkbox — after which the server renders
 * the new result. No board state lives in this component.
 */
export function InstallerJobsBoard({
  opportunities,
  countLabel,
  filters,
  sort,
  tradeOptions,
  governorates,
  subtitle,
  headerAction,
}: {
  opportunities: readonly JobCardVM[];
  countLabel: string;
  filters: BoardFilters;
  sort: ProductionSort;
  tradeOptions: readonly TradeOption[];
  governorates: readonly string[];
  subtitle: string;
  headerAction: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
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
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  return (
    <InstallerJobOpportunitiesView
      scroll="page"
      opportunities={opportunities}
      countLabel={countLabel}
      filters={shownFilters}
      onFiltersChange={(next) => go(next, shownSort)}
      sort={shownSort}
      onSortChange={(next) => go(shownFilters, next === "highest" ? "highest" : "newest")}
      sortOptions={PRODUCTION_SORTS}
      tradeOptions={tradeOptions}
      governorates={governorates}
      subtitle={subtitle}
      headerAction={headerAction}
      pending={pending}
    />
  );
}
