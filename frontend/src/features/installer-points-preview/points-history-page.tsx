"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/controls";
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrownIcon,
  DownloadIcon,
  GiftIcon,
  ListIcon,
} from "@/components/ui/icons";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import {
  INSTALLER_CONTENT_FRAME_CLASS,
  INSTALLER_SHELL_GUTTER_CLASS,
} from "@/features/installer-dashboard-preview/installer-layout";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { POINTS_LEVEL_BADGE_ASSET } from "@/lib/network/points-level-assets";
import { cn } from "@/lib/ui/cn";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import {
  POINTS_HISTORY,
  POINT_SOURCES,
  type LocalizedText,
  type PointsActivityId,
  type PointsHistoryItem,
} from "./preview-data";

type MonthFilter = "all" | "2025-03" | "2025-02";
type ResultFilter = "all" | "earned";
type FilterOption<T extends string> = { value: T; label: string };

const text = {
  ar: {
    title: "سجل النقاط",
    subtitle: "تعرّف على كل الأنشطة التي منحتك نقاطًا",
    total: "إجمالي النقاط",
    point: "نقطة",
    currentLevel: "المستوى الحالي",
    silver: "فضي",
    reachGold: "250 نقطة للوصول إلى المستوى الذهبي",
    nextLevel: "المستوى التالي",
    gold: "المستوى الذهبي",
    required: "1,500 نقطة مطلوبة",
    period: "الفترة الزمنية",
    march: "من 1 مارس 2025 إلى 31 مارس 2025",
    february: "من 1 فبراير 2025 إلى 28 فبراير 2025",
    allPeriods: "كل الفترات",
    activity: "نوع النشاط",
    result: "النتيجة",
    all: "الكل",
    earned: "نقاط مكتسبة",
    export: "تصدير السجل",
    exportPreview: "التصدير غير مفعّل في المعاينة",
    date: "التاريخ",
    details: "التفاصيل",
    points: "النقاط",
    count: (visible: number) => `عرض ${visible} من 48 نتيجة`,
    empty: "لا توجد أنشطة مطابقة للفلاتر المختارة.",
    pagination: "صفحات سجل النقاط",
    previous: "الصفحة السابقة",
    next: "الصفحة التالية",
  },
  en: {
    title: "Points history",
    subtitle: "Explore every activity that earned you points",
    total: "Total points",
    point: "points",
    currentLevel: "Current level",
    silver: "Silver",
    reachGold: "250 points to reach Gold",
    nextLevel: "Next level",
    gold: "Gold level",
    required: "1,500 points required",
    period: "Date range",
    march: "1 Mar 2025 to 31 Mar 2025",
    february: "1 Feb 2025 to 28 Feb 2025",
    allPeriods: "All periods",
    activity: "Activity type",
    result: "Result",
    all: "All",
    earned: "Points earned",
    export: "Export history",
    exportPreview: "Export is unavailable in this preview",
    date: "Date",
    details: "Details",
    points: "Points",
    count: (visible: number) => `Showing ${visible} of 48 results`,
    empty: "No activities match the selected filters.",
    pagination: "Points history pages",
    previous: "Previous page",
    next: "Next page",
  },
} as const;

function localized(locale: Locale, value: LocalizedText) {
  return value[locale];
}

