"use client";

import Image from "next/image";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/ui/format";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import type { InstallerWelcomeVM } from "./view-model";

/** href="#rewards" scrolls to the in-page rewards module (preview); a
 *  production caller passes a real route ("/home/points") instead. */
export function InstallerWelcome({ data, pointsHref = "#rewards" }: { data: InstallerWelcomeVM; pointsHref?: string }) {
  const { locale, dir } = useI18n();
  const Forward = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-headline text-fg">
          {locale === "ar" ? `أهلاً ${data.firstName} 👋` : `Hi ${data.firstName} 👋`}
        </h1>
        <p className="mt-1 text-body-lg text-fg-secondary">
          {locale === "ar" ? "يوم موفق في شغلك" : "Have a productive day"}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-body text-fg-secondary">
          <span className="h-2 w-2 shrink-0 rounded-pill bg-success" aria-hidden="true" />
          {data.nearbyOpportunitiesCount > 0
            ? locale === "ar"
              ? `${formatNumber(data.nearbyOpportunitiesCount, locale)} فرص جديدة بالقرب منك`
              : `${formatNumber(data.nearbyOpportunitiesCount, locale)} new opportunities near you`
            : locale === "ar"
              ? "لا توجد فرص جديدة الآن"
              : "No new opportunities right now"}
        </p>
      </div>

      <Link
        href={pointsHref}
        className="flex items-center gap-3 rounded-lg border border-accent-solid/25 bg-gradient-to-br from-accent-solid/20 via-accent-solid/10 to-transparent px-4 py-3 shadow-card transition-colors hover:from-accent-solid/30"
      >
        {/* The asset's own pale badge backdrop is the container — no extra
            solid-fill wrapper around it (that competed with the artwork's
            own square, cream-on-gold treatment). */}
        <Image
          src="/assets/installer-dashboard/rewards/trophy.png"
          alt=""
          width={112}
          height={112}
          className="h-28 w-28 shrink-0 object-contain"
        />
        <span className="flex flex-col">
          <span className="font-mono text-title font-semibold text-fg">
            {formatNumber(data.points, locale)} {locale === "ar" ? "نقطة" : "pts"}
          </span>
          <span className="flex items-center gap-0.5 text-label font-medium text-accent">
            {locale === "ar" ? "عرض نقاطي" : "View my points"}
            <Forward size={13} />
          </span>
        </span>
      </Link>
    </div>
  );
}
