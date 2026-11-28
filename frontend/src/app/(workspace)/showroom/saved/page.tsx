import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { requireApprovedShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, canNavigate } from "@/features/showroom-shell/navigation";
import { ShowroomSaved } from "@/features/showroom-shell/saved/saved";

export const dynamic = "force-dynamic";

export default async function ShowroomSavedPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const ctx = await requireApprovedShowroomContext();
  // The same capability gate the sidebar applies to the Saved Products entry.
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "saved");
  if (!item || !canNavigate(item, ctx.org.capabilities)) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return <ShowroomSaved ctx={ctx} locale={locale} searchParams={await searchParams} />;
}
