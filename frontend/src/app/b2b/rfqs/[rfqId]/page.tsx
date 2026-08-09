import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  getRfq,
  listRfqItems,
  getRfqDisplay,
  listCatalog,
  getLiveQuotationForRfq,
} from "@/server/queries/commerce";
import { BackLink, FlashSuccess } from "@/features/sales/page-parts";
import { RfqDetail } from "@/features/commerce/rfq-detail";

export const dynamic = "force-dynamic";

export default async function RfqDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ rfqId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { rfqId } = await params;
  const sp = await searchParams;

  const [rfq, display, items] = await Promise.all([
    getRfq(supabase, rfqId),
    getRfqDisplay(supabase, rfqId),
    listRfqItems(supabase, rfqId),
  ]);
  if (!rfq || !display) notFound();

  const isRequester = org.organizationId === rfq.requester_org_id;
  const isSupplier = org.organizationId === rfq.supplier_org_id;
  const canRfq = org.capabilities.includes("rfq.create") || org.capabilities.includes("org.manage");
  const canRespond =
    org.capabilities.includes("rfq.respond") ||
    org.capabilities.includes("quote.submit") ||
    org.capabilities.includes("org.manage");

  // The supplier's published products, offered to the requester when adding lines
  // to a draft RFQ (all items must be the same supplier's published products).
  const supplierProducts =
    isRequester && rfq.status === "draft"
      ? (await listCatalog(supabase, { supplierOrgId: rfq.supplier_org_id }))
          .filter((p): p is typeof p & { id: string; name: string } => Boolean(p.id && p.name))
          .map((p) => ({ id: p.id, name: p.name }))
      : [];

  const live = isSupplier ? await getLiveQuotationForRfq(supabase, rfqId) : null;

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href="/b2b/rfqs">{m.commerce.rfq.title}</BackLink>
      {sp.created ? <FlashSuccess messageKey="commerce.flash.rfqCreated" /> : null}
      <RfqDetail
        rfq={rfq}
        requesterName={display.requester_name ?? "—"}
        supplierName={display.supplier_name ?? "—"}
        items={items}
        role={{ isRequester, isSupplier, canRfq, canRespond }}
        supplierProducts={supplierProducts}
        liveQuotation={live ? { id: live.id, status: live.status } : null}
        locale={locale}
      />
    </div>
  );
}