export function PointsHistoryPage({ theme, sidebarMode }: { theme: "light" | "dark"; sidebarMode: SidebarMode }) {
  const { locale, dir } = useI18n();
  const c = text[locale];
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [month, setMonth] = useState<MonthFilter>("all");
  const [activity, setActivity] = useState<"all" | PointsActivityId>("all");
  const [result, setResult] = useState<ResultFilter>("all");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");

  const rows = useMemo(
    () => POINTS_HISTORY.filter((item) => month === "all" || item.month === month).filter((item) => activity === "all" || item.activityId === activity),
    [activity, month],
  );

  const activityOptions: FilterOption<"all" | PointsActivityId>[] = [
    { value: "all", label: c.all },
    ...POINT_SOURCES.map((source) => ({ value: source.id as PointsActivityId, label: localized(locale, source.title) })),
  ];
  const monthOptions: FilterOption<MonthFilter>[] = [
    { value: "all", label: c.allPeriods },
    { value: "2025-03", label: c.march },
    { value: "2025-02", label: c.february },
  ];
  const resultOptions: FilterOption<ResultFilter>[] = [
    { value: "all", label: c.all },
    { value: "earned", label: c.earned },
  ];

  return (
    <div dir={dir} data-installer-points-history className="installer-surface flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        previewActiveItemId="rewards"
      />
      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col gap-4 pb-8 pt-2 tablet:pb-10 tablet:pt-3`}>
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />
        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col gap-md`}>
          <HistoryHero locale={locale} />
          <HistorySummary locale={locale} />

          <section aria-label={locale === "ar" ? "فلاتر سجل النقاط" : "Points history filters"} className="rounded-md border border-strong bg-surface p-md shadow-card">
            <div className="grid min-w-0 gap-sm tablet:grid-cols-2 desktop:grid-cols-[minmax(16rem,1.35fr)_minmax(12rem,1fr)_minmax(10rem,.72fr)_auto] desktop:items-end">
              <FilterMenu label={c.period} value={month} options={monthOptions} onChange={(value) => { setMonth(value); setPage(1); }} icon={<CalendarIcon size={18} />} />
              <FilterMenu label={c.activity} value={activity} options={activityOptions} onChange={(value) => { setActivity(value); setPage(1); }} />
              <FilterMenu label={c.result} value={result} options={resultOptions} onChange={(value) => { setResult(value); setPage(1); }} />
              <Button variant="outline" className="h-11 w-full gap-sm desktop:w-auto" onClick={() => setNotice(c.exportPreview)}>
                <DownloadIcon size={18} />{c.export}
              </Button>
            </div>
            <p aria-live="polite" className="mt-2 min-h-4 text-caption text-fg-secondary">{notice}</p>
          </section>

          <section aria-label={locale === "ar" ? "جدول سجل النقاط" : "Points history table"} className="overflow-hidden rounded-md border border-strong bg-surface shadow-card">
            <DesktopHistoryTable locale={locale} rows={rows} />
            <MobileHistoryList locale={locale} rows={rows} />
            {rows.length === 0 ? <p className="px-md py-xl text-center text-body text-fg-secondary">{c.empty}</p> : null}
            <footer dir="ltr" className="flex flex-col gap-md border-t border-strong px-md py-md tablet:flex-row tablet:items-center tablet:justify-between">
              <p dir={dir} className="text-label text-fg-secondary" aria-live="polite">{c.count(rows.length)}</p>
              <Pagination locale={locale} page={page} onChange={setPage} />
            </footer>
          </section>
        </main>
      </div>
    </div>
  );
}

function HistoryHero({ locale }: { locale: Locale }) {
  const c = text[locale];
  return (
    <section aria-labelledby="points-history-title" className="relative isolate min-h-44 overflow-hidden rounded-md border border-strong bg-canvas tablet:min-h-52">
      <Image src="/assets/installer-points/points-hero.png" alt="" fill priority sizes="(min-width: 1280px) 82vw, 100vw" className="object-cover object-top" />
      <div className="absolute inset-y-0 right-0 z-raised flex w-[57%] items-center justify-center px-lg tablet:w-[54%] tablet:px-2xl wide:w-[52%]">
        <div className="max-w-xl text-center" dir={locale === "ar" ? "rtl" : "ltr"}>
          <h1 id="points-history-title" className="text-display font-bold text-brand-basalt">{c.title}</h1>
          <p className="mt-2 text-body-lg text-brand-basalt/70">{c.subtitle}</p>
        </div>
      </div>
    </section>
  );
}

