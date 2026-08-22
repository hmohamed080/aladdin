"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE } from "@/lib/i18n/config";
import { isLocale } from "@/lib/i18n/locales";
import { THEME_COOKIE, resolveThemePreference } from "@/lib/theme/config";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Persist the UI language in a cookie (locale is not in the URL). */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/**
 * Persist the theme PREFERENCE (system/light/dark) so SSR renders the right
 * class. Anything unrecognised falls back to `system` rather than to a hard
 * light — a malformed value must not silently become a choice the user did not
 * make.
 */
export async function setTheme(theme: string): Promise<void> {
  const value = resolveThemePreference(theme);
  const store = await cookies();
  store.set(THEME_COOKIE, value, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}
