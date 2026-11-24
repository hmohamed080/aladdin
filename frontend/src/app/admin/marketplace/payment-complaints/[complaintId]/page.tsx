import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { ButtonLink } from "@/components/ui/controls";
import { StatePanel } from "@/components/ui/primitives";
import { requireAdminRoute } from "@/server/authorization/admin";
import { marketplacePrivateImageUrls } from "@/server/media/marketplace-public-images";
import { ComplaintDetailView } from "@/features/marketplace-admin-complaints/complaint-detail";
import type { ComplaintDetail } from "@/features/marketplace-admin-complaints/model";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One payment complaint. Receipt previews are /api/media (or Worker) URLs read under the ADMIN'S OWN session: the marketplace media
 * resolver admits the admin only for the receipts of an order that has a complaint (app.marketplace_complaint_admin_can_read).
 * The buyer's phone is never in the admin order document.
 */
export default async function PaymentComplaintPage({ params }: { params: Promise<{ complaintId: string }> }) {
  await requireAdminRoute("/admin/marketplace/payment-complaints");
  const { complaintId } = await params;
  if (!UUID.test(complaintId)) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_marketplace_payment_complaint_get", { p_complaint_id: complaintId });
  if (error?.message?.includes("mp:not_found")) notFound();
  const header = <AdminHeader locale={locale} title={t("marketplaceComplaints.title")} />;
  if (error || !data) {
    return (
      <div className="flex flex-col gap-lg">
        {header}
        <StatePanel tone="danger" title={error?.code === "42501" ? t("marketplaceComplaints.errors.not_permitted") : t("marketplaceComplaints.errors.unexpected")} />
      </div>
    );
  }
  const detail = data as unknown as ComplaintDetail;
  const receipts = detail.order.payment.receipts;
  const urls = await marketplacePrivateImageUrls(supabase, receipts.map((r) => r.object_key), "card");
  return (
    <div className="flex flex-col gap-lg">
      {header}
      <div><ButtonLink size="sm" variant="outline" href="/admin/marketplace/payment-complaints">{t("marketplaceComplaints.detail.back")}</ButtonLink></div>
      <ComplaintDetailView
        detail={detail}
        receipts={receipts.map((r) => ({ id: r.id, url: urls.get(r.object_key) ?? null, created_at: r.created_at, status: r.status }))}
      />
    </div>
  );
}
