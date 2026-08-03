import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { directionFor } from "@/lib/i18n/config";

/** Render a component inside the i18n provider (Arabic by default). */
export function renderWithI18n(ui: ReactElement, locale: Locale = "ar") {
  return render(
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      {ui}
    </I18nProvider>,
  );
}
