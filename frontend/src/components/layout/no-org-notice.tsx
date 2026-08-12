import Link from "next/link";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/translate";
import { StatePanel } from "@/components/ui/primitives";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { SignOutButton } from "@/components/layout/account-menu";
import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/controls";
import { UsersIcon, PlusIcon } from "@/components/ui/icons";

/**
 * Shown to a signed-in caller who has no business workspace at all — and no
 * Personal one to fall back to. It is an account-safe terminal, not a dead end:
 * creating a business is one click away, and it never bounces (which would loop).
 */
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
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-xl flex-1 place-items-center px-md py-xl">
        <div className="flex w-full flex-col items-center gap-md">
          <StatePanel icon={<UsersIcon size={22} />} title={m.states.noOrg} body={m.states.noOrgBody} tone="warning" />
          <Link href="/business/new">
            <Button type="button" variant="outline">
              <PlusIcon size={16} />
              {m.workspace.addBusiness}
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
