import { Card, Badge } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import { Monogram } from "@/components/ui/data-table";
import { PhoneIcon, MessageIcon, MapPinIcon } from "@/components/ui/icons";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { formatDate } from "@/lib/ui/format";
import type { OrganizationRow } from "@/lib/network/rows";

/**
 * One organization — a rich row, not a sparse table line (§10 of the
 * increment brief).
 *
 * ONE PRIMARY BADGE, secondary context beside it — never both stacked as
 * equals (§10's "avoid badge overload"). A verified work relationship is the
 * stronger fact and leads when both exist; a referral-only organization
 * shows its own badge instead of a blank space pretending to be one.
 *
 * CALL IS NEVER SHOWN FOR THE ORGANIZATION ITSELF. No `organizations.phone`
 * column exists anywhere in this schema, and an installer who is not a
 * member has no authorized channel to one they merely worked for or
 * referred. The only phone that can ever appear here is the REFERRER'S OWN
 * typed contact for a case-B (not-yet-registered) referral — their data,
 * about their own referral, never the organization's.
 */
export function RelationshipRow({
  row,
  t,
  locale,
}: {
  row: OrganizationRow;
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
    // `Card` does not forward `data-testid` (it destructures a fixed prop
    // set) — the marker lives on this wrapper instead.
    <div data-testid="relationship-row">
      <Card className="flex flex-col gap-xs" pad="sm">
        <div className="flex flex-wrap items-start gap-2">
          <Monogram name={row.orgName} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-fg">
              <bdi dir="auto">{row.orgName}</bdi>
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {completedWork ? (
                <Badge tone="success">{t("network.badge.verified")}</Badge>
              ) : (
                <Badge tone="accent">{t("network.badge.referred")}</Badge>
              )}
              {completedWork && referral ? (
                <span className="text-label text-fg-muted">{t("network.badge.referredToo")}</span>
              ) : null}
            </div>
            {location ? (
              <p className="mt-0.5 flex items-center gap-1 text-label text-fg-muted">
                <MapPinIcon size={11} className="shrink-0" />
                <bdi dir="auto">{location}</bdi>
              </p>
            ) : null}
          </div>
        </div>

        {completedWork ? (
          <dl className="flex flex-wrap gap-x-lg gap-y-1 border-t pt-xs text-label">
            <RowFact
              label={t("network.summary.completed")}
              value={t("network.list.completedCount", { n: completedWork.completedCount })}
            />
            <RowFact label={t("network.detail.latestWorked")} value={formatDate(completedWork.lastCompletedAt, locale)} />
            <RowFact
              label={t("network.tradeLabel")}
              value={completedWork.tradeKeys.map((k) => tradeLabel(t, k)).join(" · ") || "—"}
            />
          </dl>
        ) : null}

        <div className="flex flex-wrap items-center gap-sm border-t pt-xs">
          {phone ? (
            <a
              href={`tel:${phone}`}
              className="inline-flex items-center gap-1.5 rounded-sm border border-strong px-2.5 py-1 text-label font-medium text-fg-secondary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <PhoneIcon size={13} />
              {t("network.actions.call")}
            </a>
          ) : null}
          <span
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-sm border border-strong/60 px-2.5 py-1 text-label text-fg-muted"
          >
            <MessageIcon size={13} />
            {t("network.actions.messageSoon")}
          </span>
          <ButtonLink href={`/home/network/${row.orgId}`} variant="outline" size="sm" className="ms-auto">
            {t("network.list.view")}
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}

function RowFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-fg-muted">{label}:</dt>
      <dd className="truncate font-medium text-fg">{value}</dd>
    </div>
  );
}
