"use client";

import { useMemo, type ReactNode } from "react";
import type { Locale } from "./locales";
import { I18nContext } from "./context";
import { createTranslator } from "./translate";

/**
 * Provides the active locale + `t()` to Client Components. Fed by the server layout.
 *
 * It bundles the full bilingual catalog into the client (one shared, cached
 * chunk). A page that needs only a few strings should mount
 * `I18nMessagesProvider` from `./context` instead (see the note there).
 */
export function I18nProvider({
  locale,
  dir,
  children,
}: {
  locale: Locale;
  dir: "ltr" | "rtl";
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, dir, t: createTranslator(locale) }), [locale, dir]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