function HistorySummary({ locale }: { locale: Locale }) {
  const c = text[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  return (
    <section aria-label={locale === "ar" ? "ملخص سجل النقاط" : "Points history summary"} className="grid min-w-0 gap-md desktop:grid-cols-3" dir="ltr">
      <article dir={dir} className="flex min-h-36 items-center justify-between gap-md rounded-md border border-strong bg-surface p-lg shadow-card">
        <IconBubble><GiftIcon size={27} /></IconBubble>
        <div className="text-end"><h2 className="text-body-lg font-semibold text-fg">{c.total}</h2><strong className="mt-2 block text-[2.75rem] font-bold leading-none tabular-nums text-accent-solid">1,250</strong><span className="mt-1 block text-label font-semibold text-accent-solid">{c.point}</span></div>
      </article>
      <article dir={dir} className="grid min-h-36 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-md rounded-md border border-strong bg-surface p-md shadow-card">
        <Image src={POINTS_LEVEL_BADGE_ASSET[2]} alt="" width={130} height={130} className="h-28 w-28 object-contain" />
        <div><h2 className="text-body text-fg-secondary">{c.currentLevel}</h2><strong className="mt-1 block text-title font-bold text-fg">{c.silver}</strong><p className="mt-sm flex items-center gap-1 text-label text-fg-secondary"><ChevronLeftIcon size={15} className="text-accent-solid" />{c.reachGold}</p></div>
      </article>
      <article dir={dir} className="flex min-h-36 items-center justify-between gap-md rounded-md border border-strong bg-surface p-lg shadow-card">
        <IconBubble><CrownIcon size={27} /></IconBubble>
        <div className="text-end"><h2 className="text-body text-fg-secondary">{c.nextLevel}</h2><strong className="mt-1 block text-title font-bold text-fg">{c.gold}</strong><p className="mt-sm text-label text-fg-secondary">{c.required}</p></div>
      </article>
    </section>
  );
}

function IconBubble({ children }: { children: ReactNode }) {
  return <span className="grid h-14 w-14 shrink-0 place-items-center rounded-pill bg-accent-solid/10 text-accent-solid">{children}</span>;
}

function FilterMenu<T extends string>({ label, value, options, onChange, icon }: { label: string; value: T; options: FilterOption<T>[]; onChange: (value: T) => void; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selectedIndex = Math.max(options.findIndex((option) => option.value === value), 0);

  // Opening puts focus on the chosen option, so the keyboard continues from where the value is.
  useEffect(() => {
    if (!open) return;
    const list = document.getElementById(listId);
    list?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[selectedIndex]?.focus();
  }, [open, listId, selectedIndex]);

  return (
    <div className="relative min-w-0">
      <span className="mb-1.5 block text-label text-fg-secondary">{label}</span>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }} className="flex h-11 w-full items-center gap-sm rounded-md border border-strong bg-canvas px-md text-body text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        {icon ? <span className="shrink-0 text-fg-secondary">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate text-start">{options[selectedIndex]?.label}</span>
        <ChevronDownIcon size={16} className="shrink-0 text-fg-secondary" />
      </button>
      <FloatingMenu id={listId} open={open} onClose={() => setOpen(false)} anchorRef={trigger} role="menu" aria-label={label} placement="bottom-start" matchAnchorWidth className="max-h-60">
        {options.map((option) => (
          <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }} className={cn("flex w-full items-center gap-sm px-md py-2 text-start text-label transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2", option.value === value ? "font-semibold text-fg" : "text-fg-secondary")}>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>{option.value === value ? <CheckIcon size={15} className="shrink-0 text-accent-solid" /> : null}
          </button>
        ))}
      </FloatingMenu>
    </div>
  );
}

