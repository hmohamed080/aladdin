import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_DIRECTION } from "@/lib/i18n/locales";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aladdin",
  description:
    "AI-first operating system for Egypt's finishing, construction, interior design, furnishing, and supply sector.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = DEFAULT_LOCALE;
  return (
    <html lang={locale} dir={LOCALE_DIRECTION[locale]} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
