import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listQuotations } from "@/server/queries/commerce";
import { PageHeader } from "@/features/sales/page-parts";
import { SectionTitle } from "@/components/ui/primitives";
import { QuotationList } from "@/features/commerce/commerce-lists";

export const dynamic = "force-dynamic";

export default async function QuotationsPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);

  const [mine, received] = await Promise.all([
    listQuotations(supabase, org.organizationId, "supplier"),
    listQuotations(supabase, org.organizationId, "requester"),
  ]);

  return (
    <div className="flex flex-col gap-xl pb-16 tablet:pb-0">
      <div>
        <PageHeader title={m.commerce.quotation.title} subtitle={m.commerce.quotation.subtitle} />
      </div>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.commerce.quotation.receivedHeading}</SectionTitle>
        <QuotationList quotations={received} perspective="requester" locale={locale} />
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.commerce.quotation.sentHeading}</SectionTitle>
        <QuotationList quotations={mine} perspective="supplier" locale={locale} />
      </section>
    </div>
  );
}
