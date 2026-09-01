import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import type { WorkspaceContext } from "@/server/queries/context";
import { BranchSwitcher } from "@/components/layout/context-switchers";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { AppHeader, HeaderSeparator } from "@/components/layout/app-header";
import { WorkspaceNavPanel, MobileNav } from "@/components/layout/workspace-nav";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { AppShell } from "@/components/layout/app-shell";
import { SalesRealtime } from "@/features/sales/sales-realtime";
import { SIDEBAR_MODE_COOKIE, resolveSidebarMode } from "@/lib/ui/sidebar-mode";
import { commerceStance } from "@/lib/workspace/supply-side";

/**
 * The B2B WORKSPACE assembly — what fills the shared shell for an organization.
 *
 * This file is what `AppShell` used to be. The split is the point: everything
 * about the GROUND (frame, atmosphere, apertures, content measure, header
 * placement, mobile behaviour) moved to `AppShell`, and what stayed here is only
 * the part that is genuinely about a workspace — capabilities, commerce stance,
 * branch scope, the sales realtime channel.
 *
 * NOTHING VISUAL CHANGED IN THIS SPLIT, deliberately. The B2B workspace is the
 * approved reference, so it migrates FIRST and any regression here is a
 * regression in the reference itself — which is exactly why it is the migration
 * to do first rather than last. Same sidebar, same modes, same carve, same
 * apertures, same header, same mobile navigation.
 *
 * Navigation reflects ONLY implemented modules; access is still enforced
 * server-side on every page.
 */
export async function WorkspaceShell({
  workspace,
  children,
}: {
  workspace: WorkspaceContext;
  children: ReactNode;
}) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const active = workspace.active!;
  const orgWide = active.canManageSales || active.capabilities.includes("branch.manage");
  // Read on the server so the first paint already has the chosen width — the
  // preference is layout, and discovering it after hydration is a visible flash.
  const sidebarMode = resolveSidebarMode(store.get(SIDEBAR_MODE_COOKIE)?.value);
  // Which seat this organization leads from. Derived from the org's own
  // classification on the server, so the first paint is already correct — it is a
  // navigation ORDER, and rewriting the rail after hydration is a visible jump.
  const stance = commerceStance(active.orgType);

  return (
    <AppShell
      nav={
        /* The panel supplies the material, the gutter, the display modes and the
           carve; `Sidebar` supplies the modules. The shell asks only for a
           renderer and hands back its live display state — see `SidebarShell`'s
           `nav` prop for why that indirection exists. */
        <SidebarShell
          mode={sidebarMode}
          appName={m.common.appName}
          nav={<WorkspaceNavPanel allowed={active.capabilities} stance={stance} />}
        />
      }
      header={
        <AppHeader
          appName={m.common.appName}
          capabilities={active.capabilities}
          stance={stance}
          hasWorkspace
          workspaceLabel={active.organizationName}
          orgId={active.organizationId}
          preferencesHref="/b2b/settings"
          /* The floating form. The brand is NOT drawn here in this variant — it
             lives at the head of the sidebar, where it only has to be drawn
             once. */
          variant="card"
          context={
            <>
              <WorkspaceSwitcher entries={workspace.entries} activeKey={active.organizationId} />
              {/* The branch is a scope INSIDE the organization, so it reads as
                  the next crumb rather than as a second, unrelated chip. */}
              <HeaderSeparator />
              <BranchSwitcher
                branches={active.branches}
                activeId={active.activeBranchId}
                orgWide={orgWide}
              />
            </>
          }
          actions={<SalesRealtime orgId={active.organizationId} branchId={active.activeBranchId} />}
        />
      }
      mobileNav={<MobileNav allowed={active.capabilities} stance={stance} />}
    >
      {children}
    </AppShell>
  );
}
