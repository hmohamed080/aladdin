"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./locales";
import { createTranslator, type TranslateFn } from "./translate";

type I18nValue = { locale: Locale; dir: "ltr" | "rtl"; t: TranslateFn };

const I18nContext = createContext<I18nValue | null>(null);

/** Provides the active locale + `t()` to Client Components. Fed by the server layout. */
export function I18nProvider({
  locale,
  dir,
  children,
}: {
  locale: Locale;
  dir: "ltr" | "rtl";
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, dir, t: createTranslator(locale) }),
    [locale, dir],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider.");
  return ctx;
}
