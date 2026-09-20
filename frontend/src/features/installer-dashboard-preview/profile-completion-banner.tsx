"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/ui/format";
import { ProgressMeter } from "@/components/ui/primitives";
import { BadgeCheckIcon, UserIcon, XIcon } from "@/components/ui/icons";
import { PROFILE, pick } from "./mock-data";

/**
 * A TEMPORARY banner, not a permanent module.
 *
 * Profile completion is state a craftsman graduates out of — once they reach
 * 100% there is nothing left to say here, so this renders `null` rather than
 * an empty/disabled card. That is also why it does not live in the permanent
 * bottom module grid beside rewards, learning and the brand ecosystem: those
 * are always-there destinations, this is a nudge with an expiry. Modelled as
 * a real conditional now (`PROFILE.completionPercent < 100`) even though the
 * value is mock-only, so the real data wiring in Phase 2 is a drop-in.
 *
 * Session-local dismiss only — no backend persistence yet. Reappears on
 * reload, which is correct for a mock: the real dismiss state belongs to a
 * future `profile_completion_dismissed_at` column, not `localStorage`.
 */
export function ProfileCompletionBanner() {
  const { locale } = useI18n();
  const [dismissed, setDismissed] = useState(false);

  if (PROFILE.completionPercent >= 100 || dismissed) return null;

  return (
    <div className="relative overflow-hidden rounded-lg border border-iris-solid/20 bg-surface p-4 shadow-card tablet:p-5">
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
            <p className="mt-0.5 text-caption text-fg-secondary">
              {locale === "ar"
                ? "أضف 3 صور أعمال لزيادة فرصك في الحصول على المزيد من فرص الشغل"
                : "Add 3 portfolio photos to improve your chances of more job opportunities"}
            </p>

            <div className="mt-3 flex max-w-xs items-center gap-2.5">
              <div className="flex-1">
                <ProgressMeter
                  value={PROFILE.completionPercent}
                  tone="accent"
                  size="sm"
                  label={locale === "ar" ? "اكتمال الملف الشخصي" : "Profile completion"}
                />
              </div>
              <span className="font-mono text-label font-semibold text-fg">
                {formatNumber(PROFILE.completionPercent, locale)}%
              </span>
            </div>

            <p className="mt-2 flex items-center gap-1.5 text-caption text-fg-secondary">
              <BadgeCheckIcon size={14} className="text-bronze" />
              <span className="font-medium text-fg">{locale === "ar" ? "موثّق" : "Verified"}</span>
              {pick(locale, PROFILE.verifiedHint)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-start tablet:self-center">
          <button
            type="button"
            className="rounded-sm bg-iris-solid px-4 py-2 text-label font-semibold text-white transition-colors hover:brightness-105"
          >
            {locale === "ar" ? "استكمال الملف" : "Complete profile"}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={locale === "ar" ? "إخفاء" : "Dismiss"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <XIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
