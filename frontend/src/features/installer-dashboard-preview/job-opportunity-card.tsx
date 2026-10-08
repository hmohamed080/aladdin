"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
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
  SendIcon,
  TargetIcon,
} from "@/components/ui/icons";
import { pick } from "./localized";
import { MatchBadge } from "@/features/installer-job-opportunities-preview/match-badge";
import { TradeIllustration } from "./trade-illustration";
import type { InstallerOpportunityVM } from "./view-model";

/**
 * `variant="preview"` is the approved design with local demo interactions (a
 * save heart, an Apply button that flips local state). `variant="production"`
 * keeps the same card but only carries what the backend can honour:
 *   - the save heart is the REAL saved-jobs state (`save`, the same `saved_jobs` authority as /home/jobs), never a local
 *     flip: it is drawn only when the owner supplies `save`, and shows `aria-pressed`,
 *   - TWO separate actions beside each other — "Details" (the opening's page) and
 *     "Apply now" (the same page with `?apply=1`, which opens the real confirmation
 *     dialog around `applyToJobAction`). The card never applies by itself. An
 *     opening the caller already applied to shows the honest applied state and
 *     Details, never a second active Apply,
 *   - an image only when one genuinely belongs to the opening, otherwise a
 *     generic illustration of the opening's REAL trade (obviously a drawing),
 *   - an honest "budget not specified" instead of a zero amount.
 */
