import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/workspace-layout";
import { ButtonLink } from "@/components/ui/controls";
import { ChevronLeftIcon, ChevronRightIcon, ReceiptIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { SellerOrderDetail } from "@/features/marketplace-orders/seller-order-detail";
import { ordersCopy } from "@/features/marketplace-orders/orders-copy";
import { loadSellerOrder } from "@/server/queries/marketplace-orders-v2";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** /showroom/marketplace/orders/[orderId] - one order of this showroom (the RPC answers not_found otherwise). */
export default async function MarketplaceOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();
  const { supabase, locale } = await requireApprovedSeller();
  const t = ordersCopy[locale];
  const order = await loadSellerOrder(supabase, orderId);
  if (!order) notFound();
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        locale={locale}
        Icon={ReceiptIcon}
        title={t.seller.orderTitle(order.order_number)}
        subtitle={`${order.recipient.name} · ${t.status[order.status]}`}
        toolbar={
          <ButtonLink href="/showroom/marketplace/orders" variant="outline">
            {locale === "ar" ? <ChevronRightIcon size={16} /> : <ChevronLeftIcon size={16} />}
            {t.seller.backToOrders}
          </ButtonLink>
        }
      />
      <SellerOrderDetail initial={order} />
    </div>
  );
}
