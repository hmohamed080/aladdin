import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BarChartIcon, ClockIcon, CrownIcon, GiftIcon } from "@/components/ui/icons";
import type { Locale } from "@/lib/i18n/locales";
import { POINTS_LEVEL_BADGE_ASSET } from "@/lib/network/points-level-assets";
import { POINT_SOURCES, PREVIEW_REWARDS, RECENT_POINTS, type LocalizedText } from "./preview-data";

function copy(locale: Locale, value: LocalizedText) {
  return value[locale];
}

export function PointsHero({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <section aria-labelledby="points-title" className="relative isolate min-h-44 overflow-hidden rounded-md border border-strong bg-canvas tablet:min-h-52">
      <Image src="/assets/installer-points/points-hero.png" alt="" fill priority sizes="(min-width: 1280px) 82vw, 100vw" className="object-cover object-top" />
      <div className="absolute inset-y-0 right-0 z-raised flex w-[57%] items-center justify-center px-lg tablet:w-[54%] tablet:px-2xl wide:w-[52%]">
        <div className="max-w-xl text-center" dir={ar ? "rtl" : "ltr"}>
          <h1 id="points-title" className="text-display font-bold text-brand-basalt">{ar ? "نقاطي ومكافآتي" : "My points & rewards"}</h1>
          <p className="mt-2 text-body-lg text-brand-basalt/70">{ar ? "تابع نقاطك، مستواك، والمكافآت التي تستحقها" : "Track your points, level, and the rewards you have earned"}</p>
        </div>
      </div>
    </section>
  );
}

export function SummaryGrid({ locale }: { locale: Locale }) {
  return (
    <section aria-label={locale === "ar" ? "ملخص النقاط" : "Points summary"} className="grid min-w-0 gap-md wide:grid-cols-[minmax(0,1.15fr)_minmax(15rem,0.68fr)_minmax(0,0.95fr)]" dir="ltr">
      <CurrentLevelCard locale={locale} />
      <PointsTotalCard locale={locale} />
      <ProgressCard locale={locale} />
    </section>
  );
}

function ProgressCard({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <article dir={ar ? "rtl" : "ltr"} className="relative min-h-52 overflow-hidden rounded-md border border-strong bg-surface p-lg shadow-card">
      <div className="flex items-center justify-between gap-md">
        <h2 className="flex items-center gap-sm text-title text-fg"><IconBubble><BarChartIcon size={22} /></IconBubble>{ar ? "التقدم نحو المستوى التالي" : "Progress to the next level"}</h2>
        <Image src={POINTS_LEVEL_BADGE_ASSET[3]} alt="" width={118} height={118} className="h-24 w-24 shrink-0 object-contain tablet:h-28 tablet:w-28" />
      </div>
      <p className="-mt-8 pe-28 text-body font-semibold text-fg-secondary tablet:pe-32">{ar ? <>باقي <strong className="text-accent-solid">250 نقطة</strong> للوصول إلى المستوى الذهبي</> : <>Only <strong className="text-accent-solid">250 points</strong> to reach Gold</>}</p>
      <div className="mt-lg rounded-pill border border-strong bg-canvas p-1" role="progressbar" aria-valuemin={0} aria-valuemax={1500} aria-valuenow={1250} aria-label={ar ? "التقدم إلى المستوى الذهبي" : "Progress to Gold level"}>
        <div className="h-5 w-5/6 rounded-pill bg-accent-solid" />
      </div>
      <div className="mt-2 flex justify-between text-label font-semibold tabular-nums text-fg-secondary"><span>{ar ? "1,250 نقطة" : "1,250 points"}</span><span>{ar ? "1,500 نقطة" : "1,500 points"}</span></div>
    </article>
  );
}

function PointsTotalCard({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <article dir={ar ? "rtl" : "ltr"} className="flex min-h-52 flex-col rounded-md border border-strong bg-surface p-lg text-center shadow-card">
      <h2 className="flex items-center justify-center gap-sm text-title text-fg"><IconBubble><GiftIcon size={22} /></IconBubble>{ar ? "إجمالي النقاط" : "Total points"}</h2>
      <strong className="mt-auto text-[clamp(3rem,5vw,4.75rem)] font-bold leading-none tabular-nums text-accent-solid">1,250</strong>
      <span className="mt-2 text-title font-bold text-accent-solid">{ar ? "نقطة" : "points"}</span>
      <p className="mt-auto inline-flex items-center justify-center gap-sm rounded-md bg-accent-solid/10 px-md py-sm text-label text-fg-secondary"><BarChartIcon size={18} className="text-accent-solid" /><strong className="text-accent-solid">+150 {ar ? "نقطة" : "points"}</strong>{ar ? "هذا الشهر" : "this month"}</p>
    </article>
  );
}

function CurrentLevelCard({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <article dir={ar ? "rtl" : "ltr"} className="grid min-h-52 grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-md rounded-md border border-strong bg-surface p-lg shadow-card">
      <div>
        <h2 className="flex items-center gap-sm text-body-lg text-fg-secondary"><IconBubble><CrownIcon size={23} /></IconBubble>{ar ? "المستوى الحالي" : "Current level"}</h2>
        <strong className="mt-2 block text-headline text-fg">{ar ? "فضي" : "Silver"}</strong>
        <p className="mt-md text-body leading-relaxed text-fg-secondary">{ar ? "أنت في المستوى الفضي، واصل جمع النقاط للوصول إلى المستوى الذهبي والمزيد من المزايا المميزة." : "You are at Silver. Keep collecting points to reach Gold and unlock more benefits."}</p>
      </div>
      <Image src={POINTS_LEVEL_BADGE_ASSET[2]} alt="" width={180} height={180} className="h-auto w-full object-contain" />
    </article>
  );
}

