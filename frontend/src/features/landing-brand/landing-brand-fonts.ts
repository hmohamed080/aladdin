import localFont from "next/font/local";

/**
 * Brand typography for the public Landing page ONLY (design-system v1.1.0, brand-landing scope).
 * Hurme Geometric Sans covers Latin glyphs and digits; 29LT Bukra covers Arabic (and has Latin as a fallback), so the
 * two are stacked: Hurme first, Bukra second. Scoped as CSS variables on the landing wrapper — the rest of the app
 * keeps its Aperture fonts.
 */
export const hurme = localFont({
  src: [
    { path: "./fonts/Hurme-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Hurme-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Hurme-Bold.woff2", weight: "700 900", style: "normal" },
  ],
  variable: "--font-hurme",
  display: "swap",
});

export const bukra = localFont({
  src: [
    { path: "./fonts/Bukra-Regular.woff2", weight: "300 500", style: "normal" },
    { path: "./fonts/Bukra-Bold.woff2", weight: "600 900", style: "normal" },
  ],
  variable: "--font-bukra",
  display: "swap",
});
