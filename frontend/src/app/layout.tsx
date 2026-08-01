import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, JetBrains_Mono, Readex_Pro, Reem_Kufi } from "next/font/google";
import { DEFAULT_LOCALE, LOCALE_DIRECTION } from "@/lib/i18n/locales";
import "./globals.css";

// Bilingual (AR + EN) product-UI workhorse — the default body font.
const readex = Readex_Pro({
  subsets: ["arabic", "latin"],
  variable: "--font-readex",
  display: "swap",
});

// Latin brand & display.
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

// Arabic brand & display (geometric Kufic).
const reemKufi = Reem_Kufi({
  subsets: ["arabic", "latin"],
  variable: "--font-reem-kufi",
  display: "swap",
});

// EGP figures, RFQ/quote codes, quantities.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aladdin",
  description:
    "AI-first operating system for Egypt's finishing, construction, interior design, furnishing, and supply sector.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = DEFAULT_LOCALE;
  const fontVariables = [
    readex.variable,
    archivo.variable,
    reemKufi.variable,
    jetbrainsMono.variable,
  ].join(" ");

  return (
    <html
      lang={locale}
      dir={LOCALE_DIRECTION[locale]}
      className={fontVariables}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
