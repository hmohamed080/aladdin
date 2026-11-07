import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, canNavigate } from "@/features/showroom-shell/navigation";
import { ShowroomMyProducts } from "@/features/showroom-shell/products/my-products";

export const dynamic = "force-dynamic";

export default async function ShowroomMyProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; sort?: string }>;
}) {
  const ctx = await requireShowroomContext();
  // The same capability gate the sidebar applies to "منتجاتي".
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "my-products");
  if (!item || !canNavigate(item, ctx.org.capabilities)) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return <ShowroomMyProducts ctx={ctx} locale={locale} searchParams={await searchParams} />;
}
