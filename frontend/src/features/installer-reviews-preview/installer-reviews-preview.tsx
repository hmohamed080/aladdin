"use client";

import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/controls";
import {
  BadgeCheckFilledIcon,
  BarChartIcon,
  BroomIcon,
  CalendarCheckIcon,
  ChevronDownIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  GridIcon,
  ListIcon,
  MessageIcon,
  MinusCircleIcon,
  MoneyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  StarOutlineIcon,
  SparklesIcon,
  SearchIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TrashIcon,
  TrendingUpIcon,
  UserIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { Badge, ProgressMeter } from "@/components/ui/primitives";
import { Stars } from "@/features/reviews/parts";
import { DateRangeFilter, type WorkDateRange } from "@/features/installer-my-work-preview/installer-my-work-preview";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import { INSTALLER_CONTENT_FRAME_CLASS, INSTALLER_SHELL_GUTTER_CLASS } from "@/features/installer-dashboard-preview/installer-layout";
import { pick } from "@/features/installer-dashboard-preview/mock-data";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { cn } from "@/lib/ui/cn";
import {
  CUSTOMER_HIGHLIGHTS,
  DISTRIBUTION,
  IMPROVEMENT_TIPS,
  REVIEW_FIXTURES,
  TREND_POINTS,
  type ReviewFixture,
} from "./preview-data";

type SortOrder = "newest" | "highest" | "oldest";
type ReviewsView = "list" | "grid";

const REVIEWS_PAGE_SIZE = 6;

export function InstallerReviewsPreview({ theme, sidebarMode }: { theme: "light" | "dark"; sidebarMode: SidebarMode }) {
  const { locale, dir } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div dir={dir} className="installer-surface flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        previewActiveItemId="reviews"
      />

      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col gap-6 tablet:pb-10 tablet:pt-6 desktop:pt-8`}>
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />
        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col gap-md py-4 tablet:py-6 desktop:py-7`}>
          <PageHeader locale={locale} />
          <div className="grid min-w-0 items-start gap-md desktop:items-stretch desktop:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-md desktop:flex desktop:h-full desktop:min-h-0 desktop:flex-col desktop:gap-md desktop:space-y-0 desktop:overflow-hidden desktop:[contain:size]">
              <RatingsOverview locale={locale} />
              <ReviewsWorkspace locale={locale} />
            </div>
            <RatingsRail locale={locale} />
          </div>
        </main>
      </div>
    </div>
  );
}

function PageHeader({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <header className="flex flex-col gap-md tablet:flex-row tablet:items-end tablet:justify-between">
      <div>
        <h1 className="text-headline text-fg">{ar ? "تقييماتي" : "My reviews"}</h1>
        <p className="mt-3 text-body text-fg-secondary">{ar ? "تقييمات العملاء لأعمالك وجودة خدماتك" : "Client feedback on your work and service quality"}</p>
      </div>
      <Button variant="outline" className="w-fit gap-sm text-info">
        <DownloadIcon size={16} className="text-info" />{ar ? "تصدير التقرير" : "Export report"}
      </Button>
    </header>
  );
}

