import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { StatePanel } from "@/components/ui/primitives";
import { SellersTable, type SellerRow } from "@/features/admin-marketplace/sellers-table";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

/**
 * Marketplace seller management. The list and every transition come from
 * SECURITY DEFINER RPCs that re-check marketplace_sellers.read / .manage, so a
 * staff member without the permission sees the refusal panel, not data.
 */
export default async function AdminMarketplaceSellersPage() {
  // Console door for this route (the route table in lib/permissions/admin.ts); the page's RPCs still re-check
  // marketplace_sellers.* / marketplace_media.moderate and the refusal panel shows without them.
  await requireAdminRoute("/admin/marketplace");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale).adminMarketplace;
  const { data, error } = await supabase.rpc("admin_marketplace_seller_overview");

  if (error) {
    return (
      <div className="flex flex-col gap-lg">
        <AdminHeader locale={locale} title={m.sellers.title} subtitle={m.sellers.subtitle} />
        <StatePanel tone="danger" title={error.code === "42501" ? m.errors.not_permitted : m.errors.unexpected} />
      </div>
    );
  }

  const rows: SellerRow[] = (data ?? []).map((r) => ({
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    eligible: r.eligible,
    status: r.seller_status,
    statusReason: r.status_reason,
    statusChangedAt: r.status_changed_at,
    approvedByName: r.approved_by_name,
    productsTotal: Number(r.products_total),
    productsPublished: Number(r.products_published),
    productsDraft: Number(r.products_draft),
  }));

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={m.sellers.title} subtitle={m.sellers.subtitle} count={rows.length} />
      {rows.length === 0 ? <StatePanel title={m.sellers.empty} /> : <SellersTable rows={rows} />}
    </div>
  );
}
