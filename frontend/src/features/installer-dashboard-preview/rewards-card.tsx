"use client";

import Image from "next/image";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/ui/format";
import { ProgressMeter } from "@/components/ui/primitives";
import { ClipboardIcon, GiftIcon, StarIcon } from "@/components/ui/icons";
import { PROFILE, REWARDS, pick } from "./mock-data";

/**
 * "My points and rewards" — a real rewards moment, not a fourth stat tile.
 * The supplied gold medal artwork is the one place this card spends a real
 * image rather than a drawn icon; it stays a 44px accent beside the balance,
 * not a hero illustration. Ratings and completed jobs used to have their own
 * permanent bottom-grid card — moved here as a one-line reputation strip once
 * profile completion (the thing that actually justified that card's size)
 * became a temporary banner instead (see `ProfileCompletionBanner`).
 */
export function RewardsCard() {
  const { locale } = useI18n();
  const remaining = REWARDS.nextLevelAt - REWARDS.points;

  return (
    <div
      id="rewards"
      className="flex h-full scroll-mt-24 flex-col gap-3.5 rounded-lg border border-iris-solid/25 bg-gradient-to-br from-iris-solid/10 via-iris-solid/5 to-transparent p-4 shadow-card"
    >
      <div className="flex min-h-12 items-start gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-iris-solid/10 text-iris">
          <GiftIcon size={16} />
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
          <p className="font-mono text-headline leading-none text-fg">{formatNumber(REWARDS.points, locale)}</p>
          <p className="text-caption text-fg-muted">
            {locale === "ar" ? "نقطة" : "points"} · {pick(locale, REWARDS.levelLabel)}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <ProgressMeter
          value={(REWARDS.points / REWARDS.nextLevelAt) * 100}
          tone="accent"
          size="sm"
          label={locale === "ar" ? "التقدم نحو المستوى التالي" : "Progress to next level"}
        />
        <p className="text-caption text-fg-secondary">
          {locale === "ar"
            ? `باقي ${formatNumber(remaining, locale)} نقطة للمستوى التالي (${pick(locale, REWARDS.nextLevelLabel)})`
            : `${formatNumber(remaining, locale)} points to ${pick(locale, REWARDS.nextLevelLabel)}`}
        </p>
      </div>

      <div className="rounded-md border bg-surface px-3 py-2.5">
        <p className="text-caption text-fg-muted">{locale === "ar" ? "آخر المكافآت" : "Recent reward"}</p>
        <p className="mt-0.5 text-body-lg font-medium text-fg">{pick(locale, REWARDS.recentReward)}</p>
        <p className="text-caption text-fg-muted">{pick(locale, REWARDS.recentRewardAgo)}</p>
      </div>

      <button
        type="button"
        className="mt-auto rounded-sm bg-iris-solid px-4 py-2 text-label font-semibold text-white transition-colors hover:brightness-105"
      >
        {locale === "ar" ? "عرض كل المكافآت" : "View all rewards"}
      </button>

      <div className="flex items-center justify-between gap-2 border-t pt-3 text-body text-fg-secondary">
        <span className="flex items-center gap-1.5">
          <StarIcon size={14} className="text-accent-solid" />
          <span className="font-mono font-semibold text-fg">
            {formatNumber(PROFILE.rating, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          </span>
          <span className="text-caption text-fg-muted">({formatNumber(PROFILE.ratingCount, locale)})</span>
        </span>
        <span className="flex items-center gap-1.5">
          <ClipboardIcon size={14} className="text-success" />
          <span className="font-mono font-semibold text-fg">{formatNumber(PROFILE.completedJobs, locale)}</span>
          <span className="text-caption text-fg-muted">{locale === "ar" ? "عمل منجز" : "jobs done"}</span>
        </span>
      </div>
    </div>
  );
}
