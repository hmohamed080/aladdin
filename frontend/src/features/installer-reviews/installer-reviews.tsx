"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/controls";
import {
  BadgeCheckFilledIcon,
  BarChartIcon,
  BroomIcon,
  CalendarCheckIcon,
  ChevronDownIcon,
  ClockIcon,
  DownloadIcon,
  GridIcon,
  ListIcon,
  MessageIcon,
  MinusCircleIcon,
  PencilIcon,
  SearchIcon,
  StarOutlineIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { InlineError, ProgressMeter } from "@/components/ui/primitives";
import { DateRangeFilter, type WorkDateRange } from "@/components/ui/date-range-filter";
import { Stars } from "@/features/reviews/parts";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import type { RatingSummary } from "@/lib/reviews/summary";
import { cn } from "@/lib/ui/cn";
import { MenuSelect } from "@/features/installer-reviews-preview/installer-reviews-preview";

/** One review as the page renders it (the database's `my_job_reviews` row, already scoped and moderated). */
export type InstallerReview = {
  id: string;
  rating: number;
  comment: string | null;
  /** The reviewing organization (a business that confirmed the finished job). */
  orgName: string;
  jobTitle: string;
  createdAt: string;
};
export type ReviewMonthPoint = { month: string; reviews: number; average: number | null };
export type ReviewsOrder = "newest" | "highest" | "oldest";
export type ReviewsQuery = { order: ReviewsOrder; q: string; from: string; to: string };
export type ReviewsPageResult = { ok: true; reviews: InstallerReview[]; nextCursor: string | null } | { ok: false };
export type LoadReviews = (query: ReviewsQuery, cursor: string | null) => Promise<ReviewsPageResult>;

type ReviewsView = "list" | "grid";

/**
 * `/home/reviews` for an Installer: the APPROVED Reviews design (`/preview/installer-reviews`) on real data.
 *
 *   * The overview, the rail summary and the distribution are the database's EXACT counts over the whole set.
 *   * The list is keyset-paged in SQL for every order, search and date range ("View more" appends the next page; there
 *     is no ceiling). Nothing is filtered in the browser.
 *   * The trend is the database's monthly average (Africa/Cairo months); a month without reviews has no point.
 *   * "Export report" downloads every review matching the current filters as CSV.
 * Elements of the approved mock that have no data behind them (the reviewer's location, "recommended", the
 * "what clients like most" categories) are not drawn rather than invented.
 */
export function InstallerReviews({
  summary,
  monthly,
  initial,
  load,
}: {
  summary: RatingSummary;
  monthly: readonly ReviewMonthPoint[];
  initial: { reviews: InstallerReview[]; nextCursor: string | null };
  load: LoadReviews;
}) {
  const { locale, dir } = useI18n();
  return (
    <div dir={dir} className="flex w-full min-w-0 flex-col gap-md" data-installer-reviews>
      <ReviewsWorkspaceShell summary={summary} monthly={monthly} initial={initial} load={load} locale={locale} />
    </div>
  );
}

function ReviewsWorkspaceShell({
  summary,
  monthly,
  initial,
  load,
  locale,
}: {
  summary: RatingSummary;
  monthly: readonly ReviewMonthPoint[];
  initial: { reviews: InstallerReview[]; nextCursor: string | null };
  load: LoadReviews;
  locale: Locale;
}) {
  const [query, setQuery] = useState<ReviewsQuery>({ order: "newest", q: "", from: "", to: "" });
  const [exporting, startExport] = useTransition();
  const [exportError, setExportError] = useState(false);

  const exportCsv = () => {
    setExportError(false);
    startExport(async () => {
      const rows: InstallerReview[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 200; page++) {
        const result = await load(query, cursor);
        if (!result.ok) {
          setExportError(true);
          return;
        }
        rows.push(...result.reviews);
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      downloadCsv(rows, locale);
    });
  };

  return (
    <>
      <PageHeader locale={locale} onExport={exportCsv} exporting={exporting} disabled={summary.total === 0} />
      {exportError ? <InlineError>{locale === "ar" ? "تعذّر تصدير التقرير. حاول مرة أخرى." : "The report could not be exported. Try again."}</InlineError> : null}
      <div className="grid min-w-0 items-start gap-md desktop:items-stretch desktop:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-md desktop:flex desktop:h-full desktop:min-h-0 desktop:flex-col desktop:gap-md desktop:space-y-0">
          <RatingsOverview locale={locale} summary={summary} />
          <ReviewsList locale={locale} initial={initial} load={load} query={query} onQuery={setQuery} total={summary.total} />
        </div>
        <RatingsRail locale={locale} summary={summary} monthly={monthly} />
      </div>
    </>
  );
}

function PageHeader({ locale, onExport, exporting, disabled }: { locale: Locale; onExport: () => void; exporting: boolean; disabled: boolean }) {
  const ar = locale === "ar";
  return (
    <header className="flex flex-col gap-md tablet:flex-row tablet:items-end tablet:justify-between">
      <div>
        <h1 className="text-headline text-fg">{ar ? "تقييماتي" : "My reviews"}</h1>
        <p className="mt-3 text-body text-fg-secondary">{ar ? "تقييمات العملاء لأعمالك وجودة خدماتك" : "Client feedback on your work and service quality"}</p>
      </div>
      <Button variant="outline" className="w-fit gap-sm text-info" onClick={onExport} disabled={exporting || disabled} aria-busy={exporting} data-testid="reviews-export">
        <DownloadIcon size={16} className="text-info" />{exporting ? (ar ? "جارٍ التصدير…" : "Exporting…") : ar ? "تصدير التقرير" : "Export report"}
      </Button>
    </header>
  );
}

/** Positive = 4-5 stars, neutral = 3, negative = 1-2 (the same bands the approved design labels). */
export function sentimentCounts(summary: RatingSummary) {
  const d = summary.distribution;
  return { positive: d[5] + d[4], neutral: d[3], negative: d[2] + d[1] };
}

export function ratingLabel(average: number | null, locale: Locale): string {
  const ar = locale === "ar";
  if (average === null) return ar ? "لا توجد تقييمات بعد" : "No reviews yet";
  if (average >= 4.5) return ar ? "ممتاز" : "Excellent";
  if (average >= 4) return ar ? "جيد جدًا" : "Very good";
  if (average >= 3) return ar ? "جيد" : "Good";
  return ar ? "يحتاج إلى تحسين" : "Needs improvement";
}

function RatingsOverview({ locale, summary }: { locale: Locale; summary: RatingSummary }) {
  const ar = locale === "ar";
  const s = sentimentCounts(summary);
  const avg = summary.average;
  return (
    <section aria-labelledby="ratings-overview" className="shrink-0 overflow-hidden rounded-md border bg-surface shadow-card" data-testid="ratings-overview">
      <h2 id="ratings-overview" className="sr-only">{ar ? "نظرة عامة على التقييمات" : "Ratings overview"}</h2>
      <div className="grid divide-y divide-strong tablet:grid-cols-[0.85fr_0.8fr_1.55fr] tablet:divide-x-0 tablet:divide-y-0 tablet:[&>*+*]:border-s">
        <div className="flex min-h-48 flex-col items-center justify-center gap-sm p-lg text-center">
          <strong className="text-display font-semibold tabular-nums text-info">{avg === null ? "—" : formatNumber(avg, locale, 1)}</strong>
          <Stars value={avg ?? 0} size={27} filledClassName="text-accent-solid" label={avg === null ? (ar ? "لا توجد تقييمات" : "No ratings") : ar ? `${avg} من 5 نجوم` : `${avg} out of 5 stars`} />
          <span className={cn("text-body-lg font-semibold", avg !== null && avg >= 4 ? "text-success" : "text-fg-secondary")}>{ratingLabel(avg, locale)}</span>
          <span className="text-label text-fg-secondary">{ar ? "من 5" : "out of 5"}</span>
        </div>

        <dl className="grid content-center gap-md p-lg">
          <OverviewMetric icon={UsersIcon} value={formatNumber(summary.total, locale)} label={ar ? "إجمالي التقييمات" : "Total reviews"} tone="info" />
          <OverviewMetric icon={ThumbsUpIcon} value={formatNumber(s.positive, locale)} label={ar ? "تقييم إيجابي" : "Positive reviews"} tone="success" />
          <OverviewMetric icon={MinusCircleIcon} value={formatNumber(s.neutral, locale)} label={ar ? "تقييم محايد" : "Neutral reviews"} tone="warning" />
          <OverviewMetric icon={ThumbsDownIcon} value={formatNumber(s.negative, locale)} label={ar ? "تقييم سلبي" : "Negative reviews"} tone="danger" />
        </dl>

        <div className="flex flex-col justify-center gap-3 p-lg" data-testid="rating-distribution">
          {([5, 4, 3, 2, 1] as const).map((stars) => {
            const count = summary.distribution[stars];
            const percent = summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
            return (
              <div key={stars} className="grid grid-cols-[4.75rem_minmax(0,1fr)_5rem] items-center gap-sm">
                <span className="text-label text-fg-secondary">{ar ? `${formatNumber(stars, locale)} ${stars === 1 ? "نجمة" : "نجوم"}` : `${stars} stars`}</span>
                <ProgressMeter value={percent} label={ar ? `نسبة تقييمات ${stars} نجوم` : `${stars}-star review share`} tone="accent" size="sm" />
                <span className="text-end text-label tabular-nums text-fg-secondary">{formatNumber(percent, locale)}% ({formatNumber(count, locale)})</span>
              </div>
            );
          })}
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

function ReviewsList({
  locale,
  initial,
  load,
  query,
  onQuery,
  total,
}: {
  locale: Locale;
  initial: { reviews: InstallerReview[]; nextCursor: string | null };
  load: LoadReviews;
  query: ReviewsQuery;
  onQuery: (next: ReviewsQuery) => void;
  total: number;
}) {
  const ar = locale === "ar";
  // GRID is the default view wherever a page offers both; the choice lasts for this visit only.
  const [view, setView] = useState<ReviewsView>("grid");
  const [rows, setRows] = useState(initial.reviews);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const firstRender = useRef(true);
  const filtered = query.q !== "" || query.from !== "" || query.to !== "";

  // A new order / search / date range starts again from the first page, in SQL.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    startTransition(async () => {
      const result = await load(query, null);
      if (cancelled) return;
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setRows(result.reviews);
      setCursor(result.nextCursor);
    });
    return () => {
      cancelled = true;
    };
  }, [query, load]);

  // Search is sent after the person stops typing, never per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (search.trim() !== query.q) onQuery({ ...query, q: search.trim() });
    }, 350);
    return () => clearTimeout(handle);
  }, [search, query, onQuery]);

  const more = () => {
    if (!cursor) return;
    startTransition(async () => {
      const result = await load(query, cursor);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setRows((current) => {
        const seen = new Set(current.map((r) => r.id));
        return [...current, ...result.reviews.filter((r) => !seen.has(r.id))];
      });
      setCursor(result.nextCursor);
    });
  };

  const countLabel = useMemo(() => {
    if (!filtered && !cursor) return ar ? `عرض ${formatNumber(rows.length, locale)} من ${formatNumber(total, locale)} نتائج` : `Showing ${rows.length} of ${total} results`;
    if (!filtered) return ar ? `عرض ${formatNumber(rows.length, locale)} من ${formatNumber(total, locale)} نتائج` : `Showing ${rows.length} of ${total} results`;
    return ar ? `النتائج المعروضة: ${formatNumber(rows.length, locale)}` : `Showing ${rows.length} results`;
  }, [ar, cursor, filtered, locale, rows.length, total]);

  return (
    <section aria-labelledby="reviews-list" aria-busy={pending} className="relative rounded-md border bg-surface shadow-card desktop:flex desktop:min-h-0 desktop:flex-1 desktop:flex-col">
      <h2 id="reviews-list" className="sr-only">{ar ? "قائمة التقييمات" : "Reviews list"}</h2>

      <div className="flex flex-wrap items-center justify-between gap-sm border-b px-md py-sm">
        <div className="flex items-center gap-xs" role="group" aria-label={ar ? "طريقة العرض" : "View mode"}>
          <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn("flex h-8 items-center gap-xs rounded-sm px-sm text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", view === "grid" ? "bg-surface-2 font-semibold text-fg" : "text-fg-muted hover:text-fg")}><GridIcon size={15} />{ar ? "عرض الشبكة" : "Grid view"}</button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("flex h-8 items-center gap-xs rounded-sm px-sm text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", view === "list" ? "bg-surface-2 font-semibold text-fg" : "text-fg-muted hover:text-fg")}><ListIcon size={15} />{ar ? "عرض القائمة" : "List view"}</button>
        </div>
        <div className="grid w-full grid-cols-2 items-center gap-sm tablet:flex tablet:w-auto tablet:flex-wrap [&>*]:min-w-0">
          <DateRangeFilter compact locale={locale} value={{ from: query.from, to: query.to } satisfies WorkDateRange} onChange={(next) => onQuery({ ...query, from: next.from, to: next.to })} />
          <MenuSelect compact className="w-full tablet:w-56" icon={<CalendarCheckIcon size={15} className="text-info" />} label={ar ? "ترتيب التقييمات" : "Review order"} value={query.order} options={[
            { value: "newest", label: ar ? "الترتيب: الأحدث أولًا" : "Sort: Newest first" },
            { value: "highest", label: ar ? "الأعلى تقييمًا" : "Highest rated" },
            { value: "oldest", label: ar ? "الأقدم أولًا" : "Oldest first" },
          ]} onChange={(next) => onQuery({ ...query, order: next as ReviewsOrder })} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-sm border-b px-md py-sm">
        <label className="flex min-h-9 min-w-0 flex-1 items-center gap-sm rounded-sm border bg-canvas px-sm text-fg-secondary focus-within:ring-2 focus-within:ring-focus">
          <SearchIcon size={15} className="shrink-0" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={80} aria-label={ar ? "ابحث في تقييماتك" : "Search your reviews"} placeholder={ar ? "ابحث في تقييماتك" : "Search your reviews"} className="min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-muted" data-testid="reviews-search" />
        </label>
        <span className="shrink-0 text-label text-fg-muted" aria-live="polite" data-testid="reviews-count">{countLabel}</span>
      </div>

      {failed ? <div className="px-md pt-sm"><InlineError>{ar ? "تعذّر تحميل المزيد من التقييمات. حاول مرة أخرى." : "Could not load more reviews. Please try again."}</InlineError></div> : null}

      <div id="reviews-results-viewport" data-testid="reviews-results-viewport" className="min-h-0 desktop:flex-1 desktop:overflow-y-auto desktop:overscroll-contain">
        {rows.length > 0 ? (
          view === "list" ? (
            <div className="flex min-h-full flex-col">
              <div className="hidden grid-cols-[11.5rem_9rem_8rem_minmax(8rem,1fr)_7rem] items-center gap-sm border-b bg-surface-2/70 px-md py-2.5 text-center text-label font-semibold text-fg-secondary desktop:sticky desktop:top-0 desktop:z-base desktop:grid">
                <span className="text-start">{ar ? "العميل" : "Client"}</span>
                <span>{ar ? "المشروع" : "Project"}</span>
                <span>{ar ? "التقييم" : "Rating"}</span>
                <span>{ar ? "التعليق" : "Comment"}</span>
                <span>{ar ? "التاريخ" : "Date"}</span>
              </div>
              <ul className="grid flex-1 auto-rows-fr divide-y divide-strong">
                {rows.map((review, index) => <ReviewRow key={review.id} review={review} locale={locale} avatarTone={index} />)}
              </ul>
            </div>
          ) : (
            <ul className="grid content-start gap-md p-md tablet:grid-cols-2">
              {rows.map((review, index) => <ReviewGridCard key={review.id} review={review} locale={locale} avatarTone={index} />)}
            </ul>
          )
        ) : (
          <div className="px-lg py-xl text-center" data-testid="reviews-empty">
            <p className="text-body-lg font-medium text-fg">{filtered ? (ar ? "لا توجد تقييمات مطابقة" : "No matching reviews") : ar ? "لا توجد تقييمات بعد" : "No reviews yet"}</p>
            <p className="mt-1 text-body text-fg-secondary">
              {filtered
                ? ar ? "جرّب تغيير فلاتر القائمة." : "Try changing the list filters."
                : ar ? "عندما تؤكد شركة عملًا أنجزته، يمكنها ترك تقييم يظهر هنا وعلى ملفك العام." : "When a business confirms work you finished, they can leave a review. It appears here and on your public profile."}
            </p>
          </div>
        )}
      </div>

      {cursor ? (
        <button
          type="button"
          aria-controls="reviews-results-viewport"
          onClick={more}
          disabled={pending}
          data-testid="reviews-more"
          className="flex w-full shrink-0 items-center justify-center gap-2 border-t border-strong px-md py-3 text-label font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus disabled:opacity-60"
        >
          {ar ? "عرض المزيد" : "View more"}
          <ChevronDownIcon size={15} />
        </button>
      ) : null}
    </section>
  );
}

