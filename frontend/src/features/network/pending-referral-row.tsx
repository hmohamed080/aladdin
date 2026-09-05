import { Card, Badge } from "@/components/ui/primitives";
import { Monogram } from "@/components/ui/data-table";
import { PhoneIcon, MapPinIcon } from "@/components/ui/icons";
import { ResendButton } from "./resend-button";
import { PendingRowMenu } from "./pending-row-menu";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { formatDate } from "@/lib/ui/format";
import type { NetworkReferral } from "@/server/queries/network-referrals";

/**
 * A pending referral — deliberately NOT shaped like an organization row
 * (§11 of the increment brief). No "View relationship", no completed-work
 * figures, no organization identity: it is a candidate the platform has not
 * reviewed yet, and the card says exactly that and nothing more.
 *
 * Shared by two surfaces: the Network Directory's "All"/"Pending" tabs, and
 * (as a preview) the Pending Invitations rail panel — one component, so the
 * two never drift.
 *
 * Withdraw moved out of the row body into `PendingRowMenu`'s compact
 * overflow (revisit §8); Resend is now a real share action (`ResendButton`,
 * revisit §14), not a disabled placeholder.
 */
export function PendingReferralRow({
  referral,
  t,
  locale,
}: {
  referral: NetworkReferral;
  t: TranslateFn;
  locale: Locale;
}) {
  const location = [referral.governorate, referral.city].filter(Boolean).join(" · ");

  return (
    // `Card` does not forward `data-testid` — the marker lives on this wrapper.
    <div data-testid="pending-referral-row">
      <Card className="flex flex-col gap-xs" pad="sm">
        <div className="flex flex-wrap items-start gap-2">
          <Monogram name={referral.displayName ?? "—"} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-fg">
              <bdi dir="auto">{referral.displayName}</bdi>
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="warning">{t("network.badge.pending")}</Badge>
              <span className="text-label text-fg-muted">
                {t("network.pending.submitted", { date: formatDate(referral.createdAt, locale) })}
              </span>
            </div>
            {location ? (
              <p className="mt-0.5 flex items-center gap-1 text-label text-fg-muted">
                <MapPinIcon size={11} className="shrink-0" />
                <bdi dir="auto">{location}</bdi>
              </p>
            ) : null}
          </div>
          <PendingRowMenu
            referralId={referral.id}
            label={t("network.pending.menuLabel")}
            withdrawLabel={t("network.pending.withdraw")}
          />
        </div>

        <div className="flex flex-wrap items-center gap-sm border-t pt-xs">
          {referral.phone ? (
            <a
              href={`tel:${referral.phone}`}
              className="inline-flex items-center gap-1.5 rounded-sm border border-strong px-2.5 py-1.5 text-label font-medium text-fg-secondary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <PhoneIcon size={14} />
              {t("network.actions.call")}
            </a>
          ) : null}
          <ResendButton name={referral.displayName ?? ""} variant="full" />
        </div>
      </Card>
    </div>
  );
}
