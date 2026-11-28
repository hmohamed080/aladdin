import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import type {
  BuyerOrdersPage,
  OrderDocumentV2,
  OrderInvoice,
  OrderWaybill,
  SellerOrdersPageV2,
} from "@/features/marketplace-orders/order-types";
import {
  BUYER_PAGE_SIZE,
  SELLER_PAGE_SIZE,
  type BuyerOrdersQuery,
  type SellerOrdersQuery,
} from "@/features/marketplace-orders/order-model";

/**
 * Reads of the buyer and seller order pages (PR 13). Every function runs under the caller's own session:
 * the SECURITY DEFINER RPCs decide whose orders a caller may read and answer an error for anyone else's,
 * which becomes `null` here (the pages turn that into "not found"). Nothing is logged: the documents hold
 * addresses and phones.
 */
type Client = Awaited<ReturnType<typeof getServerSupabase>>;

const EMPTY_BUYER: BuyerOrdersPage = { total: 0, items: [] };
const EMPTY_SELLER: SellerOrdersPageV2 = {
  total: 0,
  counts: { new: 0, in_preparation: 0, shipped: 0, delivered: 0, cancelled: 0 },
  needs_attention: 0,
  items: [],
};

export async function loadBuyerOrders(q: BuyerOrdersQuery, supabase?: Client): Promise<BuyerOrdersPage & { failed?: boolean }> {
  const db = supabase ?? (await getServerSupabase());
  const { data, error } = await db.rpc("marketplace_buyer_orders_v2", {
    p_search: q.search || undefined,
    p_period: q.period,
    p_status: q.status ?? undefined,
    p_limit: BUYER_PAGE_SIZE,
    p_offset: (q.page - 1) * BUYER_PAGE_SIZE,
  });
  if (error || !data) return { ...EMPTY_BUYER, failed: true };
  return data as unknown as BuyerOrdersPage;
}

export async function loadBuyerOrder(orderId: string, supabase?: Client): Promise<OrderDocumentV2 | null> {
  const db = supabase ?? (await getServerSupabase());
  const { data, error } = await db.rpc("marketplace_buyer_order_get_v2", { p_order_id: orderId });
  return error || !data ? null : (data as unknown as OrderDocumentV2);
}

export async function loadSellerOrders(
  supabase: Client,
  organizationId: string,
  q: SellerOrdersQuery,
): Promise<SellerOrdersPageV2 & { failed?: boolean }> {
  const { data, error } = await supabase.rpc("marketplace_seller_orders_page_v2", {
    p_organization_id: organizationId,
    p_tab: q.tab ?? undefined,
    p_search: q.search || undefined,
    p_from: q.from ?? undefined,
    p_to: q.to ?? undefined,
    p_limit: SELLER_PAGE_SIZE,
    p_offset: (q.page - 1) * SELLER_PAGE_SIZE,
  });
  if (error || !data) return { ...EMPTY_SELLER, failed: true };
  return data as unknown as SellerOrdersPageV2;
}

export async function loadSellerOrder(supabase: Client, orderId: string): Promise<OrderDocumentV2 | null> {
  const { data, error } = await supabase.rpc("marketplace_seller_order_get_v2", { p_order_id: orderId });
  return error || !data ? null : (data as unknown as OrderDocumentV2);
}

export async function loadOrderInvoice(supabase: Client, orderId: string): Promise<OrderInvoice | null> {
  const { data, error } = await supabase.rpc("marketplace_order_invoice_get", { p_order_id: orderId });
  return error || !data ? null : (data as unknown as OrderInvoice);
}

export async function loadOrderWaybill(supabase: Client, orderId: string): Promise<OrderWaybill | null> {
  const { data, error } = await supabase.rpc("marketplace_order_waybill_get", { p_order_id: orderId });
  return error || !data ? null : (data as unknown as OrderWaybill);
}
