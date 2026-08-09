import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listOrders } from "@/server/queries/execution";
import { PageHeader } from "@/features/sales/page-parts";
import { SectionTitle } from "@/components/ui/primitives";
import { OrderList } from "@/features/execution/execution-lists";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);

  const [placed, received] = await Promise.all([
    listOrders(supabase, org.organizationId, "requester"),
    listOrders(supabase, org.organizationId, "supplier"),
  ]);

  return (
    <div className="flex flex-col gap-xl pb-16 tablet:pb-0">
      <div>
        <PageHeader title={m.execution.order.title} subtitle={m.execution.order.subtitle} />
      </div>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.execution.order.placedHeading}</SectionTitle>
        <OrderList orders={placed} perspective="requester" locale={locale} />
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.execution.order.receivedHeading}</SectionTitle>
        <OrderList orders={received} perspective="supplier" locale={locale} />
      </section>
    </div>
  );
}
