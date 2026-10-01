import type { Metadata } from "next";
import { cookies } from "next/headers";
import { InstallerPointsPreview } from "@/features/installer-points-preview/installer-points-preview";
import { I18nProvider } from "@/lib/i18n/context";
import { directionFor, LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { resolveTheme, resolveThemePreference, THEME_COOKIE } from "@/lib/theme/config";
import { resolveSidebarMode, SIDEBAR_MODE_COOKIE } from "@/lib/ui/sidebar-mode";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Installer points preview | Aladdin",
  robots: { index: false, follow: false },
};

export default async function InstallerPointsPreviewPage() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const themePreference = resolveThemePreference(store.get(THEME_COOKIE)?.value);
  const sidebarMode = resolveSidebarMode(store.get(SIDEBAR_MODE_COOKIE)?.value);

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <InstallerPointsPreview theme={resolveTheme(themePreference)} sidebarMode={sidebarMode} />
    </I18nProvider>
  );
}
