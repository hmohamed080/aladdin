"use client";

import { useState, type ReactNode } from "react";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { InstallerSidebar } from "./installer-sidebar";
import { InstallerTopbarCore } from "./installer-topbar-core";
import type { InstallerOpportunityVM } from "./view-model";
import { INSTALLER_CONTENT_FRAME_CLASS, INSTALLER_SHELL_GUTTER_CLASS } from "./installer-layout";

/** Production shell for every installer route under `/home`. */
export function InstallerDashboardShell({
  children,
  theme,
  sidebarMode,
  displayName,
  location,
  searchJobs,
}: {
  children: ReactNode;
  theme: "light" | "dark";
  sidebarMode: SidebarMode;
  displayName: string;
  location: string | null;
  /** Real, bounded opportunities the shared search overlay can jump to. */
  searchJobs: readonly InstallerOpportunityVM[];
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    // `installer-surface` scopes the approved Installer palette
    // (`styles/installer-theme.css`) to this shell and everything inside it, so
    // no other persona's chrome is touched.
    <div className="installer-surface flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        production
      />
      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col tablet:gap-6 tablet:pb-10 tablet:pt-6 desktop:pt-8`}>
        <InstallerTopbarCore
          theme={theme}
          onMenuClick={() => setMobileNavOpen(true)}
          displayName={displayName}
          location={location}
          searchJobs={searchJobs}
          production
        />
        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col py-4 tablet:py-6 desktop:py-7`}>
          {children}
        </main>
      </div>
    </div>
  );
}
