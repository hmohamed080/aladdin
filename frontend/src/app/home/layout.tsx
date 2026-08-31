import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { getMessages } from "@/lib/i18n/translate";
import { getWorkspaces } from "@/server/queries/workspace";
import { loadIsSalesPersona } from "@/server/queries/sales-persona";
import { PERSONAL_CONTEXT, personalEntry } from "@/lib/workspace/model";
import { AppHeader } from "@/components/layout/app-header";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { contentColumnClass } from "@/components/layout/content-column";
import { cn } from "@/lib/ui/cn";

export const dynamic = "force-dynamic";

/**
 * Personal home chrome — deliberately NOT the B2B workspace shell. A consumer, or
 * an individual professional, works here and never in the Sales cockpit.
 *
 * The workspace switcher is the one piece of workspace chrome that belongs here:
 * a person who also owns or works in a business must be able to reach it from
 * their personal surface, and a person who has none needs somewhere to add their
 * first — which is why it is present even for a lone Personal context.
 *
 * The content column is the SHARED one (`contentColumnClass`) — fluid between the
 * viewport edges rather than a fixed cap. The old 1120px was itself a widening of
 * an earlier 900px, and it fixed the same Pilot UAT finding only up to a laptop:
 * past that the page went back to reading as a narrow strip in a wide empty field.
 * The fix is to stop hardcoding the number here at all.
 */
export default async function HomeLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  const m = getMessages(locale);
  const { entries } = await getWorkspaces();
  // A Salesperson's Sales tools live in a business someone ELSE owns, so the
  // switcher offers them the affiliation path alongside "add my own business".
  //
  // Resolved the SAME way /home/showroom resolves it, and not from
  // `personal.persona`: that column is `users.primary_account_type` alone, while
  // the Personal row it belongs to is emitted on the broader
  // `app.has_personal_persona` test. A salesperson whose upgrade is still under
  // review therefore has a personal workspace with a NULL persona — admitted by the
  // page and by the database, but silently never offered the link.
  //
  // Still gated on having a personal workspace at all, because the page redirects
  // a caller without one; offering a link to a redirect is not navigation.
  const personal = personalEntry(entries);
  const showConnectShowroom = Boolean(personal) && (await loadIsSalesPersona());

  return (
    <I18nProvider locale={locale} dir={dir}>
      <div className="flex min-h-dvh flex-col bg-canvas">
        <AppHeader
          appName={m.common.appName}
          /* The header owns the mark on every surface now, and spans the
             viewport on every surface too — including this one, which has no
             sidebar. Its row is deliberately NOT constrained to the 1120px
             content column any more: one shell, one geometry. */
          /* No business workspace here, so the palette is navigation-only and
             the record search never runs — a personal account has no B2B
             records to find, and the action returns nothing for it by
             construction, not by a client-side filter. */
          hasWorkspace={false}
          workspaceLabel={m.account.personal}
          context={
            <WorkspaceSwitcher
              entries={entries}
              activeKey={PERSONAL_CONTEXT}
              showConnectShowroom={showConnectShowroom}
            />
          }
        />

        <main className={cn(contentColumnClass, "py-xl")} id="main">
          {children}
        </main>
      </div>
    </I18nProvider>
  );
}
