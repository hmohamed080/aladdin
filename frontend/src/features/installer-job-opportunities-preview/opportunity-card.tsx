"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/controls";
import {
  BriefcaseIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  HeartFilledIcon,
  HeartIcon,
  MapPinIcon,
  MoneyIcon,
  SendIcon,
  TargetIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import type { Locale } from "@/lib/i18n/locales";
import { formatEgp } from "@/lib/ui/egp-format";
import { TradeIllustration } from "@/features/installer-dashboard-preview/trade-illustration";
import type { JobCardVM } from "./view-model";

/** The interactions only the preview fixtures can honour (see `PreviewInteractions`). */
export type CardPreviewState = {
  saved: boolean;
  applied: boolean;
  onToggleSaved: () => void;
  onApply: () => void;
};

/**
 * ONE card for the preview and for production.
 *
 * `preview` present  -> the approved design with its local demo behaviour: a save
 *                       heart and an Apply button that flips local state.
 * `preview` absent   -> the same card carrying only what the backend can honour:
 *   - no save heart (there is no saved-jobs model);
 *   - no in-card Apply: applying is a deliberate act on the opening's own page,
 *     which owns the real `applyToJobAction`, so the card LINKS there;
 *   - no skill-match badge and no distance (no such data exists);
 *   - the image is the generic illustration of the opening's REAL trade unless a
 *     photograph genuinely belongs to it;
 *   - an honest "budget not specified" instead of a zero.
 */
export function OpportunityCard({
  job,
  locale,
  view,
  preview,
}: {
  job: JobCardVM;
  locale: Locale;
  view: "grid" | "list";
  preview?: CardPreviewState;
}) {
  const { t } = useI18n();
  const ar = locale === "ar";
  const meta: { key: string; icon: React.ReactNode; label: string }[] = [];
  if (job.place) meta.push({ key: "place", icon: <MapPinIcon size={14} />, label: job.place });
  if (job.distanceKm !== null) {
    meta.push({ key: "distance", icon: <ClockIcon size={14} />, label: ar ? `${formatNumber(job.distanceKm, locale)} كم` : `${formatNumber(job.distanceKm, locale)} km` });
  }
  if (job.tradeLabel) meta.push({ key: "trade", icon: <BriefcaseIcon size={14} />, label: job.tradeLabel });
  if (job.durationDays !== null) meta.push({ key: "duration", icon: <CalendarIcon size={14} />, label: durationLabel(job.durationDays, locale) });

  return (
    <article
      data-testid="job-card"
      className={cn(
        "group h-full overflow-hidden rounded-md border bg-surface shadow-card transition-[border-color,box-shadow,transform] duration-fast hover:-translate-y-0.5 hover:border-strong hover:shadow-raised",
        view === "grid" ? "flex flex-col" : "tablet:grid tablet:grid-cols-[14rem_minmax(0,1fr)]",
      )}
    >
      <div className={cn("relative overflow-hidden", job.image ? "bg-surface-2" : "bg-gradient-to-br from-surface-2 to-canvas", view === "grid" ? "aspect-[16/7]" : "aspect-[16/7] tablet:aspect-auto tablet:min-h-full")}>
        {job.image ? (
          <Image
            src={job.image}
            alt={job.title}
            fill
            sizes={view === "grid" ? "(min-width: 1440px) 24vw, (min-width: 768px) 40vw, 100vw" : "(min-width: 768px) 224px, 100vw"}
            className="object-cover transition-transform duration-base group-hover:scale-[1.025]"
          />
        ) : (
          <TradeIllustration tradeKey={job.tradeKey} className="absolute inset-y-2 end-3 h-[calc(100%-1rem)] w-auto max-w-[70%]" />
        )}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-sm p-sm">
          {job.matchPercent !== null ? (
            <span className="flex items-center gap-1 rounded-pill bg-success px-2.5 py-1 text-label font-semibold text-white shadow-sm">
              <TargetIcon size={13} />
              {ar
                ? `${formatNumber(job.matchPercent, locale)}% مناسب لمهاراتك`
                : `${formatNumber(job.matchPercent, locale)}% skill match`}
            </span>
          ) : <span />}
          {preview ? (
            <button
              type="button"
              aria-label={preview.saved ? (ar ? "إزالة من الفرص المحفوظة" : "Remove from saved jobs") : ar ? "حفظ الفرصة" : "Save opportunity"}
              aria-pressed={preview.saved}
              onClick={preview.onToggleSaved}
              className="grid h-9 w-9 place-items-center rounded-pill bg-white/90 text-fg-secondary shadow-sm backdrop-blur transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {preview.saved ? <HeartFilledIcon size={19} className="text-danger" /> : <HeartIcon size={19} />}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-sm p-md">
        <div>
          <h2 dir="auto" className="text-title font-semibold text-fg">{job.title}</h2>
          {job.org ? (
            // `<bdi>`: this line may mix an LTR organization name into an RTL line.
            <p className="mt-1 text-caption text-fg-secondary"><bdi dir="auto">{job.org}</bdi></p>
          ) : null}
        </div>

        {meta.length > 0 ? (
          <dl className="flex flex-wrap gap-x-md gap-y-1.5 text-caption text-fg-secondary">
            {meta.map((item) => <Meta key={item.key} icon={item.icon} label={item.label} />)}
          </dl>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-sm gap-y-2 border-t pt-sm">
          <div className="min-w-0 whitespace-nowrap">
            {job.amount !== null ? (
              <p className="flex items-center gap-1 text-body-lg font-semibold text-success">
                <MoneyIcon size={15} aria-hidden="true" />
                <bdi>{formatEgp(job.amount, locale)}</bdi>
              </p>
            ) : (
              <p className="text-caption text-fg-muted">{t("jobs.opportunities.budgetUnspecified")}</p>
            )}
            {job.postedLabel ? <p className="mt-0.5 text-label text-fg-muted">{job.postedLabel}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {preview ? (
              <>
                <Button variant="outline" size="sm">{ar ? "تفاصيل" : "Details"}</Button>
                <Button size="sm" onClick={preview.onApply} disabled={preview.applied}>
                  {preview.applied ? null : <SendIcon size={14} />}
                  {preview.applied ? (ar ? "تم التقديم" : "Applied") : ar ? "قدّم الآن" : "Apply now"}
                </Button>
              </>
            ) : job.hasApplied ? (
              <>
                <span className="flex items-center gap-1.5 rounded-sm bg-success/15 px-2.5 py-1.5 text-label font-medium text-success">
                  <CheckIcon size={14} />
                  {t("jobs.opportunities.appliedBadge")}
                </span>
                <Link href={job.href} className="rounded-sm border border-strong px-2.5 py-1.5 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  {ar ? "تفاصيل أكثر" : "More details"}
                </Link>
              </>
            ) : (
              <Link href={job.href} className="flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1.5 text-label font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <SendIcon size={14} />
                {t("jobs.opportunities.viewAndApply")}
              </Link>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Meta({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5">
      <dt className="sr-only">{label}</dt>
      <span className="shrink-0 text-fg-muted" aria-hidden="true">{icon}</span>
      <dd className="min-w-0"><bdi dir="auto">{label}</bdi></dd>
    </div>
  );
}

function durationLabel(days: number, locale: Locale): string {
  if (locale === "ar") {
    if (days === 1) return "يوم واحد";
    if (days === 2) return "يومان";
    return `${formatNumber(days, locale)} ${days >= 3 && days <= 10 ? "أيام" : "يومًا"}`;
  }
  return `${formatNumber(days, locale)} ${days === 1 ? "day" : "days"}`;
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { maximumFractionDigits: 1 }).format(value);
}
