"use client";

import { useState } from "react";
import Image from "next/image";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { formatNumber } from "@/lib/ui/format";
import { formatWholeEGP } from "./format";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  HeartFilledIcon,
  HeartIcon,
  MapPinIcon,
  TargetIcon,
} from "@/components/ui/icons";
import { TRADE_LABEL, pick, type JobOpportunity } from "./mock-data";

export function JobOpportunityCard({ job }: { job: JobOpportunity }) {
  const { locale } = useI18n();
  const [saved, setSaved] = useState(false);
  const [applied, setApplied] = useState(false);

  const distanceLabel =
    locale === "ar"
      ? `${formatNumber(job.distanceKm, locale, { maximumFractionDigits: 1 })} كم`
      : `${formatNumber(job.distanceKm, locale, { maximumFractionDigits: 1 })} km`;
  const durationLabel =
    locale === "ar"
      ? job.durationDays === 1
        ? "يوم واحد"
        : job.durationDays === 2
          ? "يومان"
          : `${formatNumber(job.durationDays, locale)} أيام`
      : `${formatNumber(job.durationDays, locale)} ${job.durationDays === 1 ? "day" : "days"}`;

  return (
    <li className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-surface shadow-card transition-[transform,box-shadow] duration-base ease-out-expo hover:-translate-y-1 hover:shadow-lg">
      <div className="relative h-40 shrink-0 tablet:h-44">
        <Image src={job.image} alt="" fill sizes="(min-width: 1024px) 33vw, 100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/0 to-black/0" aria-hidden="true" />

        <span className="absolute start-2.5 top-2.5 flex items-center gap-1 rounded-pill bg-success px-2.5 py-1 text-label font-semibold text-white shadow-sm">
          <TargetIcon size={13} />
          {locale === "ar"
            ? `${formatNumber(job.matchPercent, locale)}% مناسب لمهاراتك`
            : `${formatNumber(job.matchPercent, locale)}% skill match`}
        </span>

        <button
          type="button"
          onClick={() => setSaved((v) => !v)}
          aria-pressed={saved}
          aria-label={locale === "ar" ? "حفظ الفرصة" : "Save opportunity"}
          className="absolute end-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-pill bg-white/90 text-fg-secondary shadow-sm backdrop-blur transition-colors hover:text-danger"
        >
          {saved ? <HeartFilledIcon size={17} className="text-danger" /> : <HeartIcon size={17} />}
        </button>

        <span className="absolute bottom-2.5 start-2.5 rounded-sm bg-black/55 px-2 py-0.5 text-caption font-medium text-white backdrop-blur">
          {pick(locale, TRADE_LABEL[job.trade])}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="min-w-0">
          <h3 className="text-body-lg font-semibold leading-snug text-fg">{pick(locale, job.title)}</h3>
          <p className="mt-0.5 truncate text-caption text-fg-secondary">
            <bdi dir="auto">{pick(locale, job.org)}</bdi>
          </p>
        </div>

        <ul className="flex flex-wrap gap-x-2.5 gap-y-1 text-caption text-fg-secondary">
          <li className="flex items-center gap-1">
            <MapPinIcon size={12} className="text-fg-muted" />
            {pick(locale, job.area)} · {distanceLabel}
          </li>
          <li className="flex items-center gap-1">
            <ClockIcon size={12} className="text-fg-muted" />
            {durationLabel}
          </li>
          <li className="flex items-center gap-1">
            <CalendarIcon size={12} className="text-fg-muted" />
            {pick(locale, job.publishedAgo)}
          </li>
        </ul>

        <div className="mt-auto flex items-end justify-between gap-2 border-t pt-2.5">
          <p className="font-mono text-body-lg font-bold text-success">{formatWholeEGP(job.paymentEGP, locale)}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="rounded-sm border border-strong px-2.5 py-1.5 text-label font-medium text-fg transition-colors hover:bg-surface-2"
            >
              {locale === "ar" ? "تفاصيل أكثر" : "More details"}
            </button>
            <button
              type="button"
              disabled={applied}
              onClick={() => setApplied(true)}
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-label font-medium transition-colors",
                applied ? "bg-success/15 text-success" : "bg-iris-solid text-white hover:brightness-105",
              )}
            >
              {applied ? <CheckIcon size={14} /> : null}
              {applied ? (locale === "ar" ? "تم التقديم" : "Applied") : locale === "ar" ? "قدم الآن" : "Apply now"}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
