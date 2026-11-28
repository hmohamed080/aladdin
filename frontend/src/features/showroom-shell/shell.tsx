"use client";

import { Suspense, useState, type ReactNode } from "react";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { INSTALLER_CONTENT_FRAME_CLASS, INSTALLER_SHELL_GUTTER_CLASS } from "@/features/installer-dashboard-preview/installer-layout";
import { ShowroomSidebar } from "./sidebar";
import { ShowroomTopbar } from "./topbar";

/** Isolated composition of the production craftsman frame; no alternate theme. */
export function ShowroomShell({ children, theme, sidebarMode, displayName, location, capabilities, workspaceSwitch, notifications, chat, branchSwitch, banner }: {
  children: ReactNode;
  /** Shown above the page (the "pending Admin approval" status). */
  banner?: ReactNode;
  theme: "light" | "dark";
  sidebarMode: SidebarMode;
  displayName: string;
  location: string | null;
  capabilities: readonly string[];
  workspaceSwitch: ReactNode;
  notifications: ReactNode;
  chat: ReactNode;
  branchSwitch?: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <div className="installer-surface flex min-h-dvh bg-workspace">
      <ShowroomSidebar initialMode={sidebarMode} mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} capabilities={capabilities} />
      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col tablet:gap-6 tablet:pb-10 tablet:pt-6 desktop:pt-8`}>
        <ShowroomTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} displayName={displayName} location={location} capabilities={capabilities} workspaceSwitch={workspaceSwitch} notifications={notifications} chat={chat} branchSwitch={branchSwitch} />
        {/* The boundary lets the page suspend during hydration (its code still loading) without React replaying
            <main> itself, which can throw a hydration mismatch (#418) when the code arrives in a different order. */}
        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col py-4 tablet:py-6 desktop:py-7`}><Suspense>{banner}{children}</Suspense></main>
      </div>
    </div>
  );
}
