import { notFound } from "next/navigation";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { WaybillView } from "@/features/marketplace-orders/print-views";
import { loadOrderWaybill } from "@/server/queries/marketplace-orders-v2";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Printable waybill of a delivery order, from the order snapshot. Seller only (pickup orders and other showrooms: not found). */
export default async function MarketplaceWaybillPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();
  const { supabase } = await requireApprovedSeller();
  const waybill = await loadOrderWaybill(supabase, orderId);
  if (!waybill) notFound();
  return <WaybillView waybill={waybill} backHref={`/showroom/marketplace/orders/${orderId}`} />;
}
