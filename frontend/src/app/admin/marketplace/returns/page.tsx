import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { StatePanel } from "@/components/ui/primitives";
import { requireAdminRoute } from "@/server/authorization/admin";
import { RETURN_COPY } from "@/features/marketplace-returns/copy";
import { ReturnList } from "@/features/marketplace-returns/return-view";
import type { AdminReturnsPage } from "@/features/marketplace-returns/contract";

export const dynamic = "force-dynamic";

/** Returns escalated to the platform (seller silent 72 h, or a buyer complaint). Needs marketplace_returns.review. */
export default async function AdminMarketplaceReturnsPage() {
  await requireAdminRoute("/admin/marketplace/returns");
  const supabase = await getServerSupabase();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const { data, error } = await supabase.rpc("admin_marketplace_returns", { p_limit: 100, p_offset: 0 });
  if (error) return <StatePanel tone="danger" title={RETURN_COPY.failed[locale]} />;
  const page = data as unknown as AdminReturnsPage;
  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={RETURN_COPY.adminTitle[locale]} subtitle="" />
      <ReturnList items={page.items} locale={locale} base="/admin/marketplace/returns" />
    </div>
  );
}