function DesktopHistoryTable({ locale, rows }: { locale: Locale; rows: PointsHistoryItem[] }) {
  const c = text[locale];
  return (
    <div className="hidden tablet:block">
      <table className="w-full table-fixed border-collapse text-start">
        <thead className="bg-surface-2">
          <tr className="border-b border-strong text-label font-semibold text-fg-secondary">
            <th scope="col" className="w-[17%] px-md py-3 text-start"><span className="inline-flex items-center gap-sm"><CalendarIcon size={16} />{c.date}</span></th>
            <th scope="col" className="w-[24%] px-md py-3 text-start"><span className="inline-flex items-center gap-sm"><GiftIcon size={16} />{c.activity}</span></th>
            <th scope="col" className="w-[43%] px-md py-3 text-start"><span className="inline-flex items-center gap-sm"><ListIcon size={16} />{c.details}</span></th>
            <th scope="col" className="w-[16%] px-md py-3 text-center"><span className="inline-flex items-center gap-sm"><GiftIcon size={16} />{c.points}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-strong">
          {rows.map((item) => <HistoryTableRow key={item.id} locale={locale} item={item} />)}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTableRow({ locale, item }: { locale: Locale; item: PointsHistoryItem }) {
  const { Icon } = item;
  return (
    <tr className="bg-canvas transition-colors hover:bg-surface-2/60">
      <td className="px-md py-2.5 text-label tabular-nums text-fg-secondary"><time>{localized(locale, item.date)}</time></td>
      <td className="px-md py-2.5"><span className="flex items-center gap-sm text-label font-semibold text-fg"><Icon size={19} className="shrink-0 text-accent-solid" />{localized(locale, item.title)}</span></td>
      <td className="truncate px-md py-2.5 text-label text-fg-secondary" title={localized(locale, item.description)}>{localized(locale, item.description)}</td>
      <td className="px-md py-2.5 text-center"><PointsBadge points={item.points} /></td>
    </tr>
  );
}

function MobileHistoryList({ locale, rows }: { locale: Locale; rows: PointsHistoryItem[] }) {
  return (
    <ul className="divide-y divide-strong tablet:hidden">
      {rows.map((item) => {
        const { Icon } = item;
        return (
          <li key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-sm bg-canvas px-md py-3">
            <span className="grid h-9 w-9 place-items-center rounded-sm bg-accent-solid/10 text-accent-solid"><Icon size={19} /></span>
            <div className="min-w-0"><h3 className="text-label font-semibold text-fg">{localized(locale, item.title)}</h3><p className="truncate text-caption text-fg-secondary">{localized(locale, item.description)}</p><time className="mt-1 block text-caption tabular-nums text-fg-secondary">{localized(locale, item.date)}</time></div>
            <PointsBadge points={item.points} />
          </li>
        );
      })}
    </ul>
  );
}

function PointsBadge({ points }: { points: number }) {
  return <strong className="inline-flex min-w-16 justify-center rounded-sm border border-accent-solid/20 bg-accent-solid/10 px-sm py-1 text-label font-bold tabular-nums text-accent-solid">+{points}</strong>;
}

function Pagination({ locale, page, onChange }: { locale: Locale; page: number; onChange: (page: number) => void }) {
  const c = text[locale];
  const pages = locale === "ar" ? [5, 4, 3, 2, 1] : [1, 2, 3, 4, 5];
  return (
    <nav aria-label={c.pagination} dir="ltr" className="flex items-center gap-1">
      <button type="button" aria-label={c.previous} disabled={page === 1} onClick={() => onChange(Math.max(1, page - 1))} className="grid h-9 w-9 place-items-center rounded-sm border border-strong bg-canvas text-fg disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><ChevronLeftIcon size={17} /></button>
      {pages.map((number) => <button key={number} type="button" aria-current={page === number ? "page" : undefined} onClick={() => onChange(number)} className={cn("grid h-9 w-9 place-items-center rounded-sm border text-label font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", page === number ? "border-primary bg-primary text-primary-foreground" : "border-strong bg-canvas text-fg hover:bg-surface-2")}>{number}</button>)}
      <button type="button" aria-label={c.next} disabled={page === 5} onClick={() => onChange(Math.min(5, page + 1))} className="grid h-9 w-9 place-items-center rounded-sm border border-strong bg-canvas text-fg disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><ChevronRightIcon size={17} /></button>
    </nav>
  );
}
