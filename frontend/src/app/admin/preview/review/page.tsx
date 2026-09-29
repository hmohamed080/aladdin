import Link from "next/link";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { previewReviewQueue } from "@/server/queries/admin-preview";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate } from "@/lib/ui/format";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Card, Badge, StatePanel } from "@/components/ui/primitives";
import { AutoFilters } from "@/features/admin-preview/auto-filters";

export const dynamic = "force-dynamic";

/**
 * Phase 0 preview — Review Center queue. Real data: the SAME three read
 * models `/admin/verifications` already uses (`listVerifications`,
 * `listAdminReferrals`, `listAdminNetworkReferrals`), merged into one
 * queue and sorted by recency — previewing the planned single-queue
 * presentation, not a different dataset.
 */
export default async function PreviewReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { type } = await searchParams;
  const allItems = await previewReviewQueue(supabase);
  const items = type ? allItems.filter((item) => item.kind === type) : allItems;
  const t = m.admin.preview.review;

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={t.title} subtitle={t.subtitle} count={items.length} />

      <AutoFilters
        fields={[
          {
            kind: "select",
            name: "type",
            anyLabel: m.admin.preview.users.anyType,
            options: [
              { value: "verification", label: t.typeVerification },
              { value: "salesReferral", label: t.typeSalesReferral },
              { value: "networkReferral", label: t.typeNetworkReferral },
            ],
          },
        ]}
      />

      {items.length === 0 ? (
        <StatePanel title={t.empty} />
      ) : (
        <div className="flex flex-col gap-sm">
          {items.map((item) => {
            const href =
              item.kind === "verification"
                ? `/admin/preview/review/verification/${item.row.id}`
                : item.kind === "salesReferral"
                  ? `/admin/preview/review/sales-referral/${item.row.id}`
                  : `/admin/preview/review/network-referral/${item.row.id}`;
            const title =
              item.kind === "verification"
                ? item.row.subjectName
                : item.kind === "salesReferral"
                  ? item.row.displayName
                  : item.row.displayName;
            const typeLabel = item.kind === "verification" ? t.typeVerification : item.kind === "salesReferral" ? t.typeSalesReferral : t.typeNetworkReferral;
            const submittedBy = item.kind === "salesReferral" || item.kind === "networkReferral" ? item.row.referrerName : null;
            const at = item.kind === "verification" ? item.row.submittedAt : item.row.createdAt;
            return (
              <Link key={`${item.kind}-${item.row.id}`} href={href}>
                <Card pad="sm" className="flex flex-wrap items-center justify-between gap-md transition-colors hover:bg-surface-2/40">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-body-lg font-medium text-fg">
                        <bdi dir="auto">{title}</bdi>
                      </p>
                      <Badge tone="neutral">{typeLabel}</Badge>
                    </div>
                    <p className="text-label text-fg-muted">
                      {submittedBy ? `${t.submittedBy}: ${submittedBy} · ` : ""}
                      {t.submittedOn}: {formatAdminDate(at, locale)}
                    </p>
                  </div>
                  <StatusBadge status="submitted" label={m.admin.status.submitted} />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
