import Link from "next/link";
import { Panel } from "@/components/ui/workspace-layout";
import { ProgressMeter } from "@/components/ui/primitives";
import { GaugeIcon } from "@/components/ui/icons";
import { formatPointsBalance } from "@/features/points/view-model";
import { derivePointsLevel } from "@/lib/network/points-level";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The rich Network Points card (revisit §10/§11) — header, real balance, a
 * derived level ring, a progress bar toward the next level, two real
 * referral-contribution stats, and a footer link. Every figure here is real:
 * `pointsBalance` is the caller's own ledger balance, `referredOrgsCount` and
 * `showroomsAddedCount` come straight from `network_referrals`, and the level
 * itself is `derivePointsLevel`'s pure, always-recomputed read of that same
 * real balance — never a second, storable number.
 */
export function NetworkPointsPanel({
  pointsBalance,
  referredOrgsCount,
  showroomsAddedCount,
  t,
  locale,
}: {
  pointsBalance: number;
  /** Distinct organizations joined through the caller's referral — real. */
  referredOrgsCount: number;
  /** Not-yet-registered showrooms the caller has referred — real. */
  showroomsAddedCount: number;
  t: TranslateFn;
  locale: Locale;
}) {
  const info = derivePointsLevel(pointsBalance);
  const figure = formatPointsBalance(pointsBalance, locale);

  return (
    <Panel
      title={t("network.rail.pointsTitle")}
      Icon={GaugeIcon}
      tone="accent"
      fill
      foot={
        <Link href="/home/points" className="block text-center text-label font-medium text-accent hover:underline">
          {t("network.rail.viewPoints")}
        </Link>
      }
    >
      <div className="flex flex-col gap-md">
        <div className="flex items-center gap-3">
          <LevelRing level={info.level} progressPct={info.progressPct} label={t("network.rail.levelLabel")} />
          <div
            className="min-w-0"
            aria-label={t("points.balance.description", { amount: figure })}
          >
            <p aria-hidden="true" className="font-display text-headline leading-none tabular-nums text-fg">
              {figure}
            </p>
            <p aria-hidden="true" className="mt-1 text-label text-fg-muted">
              {t("points.balance.unit")}
            </p>
          </div>
        </div>

        <div aria-label={t("network.rail.levelValue", { n: info.level })}>
          <ProgressMeter value={info.progressPct} label={t("network.rail.pointsTitle")} tone="accent" />
          <p className="mt-1.5 text-label text-fg-muted">
            {info.isMaxLevel
              ? t("network.rail.maxLevel")
              : t("network.rail.remainingToNext", { n: info.remainingToNextLevel ?? 0 })}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-sm border-t pt-sm">
          <RailStat value={referredOrgsCount} label={t("network.rail.referredOrgs")} />
          <RailStat value={showroomsAddedCount} label={t("network.rail.showroomsAdded")} />
        </div>
      </div>
    </Panel>
  );
}

/** A small circular level indicator — decorative geometry; the level itself is announced by the surrounding progress region's `aria-label`. */
function LevelRing({ level, progressPct, label }: { level: number; progressPct: number; label: string }) {
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.min(100, Math.max(0, progressPct)) / 100) * circumference;

  return (
    <div className="relative grid h-14 w-14 shrink-0 place-items-center">
      <svg viewBox="0 0 48 48" className="h-14 w-14 -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r={radius} className="stroke-surface-2" strokeWidth="4" fill="none" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          className="stroke-accent-solid"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <span aria-hidden="true" className="absolute flex flex-col items-center leading-none">
        <span className="text-[0.6rem] text-fg-muted">{label}</span>
        <span className="text-body-lg font-semibold tabular-nums text-fg">{level}</span>
      </span>
    </div>
  );
}

function RailStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0 rounded-sm bg-surface-2/50 px-sm py-1.5">
      <p className="font-display text-title leading-none tabular-nums text-fg">{value}</p>
      <p className="mt-1 truncate text-caption text-fg-muted">{label}</p>
    </div>
  );
}
