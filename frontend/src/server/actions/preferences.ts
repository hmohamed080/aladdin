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
 *
 * IT DOES NOT REVALIDATE, AND THAT IS THE FIX RATHER THAN AN OMISSION.
 *
 * This used to end with `revalidatePath("/", "layout")`, which did no visible
 * work and cost the control its usability. Both halves of that are worth stating
 * because the second one is not obvious:
 *
 *   NO VISIBLE WORK. The theme is a class on the ROOT <html> element, and React
 *   does not re-render the root element's class from a server revalidation —
 *   `lib/theme/config.ts` says so in its own comment, which is precisely why
 *   `applyThemePreference` exists and writes the document directly. The live
 *   page is already correct before this action is even awaited.
 *
 *   REAL COST. Both callers wrap this in `useTransition` and disable themselves
 *   while it is pending. A transition does not commit until the re-render the
 *   action triggered has been applied — so revalidating the whole app LAYOUT
 *   meant the toggle stayed disabled for as long as `/b2b` took to rebuild
 *   server-side: workspace context, the header's identity/notification/chat
 *   fan-out, and the dashboard's own queries. Measured, it did not re-enable
 *   inside 30 seconds, which left the control permanently dead after one press.
 *
 * Nothing is lost by dropping it. The cookie IS the store, and every layout that
 * reads it calls `cookies()` (the B2B shell is `force-dynamic` besides), so the
 * next server render picks the new value up on its own.
 *
 * `setLocale` above KEEPS its revalidation: a language change really does change
 * every server-rendered string, so there the re-render is the point.
 */
export async function setTheme(theme: string): Promise<void> {
  const value = resolveThemePreference(theme);
  const store = await cookies();
  store.set(THEME_COOKIE, value, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
}
