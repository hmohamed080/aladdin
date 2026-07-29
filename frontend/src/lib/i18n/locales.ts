/**
 * Locale constants. English (LTR) and Arabic (RTL) are both first-class and
 * part of the MVP. next-intl wiring (middleware + request config + message
 * catalogs) is added by the i18n work item; this file holds the shared
 * constants so features can reference locale + direction consistently.
 */

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_DIRECTION: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  ar: "rtl",
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
