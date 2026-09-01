import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { getMessages } from "@/lib/i18n/translate";
import { getWorkspaces } from "@/server/queries/workspace";
import { loadIsSalesPersona } from "@/server/queries/sales-persona";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { personalNavKeys } from "@/lib/nav/personal-modules";
import { PersonalNavPanel, PersonalMobileNav } from "@/components/layout/personal-nav";
import { PERSONAL_CONTEXT, personalEntry } from "@/lib/workspace/model";
import { AppHeader } from "@/components/layout/app-header";
import { AppShell } from "@/components/layout/app-shell";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { SIDEBAR_MODE_COOKIE, resolveSidebarMode } from "@/lib/ui/sidebar-mode";

export const dynamic = "force-dynamic";

/**
 * Personal home chrome — now the SAME shell as the B2B workspace, filled with a
 * different navigation.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A REDESIGN
 * This layout used to write its own shell: `flex min-h-dvh flex-col bg-canvas`,
 * a horizontal rail under the header, and no atmosphere. That was one of five
 * hand-written copies of an unnamed shell, and it is why a personal account and
 * a showroom workspace read as two different products. The page compositions
 * below are untouched; only the ground and the navigation organ moved onto the
 * canonical foundation.
 *
 * A consumer, or an individual professional, works here and never in the Sales
 * cockpit — that remains true. It was never a reason for a different visual
 * language, only for a different list of destinations.
 *
 * The workspace switcher is the one piece of workspace chrome that belongs here:
 * a person who also owns or works in a business must be able to reach it from
 * their personal surface, and a person who has none needs somewhere to add their
 * first — which is why it is present even for a lone Personal context.
 *
 * THE SIDEBAR MODE COOKIE IS SHARED WITH THE WORKSPACE, deliberately. Someone
 * who collapsed the panel in their showroom expects it collapsed here; the
 * preference is about how much room navigation should take, not about which
 * product they are in.
 */
export default async function HomeLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  const m = getMessages(locale);
  const { entries } = await getWorkspaces();
  const sidebarMode = resolveSidebarMode(store.get(SIDEBAR_MODE_COOKIE)?.value);

  // A Salesperson's Sales tools live in a business someone ELSE owns, so the
  // switcher offers them the affiliation path alongside "add my own business".
  //
  // Resolved the SAME way /home/showroom resolves it, and not from
  // `personal.persona`: that column is `users.primary_account_type` alone, while
  // the Personal row it belongs to is emitted on the broader
  // `app.has_personal_persona` test. A salesperson whose upgrade is still under
  // review therefore has a personal workspace with a NULL persona — admitted by
  // the page and by the database, but silently never offered the link.
  //
  // Still gated on having a personal workspace at all, because the page redirects
  // a caller without one; offering a link to a redirect is not navigation.
  const personal = personalEntry(entries);
  const showConnectShowroom = Boolean(personal) && (await loadIsSalesPersona());

  /**
   * The destinations, derived from the SAME two answers the pages use — the
   * variant `loadPersonalHome` resolves (track, then persona) and the Sales
   * answer above. A caller with no personal workspace gets no navigation at all:
   * the pages under here redirect them, and a nav of links to redirects is worse
   * than none. Both loaders are render-scoped, so the page below pays nothing.
   */
  const home = personal ? await loadPersonalHome() : null;
  const navKeys = home
    ? personalNavKeys({ variant: home.variant, isSalesPersona: showConnectShowroom })
    : [];

  return (
    <I18nProvider locale={locale} dir={dir}>
      <AppShell
        nav={
          navKeys.length > 0 ? (
            <SidebarShell
              mode={sidebarMode}
              appName={m.common.appName}
              nav={<PersonalNavPanel keys={navKeys} />}
              /* No Settings/Upgrade block. Both of the workspace's point at
                 `/b2b/settings`, which this account is redirected out of, and
                 "upgrade your plan" is a business concept. A personal settings
                 route is specified but not built. */
              footer="none"
            />
          ) : undefined
        }
        header={
          <AppHeader
            appName={m.common.appName}
            /* No business workspace here, so the palette is navigation-only and
               the record search never runs — a personal account has no B2B
               records to find, and the action returns nothing for it by
               construction, not by a client-side filter. */
            hasWorkspace={false}
            workspaceLabel={m.account.personal}
            /* The floating card form, same as the workspace. The brand is drawn
               once, at the head of the sidebar — so on a personal account with
               no navigation at all (a caller mid-redirect) the header falls back
               to carrying it itself. */
            variant={navKeys.length > 0 ? "card" : "bar"}
            context={
              <WorkspaceSwitcher
                entries={entries}
                activeKey={PERSONAL_CONTEXT}
                showConnectShowroom={showConnectShowroom}
              />
            }
          />
        }
        mobileNav={navKeys.length > 0 ? <PersonalMobileNav keys={navKeys} /> : undefined}
      >
        {children}
      </AppShell>
    </I18nProvider>
  );
}
