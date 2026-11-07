import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { ShowroomSettings } from "@/features/showroom-shell/settings/settings";

export const dynamic = "force-dynamic";

export default async function ShowroomSettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const ctx = await requireShowroomContext();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return <ShowroomSettings ctx={ctx} locale={locale} section={(await searchParams).section} />;
}
