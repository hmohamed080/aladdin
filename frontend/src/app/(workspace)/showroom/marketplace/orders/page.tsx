import { PageHeader } from "@/components/ui/workspace-layout";
import { ReceiptIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { SellerOrdersList } from "@/features/marketplace-orders/seller-orders-list";
import { parseSellerOrdersQuery } from "@/features/marketplace-orders/order-model";
import { ordersCopy } from "@/features/marketplace-orders/orders-copy";
import { loadSellerOrders } from "@/server/queries/marketplace-orders-v2";

export const dynamic = "force-dynamic";

/**
 * /showroom/marketplace/orders - the orders Marketplace buyers placed with this showroom, in the tabs
 * new / preparing / shipped / delivered / cancelled, with search and a date filter. Read through
 * marketplace_seller_orders_page_v2, which admits only members who may manage orders (order.manage or org.manage).
 * Not behind the ordering flag: a showroom must always be able to see and finish the orders that exist.
 */
export default async function MarketplaceOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, org, locale } = await requireApprovedSeller();
  const t = ordersCopy[locale].seller;
  const query = parseSellerOrdersQuery(await searchParams);
  const page = await loadSellerOrders(supabase, org.organizationId, query);
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader locale={locale} Icon={ReceiptIcon} title={t.title} subtitle={t.subtitle} />
      <SellerOrdersList page={page} query={query} failed={page.failed} />
    </div>
  );
}
