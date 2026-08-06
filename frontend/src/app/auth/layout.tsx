import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { THEME_COOKIE } from "@/lib/theme/config";
import { I18nProvider } from "@/lib/i18n/context";
import { getMessages } from "@/lib/i18n/translate";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { Brand } from "@/components/layout/brand";
import { AuthBrandPanel } from "@/features/auth/brand-panel";

/**
 * Auth chrome: a professional split panel on desktop (Brand Panel + Form Panel),
 * and a compact single column on tablet/mobile. The form panel carries the
 * language and theme switchers so a visitor can set their preference before
 * signing in. Arabic-first, RTL-correct, light/dark.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  const m = getMessages(locale);

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <div className="grid min-h-dvh bg-canvas desktop:grid-cols-2">
        <AuthBrandPanel name={m.common.appName} tagline={m.auth.brandTagline} note={m.auth.brandNote} />

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

          <main className="flex flex-1 items-center justify-center px-md pb-xl">
            <div className="w-full max-w-md">{children}</div>
          </main>
        </div>
      </div>
    </I18nProvider>
  );
}
