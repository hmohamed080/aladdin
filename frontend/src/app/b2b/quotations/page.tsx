import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listQuotations, type QuotationListRow } from "@/server/queries/commerce";
import { PageHeader } from "@/features/sales/page-parts";
import { TabLinks, StatTiles } from "@/components/ui/stat-tiles";
import { QuotationTable } from "@/features/commerce/commerce-lists";
import { InboxIcon, ClockIcon, CheckIcon, XIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

function countBy(rows: QuotationListRow[], status: string) {
  return rows.filter((q) => q.status === status).length;
}

/**
 * Incoming Offers — the prices suppliers have quoted back to this business.
 *
 * The received side leads, mirroring Purchase Requests: a showroom's job here is
 * to compare offers and decide. "Quotes we sent" is a second tab, shown only to an
 * organization that actually quotes.
 */
export default async function IncomingOffersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const canQuote =
    org.capabilities.includes("quote.submit") ||
    org.capabilities.includes("rfq.respond") ||
    org.capabilities.includes("org.manage");

  const view = canQuote && sp.view === "sent" ? "sent" : "received";

  const [received, sent] = await Promise.all([
    listQuotations(supabase, org.organizationId, "requester"),
    canQuote ? listQuotations(supabase, org.organizationId, "supplier") : Promise.resolve([]),
  ]);

  const rows = view === "received" ? received : sent;

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        title={m.commerce.quotation.title}
        subtitle={m.commerce.quotation.subtitle}
        count={rows.length}
      />

      <StatTiles
        tiles={[
          {
            label: m.commerce.quotation.stat.awaiting,
            value: countBy(rows, "submitted"),
            Icon: ClockIcon,
            tone: "warning",
            hint: view === "received" ? m.commerce.quotation.stat.awaitingHint : undefined,
          },
          {
            label: m.commerce.quotation.stat.accepted,
            value: countBy(rows, "accepted"),
            Icon: CheckIcon,
            tone: "success",
          },
          { label: m.commerce.quotation.stat.rejected, value: countBy(rows, "rejected"), Icon: XIcon, tone: "danger" },
          { label: m.commerce.quotation.stat.total, value: rows.length, Icon: InboxIcon, tone: "accent" },
        ]}
      />

      <div>
        {canQuote ? (
          <TabLinks
            basePath="/b2b/quotations"
            param="view"
            current={view === "received" ? "" : "sent"}
            label={m.commerce.quotation.title}
            tabs={[
              { value: "", label: m.commerce.quotation.receivedHeading, count: received.length },
              { value: "sent", label: m.commerce.quotation.sentHeading, count: sent.length },
            ]}
          />
        ) : null}

        <QuotationTable
          quotations={rows}
          perspective={view === "received" ? "requester" : "supplier"}
          locale={locale}
          m={m}
        />
      </div>
    </div>
  );
}
