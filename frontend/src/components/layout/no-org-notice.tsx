import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/translate";
import { StatePanel } from "@/components/ui/primitives";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { AccountMenu } from "@/components/layout/account-menu";

/** Shown to a signed-in caller who has no active organization membership. */
export async function NoOrgNotice({ theme }: { theme: "light" | "dark" }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex items-center gap-1 border-b bg-surface px-md py-2">
        <span className="font-display-ar text-title text-fg">{m.common.appName}</span>
        <div className="ms-auto flex items-center gap-1">
          <LanguageSwitch />
          <ThemeSwitch current={theme} />
          <AccountMenu orgName="—" />
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-2xl flex-1 place-items-center px-md py-xl">
        <StatePanel title={m.states.noOrg} body={m.states.noOrgBody} tone="warning" />
      </main>
    </div>
  );
}
