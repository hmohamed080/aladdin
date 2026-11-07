import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { requireApprovedShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, canNavigate } from "@/features/showroom-shell/navigation";
import { ShowroomCatalog } from "@/features/showroom-shell/catalog/catalog";

export const dynamic = "force-dynamic";

export default async function ShowroomCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; supplier?: string }>;
}) {
  const ctx = await requireApprovedShowroomContext();
  // The same capability gate the sidebar applies to "تصفح المنتجات".
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "catalog");
  if (!item || !canNavigate(item, ctx.org.capabilities)) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return <ShowroomCatalog ctx={ctx} locale={locale} searchParams={await searchParams} />;
}
