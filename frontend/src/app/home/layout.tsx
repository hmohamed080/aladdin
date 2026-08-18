import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { getMessages } from "@/lib/i18n/translate";
import { getWorkspaces } from "@/server/queries/workspace";
import { PERSONAL_CONTEXT, personalEntry } from "@/lib/workspace/model";
import { AppHeader } from "@/components/layout/app-header";
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
 *
 * The content column is 1120px. The previous 900px was the root of several Pilot
 * UAT findings at once — a desktop page that read as a narrow form with large empty
 * margins, and a three-up card grid with nowhere to breathe.
 */
export default async function HomeLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  const m = getMessages(locale);
  const { entries } = await getWorkspaces();
  // A Salesperson's Sales tools live in a business someone ELSE owns, so the
  // switcher offers them the affiliation path alongside "add my own business".
  const personal = personalEntry(entries);
  const showConnectShowroom = personal?.persona === "sales";

  return (
    <I18nProvider locale={locale} dir={dir}>
      <div className="flex min-h-dvh flex-col bg-canvas">
        <AppHeader
          appName={m.common.appName}
          /* No sidebar on the personal surface, so the header owns the mark —
             and its row follows the same 1120px column the content uses. */
          brand="header"
          width="content"
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

        <main className="mx-auto w-full max-w-[1120px] flex-1 px-md py-xl" id="main">
          {children}
        </main>
      </div>
    </I18nProvider>
  );
}
