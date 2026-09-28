import type { Metadata } from "next";
import { cookies } from "next/headers";
import { InstallerAccountPreview } from "@/features/installer-account-preview/installer-account-preview";
import { I18nProvider } from "@/lib/i18n/context";
import { directionFor, LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { resolveTheme, resolveThemePreference, THEME_COOKIE } from "@/lib/theme/config";
import { resolveSidebarMode, SIDEBAR_MODE_COOKIE } from "@/lib/ui/sidebar-mode";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Installer account preview | Aladdin",
  robots: { index: false, follow: false },
};

export default async function InstallerAccountPreviewPage() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const themePreference = resolveThemePreference(store.get(THEME_COOKIE)?.value);
  const sidebarMode = resolveSidebarMode(store.get(SIDEBAR_MODE_COOKIE)?.value);

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <InstallerAccountPreview theme={resolveTheme(themePreference)} sidebarMode={sidebarMode} />
    </I18nProvider>
  );
}

