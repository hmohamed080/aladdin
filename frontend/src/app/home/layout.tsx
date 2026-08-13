import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { THEME_COOKIE } from "@/lib/theme/config";
import { getMessages } from "@/lib/i18n/translate";
import { getWorkspaces } from "@/server/queries/workspace";
import { PERSONAL_CONTEXT } from "@/lib/workspace/model";
import { Brand } from "@/components/layout/brand";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { SignOutButton } from "@/components/layout/account-menu";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";

export const dynamic = "force-dynamic";

/**
 * Personal home chrome — deliberately NOT the B2B workspace shell. A consumer, or
 * an individual professional, works here and never in the Sales cockpit.
 *
 * The workspace switcher is the one piece of workspace chrome that belongs here:
 * a person who also owns or works in a business must be able to reach it from
 * their personal surface, and a person who has none needs somewhere to add their
 * first — which is why it is present even for a lone Personal context.
 */
export default async function HomeLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  const m = getMessages(locale);
  const { entries } = await getWorkspaces();

  return (
    <I18nProvider locale={locale} dir={dir}>
      <div className="flex min-h-dvh flex-col bg-canvas">
        <header className="sticky top-0 z-header border-b bg-surface/85 backdrop-blur" style={{ zIndex: 200 }}>
          <div className="mx-auto flex w-full max-w-[900px] items-center gap-md px-md py-2.5">
            <Brand name={m.common.appName} size="sm" />
            <div className="ms-auto flex items-center gap-sm">
              <WorkspaceSwitcher entries={entries} activeKey={PERSONAL_CONTEXT} />
              <LanguageSwitch />
              <ThemeSwitch current={theme} />
              <SignOutButton />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[900px] flex-1 px-md py-xl" id="main">
          {children}
        </main>
      </div>
    </I18nProvider>
  );
}
