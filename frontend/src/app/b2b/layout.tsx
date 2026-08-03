import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { THEME_COOKIE } from "@/lib/theme/config";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/server/queries/context";
import { AppShell } from "@/components/layout/app-shell";
import { NoOrgNotice } from "@/components/layout/no-org-notice";

export const dynamic = "force-dynamic";

/**
 * The authenticated B2B workspace shell. Middleware guarantees a session before
 * this renders. Organization/branch context is DERIVED from real memberships
 * (no role switcher). A caller with no active membership sees a clear notice.
 */
export default async function B2BLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  const supabase = await getServerSupabase();
  const workspace = await loadWorkspaceContext(supabase);

  return (
    <I18nProvider locale={locale} dir={dir}>
      {workspace.active ? (
        <AppShell workspace={workspace} theme={theme}>
          {children}
        </AppShell>
      ) : (
        <NoOrgNotice theme={theme} />
      )}
    </I18nProvider>
  );
}
