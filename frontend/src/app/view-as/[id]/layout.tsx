import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { SIDEBAR_MODE_COOKIE, resolveSidebarMode } from "@/lib/ui/sidebar-mode";
import { THEME_COOKIE, resolveTheme, resolveThemePreference } from "@/lib/theme/config";
import { viewAsExactBasePath } from "@/lib/admin/view-as/registry";
import { ViewAsScopeProvider } from "@/components/navigation/scoped-link";
import { InstallerDashboardShell } from "@/features/installer-dashboard-preview/installer-dashboard-shell";
import { ViewAsBanner } from "@/features/admin-view-as/view-as-banner";
import { ViewAsReadOnlyRegion } from "@/features/admin-view-as/view-as-read-only-region";
import { requireViewAs } from "@/server/view-as/guard";
import { viewAsReader } from "@/server/view-as/account-reader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * "View as account", exact UI parity: the account's OWN shell (`InstallerDashboardShell`, as the account's own layout renders it)
 * filled with the subject's identity from `viewAsReader`, under a persistent banner and with NO Admin console chrome. The
 * Admin stays the signed-in principal; nothing here impersonates. Every page below re-establishes the gate itself
 * (`requireViewAs`), because a layout is not re-run on soft navigation.
 */
export default async function ViewAsLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireViewAs(id);
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const shell = await viewAsReader(session.subjectUserId, locale).shell();
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <ViewAsScopeProvider base={viewAsExactBasePath(session.subjectUserId)}>
        <ViewAsBanner
          tree="exact"
          subjectUserId={session.subjectUserId}
          subjectName={session.subjectName}
          kind={session.kind}
          expiresAt={session.expiresAt}
        />
        <InstallerDashboardShell
          theme={resolveTheme(resolveThemePreference(store.get(THEME_COOKIE)?.value))}
          sidebarMode={resolveSidebarMode(store.get(SIDEBAR_MODE_COOKIE)?.value)}
          displayName={shell.displayName}
          avatarUrl={shell.avatarUrl}
          location={shell.location}
          searchJobs={shell.searchJobs}
        >
          <ViewAsReadOnlyRegion>{children}</ViewAsReadOnlyRegion>
        </InstallerDashboardShell>
      </ViewAsScopeProvider>
    </I18nProvider>
  );
}
