import type { ReactNode } from "react";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale } from "@/lib/i18n/config";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/i18n/config";
import type { WorkspaceContext } from "@/server/queries/context";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { OrgSwitcher, BranchSwitcher } from "@/components/layout/context-switchers";
import { AccountMenu } from "@/components/layout/account-menu";
import { WorkspaceNav } from "@/components/layout/workspace-nav";
import { SalesRealtime } from "@/features/sales/sales-realtime";

/**
 * The B2B workspace chrome: a top bar (brand, org/branch context, language/
 * theme, account) and a primary nav that reflects ONLY this sprint's modules
 * (Home, Customers, Leads, Follow-ups). No dead links, no modules the caller
 * can't use.
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

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header
        className="sticky top-0 z-header border-b bg-surface/95 backdrop-blur"
        style={{ zIndex: 200 }}
      >
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-md px-md py-2">
          <span className="font-display-ar text-title text-fg">{m.common.appName}</span>

          <div className="hidden items-center gap-sm tablet:flex">
            <OrgSwitcher orgs={workspace.organizations} activeId={active.organizationId} />
            <BranchSwitcher
              branches={active.branches}
              activeId={active.activeBranchId}
              orgWide={active.canManageSales || active.capabilities.includes("branch.manage")}
            />
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

        {/* Context switchers move below the bar on small screens. */}
        <div className="flex items-center gap-sm border-t px-md py-2 tablet:hidden">
          <OrgSwitcher orgs={workspace.organizations} activeId={active.organizationId} />
          <BranchSwitcher
            branches={active.branches}
            activeId={active.activeBranchId}
            orgWide={active.canManageSales || active.capabilities.includes("branch.manage")}
          />
        </div>

        <WorkspaceNav />
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-md py-lg" id="main">
        {children}
      </main>
    </div>
  );
}
