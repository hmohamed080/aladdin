"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { InstallerMyWorkView } from "@/features/installer-my-work-preview/installer-my-work-view";
import type { ActiveWorkVM, WorkRowVM, WorkSort, WorkTabVM } from "@/features/installer-my-work-preview/view-model";
import { ALL_TAB } from "./installer-work-data";

/** Real orderings only: the default (newest assignment first), the same reversed, and last progress report. */
const PRODUCTION_SORTS: readonly WorkSort[] = ["default", "recent-added", "oldest-first", "last-action"];

/**
 * The real `/home/work` page body: the shared View, with the status tab held in the
 * URL (`?state=`) so the summary rail, the dashboard and other pages can deep-link
 * to it. Search, company, planned-period range and ordering are views over the rows
 * already in hand and live inside the View.
 */
export function InstallerWorkBoard({
  activeWork,
  rows,
  tabs,
  activeTab,
  rail,
  subtitle,
  headerAction,
}: {
  activeWork: ActiveWorkVM | null;
  rows: readonly WorkRowVM[];
  tabs: readonly WorkTabVM[];
  activeTab: string;
  rail: ReactNode;
  subtitle: string;
  headerAction: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useI18n();

  return (
    <InstallerMyWorkView
      activeWork={activeWork}
      rows={rows}
      tabs={tabs}
      activeTab={activeTab}
      defaultTab={ALL_TAB}
      onTabChange={(key) => router.replace(key === ALL_TAB ? pathname : `${pathname}?state=${encodeURIComponent(key)}`)}
      rail={rail}
      sortOptions={PRODUCTION_SORTS}
      subtitle={subtitle}
      headerAction={headerAction}
      // The range is the PLANNED WORK WINDOW (starts_on -> ends_by), and the control says so.
      datePlaceholder={locale === "ar" ? "فترة التنفيذ" : "Planned period"}
    />
  );
}
