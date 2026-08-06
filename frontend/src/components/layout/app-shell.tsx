import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import type { WorkspaceContext } from "@/server/queries/context";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { OrgSwitcher, BranchSwitcher } from "@/components/layout/context-switchers";
import { AccountMenu } from "@/components/layout/account-menu";
import { Sidebar, MobileNav } from "@/components/layout/workspace-nav";
import { Brand } from "@/components/layout/brand";
import { SalesRealtime } from "@/features/sales/sales-realtime";

/**
 * The B2B workspace chrome: a persistent left sidebar (brand + primary nav) on
 * desktop/tablet, a slim top bar carrying the org/branch context and the
 * language/theme/account controls, and a fixed bottom nav on mobile. Navigation
 * reflects ONLY this sprint's modules; access is still enforced server-side.
 * Behavior is unchanged — only the presentation and hierarchy are improved.
 */
export async function AppShell({
  workspace,
  theme,
  children,
}: {
  workspace: WorkspaceContext;
  theme: "light" | "dark";
  children: ReactNode;
}) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const active = workspace.active!;
  const orgWide = active.canManageSales || active.capabilities.includes("branch.manage");

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Persistent sidebar (desktop / tablet). */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e bg-surface px-3 py-lg tablet:flex">
        <div className="px-2 pb-lg">
          <Brand name={m.common.appName} size="md" />
        </div>
        <Sidebar />
        <p className="mt-auto px-3 pt-lg text-label text-fg-muted">{m.nav.workspace}</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-header border-b bg-surface/85 backdrop-blur"
          style={{ zIndex: 200 }}
        >
          <div className="flex flex-wrap items-center gap-md px-md py-2">
            {/* Brand shows in the top bar only on mobile (sidebar carries it above). */}
            <span className="tablet:hidden">
              <Brand name={m.common.appName} size="sm" />
            </span>

            <div className="hidden items-center gap-sm tablet:flex">
              <OrgSwitcher orgs={workspace.organizations} activeId={active.organizationId} />
              <BranchSwitcher branches={active.branches} activeId={active.activeBranchId} orgWide={orgWide} />
            </div>

            <div className="ms-auto flex items-center gap-sm">
              <div className="hidden tablet:block">
                <SalesRealtime orgId={active.organizationId} branchId={active.activeBranchId} />
              </div>
              <LanguageSwitch />
              <ThemeSwitch current={theme} />
              <AccountMenu orgName={active.organizationName} />
            </div>
          </div>

          {/* Org/branch context moves to its own row on mobile. */}
          <div className="flex items-center gap-sm border-t px-md py-2 tablet:hidden">
            <OrgSwitcher orgs={workspace.organizations} activeId={active.organizationId} />
            <BranchSwitcher branches={active.branches} activeId={active.activeBranchId} orgWide={orgWide} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1200px] flex-1 px-md py-lg pb-24 tablet:pb-xl" id="main">
          {children}
        </main>

        <MobileNav />
      </div>
    </div>
  );
}