const AVATAR_TONES = ["bg-accent-solid/15 text-accent", "bg-success/15 text-success", "bg-warning/15 text-warning", "bg-info/15 text-info", "bg-surface-2 text-fg"];

function initialsOf(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "•";
}

function ReviewRow({ review, locale, avatarTone }: { review: InstallerReview; locale: Locale; avatarTone: number }) {
  const ar = locale === "ar";
  return (
    <li className="grid min-h-20 gap-md p-md transition-colors hover:bg-surface-2/60 tablet:grid-cols-2 desktop:grid-cols-[11.5rem_9rem_8rem_minmax(8rem,1fr)_7rem] desktop:items-center desktop:gap-sm" data-testid="review-row">
      <div className="flex min-w-0 items-center justify-start gap-sm text-start">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-pill text-body-lg font-semibold", AVATAR_TONES[avatarTone % AVATAR_TONES.length])}>{initialsOf(review.orgName)}</span>
        <div className="min-w-0">
          <p className="flex items-center justify-start gap-1.5 text-body font-semibold text-fg">
            <bdi dir="auto" className="truncate">{review.orgName}</bdi>
            <BadgeCheckFilledIcon size={14} className="shrink-0 text-info" aria-label={ar ? "عمل مؤكَّد" : "Confirmed job"} />
          </p>
          <span className="block text-start text-label text-fg-muted">{ar ? "عميل" : "Client"}</span>
        </div>
      </div>
      <div className="min-w-0 text-center">
        <p className="truncate text-body font-semibold text-fg"><bdi dir="auto">{review.jobTitle || "—"}</bdi></p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-center gap-sm">
        <Stars value={review.rating} size={18} filledClassName="text-accent-solid" label={ar ? `${review.rating} من 5 نجوم` : `${review.rating} out of 5 stars`} />
        <span className="font-mono text-label font-semibold tabular-nums text-fg">{formatNumber(review.rating, locale, 1)}</span>
      </div>
      <p className="min-w-0 text-center text-body leading-relaxed text-fg-secondary"><bdi dir="auto">{review.comment ?? ""}</bdi></p>
      <div className="flex items-center justify-center text-center">
        <time dateTime={review.createdAt} className="text-label text-fg-muted">{formatDate(review.createdAt, locale)}</time>
      </div>
    </li>
  );
}

