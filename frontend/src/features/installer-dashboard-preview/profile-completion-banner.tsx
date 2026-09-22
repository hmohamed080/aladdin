"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/ui/format";
import { ProgressMeter } from "@/components/ui/primitives";
import { BadgeCheckIcon, UserIcon, XIcon } from "@/components/ui/icons";
import { pick } from "./mock-data";
import type { InstallerProfileCompletionVM } from "./view-model";

/**
 * A TEMPORARY banner, not a permanent module.
 *
 * `data === null` means "nothing to say here" (100% complete, or the caller
 * has no completeness to report) — renders `null` rather than an
 * empty/disabled card, exactly like the profile-completion rule everywhere
 * else in the product. Session-local dismiss only — no backend persistence.
 *
 * Outer border is `border-strong` (the same neutral token every card on this
 * dashboard uses) rather than the iris-tinted hairline it had before — the
 * decorative wash and icon-badge tint stay iris; only the boundary itself
 * moved to the shared neutral treatment so the card reads as clearly
 * separated from the page at a glance.
 */
export function ProfileCompletionBanner({ data }: { data: InstallerProfileCompletionVM }) {
  const { locale } = useI18n();
  const [dismissed, setDismissed] = useState(false);

  if (!data || dismissed) return null;

  return (
    <div className="relative overflow-hidden rounded-lg border border-strong bg-surface p-4 shadow-card tablet:p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 end-0 w-40 bg-gradient-to-l from-iris-solid/[0.07] to-transparent"
      />

      <div className="relative flex flex-col gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-pill bg-iris-solid/10 text-iris">
            <UserIcon size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-body-lg font-semibold text-fg">
              {locale === "ar" ? "أكمل ملفك الشخصي لزيادة ظهورك للمعارض" : "Complete your profile to appear more to showrooms"}
            </p>
            <p className="mt-0.5 text-caption text-fg-secondary">{pick(locale, data.hint)}</p>

            <div className="mt-3 flex max-w-xs items-center gap-2.5">
              <div className="flex-1">
                <ProgressMeter
                  value={data.percent}
                  tone="accent"
                  size="sm"
                  label={locale === "ar" ? "اكتمال الملف الشخصي" : "Profile completion"}
                />
              </div>
              <span className="font-mono text-label font-semibold text-fg">
                {formatNumber(data.percent, locale)}%
              </span>
            </div>

            <p className="mt-2 flex items-center gap-1.5 text-caption text-fg-secondary">
              <BadgeCheckIcon size={14} className={data.verified ? "text-success" : "text-bronze"} />
              {pick(locale, data.verifiedHint)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-start tablet:self-center">
          <Link
            href={data.href}
            onClick={data.href === "#" ? (e) => e.preventDefault() : undefined}
            className="rounded-sm bg-[var(--installer-cta)] px-4 py-2 text-label font-semibold text-white transition-colors hover:bg-[var(--installer-cta-hover)]"
          >
            {locale === "ar" ? "استكمال الملف" : "Complete profile"}
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={locale === "ar" ? "إخفاء" : "Dismiss"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-strong text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <XIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
