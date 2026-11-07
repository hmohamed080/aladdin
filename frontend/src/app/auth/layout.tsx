import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { THEME_COOKIE } from "@/lib/theme/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { AuthStage } from "@/features/entry-auth/auth-stage";

/**
 * Auth chrome: the same composition as the showroom sign-in page (photo beside a
 * cream sheet, 2026 logo, scoped palette) for every /auth route. The sheet keeps
 * the language and theme switchers so a visitor can set their preference before
 * signing in. RTL/LTR follows the locale; light/dark follows the theme.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <AuthStage
        dir={directionFor(locale)}
        lang={locale}
        toolbar={
          <>
            <LanguageSwitch />
            <ThemeSwitch current={theme} />
          </>
        }
      >
        {children}
      </AuthStage>
    </I18nProvider>
  );
}
