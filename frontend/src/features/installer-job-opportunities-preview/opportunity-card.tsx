"use client";

import Image from "next/image";
import { Button } from "@/components/ui/controls";
import {
  BriefcaseIcon,
  CalendarIcon,
  ClockIcon,
  HeartFilledIcon,
  HeartIcon,
  MapPinIcon,
  MoneyIcon,
  TargetIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import type { Locale } from "@/lib/i18n/locales";
import { pick, type PreviewOpportunity } from "./preview-data";

export function OpportunityCard({
  opportunity,
  locale,
  saved,
  applied,
  view,
  onToggleSaved,
  onApply,
}: {
  opportunity: PreviewOpportunity;
  locale: Locale;
  saved: boolean;
  applied: boolean;
  view: "grid" | "list";
  onToggleSaved: () => void;
  onApply: () => void;
}) {
  const ar = locale === "ar";

  return (
    <article
      className={cn(
        "group h-full overflow-hidden rounded-md border bg-surface shadow-card transition-[border-color,box-shadow,transform] duration-fast hover:-translate-y-0.5 hover:border-strong hover:shadow-raised",
        view === "grid" ? "flex flex-col" : "tablet:grid tablet:grid-cols-[14rem_minmax(0,1fr)]",
      )}
    >
      <div className={cn("relative overflow-hidden bg-surface-2", view === "grid" ? "aspect-[16/7]" : "aspect-[16/7] tablet:aspect-auto tablet:min-h-full")}>
        <Image
          src={opportunity.image}
          alt={pick(locale, opportunity.title)}
          fill
          sizes={view === "grid" ? "(min-width: 1440px) 24vw, (min-width: 768px) 40vw, 100vw" : "(min-width: 768px) 224px, 100vw"}
          className="object-cover transition-transform duration-base group-hover:scale-[1.025]"
        />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-sm p-sm">
          <span className="flex items-center gap-1 rounded-pill bg-success px-2.5 py-1 text-label font-semibold text-white shadow-sm">
            <TargetIcon size={13} />
            {ar
              ? `${formatNumber(opportunity.matchPercent, locale)}% مناسب لمهاراتك`
              : `${formatNumber(opportunity.matchPercent, locale)}% skill match`}
          </span>
          <button
            type="button"
            aria-label={saved ? (ar ? "إزالة من الفرص المحفوظة" : "Remove from saved jobs") : ar ? "حفظ الفرصة" : "Save opportunity"}
            aria-pressed={saved}
            onClick={onToggleSaved}
            className="grid h-9 w-9 place-items-center rounded-pill bg-white/90 text-fg-secondary shadow-sm backdrop-blur transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {saved ? <HeartFilledIcon size={19} className="text-danger" /> : <HeartIcon size={19} />}
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-sm p-md">
        <div>
          <h2 className="text-title font-semibold text-fg">{pick(locale, opportunity.title)}</h2>
          <p className="mt-1 text-caption text-fg-secondary">{pick(locale, opportunity.company)}</p>
        </div>

        <dl className="grid grid-cols-2 gap-x-md gap-y-2 text-caption text-fg-secondary">
          <Meta icon={<MapPinIcon size={14} />} label={pick(locale, opportunity.location)} />
          <Meta icon={<ClockIcon size={14} />} label={ar ? `${formatNumber(opportunity.distanceKm, locale)} كم` : `${formatNumber(opportunity.distanceKm, locale)} km`} />
          <Meta icon={<BriefcaseIcon size={14} />} label={pick(locale, opportunity.tradeLabel)} />
          <Meta icon={<CalendarIcon size={14} />} label={ar ? `${formatNumber(opportunity.durationDays, locale)} أيام` : `${formatNumber(opportunity.durationDays, locale)} days`} />
        </dl>

        <div className="mt-auto flex items-center justify-between gap-sm border-t pt-sm">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-body-lg font-semibold text-success">
              <MoneyIcon size={15} aria-hidden="true" />
              <bdi>{formatBudget(opportunity.budget, locale)}</bdi>
            </p>
            <p className="mt-0.5 text-label text-fg-muted">{pick(locale, opportunity.postedLabel)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm">{ar ? "تفاصيل" : "Details"}</Button>
            <Button size="sm" onClick={onApply} disabled={applied}>
              {applied ? (ar ? "تم التقديم" : "Applied") : ar ? "قدّم الآن" : "Apply now"}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function Meta({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="sr-only">{label}</dt>
      <span className="shrink-0 text-fg-muted" aria-hidden="true">{icon}</span>
      <dd className="truncate">{label}</dd>
    </div>
  );
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { maximumFractionDigits: 1 }).format(value);
}

function formatBudget(value: number, locale: Locale) {
  const amount = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { maximumFractionDigits: 0 }).format(value);
  return locale === "ar" ? `${amount} جنيه` : `EGP ${amount}`;
}
