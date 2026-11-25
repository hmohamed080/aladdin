import { notFound } from "next/navigation";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { InvoiceView } from "@/features/marketplace-orders/print-views";
import { ordersCopy } from "@/features/marketplace-orders/orders-copy";
import { loadOrderInvoice } from "@/server/queries/marketplace-orders-v2";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Printable order invoice for the showroom (issued on the first read once the order is ready; not a tax invoice). */
export default async function MarketplaceSellerInvoicePage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();
  const { supabase, locale } = await requireApprovedSeller();
  const invoice = await loadOrderInvoice(supabase, orderId);
  if (!invoice) {
    return <p role="status" className="py-lg text-center text-body text-fg-secondary">{ordersCopy[locale].invoice.unavailable}</p>;
  }
  return <InvoiceView invoice={invoice} backHref={`/showroom/marketplace/orders/${orderId}`} />;
}
