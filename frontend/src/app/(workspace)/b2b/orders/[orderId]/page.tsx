import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import {
  getOrder,
  getOrderDisplay,
  listOrderItems,
  getProjectForOrder,
} from "@/server/queries/execution";
import { BackLink, FlashSuccess } from "@/features/sales/page-parts";
import { getMessages } from "@/lib/i18n/translate";
import { OrderDetail } from "@/features/execution/order-detail";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { orderId } = await params;
  const sp = await searchParams;

  const [order, display, items, project] = await Promise.all([
    getOrder(supabase, orderId),
    getOrderDisplay(supabase, orderId),
    listOrderItems(supabase, orderId),
    getProjectForOrder(supabase, orderId),
  ]);
  if (!order || !display) notFound();

  const isSupplier = org.organizationId === order.supplier_org_id;
  const isRequester = org.organizationId === order.requester_org_id;
  const canManage = org.capabilities.includes("order.manage") || org.capabilities.includes("org.manage");
  const canProject = org.capabilities.includes("project.write") || org.capabilities.includes("org.manage");

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href="/b2b/orders">{m.execution.order.title}</BackLink>
      {sp.created ? <FlashSuccess messageKey="execution.flash.orderCreated" /> : null}
      <OrderDetail
        order={order}
        items={items}
        project={project}
        supplierName={display.supplier_name ?? "—"}
        requesterName={display.requester_name ?? "—"}
        role={{ isSupplier, isRequester, canManage, canProject }}
        locale={locale}
      />
    </div>
  );
}
