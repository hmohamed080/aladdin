"use client";

import Image from "next/image";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/ui/format";
import { ProgressMeter } from "@/components/ui/primitives";
import { ClipboardIcon, GiftIcon, StarIcon } from "@/components/ui/icons";
import { NetworkTrophyIcon } from "@/features/installer-network-preview/network-visuals";
import { pick } from "./mock-data";
import type { InstallerRewardsVM } from "./view-model";

/**
 * "My points and rewards" — a real rewards moment, not a fourth stat tile.
 *
 * `data.level` is null on real data: no points-level/progression system
 * exists in the backend (only a running balance, `points_ledger` + the
 * `points_balance()` RPC), so production never invents a "Silver Pro" tier or
 * a "points to next level" figure — the progress bar and level copy simply do
 * not render, and the card leads with the real balance instead.
 */
export function RewardsCard({ data, viewAllHref }: { data: InstallerRewardsVM; viewAllHref?: string }) {
  const { locale } = useI18n();
  const remaining = data.level ? data.level.nextAt - data.points : null;

  return (
    <div
      id="rewards"
      data-module-card=""
      className="flex h-full min-h-0 scroll-mt-24 flex-col rounded-lg border border-strong bg-surface p-md shadow-card desktop:min-h-96 desktop:p-3"
    >
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2 rounded-sm border border-strong bg-surface-2/45 px-2.5 py-1.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-iris">
            <NetworkTrophyIcon size={22} />
          </span>
          <h2 className="text-title text-fg">{locale === "ar" ? "نقاطي ومكافآتي" : "My points & rewards"}</h2>
        </div>
      </div>

      <div className="mt-md flex min-h-28 items-center justify-between gap-md overflow-hidden rounded-md bg-iris-solid px-md py-sm text-on-accent desktop:mt-2">
        <div className="min-w-0">
          <p className="text-caption font-medium text-on-accent/80">{locale === "ar" ? "رصيد نقاطك" : "Points balance"}</p>
          <div className="mt-1 flex items-end gap-xs">
            <strong className="font-mono text-headline font-semibold leading-none tabular-nums">{formatNumber(data.points, locale)}</strong>
            <span className="pb-0.5 text-caption">{locale === "ar" ? "نقطة" : "points"}</span>
          </div>
        </div>
        <Image
          src="/assets/installer-dashboard/rewards/medal.webp"
          alt=""
          width={72}
          height={72}
          className="h-16 w-16 shrink-0 object-contain"
        />
      </div>

      {data.level && remaining !== null ? (
        <div className="mt-md flex flex-col gap-2 desktop:mt-2 desktop:gap-1">
          <p className="text-caption text-fg-secondary">
            {locale === "ar"
              ? `باقي ${formatNumber(remaining, locale)} نقطة للمستوى التالي (${pick(locale, data.level.nextLabel)})`
              : `${formatNumber(remaining, locale)} points to ${pick(locale, data.level.nextLabel)}`}
          </p>
          <ProgressMeter
            value={(data.points / data.level.nextAt) * 100}
            tone="iris"
            size="md"
            label={locale === "ar" ? "التقدم نحو المستوى التالي" : "Progress to next level"}
          />
          <p className="text-end font-mono text-caption tabular-nums text-fg-secondary">{formatNumber(data.points, locale)} / {formatNumber(data.level.nextAt, locale)}</p>
        </div>
      ) : null}

      <div className="mt-md rounded-md border border-strong bg-canvas p-sm desktop:mt-2 desktop:p-2">
        <p className="text-label font-semibold text-fg">{locale === "ar" ? "آخر المكافآت" : "Latest rewards"}</p>
        {data.recentActivity ? (
          <div className="mt-sm flex items-center gap-sm rounded-sm bg-success/5 p-sm desktop:mt-1 desktop:p-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-success/10 text-success">
              <GiftIcon size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-caption font-semibold leading-snug text-fg">{data.recentActivity.title}</p>
              <p className="text-caption text-fg-muted">{data.recentActivity.dateLabel}</p>
            </div>
            {data.recentActivity.deltaLabel ? <strong className="shrink-0 font-mono text-caption tabular-nums text-fg">{data.recentActivity.deltaLabel}</strong> : null}
          </div>
        ) : (
          <p className="mt-sm text-body text-fg-muted">
            {locale === "ar" ? "لا يوجد نشاط بعد." : "No activity yet."}
          </p>
        )}
      </div>

      <div className="mt-auto pt-sm desktop:pt-1.5">
        {viewAllHref ? (
          <Link
            href={viewAllHref}
            className="block w-full rounded-sm border border-strong px-md py-2 text-center text-label font-semibold text-iris transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {locale === "ar" ? "عرض كل المكافآت" : "View all rewards"}
          </Link>
        ) : (
          <button
            type="button"
            className="w-full rounded-sm border border-strong px-md py-2 text-center text-label font-semibold text-iris transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {locale === "ar" ? "عرض كل المكافآت" : "View all rewards"}
          </button>
        )}
      </div>

      {!data.level && (data.rating !== null || data.completedJobs > 0) ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-strong pt-2 text-body text-fg-secondary">
          <span className="flex items-center gap-1.5">
            <StarIcon size={18} className="text-accent-solid" />
            <span className="font-mono font-semibold text-fg">
              {data.rating === null
                ? "—"
                : formatNumber(data.rating, locale, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
            </span>
            <span className="text-caption text-fg-muted">({formatNumber(data.ratingCount, locale)})</span>
          </span>
          <span className="flex items-center gap-1.5">
            <ClipboardIcon size={18} className="text-success" />
            <span className="font-mono font-semibold text-fg">{formatNumber(data.completedJobs, locale)}</span>
            <span className="text-caption text-fg-muted">{locale === "ar" ? "عمل منجز" : "jobs done"}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
