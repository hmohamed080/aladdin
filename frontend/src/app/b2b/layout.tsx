import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { THEME_COOKIE } from "@/lib/theme/config";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/server/queries/context";
import { personalEntry } from "@/lib/workspace/model";
import { AppShell } from "@/components/layout/app-shell";
import { NoOrgNotice } from "@/components/layout/no-org-notice";

export const dynamic = "force-dynamic";

/**
 * The authenticated B2B workspace shell. Middleware guarantees a session before
 * this renders. Organization/branch context is DERIVED from real memberships
 * (no role switcher, no persona switcher).
 *
 * A caller who cannot work in ANY business here — they never had a membership, or
 * the one they had was suspended/revoked — is resolved safely rather than shown a
 * broken workspace: to their Personal home when they have one, otherwise to a
 * clear notice. Direct navigation therefore cannot reach an organization the
 * caller no longer belongs to.
 */
export default async function B2BLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  const supabase = await getServerSupabase();
  const workspace = await loadWorkspaceContext(supabase);

  if (!workspace.active && personalEntry(workspace.entries)) redirect("/home");

  /* DESIGN-LAB PROTOTYPE GATE — TEMPORARY, ONE ACCOUNT ONLY.
     A visual-refresh pass reviewed live rather than as static shots. Gated on
     the signed-in email so every other account renders byte-identical chrome;
     nothing here changes data, capabilities, or business behavior. This is a
     working-tree prototype, not a shipped preference — remove once the
     direction is approved instead of promoting the flag. */
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const designLabAtmosphere = user?.email === "fady@example.test";

  return (
    <I18nProvider locale={locale} dir={dir}>
      {workspace.active ? (
        <AppShell workspace={workspace} designLabAtmosphere={designLabAtmosphere}>
          {children}
        </AppShell>
      ) : (
        <NoOrgNotice theme={theme} />
      )}
    </I18nProvider>
  );
}
