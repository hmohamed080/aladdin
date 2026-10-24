import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import type { WorkspaceContext } from "@/server/queries/context";
import { BranchSwitcher, WorkspaceContextMobile } from "@/components/layout/context-switchers";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { WorkplaceSwitcher } from "@/components/layout/workplace-switcher";
import { showsGenericWorkspaceSwitcher } from "@/lib/workspace/entitlements";
import { personalEntry } from "@/lib/workspace/model";
import { AppHeader, HeaderSeparator } from "@/components/layout/app-header";
import { WorkspaceNavPanel, MobileNav } from "@/components/layout/workspace-nav";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { AppShell } from "@/components/layout/app-shell";
import { SalesRealtime } from "@/features/sales/sales-realtime";
import { SIDEBAR_MODE_COOKIE, resolveSidebarMode } from "@/lib/ui/sidebar-mode";
import { commerceStance } from "@/lib/workspace/supply-side";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadMarketplaceSellerStatus } from "@/server/queries/marketplace-seller";
import { MARKETPLACE_SELL_ENTITLEMENT } from "@/lib/nav/modules";
import { isMarketplacePreviewEnabled } from "@/lib/env";
import { Brand2026BodyScope } from "@/components/layout/brand-2026-scope";
import { BRAND_2026_SCOPE_CLASS } from "@/lib/brand/surface";

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
  orgDisplayName,
  branchDisplayName,
}: {
  workspace: WorkspaceContext;
  children: ReactNode;
  /** The active organization's own Arabic/English name, already resolved for the caller's locale — see `WorkspaceSwitcher`'s `activeDisplayName`. */
  orgDisplayName?: string | null;
  /** The active (single) branch's own Arabic/English name, when there is exactly one in scope — see `BranchSwitcher`'s `activeDisplayName`. */
  branchDisplayName?: string | null;
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
  // Marketplace selling is an ADMIN-GRANTED entitlement of the organization, not a
  // membership capability: the module is drawn only for an approved seller. The
  // membership capabilities themselves are passed on untouched everywhere else.
  const sellerStatus = await loadMarketplaceSellerStatus(await getServerSupabase(), active.organizationId);
  const navCapabilities =
    sellerStatus === "approved" ? [...active.capabilities, MARKETPLACE_SELL_ENTITLEMENT] : active.capabilities;

  // THE 2026 BRAND DIRECTION, PREVIEWED ON THE WHOLE WORKSPACE. Behind the same
  // flag as the Marketplace preview, so a closed environment keeps the current
  // design system untouched. It is presentation only: the palette scope and the
  // 2026 lockup. Navigation, access and data are identical either way.
  const brand2026 = isMarketplacePreviewEnabled();
  const brandEdition = brand2026 ? ("2026" as const) : ("classic" as const);

  const shell = (
    <AppShell
      nav={
        /* The panel supplies the material, the gutter, the display modes and the
           carve; `Sidebar` supplies the modules. The shell asks only for a
           renderer and hands back its live display state — see `SidebarShell`'s
           `nav` prop for why that indirection exists. */
        <SidebarShell
          mode={sidebarMode}
          appName={m.common.appName}
          brandEdition={brandEdition}
          nav={<WorkspaceNavPanel allowed={navCapabilities} stance={stance} />}
        />
      }
      header={
        <AppHeader
          appName={m.common.appName}
          brandEdition={brandEdition}
          capabilities={navCapabilities}
          stance={stance}
          hasWorkspace
          workspaceLabel={orgDisplayName ?? active.organizationName}
          orgId={active.organizationId}
          preferencesHref="/b2b/settings"
          /* The floating form. The brand is NOT drawn here in this variant — it
             lives at the head of the sidebar, where it only has to be drawn
             once. */
          variant="card"
          context={
            <>
              {/* The generic switcher is for the approved five categories. Everyone
                  else who genuinely belongs here — an employee, a salesperson in
                  an affiliated showroom — keeps moving between their workplaces
                  through the narrow control, with no Add business and no
                  ownership framing. Membership access itself is untouched. */}
              {showsGenericWorkspaceSwitcher({
                persona: personalEntry(workspace.entries)?.persona ?? null,
                entries: workspace.entries,
              }) ? (
                <WorkspaceSwitcher
                  entries={workspace.entries}
                  activeKey={active.organizationId}
                  activeDisplayName={orgDisplayName}
                />
              ) : (
                <WorkplaceSwitcher
                  entries={workspace.entries}
                  activeKey={active.organizationId}
                  activeDisplayName={orgDisplayName}
                />
              )}
              {/* The branch is a scope INSIDE the organization, so it reads as
                  the next crumb rather than as a second, unrelated chip. */}
              <HeaderSeparator />
              <BranchSwitcher
                branches={active.branches}
                activeId={active.activeBranchId}
                orgWide={orgWide}
                activeDisplayName={branchDisplayName}
              />
            </>
          }
          mobileContext={
            <WorkspaceContextMobile
              orgLabel={m.nav.organization}
              orgName={orgDisplayName || active.organizationName}
              branchLabel={m.nav.branch}
              branchName={active.branches.length <= 1 ? (branchDisplayName || active.branches[0]?.name || null) : null}
              branchSelector={
                active.branches.length > 1 ? (
                  <BranchSwitcher branches={active.branches} activeId={active.activeBranchId} orgWide={orgWide} />
                ) : undefined
              }
            />
          }
          actions={<SalesRealtime orgId={active.organizationId} branchId={active.activeBranchId} />}
        />
      }
      mobileNav={<MobileNav allowed={navCapabilities} stance={stance} />}
    >
      {children}
    </AppShell>
  );

  if (!brand2026) return shell;
  return (
    // `contents` keeps the wrapper out of layout; the palette tokens still inherit through it.
    <div className={`${BRAND_2026_SCOPE_CLASS} contents`}>
      <Brand2026BodyScope />
      {shell}
    </div>
  );
}