function ReviewGridCard({ review, locale, avatarTone }: { review: InstallerReview; locale: Locale; avatarTone: number }) {
  const ar = locale === "ar";
  return (
    <li className="rounded-md border bg-canvas p-md transition-colors hover:bg-surface-2/60" data-testid="review-card">
      <div className="flex items-start gap-sm">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-pill text-body-lg font-semibold", AVATAR_TONES[avatarTone % AVATAR_TONES.length])}>{initialsOf(review.orgName)}</span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-body font-semibold text-fg"><bdi dir="auto" className="truncate">{review.orgName}</bdi><BadgeCheckFilledIcon size={14} className="shrink-0 text-info" aria-label={ar ? "عمل مؤكَّد" : "Confirmed job"} /></p>
          <p className="mt-1 truncate text-label text-fg-muted"><bdi dir="auto">{review.jobTitle}</bdi></p>
        </div>
      </div>
      <div className="mt-md flex flex-wrap items-center gap-sm border-t pt-md">
        <Stars value={review.rating} size={18} filledClassName="text-accent-solid" label={ar ? `${review.rating} من 5 نجوم` : `${review.rating} out of 5 stars`} />
        <span className="font-mono text-label font-semibold tabular-nums text-fg">{formatNumber(review.rating, locale, 1)}</span>
      </div>
      {review.comment ? <p className="mt-sm text-body leading-relaxed text-fg-secondary"><bdi dir="auto">{review.comment}</bdi></p> : null}
      <div className="mt-md flex items-center justify-end text-label text-fg-muted"><time dateTime={review.createdAt}>{formatDate(review.createdAt, locale)}</time></div>
    </li>
  );
}