export function PointSources({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <section dir={ar ? "rtl" : "ltr"} aria-labelledby="sources-title" className="rounded-md border border-strong bg-surface p-lg shadow-card">
      <header className="mb-md"><h2 id="sources-title" className="flex items-center gap-sm text-title text-fg"><IconBubble><GiftIcon size={22} /></IconBubble>{ar ? "مصادر النقاط" : "Ways to earn points"}</h2><p className="mt-1 text-body text-fg-secondary">{ar ? "هذه أمثلة توضيحية لكيفية كسب النقاط في تجربة المعاينة." : "These are preview examples of how points could be earned."}</p></header>
      <div className="grid gap-sm tablet:grid-cols-2 desktop:grid-cols-3 wide:grid-cols-5">
        {POINT_SOURCES.map(({ id, title, points, description, Icon }) => (
          <article key={id} className="flex min-h-48 flex-col rounded-md border border-strong bg-canvas p-md">
            <div className="flex items-center justify-between gap-sm"><IconBubble large><Icon size={26} /></IconBubble><h3 className="text-body-lg font-bold text-fg">{copy(locale, title)}</h3></div>
            <p className="mt-sm text-title font-bold text-accent-solid">+{points} <span className="text-label">{ar ? "نقطة" : "points"}</span></p>
            <p className="mt-sm text-body leading-relaxed text-fg-secondary">{copy(locale, description)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RecentHistory({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <section dir={ar ? "rtl" : "ltr"} aria-labelledby="history-title" className="rounded-md border border-strong bg-surface p-lg shadow-card">
      <header className="flex items-start justify-between gap-md">
        <div><h2 id="history-title" className="flex items-center gap-sm text-title text-fg"><IconBubble><ClockIcon size={22} /></IconBubble>{ar ? "سجل النقاط الأخير" : "Recent points history"}</h2><p className="mt-1 text-body text-fg-secondary">{ar ? "تعرف على آخر الأنشطة التي منحتك نقاطًا." : "See the latest preview activities that earned points."}</p></div>
        <Link href="/preview/installer-points/history" className="shrink-0 rounded-md border border-strong bg-canvas px-md py-sm text-label font-semibold text-fg transition-colors hover:bg-accent-solid/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-solid">{ar ? "عرض الكل" : "View all"}</Link>
      </header>
      <div className="mt-md overflow-hidden rounded-md border border-strong">
        {RECENT_POINTS.map(({ id, title, description, date, points, Icon }) => (
          <article key={id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-sm border-b border-strong bg-canvas px-md py-sm last:border-b-0 tablet:grid-cols-[minmax(0,1.4fr)_auto_auto]">
            <div className="flex min-w-0 items-center gap-sm"><Icon size={19} className="shrink-0 text-accent-solid" /><div className="min-w-0"><h3 className="truncate text-label font-semibold text-fg">{copy(locale, title)}</h3><p className="truncate text-caption text-fg-secondary">{copy(locale, description)}</p></div></div>
            <strong className="rounded-pill bg-accent-solid/10 px-sm py-1 text-label tabular-nums text-accent-solid">+{points}</strong>
            <time className="col-span-2 text-caption text-fg-secondary tablet:col-span-1">{copy(locale, date)}</time>
          </article>
        ))}
      </div>
    </section>
  );
}

export function Rewards({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <section dir={ar ? "rtl" : "ltr"} aria-labelledby="rewards-title" className="rounded-md border border-strong bg-surface p-lg shadow-card">
      <header><h2 id="rewards-title" className="flex items-center gap-sm text-title text-fg"><IconBubble><GiftIcon size={22} /></IconBubble>{ar ? "مكافآتي" : "My rewards"}</h2><p className="mt-1 text-body text-fg-secondary">{ar ? "استبدل نقاطك بمكافآت مميزة داخل تجربة المعاينة." : "Explore preview rewards available for your points."}</p></header>
      <div className="mt-md grid gap-sm tablet:grid-cols-3 wide:grid-cols-3">
        {PREVIEW_REWARDS.map(({ id, title, description, cost, Icon }) => (
          <article key={id} className="flex min-h-56 flex-col items-center rounded-md border border-strong bg-canvas p-md text-center">
            <IconBubble large><Icon size={30} /></IconBubble><h3 className="mt-sm text-body-lg font-bold text-fg">{copy(locale, title)}</h3><p className="mt-sm text-body leading-relaxed text-fg-secondary">{copy(locale, description)}</p><span className="mt-auto block w-full rounded-md bg-accent-solid/10 px-sm py-sm text-label font-bold tabular-nums text-accent-solid">{cost} {ar ? "نقطة" : "points"}</span>
          </article>
        ))}
      </div>
      <p className="mt-sm flex items-center gap-sm text-caption text-fg-secondary"><CrownIcon size={16} className="text-accent-solid" />{ar ? "العناصر المعروضة أمثلة تصميمية ولا تمثل مزايا مفعّلة بعد." : "Shown rewards are design examples and are not active benefits yet."}</p>
    </section>
  );
}

function IconBubble({ children, large = false }: { children: ReactNode; large?: boolean }) {
  return <span className={`grid shrink-0 place-items-center rounded-pill bg-accent-solid/10 text-accent-solid ${large ? "h-14 w-14" : "h-10 w-10"}`}>{children}</span>;
}