export function JobOpportunityCard({
  job,
  variant = "preview",
  save,
}: {
  job: InstallerOpportunityVM;
  variant?: "preview" | "production";
  /** Production: the persisted saved state of THIS opening and the action that changes it. */
  save?: { saved: boolean; onToggle: () => void };
}) {
  const { locale, t } = useI18n();
  const production = variant === "production";
  const [saved, setSaved] = useState(false);
  const [applied, setApplied] = useState(job.hasApplied);

  const distanceLabel =
    job.distanceKm === null
      ? null
      : locale === "ar"
        ? `${formatNumber(job.distanceKm, locale, { maximumFractionDigits: 1 })} كم`
        : `${formatNumber(job.distanceKm, locale, { maximumFractionDigits: 1 })} km`;
  const durationLabel =
    job.durationDays === null
      ? null
      : locale === "ar"
        ? job.durationDays === 1
          ? "يوم واحد"
          : job.durationDays === 2
            ? "يومان"
            : `${formatNumber(job.durationDays, locale)} أيام`
        : `${formatNumber(job.durationDays, locale)} ${job.durationDays === 1 ? "day" : "days"}`;

  return (
    <li className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-surface shadow-card transition-[transform,box-shadow] duration-base ease-out-expo hover:-translate-y-1 hover:shadow-lg">
      <div className={cn("relative shrink-0 overflow-hidden", job.image ? "h-40 tablet:h-44" : "h-28 bg-gradient-to-br from-surface-2 to-canvas")}>
        {job.image ? (
          <>
            <Image src={job.image} alt="" fill sizes="(min-width: 1024px) 33vw, 100vw" className="object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/0 to-black/0" aria-hidden="true" />
          </>
        ) : (
          <TradeIllustration tradeKey={job.tradeKey} className="absolute inset-y-2 end-3 h-[calc(100%-1rem)] w-auto max-w-[70%]" />
        )}

        {production ? (
          // Production: the canonical Overall Match (the database's `overall_percent`) with its breakdown one press
          // away — the same badge as the Jobs board and the job page. A low or zero match is shown plainly and
          // never hides or disables the card.
          job.match ? (
            <div className="absolute start-2.5 top-2.5">
              <MatchBadge match={job.match} locale={locale} />
            </div>
          ) : null
        ) : job.matchPercent !== null ? (
          <span className="absolute start-2.5 top-2.5 flex items-center gap-1 rounded-pill bg-success px-2.5 py-1 text-label font-semibold text-white shadow-sm">
            <TargetIcon size={13} />
            {locale === "ar"
              ? `${formatNumber(job.matchPercent, locale)}% مناسب لمهاراتك`
              : `${formatNumber(job.matchPercent, locale)}% skill match`}
          </span>
        ) : null}

        {production ? (
          save ? (
            <button
              type="button"
              onClick={save.onToggle}
              aria-pressed={save.saved}
              aria-label={save.saved ? (locale === "ar" ? "إزالة من الفرص المحفوظة" : "Remove from saved jobs") : locale === "ar" ? "حفظ الفرصة" : "Save opportunity"}
              data-testid="dashboard-save"
              className="absolute end-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-pill bg-white/90 text-fg-secondary shadow-sm backdrop-blur transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {save.saved ? <HeartFilledIcon size={17} className="text-danger" /> : <HeartIcon size={17} />}
            </button>
          ) : null
        ) : (
          <button
            type="button"
            onClick={() => setSaved((v) => !v)}
            aria-pressed={saved}
            aria-label={locale === "ar" ? "حفظ الفرصة" : "Save opportunity"}
            className="absolute end-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-pill bg-white/90 text-fg-secondary shadow-sm backdrop-blur transition-colors hover:text-danger"
          >
            {saved ? <HeartFilledIcon size={17} className="text-danger" /> : <HeartIcon size={17} />}
          </button>
        )}

        {job.tradeLabel ? (
          <span className={cn("absolute bottom-2.5 start-2.5 rounded-sm px-2 py-0.5 text-caption font-medium backdrop-blur", job.image ? "bg-black/55 text-white" : "bg-primary text-primary-foreground")}>
            {pick(locale, job.tradeLabel)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="min-w-0">
          <h3 dir="auto" className="text-body-lg font-semibold leading-snug text-fg">{pick(locale, job.title)}</h3>
          {job.org ? (
            <p className="mt-0.5 truncate text-caption text-fg-secondary">
              <bdi dir="auto">{pick(locale, job.org)}</bdi>
            </p>
          ) : null}
        </div>

        <ul className="flex flex-wrap gap-x-2.5 gap-y-1 text-caption text-fg-secondary">
          {job.place ? (
            <li className="flex items-center gap-1">
              <MapPinIcon size={12} className="text-fg-muted" />
              <bdi dir="auto">{pick(locale, job.place)}</bdi>
              {distanceLabel ? ` · ${distanceLabel}` : null}
            </li>
          ) : null}
          {durationLabel ? (
            <li className="flex items-center gap-1">
              <ClockIcon size={12} className="text-fg-muted" />
              {durationLabel}
            </li>
          ) : null}
          {job.publishedAgo ? (
            <li className="flex items-center gap-1">
              <CalendarIcon size={12} className="text-fg-muted" />
              {pick(locale, job.publishedAgo)}
            </li>
          ) : null}
        </ul>

        <div className="mt-auto flex items-end justify-between gap-2 border-t pt-2.5">
          {job.paymentEGP !== null ? (
            <p className="font-mono text-body-lg font-bold text-success">{formatWholeEGP(job.paymentEGP, locale)}</p>
          ) : (
            <p className="text-caption text-fg-muted">{t("jobs.opportunities.budgetUnspecified")}</p>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {production ? (
              job.hasApplied ? (
                <>
                  <span className="flex items-center gap-1.5 rounded-sm bg-success/15 px-2.5 py-1.5 text-label font-medium text-success">
                    <CheckIcon size={14} />
                    {t("jobs.opportunities.appliedBadge")}
                  </span>
                  <Link href={job.href} className={DETAILS_ACTION}>
                    {locale === "ar" ? "تفاصيل" : "Details"}
                  </Link>
                </>
              ) : (
                <>
                  <Link href={job.href} className={DETAILS_ACTION}>
                    {locale === "ar" ? "تفاصيل" : "Details"}
                  </Link>
                  {/* The real application flow: the opening's own page opens its confirmation dialog around `applyToJobAction`, so applying stays a deliberate act — never a local state flip on the dashboard. */}
                  <Link href={`${job.href}?apply=1`} className="flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1.5 text-label font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                    <SendIcon size={14} />
                    {locale === "ar" ? "قدّم الآن" : "Apply now"}
                  </Link>
                </>
              )
            ) : (
              <>
                <Link
                  href={job.href}
                  onClick={job.href === "#" ? (e) => e.preventDefault() : undefined}
                  className={DETAILS_ACTION}
                >
                  {locale === "ar" ? "تفاصيل" : "Details"}
                </Link>
                <button
                  type="button"
                  disabled={applied}
                  onClick={() => setApplied(true)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-label font-medium transition-colors",
                    applied ? "bg-success/15 text-success" : "bg-primary text-primary-foreground hover:opacity-90",
                  )}
                >
                  {applied ? <CheckIcon size={14} /> : <SendIcon size={14} />}
                  {applied ? (locale === "ar" ? "تم التقديم" : "Applied") : locale === "ar" ? "قدّم الآن" : "Apply now"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

const DETAILS_ACTION =
  "rounded-sm border border-strong px-2.5 py-1.5 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
