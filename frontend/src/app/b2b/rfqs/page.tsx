import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listRfqs } from "@/server/queries/commerce";
import { PageHeader } from "@/features/sales/page-parts";
import { SectionTitle } from "@/components/ui/primitives";
import { RfqList } from "@/features/commerce/commerce-lists";

export const dynamic = "force-dynamic";

export default async function RfqsPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);

  const [sent, received] = await Promise.all([
    listRfqs(supabase, org.organizationId, "requester"),
    listRfqs(supabase, org.organizationId, "supplier"),
  ]);

  return (
    <div className="flex flex-col gap-xl pb-16 tablet:pb-0">
      <div>
        <PageHeader title={m.commerce.rfq.title} subtitle={m.commerce.rfq.subtitle} />
      </div>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.commerce.rfq.sentHeading}</SectionTitle>
        <RfqList rfqs={sent} perspective="requester" locale={locale} />
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.commerce.rfq.receivedHeading}</SectionTitle>
        <RfqList rfqs={received} perspective="supplier" locale={locale} />
      </section>
    </div>
  );
}
