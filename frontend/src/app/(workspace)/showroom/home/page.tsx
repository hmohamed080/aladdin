import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { ShowroomHome } from "@/features/showroom-shell/home/home";

export default async function ShowroomHomePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const ctx = await requireShowroomContext();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return <ShowroomHome ctx={ctx} locale={locale} searchParams={await searchParams} />;
}
