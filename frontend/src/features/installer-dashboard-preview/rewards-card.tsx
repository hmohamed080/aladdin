"use client";

import Image from "next/image";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/ui/format";
import { ProgressMeter } from "@/components/ui/primitives";
import { ClipboardIcon, GiftIcon, StarIcon } from "@/components/ui/icons";
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
 *
 * The outer border is the same `border-strong` every other module card on
 * this dashboard uses (see `module-card.tsx`'s own note) — this card doesn't
 * go through `ModuleCard` (it needs its own iris-tinted background wash), so
 * the border treatment is repeated here rather than inherited.
 */
export function RewardsCard({ data, viewAllHref }: { data: InstallerRewardsVM; viewAllHref?: string }) {
  const { locale } = useI18n();
  const remaining = data.level ? data.level.nextAt - data.points : null;

  return (
    <div
      id="rewards"
      data-module-card=""
      className="flex h-full min-h-0 scroll-mt-24 flex-col gap-3.5 rounded-lg border border-strong bg-gradient-to-br from-iris-solid/10 via-iris-solid/5 to-transparent p-4 shadow-card"
    >
      <div className="flex h-14 shrink-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-iris-solid/10 text-iris">
          <GiftIcon size={22} />
        </span>
        <h2 className="text-title text-fg">{locale === "ar" ? "نقاطي ومكافآتي" : "My points & rewards"}</h2>
      </div>

      <div className="flex items-center gap-3">
        <Image
          src="/assets/installer-dashboard/rewards/medal.webp"
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 shrink-0 object-contain"
        />
        <div>
          <p className="font-mono text-headline leading-none text-fg">{formatNumber(data.points, locale)}</p>
          <p className="text-caption text-fg-muted">
            {locale === "ar" ? "نقطة" : "points"}
            {data.level ? ` · ${pick(locale, data.level.label)}` : ""}
          </p>
        </div>
      </div>

      {data.level && remaining !== null ? (
        <div className="flex flex-col gap-1.5">
          <ProgressMeter
            value={(data.points / data.level.nextAt) * 100}
            tone="accent"
            size="sm"
            label={locale === "ar" ? "التقدم نحو المستوى التالي" : "Progress to next level"}
          />
          <p className="text-caption text-fg-secondary">
            {locale === "ar"
              ? `باقي ${formatNumber(remaining, locale)} نقطة للمستوى التالي (${pick(locale, data.level.nextLabel)})`
              : `${formatNumber(remaining, locale)} points to ${pick(locale, data.level.nextLabel)}`}
          </p>
        </div>
      ) : null}

      <div className="rounded-md border border-strong bg-surface px-3 py-2.5">
        <p className="text-caption text-fg-muted">{locale === "ar" ? "آخر نشاط" : "Recent activity"}</p>
        {data.recentActivity ? (
          <>
            <p className="mt-0.5 text-body-lg font-medium text-fg">{data.recentActivity.title}</p>
            <p className="text-caption text-fg-muted">{data.recentActivity.dateLabel}</p>
          </>
        ) : (
          <p className="mt-0.5 text-body text-fg-muted">
            {locale === "ar" ? "لا يوجد نشاط بعد." : "No activity yet."}
          </p>
        )}
      </div>

      <div className="mt-auto flex shrink-0 flex-col gap-3">
        {viewAllHref ? (
          <Link
            href={viewAllHref}
            className="rounded-sm bg-[var(--installer-cta)] px-4 py-2 text-center text-label font-semibold text-white transition-colors hover:bg-[var(--installer-cta-hover)]"
          >
            {locale === "ar" ? "عرض كل المكافآت" : "View all rewards"}
          </Link>
        ) : null}

        {data.rating !== null || data.completedJobs > 0 ? (
          <div className="flex items-center justify-between gap-2 border-t border-strong pt-3 text-body text-fg-secondary">
            <span className="flex items-center gap-1.5">
              <StarIcon size={18} className="text-accent-solid" />
              <span className="font-mono font-semibold text-fg">
                {data.rating === null ? "—" : formatNumber(data.rating, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
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
    </div>
  );
}
