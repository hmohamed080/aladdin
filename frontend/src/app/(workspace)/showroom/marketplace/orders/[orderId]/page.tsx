import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n/translate";
import { PageHeader } from "@/components/ui/workspace-layout";
import { ButtonLink } from "@/components/ui/controls";
import { ChevronLeftIcon, ChevronRightIcon, ReceiptIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { SellerOrderView } from "@/features/marketplace-orders/seller-order-view";
import type { OrderDocument } from "@/features/marketplace-orders/contract";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** /showroom/marketplace/orders/[orderId] - one order of this showroom (the RPC answers not_found otherwise). */
export default async function MarketplaceOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();
  const { supabase, locale } = await requireApprovedSeller();
  const t = getMessages(locale).marketplaceSeller.orders;
  const { data, error } = await supabase.rpc("marketplace_seller_order_get", { p_order_id: orderId });
  if (error || !data) notFound();
  const order = data as unknown as OrderDocument;
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        locale={locale}
        Icon={ReceiptIcon}
        title={`${t.col.number} ${order.order_number}`}
        subtitle={`${order.buyer_name} · ${t.status[order.status]}`}
        toolbar={
          <ButtonLink href="/showroom/marketplace/orders" variant="outline">
            {locale === "ar" ? <ChevronRightIcon size={16} /> : <ChevronLeftIcon size={16} />}
            {t.back}
          </ButtonLink>
        }
      />
      <SellerOrderView initial={order} />
    </div>
  );
}
