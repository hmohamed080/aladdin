import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BarChartIcon, ClockIcon, CrownIcon, GiftIcon } from "@/components/ui/icons";
import { POINT_SOURCES, PREVIEW_REWARDS } from "@/features/installer-points-preview/preview-data";
import type { Locale } from "@/lib/i18n/locales";
import { derivePointsLevel } from "@/lib/network/points-level";
import { POINTS_LEVEL_BADGE_ASSET } from "@/lib/network/points-level-assets";
import type { PointsEntryView } from "@/features/points/view-model";
import type { PointsOverview } from "@/server/queries/points";

/**
 * `/home/points` for an Installer: the APPROVED Points design (`/preview/installer-points`) on the real ledger.
 *
 *   * Balance and this month's totals are the database's exact figures (`my_points_overview`).
 *   * The level card and the progress card use the approved PRESENTATION-ONLY bands (`derivePointsLevel`, "Level N"):
 *     derived from the balance, stored nowhere, gating nothing.
 *   * "Ways to earn" and "My rewards" follow the approved design. The ledger awards an approved showroom referral
 *     (REFERRAL_POINTS, migration 20260830090002); redemption is not live yet and the card says so.
 *   * Recent history is the latest ledger rows; "View all" opens `/home/points/history`.
 */
/** The ledger's award for an approved business referral (product decision D1). */
const REFERRAL_POINTS = 100;

