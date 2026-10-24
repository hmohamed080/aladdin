import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { Archivo, JetBrains_Mono, Readex_Pro, Reem_Kufi } from "next/font/google";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { THEME_COOKIE, THEME_BOOTSTRAP, resolveThemePreference } from "@/lib/theme/config";
import { ThemeSync } from "@/components/layout/theme-sync";
import { BRAND_2026_SCOPE_CLASS, BRAND_SURFACE_HEADER } from "@/lib/brand/surface";
import { Toaster } from "@/components/ui/toast";
import { createTranslator } from "@/lib/i18n/translate";
import "./globals.css";

// PRELOADING. `subsets` only decides which files next/font PRELOADS: the
// generated CSS still declares every subset's @font-face (each with its own
// `unicode-range`), and the browser fetches a face the moment text that needs
// it is laid out. The preload list is the same for every request (it is fixed
// at build time, not per locale), so it holds only what BOTH locales need early:
// the Latin faces of the body font (Arabic pages also show Latin text and
// digits), of Archivo (English display) and of Reem Kufi (`font-display-ar`,
// which English headings such as Sign In's also use). Everything else loads on
// use instead of competing with the Landing hero image (the mobile LCP element)
// on every English page: the Arabic faces of Readex and Reem Kufi, and JetBrains
// Mono (codes and OTP boxes). An Arabic page starts its two Arabic faces early
// through `arabicFontWarmup` instead (see there).
//
// Bilingual (AR + EN) product-UI workhorse — the default body font.
const readex = Readex_Pro({ subsets: ["latin"], variable: "--font-readex", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });
const reemKufi = Reem_Kufi({ subsets: ["latin"], variable: "--font-reem-kufi", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ preload: false, variable: "--font-jetbrains-mono", display: "swap" });

/**
 * Arabic pages only: ask the browser for the Arabic faces of the body and
 * display fonts as soon as the stylesheets that declare them are parsed, so
 * they arrive before first paint instead of swapping in after it (a measured
 * 0.004 layout shift on the Landing page). This stands in for a per-locale
 * `<link rel="preload">`: next/font fixes its preload list at build time and
 * does not expose the hashed file URLs, but `document.fonts.load` resolves the
 * right file from the @font-face rules by `unicode-range`. English pages do not
 * run it: they fetch an Arabic face only if they render Arabic text (the "ع"
 * of the language switch), and then late, after the first layout.
 */
function arabicFontWarmup(families: string[]): string {
  return `try{${JSON.stringify(families)}.forEach(function(f){document.fonts.load("1em "+f,"\u0639")})}catch(e){}`;
}

export const metadata: Metadata = {
  title: "Aladdin",
  description:
    "AI-first operating system for Egypt's finishing, construction, interior design, furnishing, and supply sector.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  // Set by the middleware for the routes that preview the 2026 palette, so the
  // body carries it in the first byte and never paints the old canvas first.
  const brand2026 = requestHeaders.get(BRAND_SURFACE_HEADER) === "2026";
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  // The stored PREFERENCE, which may be "system" — a value the server cannot
  // resolve, because the OS colour scheme is not part of the request. It is
  // rendered onto <html> for the pre-paint script below to act on.
  const themePref = resolveThemePreference(store.get(THEME_COOKIE)?.value);

  const fontVariables = [
    readex.variable,
    archivo.variable,
    reemKufi.variable,
    jetbrainsMono.variable,
  ].join(" ");

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${fontVariables} ${themePref === "dark" ? "dark" : ""}`}
      data-theme-pref={themePref}
      suppressHydrationWarning
    >
      <head>
        {/* Blocking by design: it must decide `.dark` before the first frame, or
            every dark-mode user sees a white flash on every navigation. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {locale === "ar" ? (
          <script
            dangerouslySetInnerHTML={{
              __html: arabicFontWarmup([readex.style.fontFamily, reemKufi.style.fontFamily]),
            }}
          />
        ) : null}
      </head>
      <body className={`min-h-dvh bg-canvas text-fg${brand2026 ? ` ${BRAND_2026_SCOPE_CLASS}` : ""}`}>
        <ThemeSync />
        {children}
        {/* The one toast region (transient confirmations that outlive the dialog or control that raised them). */}
        <Toaster dismissLabel={createTranslator(locale)("common.close")} />
      </body>
    </html>
  );
}
