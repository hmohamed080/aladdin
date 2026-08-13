import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { THEME_COOKIE } from "@/lib/theme/config";
import { I18nProvider } from "@/lib/i18n/context";
import { getMessages } from "@/lib/i18n/translate";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { Brand } from "@/components/layout/brand";
import { SignOutButton } from "@/components/layout/account-menu";

/**
 * Business-creation chrome. Deliberately the same calm single column as
 * onboarding: creating a business is the same kind of focused task whether it
 * happens during registration or years later from the workspace menu, so it
 * should not feel like two different products.
 */
export default async function BusinessLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  const m = getMessages(locale);

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <div className="flex min-h-dvh flex-col bg-canvas">
        <header className="flex items-center gap-sm border-b bg-surface/85 px-md py-md backdrop-blur">
          <Brand name={m.common.appName} size="sm" />
          <div className="ms-auto flex items-center gap-sm">
            <LanguageSwitch />
            <ThemeSwitch current={theme} />
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-lg flex-1 items-center justify-center px-md py-xl">
          <div className="w-full">{children}</div>
        </main>
      </div>
    </I18nProvider>
  );
}
