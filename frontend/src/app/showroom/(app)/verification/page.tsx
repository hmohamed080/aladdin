import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, canNavigate } from "@/features/showroom-shell/navigation";
import { ShowroomVerification } from "@/features/business-verification/showroom-verification";

export const dynamic = "force-dynamic";

export default async function ShowroomVerificationPage() {
  const ctx = await requireShowroomContext();
  // The same capability gate the sidebar applies; the RPCs refuse anyone without org.manage regardless.
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "verification");
  if (!item || !canNavigate(item, ctx.org.capabilities)) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return <ShowroomVerification ctx={ctx} locale={locale} />;
}
