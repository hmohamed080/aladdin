import { notFound } from "next/navigation";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { ReturnDetail } from "@/features/marketplace-returns/return-view";
import type { ReturnDocument } from "@/features/marketplace-returns/contract";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function SellerReturnRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, locale } = await requireApprovedSeller();
  const { data } = await supabase.rpc("marketplace_seller_return_get", { p_return_id: id });
  if (!data) notFound();
  const doc = ((data as { return?: ReturnDocument }).return ?? data) as ReturnDocument;
  return <ReturnDetail doc={doc} role="seller" locale={locale} />;
}
