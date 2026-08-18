import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Archivo, JetBrains_Mono, Readex_Pro, Reem_Kufi } from "next/font/google";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { THEME_COOKIE, THEME_BOOTSTRAP, resolveThemePreference } from "@/lib/theme/config";
import { ThemeSync } from "@/components/layout/theme-sync";
import "./globals.css";

// Bilingual (AR + EN) product-UI workhorse — the default body font.
const readex = Readex_Pro({ subsets: ["arabic", "latin"], variable: "--font-readex", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });
const reemKufi = Reem_Kufi({ subsets: ["arabic", "latin"], variable: "--font-reem-kufi", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Aladdin",
  description:
    "AI-first operating system for Egypt's finishing, construction, interior design, furnishing, and supply sector.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
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
      </head>
      <body className="min-h-dvh bg-canvas text-fg">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
