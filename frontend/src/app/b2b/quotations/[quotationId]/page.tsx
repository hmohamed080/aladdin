import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  getQuotation,
  getQuotationDisplay,
  listQuotationItems,
} from "@/server/queries/commerce";
import { BackLink, FlashSuccess } from "@/features/sales/page-parts";
import { QuotationDetail } from "@/features/commerce/quotation-detail";

export const dynamic = "force-dynamic";

export default async function QuotationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ quotationId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { quotationId } = await params;
  const sp = await searchParams;

  const [quotation, display, items] = await Promise.all([
    getQuotation(supabase, quotationId),
    getQuotationDisplay(supabase, quotationId),
    listQuotationItems(supabase, quotationId),
  ]);
  if (!quotation || !display) notFound();

  const isSupplier = org.organizationId === quotation.supplier_org_id;
  const isRequester = org.organizationId === quotation.requester_org_id;
  const canRespond =
    org.capabilities.includes("rfq.respond") ||
    org.capabilities.includes("quote.submit") ||
    org.capabilities.includes("org.manage");
  const canDecide = org.capabilities.includes("quote.decide") || org.capabilities.includes("org.manage");

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href="/b2b/quotations">{m.commerce.quotation.title}</BackLink>
      {sp.created ? <FlashSuccess messageKey="commerce.flash.quotationCreated" /> : null}
      <QuotationDetail
        quotation={quotation}
        items={items}
        supplierName={display.supplier_name ?? "—"}
        requesterName={display.requester_name ?? "—"}
        rfqTitle={display.rfq_title ?? "—"}
        rfqId={quotation.rfq_id}
        role={{ isSupplier, canRespond, isRequester, canDecide }}
        locale={locale}
      />
    </div>
  );
}
