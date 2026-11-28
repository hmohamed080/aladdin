"use client";

import { useI18n } from "@/lib/i18n/context";

export default function ShowroomCatalogError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex flex-col items-start gap-sm rounded-md border border-danger/40 bg-surface p-lg" data-testid="showroom-catalog-error">
      <h1 className="text-title text-fg">{t("showroomCatalog.errorTitle")}</h1>
      <p className="text-body text-fg-secondary">{t("showroomCatalog.errorBody")}</p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-8 items-center rounded-sm border border-strong px-3 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {t("showroomCatalog.errorRetry")}
      </button>
    </div>
  );
}
