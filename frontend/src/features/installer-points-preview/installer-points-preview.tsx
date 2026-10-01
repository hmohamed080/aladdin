"use client";

import { useState } from "react";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import {
  INSTALLER_CONTENT_FRAME_CLASS,
  INSTALLER_SHELL_GUTTER_CLASS,
} from "@/features/installer-dashboard-preview/installer-layout";
import { useI18n } from "@/lib/i18n/context";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { PointSources, PointsHero, RecentHistory, Rewards, SummaryGrid } from "./points-sections";

export function InstallerPointsPreview({ theme, sidebarMode }: { theme: "light" | "dark"; sidebarMode: SidebarMode }) {
  const { locale, dir } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div dir={dir} data-installer-points-preview className="installer-surface flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        previewActiveItemId="rewards"
      />

      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col gap-4 pb-8 pt-2 tablet:pb-10 tablet:pt-3`}>
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />
        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col gap-md`}>
          <PointsHero locale={locale} />
          <SummaryGrid locale={locale} />
          <PointSources locale={locale} />
          <div className="grid min-w-0 gap-md wide:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]" dir="ltr">
            <Rewards locale={locale} />
            <RecentHistory locale={locale} />
          </div>
        </main>
      </div>
    </div>
  );
}
