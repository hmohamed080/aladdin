import Link from "next/link";
import { Card, Badge } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import { DataTable, RecordCell, Monogram, ListFooter } from "@/components/ui/data-table";
import { StarIcon, PhoneIcon, MessageIcon, MapPinIcon } from "@/components/ui/icons";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { formatDate, formatMoney } from "@/lib/ui/format";
import type { NetworkWorkHistoryRow } from "@/server/queries/network";
import type { OrganizationRow } from "@/lib/network/rows";

/**
 * "What work have I actually completed with this organization?" (§7/§13),
 * now also answering "did I refer this organization, and when?" when that
 * is the ONLY relationship that exists yet — a joined referral with no
 * completed work is a real, distinct state, never padded with fake
 * completed-work fields to look like more than it is.
 *
 * SAFE IDENTITY ONLY. No organization internals reach this page: no member
 * list, no applicant list, no B2B data. Everything here is either public
 * organization identity, the caller's OWN completed-work record
 * (`my_network_work_history`), or the caller's OWN referral record
 * (`my_network_referrals`) — never another user's.
 */
export function OrganizationDetail({
  row,
  history,
  reviewCount,
  t,
  locale,
}: {
  row: OrganizationRow;
  /** Only meaningful when `row.completedWork` exists. */
  history: NetworkWorkHistoryRow[];
  reviewCount: number;
  t: TranslateFn;
  locale: Locale;
}) {
  const { completedWork, referral } = row;
  const phone = referral?.origin === "new_showroom" ? referral.phone : null;
  const location =
    referral?.origin === "new_showroom" && (referral.governorate || referral.city)
      ? [referral.governorate, referral.city].filter(Boolean).join(" · ")
      : null;

  return (
    <div className="flex flex-col gap-xl" data-testid="network-organization-detail">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-wrap items-center gap-3">
          <Monogram name={row.orgName} size={48} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-label text-fg-muted">{t("network.detail.eyebrow")}</p>
            <h1 className="truncate text-headline text-fg">
              <bdi dir="auto">{row.orgName}</bdi>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {completedWork ? (
                <Badge tone="success">{t("network.badge.verified")}</Badge>
              ) : (
                <Badge tone="accent">{t("network.badge.referred")}</Badge>
              )}
              {completedWork && referral ? (
                <span className="text-label text-fg-muted">{t("network.badge.referredToo")}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-sm">
          {phone ? (
            <a
              href={`tel:${phone}`}
              className="inline-flex items-center gap-1.5 rounded-sm border border-strong px-3 py-1.5 text-label font-medium text-fg-secondary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <PhoneIcon size={14} />
              {t("network.actions.call")}
            </a>
          ) : null}
          <span
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-sm border border-strong/60 px-3 py-1.5 text-label text-fg-muted"
          >
            <MessageIcon size={14} />
            {t("network.actions.messageSoon")}
          </span>
        </div>
      </div>

      {completedWork ? (
        <Card className="flex flex-col gap-lg">
          <h2 className="text-title text-fg">{t("network.detail.summaryTitle")}</h2>
          <dl data-testid="relationship-summary" className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-4">
            <SummaryField label={t("network.detail.completedCount")} value={String(completedWork.completedCount)} />
            <SummaryField label={t("network.detail.firstWorked")} value={formatDate(completedWork.firstCompletedAt, locale)} />
            <SummaryField label={t("network.detail.latestWorked")} value={formatDate(completedWork.lastCompletedAt, locale)} />
            <SummaryField
              label={t("network.detail.trades")}
              value={completedWork.tradeKeys.map((k) => tradeLabel(t, k)).join(" · ") || "—"}
            />
          </dl>

          {reviewCount > 0 ? (
            <div className="flex items-center gap-2 border-t pt-md">
              <StarIcon size={16} className="shrink-0 text-fg-secondary" />
              <p className="text-body text-fg-secondary">
                {t("network.detail.reviewsCount", { n: reviewCount })}
              </p>
              <Link href="/home/reviews" className="ms-auto text-label text-accent hover:underline">
                {t("network.detail.reviewsTitle")}
              </Link>
            </div>
          ) : null}
        </Card>
      ) : (
        <div data-testid="referral-only-summary">
          <Card className="flex flex-col gap-sm">
            <h2 className="text-title text-fg">{t("network.detail.referralTitle")}</h2>
            <p className="text-body text-fg-secondary">
              {t("network.detail.referralBody", { date: formatDate(referral?.decidedAt ?? referral?.createdAt ?? null, locale) })}
            </p>
            {location ? (
              <p className="flex items-center gap-1.5 text-label text-fg-muted">
                <MapPinIcon size={13} className="shrink-0" />
                <bdi dir="auto">{location}</bdi>
              </p>
            ) : null}
            <p className="text-label text-fg-muted">{t("network.detail.referralNoWorkYet")}</p>
          </Card>
        </div>
      )}

      <section aria-labelledby="network-history">
        <h2 id="network-history" className="mb-sm text-body-lg font-medium text-fg">
          {t("network.detail.historyTitle")}
        </h2>
        {completedWork ? (
          <WorkHistoryList history={history} t={t} locale={locale} />
        ) : (
          <Card pad="sm">
            <p className="text-body text-fg-secondary">{t("network.detail.referralNoWorkYet")}</p>
          </Card>
        )}
      </section>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd dir="auto" className="break-words text-body-lg font-medium text-fg">
        {value}
      </dd>
    </div>
  );
}

function WorkHistoryList({
  history,
  t,
  locale,
}: {
  history: NetworkWorkHistoryRow[];
  t: TranslateFn;
  locale: Locale;
}) {
  if (history.length === 0) {
    return (
      <Card pad="sm">
        <p className="text-body text-fg-secondary">{t("network.detail.notFound")}</p>
      </Card>
    );
  }

  return (
    <>
      <DataTable
        caption={t("network.detail.historyTitle")}
        rows={history}
        rowKey={(r) => r.assignmentId}
        empty={null}
        columns={[
          {
            key: "job",
            header: t("work.list.job"),
            grow: true,
            cell: (r) => (
              <RecordCell
                title={r.jobTitle}
                meta={tradeLabel(t, r.tradeKey)}
                href={`/home/work/${r.assignmentId}`}
              />
            ),
          },
          {
            key: "amount",
            header: t("work.list.amount"),
            numeric: true,
            cell: (r) => formatMoney(r.agreedAmount, locale),
          },
          {
            key: "date",
            header: t("network.detail.latestWorked"),
            numeric: true,
            desktopOnly: true,
            secondary: true,
            cell: (r) => formatDate(r.completedAt, locale),
          },
          {
            key: "view",
            header: "",
            cell: (r) => (
              <ButtonLink href={`/home/work/${r.assignmentId}`} variant="outline" size="sm">
                {t("network.detail.viewAssignment")}
              </ButtonLink>
            ),
          },
        ]}
      />
      <ListFooter>{t("network.list.showing")}</ListFooter>
    </>
  );
}
