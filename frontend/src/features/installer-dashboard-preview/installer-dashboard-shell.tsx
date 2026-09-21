"use client";

import { useState, type ReactNode } from "react";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { InstallerSidebar } from "./installer-sidebar";
import { InstallerTopbar } from "./installer-topbar";
import type { InstallerOpportunityVM } from "./view-model";

/** Production shell for every installer route under `/home`. */
export function InstallerDashboardShell({
  children,
  theme,
  sidebarMode,
  displayName,
  location,
  searchJobs,
  context,
}: {
  children: ReactNode;
  theme: "light" | "dark";
  sidebarMode: SidebarMode;
  displayName: string;
  location: string | null;
  /** Real, bounded opportunities the shared search overlay can jump to. */
  searchJobs: readonly InstallerOpportunityVM[];
  context?: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        production
      />
      <div className="flex min-w-0 flex-1 flex-col tablet:gap-6 tablet:pb-10 tablet:pe-3 tablet:ps-3 tablet:pt-6 desktop:pe-4 desktop:ps-4 desktop:pt-8">
        <InstallerTopbar
          theme={theme}
          onMenuClick={() => setMobileNavOpen(true)}
          displayName={displayName}
          location={location}
          searchJobs={searchJobs}
          context={context}
          production
        />
        <main id="top" className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col p-4 tablet:p-6 desktop:p-7">
          {children}
        </main>
      </div>
    </div>
  );
}