export function InstallerPoints({
  locale,
  overview,
  recent,
}: {
  locale: Locale;
  overview: PointsOverview;
  recent: readonly PointsEntryView[];
}) {
  const ar = locale === "ar";
  return (
    <div dir={ar ? "rtl" : "ltr"} data-installer-points className="flex w-full min-w-0 flex-col gap-md">
      <PointsHero locale={locale} title={ar ? "نقاطي ومكافآتي" : "My points & rewards"} subtitle={ar ? "تابع نقاطك، مستواك، والمكافآت التي تستحقها" : "Track your points, level, and the rewards you have earned"} />
      <section aria-label={ar ? "ملخص النقاط" : "Points summary"} className="grid min-w-0 gap-md wide:grid-cols-[minmax(0,1.15fr)_minmax(15rem,0.68fr)_minmax(0,0.95fr)]" dir="ltr">
        <CurrentLevelCard locale={locale} balance={overview.balance} />
        <PointsTotalCard locale={locale} overview={overview} />
        <ProgressCard locale={locale} balance={overview.balance} />
      </section>
      <section dir={ar ? "rtl" : "ltr"} aria-labelledby="sources-title" className="rounded-md border border-strong bg-surface p-lg shadow-card" data-testid="points-sources">
        <header className="mb-md"><h2 id="sources-title" className="flex items-center gap-sm text-title text-fg"><IconBubble><GiftIcon size={22} /></IconBubble>{ar ? "مصادر النقاط" : "Ways to earn points"}</h2><p className="mt-1 text-body text-fg-secondary">{ar ? "اكسب النقاط من هذه الأنشطة على المنصة." : "Earn points from these activities on the platform."}</p></header>
        <div className="grid gap-sm min-[430px]:grid-cols-2 desktop:grid-cols-3 wide:grid-cols-5">
          {POINT_SOURCES.map(({ id, title, points, description, Icon }) => (
            <article key={id} className="flex min-h-48 flex-col rounded-md border border-strong bg-canvas p-md" data-testid="points-source">
              <div className="flex items-center justify-between gap-sm"><IconBubble large><Icon size={26} /></IconBubble><h3 className="text-body-lg font-bold text-fg">{title[locale]}</h3></div>
              <p className="mt-sm text-title font-bold text-accent-solid">+{id === "showroom-added" ? REFERRAL_POINTS : points} <span className="text-label">{ar ? "نقطة" : "points"}</span></p>
              <p className="mt-sm text-body leading-relaxed text-fg-secondary">{id === "showroom-added" ? (ar ? `احصل على ${REFERRAL_POINTS} نقطة عند اعتماد معرض رشحته للمنصة.` : `Earn ${REFERRAL_POINTS} points when a showroom you referred is approved.`) : description[locale]}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="grid min-w-0 gap-md wide:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]" dir="ltr">
        <section dir={ar ? "rtl" : "ltr"} aria-labelledby="rewards-title" className="rounded-md border border-strong bg-surface p-lg shadow-card">
          <header><h2 id="rewards-title" className="flex items-center gap-sm text-title text-fg"><IconBubble><GiftIcon size={22} /></IconBubble>{ar ? "مكافآتي" : "My rewards"}</h2></header>
          <p className="mt-1 text-body text-fg-secondary">{ar ? "استبدل نقاطك بمكافآت مميزة." : "Redeem your points for standout rewards."}</p>
          <div className="mt-md grid gap-sm tablet:grid-cols-3 wide:grid-cols-3" data-testid="points-rewards">
            {PREVIEW_REWARDS.map(({ id, title, description, cost, Icon }) => (
              <article key={id} className="flex min-h-56 flex-col items-center rounded-md border border-strong bg-canvas p-md text-center">
                <IconBubble large><Icon size={30} /></IconBubble><h3 className="mt-sm text-body-lg font-bold text-fg">{title[locale]}</h3><p className="mt-sm text-body leading-relaxed text-fg-secondary">{description[locale]}</p><span className="mt-auto block w-full rounded-md bg-accent-solid/10 px-sm py-sm text-label font-bold tabular-nums text-accent-solid">{cost} {ar ? "نقطة" : "points"}</span>
              </article>
            ))}
          </div>
          <p className="mt-sm flex items-center gap-sm text-caption text-fg-secondary"><CrownIcon size={16} className="text-accent-solid" />{ar ? "الاستبدال سيتاح قريبًا، ورصيدك محفوظ حتى ذلك الحين." : "Redemption opens soon; your balance is kept until then."}</p>
        </section>
        <section dir={ar ? "rtl" : "ltr"} aria-labelledby="history-title" className="rounded-md border border-strong bg-surface p-lg shadow-card">
          <header className="flex items-start justify-between gap-md">
            <div><h2 id="history-title" className="flex items-center gap-sm text-title text-fg"><IconBubble><ClockIcon size={22} /></IconBubble>{ar ? "سجل النقاط الأخير" : "Recent points history"}</h2><p className="mt-1 text-body text-fg-secondary">{ar ? "تعرف على آخر الأنشطة التي منحتك نقاطًا." : "See the latest activities on your points."}</p></div>
            <Link href="/home/points/history" className="shrink-0 rounded-md border border-strong bg-canvas px-md py-sm text-label font-semibold text-fg transition-colors hover:bg-accent-solid/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-solid" data-testid="points-view-all">{ar ? "عرض الكل" : "View all"}</Link>
          </header>
          {recent.length === 0 ? (
            <p className="mt-md rounded-md border border-strong bg-canvas px-md py-lg text-center text-body text-fg-secondary">{ar ? "لا توجد أنشطة نقاط بعد." : "No points activity yet."}</p>
          ) : (
            <div className="mt-md overflow-hidden rounded-md border border-strong">
              {recent.map((entry) => (
                <article key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-sm border-b border-strong bg-canvas px-md py-sm last:border-b-0 tablet:grid-cols-[minmax(0,1.4fr)_auto_auto]">
                  <div className="flex min-w-0 items-center gap-sm"><GiftIcon size={19} className="shrink-0 text-accent-solid" /><div className="min-w-0"><h3 className="truncate text-label font-semibold text-fg">{entry.title}</h3>{entry.body || entry.organizationName ? <p className="truncate text-caption text-fg-secondary">{entry.organizationName ?? entry.body}</p> : null}</div></div>
                  <PointsBadge view={entry} />
                  <time dateTime={entry.timestamp} className="col-span-2 text-caption text-fg-secondary tablet:col-span-1">{entry.dateLabel}</time>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function PointsHero({ title, subtitle, locale }: { title: string; subtitle: string; locale: Locale }) {
  return (
    <section aria-labelledby="points-title" className="relative isolate h-32 overflow-hidden rounded-md border border-strong bg-canvas tablet:h-auto tablet:min-h-52">
      <Image src="/assets/installer-points/points-hero.png" alt="" fill priority sizes="(min-width: 1280px) 82vw, 100vw" className="object-cover object-center tablet:object-top" />
      <div className="absolute inset-y-0 right-[3%] z-raised flex w-[50%] items-center justify-center px-2 tablet:right-0 tablet:w-[54%] tablet:px-2xl wide:w-[52%]">
        <div className="max-w-xl text-center" dir={locale === "ar" ? "rtl" : "ltr"}>
          <h1 id="points-title" className="text-title font-bold leading-tight text-brand-basalt tablet:text-display">{title}</h1>
          <p className="mt-1 text-caption leading-snug text-brand-basalt/70 tablet:mt-2 tablet:text-body-lg">{subtitle}</p>
        </div>
      </div>
    </section>
  );
}

function formatPoints(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG").format(value);
}

function CurrentLevelCard({ locale, balance }: { locale: Locale; balance: number }) {
  const ar = locale === "ar";
  const info = derivePointsLevel(balance);
  return (
    <article dir={ar ? "rtl" : "ltr"} className="grid min-h-52 grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-md rounded-md border border-strong bg-surface p-lg shadow-card" data-testid="points-level">
      <div>
        <h2 className="flex items-center gap-sm text-body-lg text-fg-secondary"><IconBubble><CrownIcon size={23} /></IconBubble>{ar ? "المستوى الحالي" : "Current level"}</h2>
        <strong className="mt-2 block text-headline text-fg">{ar ? `المستوى ${formatPoints(info.level, locale)}` : `Level ${info.level}`}</strong>
        <p className="mt-md text-body leading-relaxed text-fg-secondary">
          {info.isMaxLevel
            ? ar ? "وصلت إلى أعلى مستوى. واصل جمع النقاط." : "You have reached the top level. Keep collecting points."
            : ar ? "واصل جمع النقاط للوصول إلى المستوى التالي." : "Keep collecting points to reach the next level."}
        </p>
      </div>
      <Image src={POINTS_LEVEL_BADGE_ASSET[info.level]} alt="" width={180} height={180} className="h-auto w-full object-contain" />
    </article>
  );
}

function PointsTotalCard({ locale, overview }: { locale: Locale; overview: PointsOverview }) {
  const ar = locale === "ar";
  const net = overview.monthEarned - overview.monthDeducted;
  return (
    <article dir={ar ? "rtl" : "ltr"} className="flex min-h-52 flex-col rounded-md border border-strong bg-surface p-lg text-center shadow-card" data-testid="points-total">
      <h2 className="flex items-center justify-center gap-sm text-title text-fg"><IconBubble><GiftIcon size={22} /></IconBubble>{ar ? "إجمالي النقاط" : "Total points"}</h2>
      <strong className="mt-auto text-[clamp(3rem,5vw,4.75rem)] font-bold leading-none tabular-nums text-accent-solid">{formatPoints(overview.balance, locale)}</strong>
      <span className="mt-2 text-title font-bold text-accent-solid">{ar ? "نقطة" : "points"}</span>
      <p className="mt-auto inline-flex items-center justify-center gap-sm rounded-md bg-accent-solid/10 px-md py-sm text-label text-fg-secondary"><BarChartIcon size={18} className="text-accent-solid" /><strong className="text-accent-solid">{net >= 0 ? "+" : "−"}{formatPoints(Math.abs(net), locale)} {ar ? "نقطة" : "points"}</strong>{ar ? "هذا الشهر" : "this month"}</p>
    </article>
  );
}

function ProgressCard({ locale, balance }: { locale: Locale; balance: number }) {
  const ar = locale === "ar";
  const info = derivePointsLevel(balance);
  const target = info.remainingToNextLevel === null ? null : Math.max(0, balance) + info.remainingToNextLevel;
  const nextLevel = Math.min(info.level + 1, 5) as 1 | 2 | 3 | 4 | 5;
  return (
    <article dir={ar ? "rtl" : "ltr"} className="relative min-h-52 overflow-hidden rounded-md border border-strong bg-surface p-lg shadow-card" data-testid="points-progress">
      <div className="flex items-center justify-between gap-md">
        <h2 className="flex items-center gap-sm text-title text-fg"><IconBubble><BarChartIcon size={22} /></IconBubble>{ar ? "التقدم نحو المستوى التالي" : "Progress to the next level"}</h2>
        <Image src={POINTS_LEVEL_BADGE_ASSET[nextLevel]} alt="" width={118} height={118} className="h-16 w-16 shrink-0 object-contain tablet:h-28 tablet:w-28" />
      </div>
      <p className="mt-sm text-body font-semibold text-fg-secondary tablet:-mt-8 tablet:pe-32">
        {info.remainingToNextLevel === null
          ? ar ? "أنت في أعلى مستوى." : "You are at the top level."
          : ar
            ? <>باقي <strong className="text-accent-solid">{formatPoints(info.remainingToNextLevel, locale)} نقطة</strong> للوصول إلى المستوى {formatPoints(nextLevel, locale)}</>
            : <>Only <strong className="text-accent-solid">{formatPoints(info.remainingToNextLevel, locale)} points</strong> to reach Level {nextLevel}</>}
      </p>
      <div className="mt-lg rounded-pill border border-strong bg-canvas p-1" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(info.progressPct)} aria-label={ar ? "التقدم إلى المستوى التالي" : "Progress to the next level"}>
        <div className="h-5 rounded-pill bg-accent-solid" style={{ width: `${Math.max(4, info.progressPct)}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-label font-semibold tabular-nums text-fg-secondary">
        <span>{formatPoints(Math.max(0, balance), locale)} {ar ? "نقطة" : "points"}</span>
        {target !== null ? <span>{formatPoints(target, locale)} {ar ? "نقطة" : "points"}</span> : null}
      </div>
    </article>
  );
}

export function PointsBadge({ view }: { view: PointsEntryView }) {
  return (
    <strong
      className={view.direction === "earned"
        ? "inline-flex min-w-16 justify-center rounded-sm border border-accent-solid/20 bg-accent-solid/10 px-sm py-1 text-label font-bold tabular-nums text-accent-solid"
        : "inline-flex min-w-16 justify-center rounded-sm border border-danger/30 bg-danger/10 px-sm py-1 text-label font-bold tabular-nums text-danger"}
      aria-label={view.deltaDescription}
    >
      {view.deltaLabel}
    </strong>
  );
}

export function IconBubble({ children, large = false }: { children: ReactNode; large?: boolean }) {
  return <span className={`grid shrink-0 place-items-center rounded-pill bg-accent-solid/10 text-accent-solid ${large ? "h-14 w-14" : "h-10 w-10"}`}>{children}</span>;
}
