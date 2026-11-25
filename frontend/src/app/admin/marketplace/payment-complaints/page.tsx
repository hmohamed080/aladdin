import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { StatePanel } from "@/components/ui/primitives";
import { requireAdminRoute } from "@/server/authorization/admin";
import { ComplaintsQueue } from "@/features/marketplace-admin-complaints/complaints-queue";
import { isComplaintState, type ComplaintList } from "@/features/marketplace-admin-complaints/model";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Payment complaints (admin). Opens only for `marketplace_payment_complaints.review` (a grantable permission, Super Admin by default):
 * the route rule hides the page and the nav entry from everyone else, and the database re-checks on every read and decision.
 * Not behind the ordering flag: an admin must always be able to finish a complaint that exists.
 */
export default async function PaymentComplaintsPage({ searchParams }: { searchParams: Promise<{ state?: string; page?: string }> }) {
  await requireAdminRoute("/admin/marketplace/payment-complaints");
  const sp = await searchParams;
  const active = isComplaintState(sp.state) ? sp.state : "open";
  const page = Math.max(1, Math.trunc(Number(sp.page)) || 1);
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const header = <AdminHeader locale={locale} title={t("marketplaceComplaints.title")} subtitle={t("marketplaceComplaints.subtitle")} />;

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_marketplace_payment_complaints", { p_state: active, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE });
  if (error) {
    return (
      <div className="flex flex-col gap-lg">
        {header}
        <StatePanel tone="danger" title={error.code === "42501" ? t("marketplaceComplaints.errors.not_permitted") : t("marketplaceComplaints.errors.unexpected")} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-lg">
      {header}
      <ComplaintsQueue list={data as unknown as ComplaintList} active={active} locale={locale} t={t} basePath="/admin/marketplace/payment-complaints" page={page} pageSize={PAGE_SIZE} />
    </div>
  );
}
