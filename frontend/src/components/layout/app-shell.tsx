import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import type { WorkspaceContext } from "@/server/queries/context";
import { BranchSwitcher } from "@/components/layout/context-switchers";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { AppHeader, HeaderSeparator } from "@/components/layout/app-header";
import { MobileNav } from "@/components/layout/workspace-nav";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { SalesRealtime } from "@/features/sales/sales-realtime";
import { SIDEBAR_MODE_COOKIE, resolveSidebarMode } from "@/lib/ui/sidebar-mode";
import { commerceStance } from "@/lib/workspace/supply-side";
import { contentColumnClass } from "@/components/layout/content-column";
import { cn } from "@/lib/ui/cn";

/**
 * The B2B workspace chrome: a persistent left sidebar (brand + primary nav) on
 * desktop/tablet, the SHARED authenticated header (`AppHeader`) carrying search,
 * org/branch context and the account menu, and a fixed bottom nav on mobile.
 *
 * The header is the same component the personal `/home` workspace and the Admin
 * console render — this shell only supplies what is specific to a business
 * context: which switchers go in the context slot, and which live control goes
 * in the actions slot. Language, appearance and sign-out are no longer three
 * loose buttons here; they live in the account menu the header owns.
 *
 * Navigation reflects ONLY implemented modules; access is still enforced
 * server-side on every page.
 */
export async function AppShell({
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
    // Header ABOVE, then a row of sidebar + content. The header is global chrome
    // and spans the viewport; the sidebar navigates the region beneath it.
    <div className="flex min-h-dvh flex-col bg-canvas">
      <AppHeader
        appName={m.common.appName}
        capabilities={active.capabilities}
        stance={stance}
        hasWorkspace
        workspaceLabel={active.organizationName}
        preferencesHref="/b2b/settings"
        context={
          <>
            <WorkspaceSwitcher entries={workspace.entries} activeKey={active.organizationId} />
            {/* The branch is a scope INSIDE the organization, so it reads as the
                next crumb rather than as a second, unrelated chip. */}
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

      <div className="flex min-w-0 flex-1">
        {/* Persistent sidebar (desktop / tablet). Owns its own display modes. */}
        <SidebarShell allowed={active.capabilities} mode={sidebarMode} stance={stance} />

        <div className="flex min-w-0 flex-1 flex-col">
          <main className={cn(contentColumnClass, "py-lg pb-24 tablet:pb-xl")} id="main">
            {children}
          </main>

          <MobileNav allowed={active.capabilities} stance={stance} />
        </div>
      </div>
    </div>
  );
}
