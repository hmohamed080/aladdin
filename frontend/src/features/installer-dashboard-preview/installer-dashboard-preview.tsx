"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { InstallerSidebar } from "./installer-sidebar";
import { InstallerTopbar } from "./installer-topbar";
import { InstallerWelcome } from "./installer-welcome";
import { ProfileCompletionBanner } from "./profile-completion-banner";
import { JobOpportunitiesSection } from "./job-opportunities-section";
import { NeedsAttentionSection } from "./needs-attention-section";
import { BrandEcosystemSection } from "./brand-ecosystem-section";
import { LearningSection } from "./learning-section";
import { RewardsCard } from "./rewards-card";
import { INSTALLER_CONTENT_FRAME_CLASS, INSTALLER_SHELL_GUTTER_CLASS } from "./installer-layout";
import {
  mockBrandEcosystem,
  mockLearning,
  mockNeedsAction,
  mockOpportunities,
  mockProfileCompletion,
  mockRewards,
  mockWelcome,
} from "./mock-data";

/**
 * THE PREVIEW ROOT — ported onto the SAME shell contract as staging's AppShell.
 *
 * Staging structure (from app-shell.tsx + globals.css):
 *   workspace-frame
 *     workspace-atmosphere
 *     nav (SidebarShell — provides its own gutter)
 *     main column (tablet:ps-0 tablet:gap-6 tablet:pt-8 tablet:pe-3.5 tablet:pb-10)
 *       header (data-app-header="card" → globals.css applies translucent sticky card)
 *       main (workspace-body)
 *
 * The preview does not use the production SidebarShell (no gutter), so the main
 * column uses logical `ps`/`pe` for equal bilateral gaps that work in BOTH LTR
 * and RTL — `ps` is always the side facing the sidebar, `pe` the viewport edge.
 */
export function InstallerDashboardPreview({
  theme,
  sidebarMode,
}: {
  theme: "light" | "dark";
  sidebarMode: SidebarMode;
}) {
  const { locale, dir } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const learning = mockLearning();

  return (
    <div dir={dir} className="installer-surface flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col tablet:gap-6 tablet:pb-10 tablet:pt-6 desktop:pt-8`}>
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />

        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col gap-5 py-4 tablet:py-6 desktop:py-7`}>
          <ProfileCompletionBanner data={mockProfileCompletion()} />
          <InstallerWelcome data={mockWelcome(locale)} />
          <JobOpportunitiesSection
            opportunities={mockOpportunities()}
            emptyTitle={locale === "ar" ? "لا توجد فرص مطابقة" : "No matching opportunities"}
            emptyBody={locale === "ar" ? "حاول تغيير الفلاتر أو راجع لاحقًا." : "Try different filters or check back later."}
            viewAllHref="https://aladdindecore.com/home/jobs"
          />

          <div
            data-lower-module-grid=""
            className="grid min-h-0 items-stretch gap-4 tablet:grid-cols-2 desktop:grid-cols-[minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1.55fr)_minmax(0,0.95fr)] desktop:grid-rows-1"
          >
            <RewardsCard data={mockRewards(locale)} />
            <LearningSection featured={learning.featured} items={learning.items} />
            <BrandEcosystemSection items={mockBrandEcosystem()} />
            <NeedsAttentionSection items={mockNeedsAction()} />
          </div>
        </main>
      </div>
    </div>
  );
}
