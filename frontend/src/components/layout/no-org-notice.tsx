import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/translate";
import { StatePanel } from "@/components/ui/primitives";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { AccountMenu } from "@/components/layout/account-menu";
import { Brand } from "@/components/layout/brand";
import { UsersIcon } from "@/components/ui/icons";

/** Shown to a signed-in caller who has no active organization membership. */
export async function NoOrgNotice({ theme }: { theme: "light" | "dark" }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-header flex items-center gap-sm border-b bg-surface/85 px-md py-2 backdrop-blur" style={{ zIndex: 200 }}>
        <Brand name={m.common.appName} size="sm" />
        <div className="ms-auto flex items-center gap-sm">
          <LanguageSwitch />
          <ThemeSwitch current={theme} />
          <AccountMenu orgName="—" />
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-xl flex-1 place-items-center px-md py-xl">
        <StatePanel icon={<UsersIcon size={22} />} title={m.states.noOrg} body={m.states.noOrgBody} tone="warning" />
      </main>
    </div>
  );
}