function RatingsRail({ locale, summary, monthly }: { locale: Locale; summary: RatingSummary; monthly: readonly ReviewMonthPoint[] }) {
  const ar = locale === "ar";
  const s = sentimentCounts(summary);
  const satisfaction = summary.total > 0 ? Math.round((s.positive / summary.total) * 100) : null;
  return (
    <aside aria-label={ar ? "تحليلات التقييمات" : "Ratings analytics"} className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-1">
      <RailSection title={ar ? "ملخص تقييماتك" : "Ratings summary"} icon={<StarOutlineIcon size={18} />} iconTone="warning" className="tablet:col-span-2 desktop:col-span-1">
        <div className="grid grid-cols-3 gap-sm p-md">
          <Kpi value={summary.average === null ? "—" : formatNumber(summary.average, locale, 1)} label={ar ? "متوسط التقييم" : "Average rating"} />
          <Kpi value={formatNumber(summary.total, locale)} label={ar ? "إجمالي التقييمات" : "Total reviews"} />
          <Kpi value={satisfaction === null ? "—" : `${formatNumber(satisfaction, locale)}%`} label={ar ? "نسبة الرضا" : "Satisfaction"} />
        </div>
      </RailSection>

      <TrendCard locale={locale} monthly={monthly} />

      <RailSection title={ar ? "نصائح لتحسين تقييماتك" : "Tips to improve your ratings"} icon={<PencilIcon size={18} />} iconTone="warning">
        <div className="divide-y divide-strong">
          <RailMetricRow label={ar ? "التزم بالمواعيد المتفق عليها" : "Keep to the agreed schedule"} icon={<ClockIcon size={14} className="text-info" />} tone="info" />
          <RailMetricRow label={ar ? "حافظ على نظافة الموقع بعد العمل" : "Leave the site clean after the job"} icon={<BroomIcon size={14} className="text-info" />} tone="info" />
          <RailMetricRow label={ar ? "تواصل بوضوح مع العميل" : "Communicate clearly with the client"} icon={<MessageIcon size={14} className="text-success" />} tone="success" />
        </div>
      </RailSection>
    </aside>
  );
}

