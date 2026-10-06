"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import { INSTALLER_CONTENT_FRAME_CLASS, INSTALLER_SHELL_GUTTER_CLASS } from "@/features/installer-dashboard-preview/installer-layout";
import { InstallerJobOpportunitiesView } from "./installer-job-opportunities-view";
import { previewTradeOptions, toPreviewCardVM } from "./preview-adapter";
import {
  PREVIEW_BUDGET_CEILING,
  PREVIEW_OPPORTUNITIES,
  filterPreviewOpportunities,
  type TradeKey,
} from "./preview-data";
import { DEFAULT_BOARD_FILTERS, type BoardFilters, type BoardSort } from "./view-model";

const PREVIEW_SORTS: readonly BoardSort[] = ["newest", "nearest", "highest", "demanded"];

/**
 * THE PREVIEW WRAPPER: the preview's own shell, local state and fixtures around
 * the shared `InstallerJobOpportunitiesView`. Production never imports this file.
 */
export function InstallerJobOpportunitiesPreview({
  theme,
  sidebarMode,
}: {
  theme: "light" | "dark";
  sidebarMode: SidebarMode;
}) {
  const { locale, dir } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sort, setSort] = useState<BoardSort>("newest");
  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_BOARD_FILTERS);
  const [savedOnly, setSavedOnly] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(PREVIEW_OPPORTUNITIES.filter((opportunity) => opportunity.initiallySaved).map((opportunity) => opportunity.id)),
  );
  const [appliedIds, setAppliedIds] = useState<Set<string>>(() => new Set());

  const cards = useMemo(
    () =>
      filterPreviewOpportunities(PREVIEW_OPPORTUNITIES, {
        sort,
        trades: new Set(filters.tradeKeys as TradeKey[]),
        maxBudget: filters.maxAmount ?? PREVIEW_BUDGET_CEILING,
        duration: filters.duration,
        radiusKm: filters.radiusKm,
        savedOnly,
        savedIds,
      }).map((opportunity) => toPreviewCardVM(opportunity, locale)),
    [filters, locale, savedIds, savedOnly, sort],
  );
  const tradeOptions = useMemo(() => previewTradeOptions(locale), [locale]);
  const n = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG").format(cards.length);

  return (
    <div dir={dir} className="installer-surface flex min-h-dvh bg-workspace wide:fixed wide:inset-0 wide:h-dvh wide:overflow-hidden">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        previewActiveItemId="jobs"
      />

      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col gap-sm pb-md pt-sm`}>
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />

        <main id="opportunities" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex min-h-0 flex-1 flex-col gap-md pb-md pt-xs tablet:pb-lg wide:overflow-hidden`}>
          <InstallerJobOpportunitiesView
            scroll="contained"
            opportunities={cards}
            countLabel={locale === "ar" ? `${n} فرصة متاحة` : `${n} opportunities available`}
            filters={filters}
            onFiltersChange={setFilters}
            sort={sort}
            onSortChange={setSort}
            sortOptions={PREVIEW_SORTS}
            tradeOptions={tradeOptions}
            governorates={[]}
            preview={{
              savedIds,
              onToggleSaved: (id) =>
                setSavedIds((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                }),
              savedOnly,
              onSavedOnlyChange: setSavedOnly,
              appliedIds,
              onApply: (id) => setAppliedIds((current) => new Set(current).add(id)),
              budgetCeiling: PREVIEW_BUDGET_CEILING,
            }}
          />
        </main>
      </div>
    </div>
  );
}
