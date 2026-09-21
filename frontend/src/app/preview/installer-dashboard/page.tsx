import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { THEME_COOKIE, resolveTheme, resolveThemePreference } from "@/lib/theme/config";
import { SIDEBAR_MODE_COOKIE, resolveSidebarMode } from "@/lib/ui/sidebar-mode";
import { I18nProvider } from "@/lib/i18n/context";
import { InstallerDashboardPreview } from "@/features/installer-dashboard-preview/installer-dashboard-preview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Installer dashboard preview | Aladdin",
  robots: { index: false, follow: false },
};

/**
 * PHASE 1 PREVIEW — the redesigned craftsman/technician dashboard, on its own
 * route, disconnected from the real data layer.
 *
 * WHY THIS EXISTS AS A SEPARATE ROUTE RATHER THAN CHANGES TO `/home`
 * The live craftsman dashboard (`/home` → `ProfessionalHome`, see
 * `src/features/home/professional-home.tsx`) reads five real Supabase-backed
 * queries (`listMyAssignments`, `listJobOpportunities`, `getPointsBalance`,
 * `loadMyReviewSummary`, `listMyNetworkOrganizations`) behind auth and
 * onboarding-state redirects. None of that is touched here — this file does
 * not import a single `server/queries/*` module, and `/home` keeps its exact
 * current behavior in both light and dark mode. This page exists purely to
 * reach a UI/UX direction the founder can review before any of it is wired
 * to real data (see the redesign task's own written scope).
 *
 * EVERYTHING RENDERED BELOW IS MOCK DATA — see `mock-data.ts` in the feature
 * folder. Phase 2 replaces that file's exports with the real query layer and
 * folds the approved composition back into `/home`; nothing here is meant to
 * ship as-is.
 *
 * Locale, theme, and sidebar-mode cookies are read (read-only) so the preview
 * opens with the visitor's own presentation preferences, exactly like every
 * other authenticated surface — this is presentation continuity, not a
 * dependency on product state.
 */
export default async function InstallerDashboardPreviewPage() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const themePreference = resolveThemePreference(store.get(THEME_COOKIE)?.value);
  const sidebarMode = resolveSidebarMode(store.get(SIDEBAR_MODE_COOKIE)?.value);

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <InstallerDashboardPreview theme={resolveTheme(themePreference)} sidebarMode={sidebarMode} />
    </I18nProvider>
  );
}
