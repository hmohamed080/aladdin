import Link from "next/link";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { previewReviewQueue, type ReviewQueueItem } from "@/server/queries/admin-preview";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate } from "@/lib/ui/format";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Card, Badge, StatePanel } from "@/components/ui/primitives";
import { TabLinks } from "@/components/ui/stat-tiles";
import { AutoFilters } from "@/features/admin-preview/auto-filters";
import { TablePagination } from "@/features/admin-preview/table-pagination";
import { clampPageSize, paginate } from "@/features/admin-preview/table-state";
import { cn } from "@/lib/ui/cn";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

type Kind = ReviewQueueItem["kind"];

type Entry = {
  key: string;
  kind: Kind;
  href: string;
  title: string;
  at: string;
  /** Second line: who/what, specific to the type. */
  summary: string;
  /** Third line: type-specific context (reward eligibility, "no Points", …). */
  context: string | null;
  status: "submitted" | "underReview";
};

/**
 * Review Center. One queue of three visually separate request types: Network Referrals · Verifications · Sales referrals.
 *
 * COUNT SEMANTICS (pinned by page.test.tsx):
 *   - the "All" tab and each type tab count the whole real queue and ignore the search box and the page;
 *   - the header count is the number of items matching the current tab AND search, across every page;
 *   - the rows on screen are one page (pageSize) of exactly those matching items.
 *
 * Real records only: verifications, Sales referrals and Network referrals (the same three
 * read models the live queue uses). The Organization Request samples that used to be listed here
 * (no backend, "Preview only") were removed from this operational queue; an organization's own
 * application is a real `verifications` row and appears under Verifications.
 *
 * The types stay visually distinct on purpose: a coloured lead edge and badge
 * per type; Network Referrals show reward eligibility.
 */
export default async function PreviewReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string; pageSize?: string }>;
}) {
  await requireAdminRoute("/admin/review");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { tab: tabParam, q, page: pageParam, pageSize: pageSizeParam } = await searchParams;
  const t = m.admin.preview.review;

  const real = await previewReviewQueue(supabase);
  const entries: Entry[] = [
    ...real.map((item): Entry => {
      if (item.kind === "verification") {
        return {
          key: `verification-${item.row.id}`,
          kind: "verification",
          href: `/admin/review/verification/${item.row.id}`,
          title: item.row.subjectName,
          at: item.row.submittedAt,
          summary: (m.admin.verificationType as Record<string, string>)[item.row.verificationType] ?? item.row.verificationType,
          context: null,
          status: "submitted",
        };
      }
      const isNetwork = item.kind === "networkReferral";
      return {
        key: `${item.kind}-${item.row.id}`,
        kind: item.kind,
        href: `/admin/review/${isNetwork ? "network-referral" : "sales-referral"}/${item.row.id}`,
        title: item.row.displayName ?? "",
        at: item.row.createdAt,
        summary: `${t.network.referrer}: ${item.row.referrerName ?? "—"}`,
        // Network Referrals show reward eligibility; the rule is the live one:
        // +100 only when a genuinely NEW organization is created, not on link-to-existing.
        context: isNetwork ? (item.row.matchId ? t.network.rewardNotEligible : t.network.rewardEligible) : null,
        status: "submitted",
      };
    }),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const tab = (["networkReferrals", "verifications", "salesReferrals"] as const).find((v) => v === tabParam) ?? "";
  const tabKind: Record<string, Kind> = {
    networkReferrals: "networkReferral",
    verifications: "verification",
    salesReferrals: "salesReferral",
  };
  // Every row is a REAL record (previewReviewQueue reads the live verification, network-referral and sales-referral queues);
  // the header, the tab counts and the listed rows are all derived from the same list, so they cannot disagree.
  const count = (k: Kind) => entries.filter((e) => e.kind === k).length;

  const query = (q ?? "").trim().toLowerCase();
  const filtered = entries
    .filter((e) => !tab || e.kind === tabKind[tab])
    .filter((e) => !query || `${e.title} ${e.summary}`.toLowerCase().includes(query));
  const pageSize = clampPageSize(pageSizeParam);
  const slice = paginate(filtered, pageParam, pageSize);

  const kindLabel: Record<Kind, string> = {
    networkReferral: t.typeNetworkReferral,
    verification: t.typeVerification,
    salesReferral: t.typeSalesReferral,
  };
  // A lead edge + badge tone per type, so the separated workflows are visible at a glance.
  const kindStyle: Record<Kind, { edge: string; tone: "accent" | "info" | "neutral" | "warning" }> = {
    networkReferral: { edge: "bg-info", tone: "info" },
    verification: { edge: "bg-fg-muted", tone: "neutral" },
    salesReferral: { edge: "bg-warning", tone: "warning" },
  };

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={t.title} subtitle={t.subtitle} count={filtered.length} />

      <TabLinks
        basePath="/admin/review"
        param="tab"
        current={tab}
        locale={locale}
        keep={{ q }}
        label={t.title}
        tabs={[
          { value: "", label: t.tabs.all, count: entries.length },
          { value: "networkReferrals", label: t.tabs.networkReferrals, count: count("networkReferral") },
          { value: "verifications", label: t.tabs.verifications, count: count("verification") },
          { value: "salesReferrals", label: t.tabs.salesReferrals, count: count("salesReferral") },
        ]}
      />

      <p role="note" className="-mt-2 text-label text-fg-muted">
        {t.separationNote}
      </p>
      <AutoFilters fields={[{ kind: "text", name: "q", placeholder: m.admin.preview.users.searchPlaceholder }]} />

      {filtered.length === 0 ? (
        <StatePanel title={t.empty} />
      ) : (
        <>
          <div className="flex flex-col gap-sm">
            {slice.rows.map((e) => (
              <Link key={e.key} href={e.href}>
                <Card
                  pad="sm"
                  className="flex flex-wrap items-center justify-between gap-md transition-colors hover:bg-surface-2/40"
                >
                  {/* Coloured lead edge: the request type is visible before any text is read. */}
                  <span aria-hidden="true" className={cn("w-1 shrink-0 self-stretch rounded-pill", kindStyle[e.kind].edge)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body-lg font-medium text-fg">
                        <bdi dir="auto">{e.title}</bdi>
                      </p>
                      <Badge tone={kindStyle[e.kind].tone}>{kindLabel[e.kind]}</Badge>
                    </div>
                    <p className="text-label text-fg-muted">
                      <bdi dir="auto">{e.summary}</bdi> · {t.submittedOn}: {formatAdminDate(e.at, locale)}
                    </p>
                    {e.context ? <p className="mt-0.5 text-label text-fg-secondary">{e.context}</p> : null}
                  </div>
                  <StatusBadge
                    status={e.status === "underReview" ? "under_review" : "submitted"}
                    label={e.status === "underReview" ? t.orgRequest.statusUnderReview : t.orgRequest.statusSubmitted}
                  />
                </Card>
              </Link>
            ))}
          </div>
          <TablePagination {...slice} pageSize={pageSize} />
        </>
      )}
    </div>
  );
}