function RatingsOverview({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <section aria-labelledby="ratings-overview" className="shrink-0 overflow-hidden rounded-md border bg-surface shadow-card">
      <h2 id="ratings-overview" className="sr-only">{ar ? "نظرة عامة على التقييمات" : "Ratings overview"}</h2>
      <div className="grid divide-y divide-strong tablet:grid-cols-[0.85fr_0.8fr_1.55fr] tablet:divide-x-0 tablet:divide-y-0 tablet:[&>*+*]:border-s">
        <div className="flex min-h-48 flex-col items-center justify-center gap-sm p-lg text-center">
          <strong className="text-display font-semibold tabular-nums text-info">{formatNumber(4.8, locale, 1)}</strong>
          <Stars value={4.8} size={27} filledClassName="text-accent-solid" label={ar ? "4.8 من 5 نجوم" : "4.8 out of 5 stars"} />
          <span className="text-body-lg font-semibold text-success">{ar ? "ممتاز" : "Excellent"}</span>
          <span className="text-label text-fg-secondary">{ar ? "من 5" : "out of 5"}</span>
        </div>

        <dl className="grid content-center gap-md p-lg">
          <OverviewMetric icon={UsersIcon} value="128" label={ar ? "إجمالي التقييمات" : "Total reviews"} tone="info" />
          <OverviewMetric icon={ThumbsUpIcon} value="122" label={ar ? "تقييم إيجابي" : "Positive reviews"} tone="success" />
          <OverviewMetric icon={MinusCircleIcon} value="6" label={ar ? "تقييم محايد" : "Neutral reviews"} tone="warning" />
          <OverviewMetric icon={ThumbsDownIcon} value="0" label={ar ? "تقييم سلبي" : "Negative reviews"} tone="danger" />
        </dl>

        <div className="flex flex-col justify-center gap-3 p-lg" data-testid="rating-distribution">
          {DISTRIBUTION.map((row) => (
            <div key={row.stars} className="grid grid-cols-[4.75rem_minmax(0,1fr)_5rem] items-center gap-sm">
              <span className="text-label text-fg-secondary">{ar ? `${formatNumber(row.stars, locale)} ${row.stars === 1 ? "نجمة" : "نجوم"}` : `${row.stars} stars`}</span>
              <ProgressMeter value={row.percent} label={ar ? `نسبة تقييمات ${row.stars} نجوم` : `${row.stars}-star review share`} tone="accent" size="sm" />
              <span className="text-end text-label tabular-nums text-fg-secondary">{formatNumber(row.percent, locale)}% ({formatNumber(row.count, locale)})</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OverviewMetric({ icon: Icon, value, label, tone }: { icon: ComponentType<{ size?: number; className?: string }>; value: string; label: string; tone: "info" | "success" | "warning" | "danger" }) {
  const tones = { info: "text-info", success: "text-success", warning: "text-warning", danger: "text-danger" } as const;
  return (
    <div className="flex items-center gap-sm">
      <Icon size={18} className={tones[tone]} />
      <div className="min-w-0">
        <dd className="font-mono text-body-lg font-semibold tabular-nums text-fg">{value}</dd>
        <dt className="text-label text-fg-secondary">{label}</dt>
      </div>
    </div>
  );
}

type MenuOption = { value: string; label: string };

function MenuSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
  icon,
  compact = false,
  className,
  onDeleteOption,
  deleteLabel,
}: {
  label: string;
  value: string;
  placeholder?: string;
  options: readonly MenuOption[];
  onChange: (value: string) => void;
  icon?: ReactNode;
  compact?: boolean;
  className?: string;
  onDeleteOption?: (value: string) => void;
  deleteLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex w-full items-center gap-sm rounded-sm border border-strong bg-surface px-sm text-start text-body text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          compact ? "h-10 text-label" : "min-h-11",
        )}
      >
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDownIcon size={15} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div id={listId} role="listbox" aria-label={label} className="absolute start-0 top-full z-popover mt-1 max-h-64 min-w-full overflow-y-auto rounded-md border bg-surface p-xs shadow-lg">
          {options.map((option) => (
            <div key={option.value} className="flex items-center gap-xs">
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn("min-h-9 min-w-0 flex-1 rounded-sm px-sm text-start text-label text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", option.value === value && "bg-info/10 font-semibold text-info")}
              >
                {option.label}
              </button>
              {onDeleteOption ? <button type="button" aria-label={`${deleteLabel ?? "Delete"} ${option.label}`} onClick={() => onDeleteOption(option.value)} className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><TrashIcon size={14} /></button> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReviewsWorkspace({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const [sort, setSort] = useState<SortOrder>("newest");
  const [dateRange, setDateRange] = useState<WorkDateRange>({ from: "", to: "" });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ReviewsView>("list");
  const [visibleCount, setVisibleCount] = useState(REVIEWS_PAGE_SIZE);
  const rows = useMemo(() => {
    const filtered = REVIEW_FIXTURES.filter((review) => {
      const dateMatch = (!dateRange.from || review.dateIso >= dateRange.from) && (!dateRange.to || review.dateIso <= dateRange.to);
      const searchText = `${pick(locale, review.customer)} ${pick(locale, review.project)} ${pick(locale, review.location)} ${pick(locale, review.comment)}`.toLocaleLowerCase(locale);
      return dateMatch && searchText.includes(query.trim().toLocaleLowerCase(locale));
    });
    if (sort === "highest") return [...filtered].sort((a, b) => b.rating - a.rating);
    if (sort === "oldest") return [...filtered].reverse();
    return filtered;
  }, [dateRange.from, dateRange.to, locale, query, sort]);
  const visibleRows = rows.slice(0, visibleCount);

  return (
    <section aria-labelledby="reviews-list" className="relative rounded-md border bg-surface shadow-card desktop:flex desktop:min-h-0 desktop:flex-1 desktop:flex-col">
      <h2 id="reviews-list" className="sr-only">{ar ? "قائمة التقييمات" : "Reviews list"}</h2>

      <div className="flex flex-wrap items-center justify-between gap-sm border-b px-md py-sm">
        <div className="flex items-center gap-xs" role="group" aria-label={ar ? "طريقة العرض" : "View mode"}>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("flex h-8 items-center gap-xs rounded-sm px-sm text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", view === "list" ? "bg-surface-2 font-semibold text-fg" : "text-fg-muted hover:text-fg")}><ListIcon size={15} />{ar ? "قائمة" : "List"}</button>
          <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn("flex h-8 items-center gap-xs rounded-sm px-sm text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", view === "grid" ? "bg-surface-2 font-semibold text-fg" : "text-fg-muted hover:text-fg")}><GridIcon size={15} />{ar ? "شبكة" : "Grid"}</button>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          <DateRangeFilter compact locale={locale} value={dateRange} onChange={(next) => { setDateRange(next); setVisibleCount(REVIEWS_PAGE_SIZE); }} />
          <MenuSelect compact className="w-56" icon={<CalendarCheckIcon size={15} className="text-info" />} label={ar ? "ترتيب التقييمات" : "Review order"} value={sort} options={[
            { value: "newest", label: ar ? "الترتيب: الأحدث أولًا" : "Sort: Newest first" },
            { value: "highest", label: ar ? "الأعلى تقييمًا" : "Highest rated" },
            { value: "oldest", label: ar ? "الأقدم أولًا" : "Oldest first" },
          ]} onChange={(next) => { setSort(next as SortOrder); setVisibleCount(REVIEWS_PAGE_SIZE); }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-sm border-b px-md py-sm">
        <label className="flex min-h-9 min-w-0 flex-1 items-center gap-sm rounded-sm border bg-canvas px-sm text-fg-secondary focus-within:ring-2 focus-within:ring-focus">
          <SearchIcon size={15} className="shrink-0" />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(REVIEWS_PAGE_SIZE); }} placeholder={ar ? "ابحث في تقييماتك" : "Search your reviews"} className="min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-muted" />
        </label>
        <span className="shrink-0 text-label text-fg-muted" aria-live="polite">{ar ? `عرض ${formatNumber(visibleRows.length, locale)} من ${formatNumber(rows.length, locale)} نتائج` : `Showing ${visibleRows.length} of ${rows.length} results`}</span>
      </div>

      <div data-testid="reviews-results-viewport" className="min-h-0 desktop:flex-1 desktop:overflow-y-auto desktop:overscroll-contain">
        {rows.length > 0 ? (
          view === "list" ? <div className="flex min-h-full flex-col">
            <div className="hidden grid-cols-[11.5rem_9rem_8rem_minmax(8rem,1fr)_7rem] items-center gap-sm border-b bg-surface-2/70 px-md py-2.5 text-center text-label font-semibold text-fg-secondary desktop:sticky desktop:top-0 desktop:z-base desktop:grid">
              <span className="text-start">{ar ? "العميل" : "Client"}</span>
              <span>{ar ? "المشروع" : "Project"}</span>
              <span>{ar ? "التقييم" : "Rating"}</span>
              <span>{ar ? "التعليق" : "Comment"}</span>
              <span>{ar ? "التاريخ / إجراء" : "Date / action"}</span>
            </div>
            <ul className="grid flex-1 auto-rows-fr divide-y divide-strong">
              {visibleRows.map((review, index) => <ReviewRow key={review.id} review={review} locale={locale} avatarTone={index} />)}
            </ul>
          </div> : <ul className="grid content-start gap-md p-md tablet:grid-cols-2">
            {visibleRows.map((review, index) => <ReviewGridCard key={review.id} review={review} locale={locale} avatarTone={index} />)}
          </ul>
        ) : (
          <div className="px-lg py-xl text-center">
            <p className="text-body-lg font-medium text-fg">{ar ? "لا توجد تقييمات مطابقة" : "No matching reviews"}</p>
            <p className="mt-1 text-body text-fg-secondary">{ar ? "جرّب تغيير فلاتر القائمة." : "Try changing the list filters."}</p>
          </div>
        )}
      </div>

      {visibleCount < rows.length ? (
        <button
          type="button"
          aria-controls="reviews-results-viewport"
          onClick={() => setVisibleCount((count) => Math.min(count + REVIEWS_PAGE_SIZE, rows.length))}
          className="flex w-full shrink-0 items-center justify-center gap-2 border-t border-strong px-md py-3 text-label font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
        >
          {ar ? "عرض المزيد" : "View more"}
          <ChevronDownIcon size={15} />
        </button>
      ) : null}
    </section>
  );
}

function ReviewRow({ review, locale, avatarTone }: { review: ReviewFixture; locale: Locale; avatarTone: number }) {
  const ar = locale === "ar";
  const avatarTones = ["bg-accent-solid/15 text-accent", "bg-success/15 text-success", "bg-warning/15 text-warning", "bg-info/15 text-info", "bg-surface-2 text-fg"];
  return (
    <li className="grid min-h-20 gap-md p-md transition-colors hover:bg-surface-2/60 tablet:grid-cols-2 desktop:grid-cols-[11.5rem_9rem_8rem_minmax(8rem,1fr)_7rem] desktop:items-center desktop:gap-sm">
      <div className="flex min-w-0 items-center justify-start gap-sm text-start">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-pill text-body-lg font-semibold", avatarTones[avatarTone % avatarTones.length])}>{review.initials}</span>
        <div className="min-w-0">
          <p className="flex items-center justify-start gap-1.5 whitespace-nowrap text-body font-semibold text-fg">
            <bdi dir="auto">{pick(locale, review.customer)}</bdi>
            {review.verified ? <BadgeCheckFilledIcon size={14} className="shrink-0 text-info" /> : null}
          </p>
          <span className="block text-start text-label text-fg-muted">{ar ? "عميل" : "Client"}</span>
        </div>
      </div>

      <div className="min-w-0 text-center">
        <p className="truncate text-body font-semibold text-fg"><bdi dir="auto">{pick(locale, review.project)}</bdi></p>
        <p className="mt-1 truncate text-label text-fg-muted"><bdi dir="auto">{pick(locale, review.location)}</bdi></p>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-center gap-sm">
          <Stars value={review.rating} size={18} filledClassName="text-accent-solid" label={ar ? `${review.rating} من 5 نجوم` : `${review.rating} out of 5 stars`} />
          <span className="font-mono text-label font-semibold tabular-nums text-fg">{formatNumber(review.rating, locale, 1)}</span>
          {review.recommended ? <Badge tone="success"><CheckIcon size={12} />{ar ? "موصى به" : "Recommended"}</Badge> : null}
      </div>
      <p className="min-w-0 text-center text-body leading-relaxed text-fg-secondary"><bdi dir="auto">{pick(locale, review.comment)}</bdi></p>
      <div className="flex items-center justify-center gap-xs text-center">
          <span className="text-label text-fg-muted">{pick(locale, review.date)}</span>
          <button type="button" aria-label={ar ? "المزيد من الإجراءات" : "More actions"} className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <MoreHorizontalIcon size={17} className="rotate-90" />
          </button>
      </div>
    </li>
  );
}

function ReviewGridCard({ review, locale, avatarTone }: { review: ReviewFixture; locale: Locale; avatarTone: number }) {
  const ar = locale === "ar";
  const avatarTones = ["bg-accent-solid/15 text-accent", "bg-success/15 text-success", "bg-warning/15 text-warning", "bg-info/15 text-info", "bg-surface-2 text-fg"];
  return (
    <li className="rounded-md border bg-canvas p-md transition-colors hover:bg-surface-2/60">
      <div className="flex items-start gap-sm">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-pill text-body-lg font-semibold", avatarTones[avatarTone % avatarTones.length])}>{review.initials}</span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-body font-semibold text-fg"><bdi dir="auto">{pick(locale, review.customer)}</bdi>{review.verified ? <BadgeCheckFilledIcon size={14} className="shrink-0 text-info" /> : null}</p>
          <p className="mt-1 truncate text-label text-fg-muted"><bdi dir="auto">{pick(locale, review.project)}</bdi></p>
        </div>
        <button type="button" aria-label={ar ? "المزيد من الإجراءات" : "More actions"} className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><MoreHorizontalIcon size={17} className="rotate-90" /></button>
      </div>
      <div className="mt-md flex flex-wrap items-center gap-sm border-t pt-md">
        <Stars value={review.rating} size={18} filledClassName="text-accent-solid" label={ar ? `${review.rating} من 5 نجوم` : `${review.rating} out of 5 stars`} />
        <span className="font-mono text-label font-semibold tabular-nums text-fg">{formatNumber(review.rating, locale, 1)}</span>
        {review.recommended ? <Badge tone="success"><CheckIcon size={12} />{ar ? "موصى به" : "Recommended"}</Badge> : null}
      </div>
      <p className="mt-sm text-body leading-relaxed text-fg-secondary"><bdi dir="auto">{pick(locale, review.comment)}</bdi></p>
      <div className="mt-md flex items-center justify-between text-label text-fg-muted"><span>{pick(locale, review.location)}</span><span>{pick(locale, review.date)}</span></div>
    </li>
  );
}

function RatingsRail({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <aside aria-label={ar ? "تحليلات التقييمات" : "Ratings analytics"} className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-1">
      <RailSection title={ar ? "ملخص تقييماتك" : "Ratings summary"} icon={<StarOutlineIcon size={18} />} iconTone="warning" className="tablet:col-span-2 desktop:col-span-1">
        <div className="grid grid-cols-3 gap-sm p-md">
          <Kpi value={formatNumber(4.8, locale, 1)} label={ar ? "متوسط التقييم" : "Average rating"} />
          <Kpi value={formatNumber(128, locale)} label={ar ? "إجمالي التقييمات" : "Total reviews"} />
          <Kpi value={`${formatNumber(98, locale)}%`} label={ar ? "نسبة الرضا" : "Satisfaction"} />
        </div>
      </RailSection>

      <RailSection title={ar ? "أكثر ما يعجب عملائك" : "What clients like most"} icon={<TrendingUpIcon size={18} />} iconTone="success" action={ar ? "عرض التحليل الكامل" : "View full analysis"}>
        <div className="divide-y divide-strong">
          {CUSTOMER_HIGHLIGHTS.map((item) => <RailMetricRow key={item.icon} label={pick(locale, item.label)} value={`${formatNumber(item.value, locale)}%`} icon={highlightIcon(item.icon)} tone={highlightTone(item.icon)} />)}
        </div>
      </RailSection>

      <TrendCard locale={locale} />

      <RailSection title={ar ? "نصائح لتحسين تقييماتك" : "Tips to improve your ratings"} icon={<PencilIcon size={18} />} iconTone="warning" action={ar ? "عرض المزيد من النصائح" : "View more tips"}>
        <div className="divide-y divide-strong">
          {IMPROVEMENT_TIPS.map((tip) => <RailMetricRow key={tip.icon} label={pick(locale, tip.label)} icon={tipIcon(tip.icon)} tone={tipTone(tip.icon)} />)}
        </div>
      </RailSection>
    </aside>
  );
}

function RailSection({ title, icon, iconTone = "accent", action, className, children }: { title: string; icon: ReactNode; iconTone?: "accent" | "warning" | "success"; action?: string; className?: string; children: ReactNode }) {
  const iconTones = { accent: "text-accent", warning: "text-warning", success: "text-success" } as const;
  return (
    <section className={cn("overflow-hidden rounded-md border bg-surface shadow-card", className)}>
      <h2 className="flex items-center gap-sm border-b px-md py-3 text-body-lg font-semibold text-fg"><span className={iconTones[iconTone]}>{icon}</span>{title}</h2>
      {children}
      {action ? <button type="button" className="w-full border-t px-md py-3 text-start text-label font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">{action}</button> : null}
    </section>
  );
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center rounded-sm border bg-canvas px-xs py-sm text-center">
      <strong className="font-mono text-title font-semibold tabular-nums text-fg">{value}</strong>
      <span className="mt-1 text-label leading-snug text-fg-secondary">{label}</span>
    </div>
  );
}

function RailMetricRow({ label, value, icon, tone = "neutral" }: { label: string; value?: string; icon: ReactNode; tone?: "neutral" | "success" | "info" | "warning" | "accent" }) {
  const toneClass = { neutral: "bg-surface-2", success: "bg-success/10", info: "bg-info/10", warning: "bg-warning/10", accent: "bg-accent/10" }[tone];
  return (
    <div className="flex min-h-11 items-center gap-sm px-md py-2.5">
      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-pill", toneClass)}>{icon}</span>
      <span className="min-w-0 flex-1 text-label text-fg-secondary">{label}</span>
      {value ? <strong className="font-mono text-label tabular-nums text-fg">{value}</strong> : null}
    </div>
  );
}

function TrendCard({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const [range, setRange] = useState("3");
  const points = TREND_POINTS.map((value, index) => {
    const x = 20 + index * (260 / (TREND_POINTS.length - 1));
    const y = 112 - ((value - 3.25) / 1.75) * 88;
    return { x, y, value };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");

  return (
    <section className="relative rounded-md border bg-surface shadow-card">
      <div className="flex items-center justify-between gap-sm border-b px-md py-3">
        <h2 className="flex items-center gap-sm text-body-lg font-semibold text-fg"><BarChartIcon size={18} className="text-accent" />{ar ? "تطور تقييماتك" : "Ratings trend"}</h2>
        <MenuSelect compact className="w-32" label={ar ? "الفترة الزمنية" : "Time range"} value={range} options={[
          { value: "3", label: ar ? "آخر 3 أشهر" : "Last 3 months" },
          { value: "6", label: ar ? "آخر 6 أشهر" : "Last 6 months" },
        ]} onChange={setRange} />
      </div>
      <div className="p-sm">
        <svg viewBox="0 0 300 140" className="h-32 w-full" role="img" aria-labelledby="trend-title trend-desc">
          <title id="trend-title">{ar ? "تطور متوسط التقييم" : "Average rating trend"}</title>
          <desc id="trend-desc">{ar ? "ارتفع متوسط التقييم من 3.4 إلى 4.8 بين مارس ومايو" : "Average rating rose from 3.4 to 4.8 between March and May"}</desc>
          {[24, 53, 82, 111].map((y) => <line key={y} x1="20" x2="280" y1={y} y2={y} className="stroke-fg-muted/20" strokeWidth="1" />)}
          <path d={path} fill="none" className="stroke-info" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point) => <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="3" className="fill-surface stroke-info" strokeWidth="2" />)}
          <g className="fill-fg-muted text-[10px]">
            <text x="20" y="136">{ar ? "مارس" : "Mar"}</text>
            <text x="142" y="136">{ar ? "أبريل" : "Apr"}</text>
            <text x="263" y="136">{ar ? "مايو" : "May"}</text>
          </g>
        </svg>
        <table className="sr-only">
          <caption>{ar ? "قيم تطور التقييم" : "Rating trend values"}</caption>
          <tbody>{TREND_POINTS.map((value, index) => <tr key={index}><th>{index + 1}</th><td>{value}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function highlightIcon(kind: string) {
  const icons: Record<string, ReactNode> = {
    quality: <StarOutlineIcon size={14} className="text-success" />,
    time: <CalendarCheckIcon size={14} className="text-info" />,
    professional: <UserIcon size={14} className="text-warning" />,
    clean: <SparklesIcon size={14} className="text-info" />,
    value: <MoneyIcon size={14} className="text-accent" />,
  };
  return icons[kind] ?? <CheckIcon size={14} />;
}

function highlightTone(kind: string): "success" | "info" | "warning" | "accent" {
  return { quality: "success", time: "info", professional: "warning", clean: "info", value: "accent" }[kind] as "success" | "info" | "warning" | "accent" ?? "info";
}

function tipIcon(kind: string) {
  const icons: Record<string, ReactNode> = {
    time: <ClockIcon size={14} className="text-info" />,
    clean: <BroomIcon size={14} className="text-info" />,
    contact: <MessageIcon size={14} className="text-success" />,
  };
  return icons[kind] ?? <CheckIcon size={14} />;
}

function tipTone(kind: string): "info" | "success" {
  return kind === "contact" ? "success" : "info";
}

function formatNumber(value: number, locale: Locale, digits = 0) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
