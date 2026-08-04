import { LOCALE_DIRECTION, isLocale, type Locale } from "./locales";

/**
 * App-level locale policy for the B2B workspace: **Arabic-first**. Locale is held
 * in a cookie (not the URL) so the required flat route structure
 * (`/b2b/customers`, …) is preserved. English is a first-class switch.
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const APP_DEFAULT_LOCALE: Locale = "ar";

export function resolveLocale(cookieValue: string | undefined): Locale {
  if (cookieValue && isLocale(cookieValue)) return cookieValue;
  return APP_DEFAULT_LOCALE;
}

export function directionFor(locale: Locale): "ltr" | "rtl" {
  return LOCALE_DIRECTION[locale];
}
