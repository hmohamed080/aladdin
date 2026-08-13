import Link from "next/link";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { listVerifications } from "@/server/queries/admin";
import { listAdminReferrals } from "@/server/queries/affiliation";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDate } from "@/lib/ui/format";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Card, StatePanel } from "@/components/ui/primitives";
import { VerificationActions } from "@/features/admin/verification-actions";
import { ReferralReview } from "@/features/admin/referral-review";

export const dynamic = "force-dynamic";

export default async function AdminVerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { all } = await searchParams;
  const pendingOnly = all !== "1";
  const [rows, referrals] = await Promise.all([
    listVerifications(supabase, pendingOnly),
    // Referred showrooms are reviewed HERE rather than on a second Admin surface.
    listAdminReferrals(supabase, pendingOnly),
  ]);

  const typeLabels = m.accountType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;
  const vTypeLabels = m.admin.verificationType as Record<string, string>;

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <AdminHeader
          title={m.admin.review.title}
          subtitle={pendingOnly ? m.admin.review.pendingSubtitle : m.admin.review.allSubtitle}
          count={rows.length}
        />
        <Link
          href={pendingOnly ? "/admin/verifications?all=1" : "/admin/verifications"}
          className="rounded-sm bg-surface-2 px-3 py-1.5 text-label font-medium text-fg"
        >
          {pendingOnly ? m.admin.review.showAll : m.admin.review.showPending}
        </Link>
      </div>

      {rows.length === 0 ? (
        <StatePanel title={pendingOnly ? m.admin.review.emptyPending : m.admin.review.empty} />
      ) : (
        <div className="flex flex-col gap-md">
          {rows.map((v) => (
            <Card key={v.id} className="flex flex-col gap-md">
              <div className="flex flex-wrap items-start justify-between gap-md">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body-lg font-semibold text-fg">{v.subjectName || m.admin.review.unknownSubject}</p>
                    <StatusBadge status={v.status} label={statusLabels[v.status] ?? v.status} />
                  </div>
                  <p className="text-label text-fg-secondary">
                    {vTypeLabels[v.verificationType] ?? v.verificationType}
                    {v.requestedAccountType
                      ? ` → ${typeLabels[v.requestedAccountType] ?? v.requestedAccountType}`
                      : ""}
                    {" · "}
                    {v.subjectType === "user" ? m.admin.review.subjectUser : m.admin.review.subjectOrg}
                    {" · "}
                    {formatDate(v.submittedAt, locale)}
                  </p>
                </div>
              </div>
              <VerificationActions v={v} />
            </Card>
          ))}
        </div>
      )}

      <ReferralReview rows={referrals} m={m} />
    </div>
  );
}
