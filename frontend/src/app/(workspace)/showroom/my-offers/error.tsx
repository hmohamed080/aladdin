"use client";

import { useI18n } from "@/lib/i18n/context";

export default function ShowroomMyOffersError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex flex-col items-start gap-sm rounded-md border border-danger/40 bg-surface p-lg" data-testid="my-offers-error">
      <h1 className="text-title text-fg">{t("showroomOffers.mine.title")}</h1>
      <p className="text-body text-fg-secondary">{t("showroomOffers.feed.error")}</p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-8 items-center rounded-sm border border-strong px-3 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