function RailSection({ title, icon, iconTone = "accent", className, children }: { title: string; icon: ReactNode; iconTone?: "accent" | "warning" | "success"; className?: string; children: ReactNode }) {
  const iconTones = { accent: "text-accent", warning: "text-warning", success: "text-success" } as const;
  return (
    <section className={cn("overflow-hidden rounded-md border bg-surface shadow-card", className)}>
      <h2 className="flex items-center gap-sm border-b px-md py-3 text-body-lg font-semibold text-fg"><span className={iconTones[iconTone]}>{icon}</span>{title}</h2>
      {children}
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

function RailMetricRow({ label, icon, tone = "neutral" }: { label: string; icon: ReactNode; tone?: "neutral" | "success" | "info" }) {
  const toneClass = { neutral: "bg-surface-2", success: "bg-success/10", info: "bg-info/10" }[tone];
  return (
    <div className="flex min-h-11 items-center gap-sm px-md py-2.5">
      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-pill", toneClass)}>{icon}</span>
      <span className="min-w-0 flex-1 text-label text-fg-secondary">{label}</span>
    </div>
  );
}

function TrendCard({ locale, monthly }: { locale: Locale; monthly: readonly ReviewMonthPoint[] }) {
  const ar = locale === "ar";
  const [range, setRange] = useState("3");
  const months = monthly.slice(-Number(range));
  const withData = months.filter((m) => m.average !== null);
  const span = Math.max(months.length - 1, 1);
  const points = months.flatMap((m, index) =>
    m.average === null ? [] : [{ x: 20 + index * (260 / span), y: 112 - ((m.average - 1) / 4) * 88, value: m.average }],
  );
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const monthName = (iso: string) => new Intl.DateTimeFormat(ar ? "ar-EG" : "en-EG", { month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

  return (
    <section className="relative rounded-md border bg-surface shadow-card" data-testid="reviews-trend">
      <div className="flex items-center justify-between gap-sm border-b px-md py-3">
        <h2 className="flex items-center gap-sm text-body-lg font-semibold text-fg"><BarChartIcon size={18} className="text-accent" />{ar ? "تطور تقييماتك" : "Ratings trend"}</h2>
        <MenuSelect compact className="w-32" label={ar ? "الفترة الزمنية" : "Time range"} value={range} options={[
          { value: "3", label: ar ? "آخر 3 أشهر" : "Last 3 months" },
          { value: "6", label: ar ? "آخر 6 أشهر" : "Last 6 months" },
        ]} onChange={setRange} />
      </div>
      <div className="p-sm">
        {withData.length === 0 ? (
          <p className="px-sm py-lg text-center text-label text-fg-secondary">{ar ? "لا توجد تقييمات في هذه الفترة." : "No reviews in this period."}</p>
        ) : (
          <svg viewBox="0 0 300 140" className="h-32 w-full" role="img" aria-labelledby="trend-title">
            <title id="trend-title">{ar ? "تطور متوسط التقييم" : "Average rating trend"}</title>
            {[24, 53, 82, 111].map((y) => <line key={y} x1="20" x2="280" y1={y} y2={y} className="stroke-fg-muted/20" strokeWidth="1" />)}
            {points.length > 1 ? <path d={path} fill="none" className="stroke-info" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
            {points.map((point) => <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="3" className="fill-surface stroke-info" strokeWidth="2" />)}
            <g className="fill-fg-muted text-[10px]">
              {months.map((m, index) => <text key={m.month} x={20 + index * (260 / span) - 8} y="136">{monthName(m.month)}</text>)}
            </g>
          </svg>
        )}
        <table className="sr-only">
          <caption>{ar ? "قيم تطور التقييم" : "Rating trend values"}</caption>
          <tbody>{months.map((m) => <tr key={m.month}><th>{monthName(m.month)}</th><td>{m.average ?? "—"}</td><td>{m.reviews}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function formatNumber(value: number, locale: Locale, digits = 0) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function formatDate(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Cairo" }).format(new Date(iso));
}

function csvCell(value: string): string {
  // A leading = + - @ would be a formula in a spreadsheet: neutralize it.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function reviewsCsv(rows: readonly InstallerReview[], locale: Locale): string {
  const ar = locale === "ar";
  const header = ar ? ["التاريخ", "العميل", "المشروع", "التقييم", "التعليق"] : ["Date", "Client", "Project", "Rating", "Comment"];
  const lines = rows.map((r) => [r.createdAt.slice(0, 10), r.orgName, r.jobTitle, String(r.rating), r.comment ?? ""].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}

function downloadCsv(rows: readonly InstallerReview[], locale: Locale) {
  const blob = new Blob(["﻿" + reviewsCsv(rows, locale)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aladdin-reviews-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
