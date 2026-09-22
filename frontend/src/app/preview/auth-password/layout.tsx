import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { THEME_COOKIE } from "@/lib/theme/config";
import { I18nProvider } from "@/lib/i18n/context";
import { getMessages } from "@/lib/i18n/translate";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { Brand } from "@/components/layout/brand";
import { AuthBrandPanel } from "@/features/auth/brand-panel";

export const metadata: Metadata = {
  title: "Password sign-in preview | Aladdin",
  robots: { index: false, follow: false },
};

/**
 * ISOLATED PREVIEW (docs/frontend/auth-password-preview.md). Same split-panel
 * chrome as `/auth/layout.tsx` (reusing the generic Brand Panel, language and
 * theme switchers — none of which are passwordless-specific), rebuilt here
 * rather than imported so this preview can be reviewed, changed, or deleted
 * without touching the production auth layout. A visible banner makes clear
 * this is not the live registration/sign-in surface.
 */
export default async function AuthPasswordPreviewLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  const m = getMessages(locale);

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <div className="grid min-h-dvh bg-canvas desktop:grid-cols-2">
        <AuthBrandPanel name={m.common.appName} tagline={m.auth.brandTagline} note={m.authPasswordPreview.previewBanner} />

        <div className="flex min-h-dvh flex-col">
          <div className="flex items-center gap-sm px-md py-md">
            <span className="desktop:hidden">
              <Brand name={m.common.appName} size="sm" />
            </span>
            <div className="ms-auto flex items-center gap-sm">
              <LanguageSwitch />
              <ThemeSwitch current={theme} />
            </div>
          </div>

          <div role="status" className="mx-md rounded-md border border-warning/40 bg-warning/10 px-md py-2 text-center text-label text-warning">
            {m.authPasswordPreview.previewBanner}
          </div>

          <main className="flex flex-1 items-center justify-center px-md pb-xl pt-md">
            <div className="w-full max-w-md">{children}</div>
          </main>
        </div>
      </div>
    </I18nProvider>
  );
}
