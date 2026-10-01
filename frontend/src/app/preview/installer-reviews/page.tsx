import type { Metadata } from "next";
import { cookies } from "next/headers";
import { InstallerReviewsPreview } from "@/features/installer-reviews-preview/installer-reviews-preview";
import { I18nProvider } from "@/lib/i18n/context";
import { directionFor, LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { THEME_COOKIE, resolveTheme, resolveThemePreference } from "@/lib/theme/config";
import { SIDEBAR_MODE_COOKIE, resolveSidebarMode } from "@/lib/ui/sidebar-mode";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Installer reviews preview | Aladdin",
  robots: { index: false, follow: false },
};

/** Presentation-only reference preview. No production query, action, or Supabase module is imported. */
export default async function InstallerReviewsPreviewPage() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const themePreference = resolveThemePreference(store.get(THEME_COOKIE)?.value);
  const sidebarMode = resolveSidebarMode(store.get(SIDEBAR_MODE_COOKIE)?.value);

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <InstallerReviewsPreview theme={resolveTheme(themePreference)} sidebarMode={sidebarMode} />
    </I18nProvider>
  );
}
