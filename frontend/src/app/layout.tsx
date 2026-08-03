import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Archivo, JetBrains_Mono, Readex_Pro, Reem_Kufi } from "next/font/google";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { THEME_COOKIE } from "@/lib/theme/config";
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
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

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
      className={`${fontVariables} ${theme === "dark" ? "dark" : ""}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-canvas text-fg">{children}</body>
    </html>
  );
}
