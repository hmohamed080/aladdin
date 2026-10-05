import type { Metadata } from "next";
import { cookies } from "next/headers";
import { InstallerSettingsPreview } from "@/features/installer-settings-preview/installer-settings-preview";
import { I18nProvider } from "@/lib/i18n/context";
import { directionFor, LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { resolveTheme, resolveThemePreference, THEME_COOKIE } from "@/lib/theme/config";
import { resolveSidebarMode, SIDEBAR_MODE_COOKIE } from "@/lib/ui/sidebar-mode";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Installer settings preview | Aladdin", robots: { index: false, follow: false } };

export default async function InstallerSettingsPage() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return <I18nProvider locale={locale} dir={directionFor(locale)}><InstallerSettingsPreview theme={resolveTheme(resolveThemePreference(store.get(THEME_COOKIE)?.value))} sidebarMode={resolveSidebarMode(store.get(SIDEBAR_MODE_COOKIE)?.value)} /></I18nProvider>;
}
