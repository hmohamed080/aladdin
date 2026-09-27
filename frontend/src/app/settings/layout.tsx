import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { getMessages } from "@/lib/i18n/translate";
import { AppShell } from "@/components/layout/app-shell";
import { AppHeader } from "@/components/layout/app-header";

export const dynamic = "force-dynamic";

/**
 * Workspace-INDEPENDENT settings chrome. Everything under `/settings` is about
 * the person (one user id), never about a workspace, so it borrows neither the
 * Personal navigation (`/home`, which needs a personal persona) nor the B2B
 * navigation (`/b2b`, which needs an organization membership) — a
 * business-intent account with zero organizations has neither and must still
 * be able to edit its own identity. It stands on the canonical `AppShell`
 * ground with the canonical header and no navigation panel, so it is the same
 * product as every other signed-in surface.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <AppShell
        header={
          <AppHeader
            appName={m.common.appName}
            // No workspace here by design: the command palette stays
            // navigation-only and no business record search runs.
            hasWorkspace={false}
            workspaceLabel={null}
            variant="bar"
            preferencesHref="/settings/profile"
          />
        }
      >
        <div className="mx-auto w-full max-w-2xl px-md py-xl">{children}</div>
      </AppShell>
    </I18nProvider>
  );
}
