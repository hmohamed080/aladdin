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
  const { dir } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div dir={dir} className="flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col tablet:ps-3 tablet:pe-3 tablet:pt-6 tablet:gap-6 tablet:pb-10 desktop:ps-4 desktop:pe-4 desktop:pt-8">
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />

        <main id="top" className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 p-4 tablet:p-6 desktop:p-7">
          <InstallerWelcome />
          <ProfileCompletionBanner />
          <JobOpportunitiesSection />

          <div className="grid items-stretch gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
            <NeedsAttentionSection />
            <BrandEcosystemSection />
            <LearningSection />
            <RewardsCard />
          </div>
        </main>
      </div>
    </div>
  );
}
