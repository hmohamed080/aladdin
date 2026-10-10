"use client";

import "./globals.css";
import { ErrorRecovery, useRecoveryLocale, useRecoveryTheme, type RecoverableError } from "@/components/error/error-recovery";
import { directionFor } from "@/lib/i18n/config";
import { THEME_BOOTSTRAP } from "@/lib/theme/config";

/**
 * The last line of defence: an exception thrown by the ROOT layout itself (or by something above `app/error.tsx`).
 * Next replaces the whole document with this component, so it must render its own <html> and <body> (the root layout
 * is gone, which is also why it imports the global stylesheet and re-applies the locale/direction and theme itself).
 *
 * Retry is a full reload: the router and every provider may be exactly what failed, and a reload keeps the session
 * cookie, so the user stays signed in. Everything else (no raw error text, digest reference, no cookie handling, no fake
 * data) is shared with `app/error.tsx` through `ErrorRecovery`.
 */
export default function GlobalError({ error }: { error: RecoverableError; reset?: () => void }) {
  const locale = useRecoveryLocale();
  const themePreference = useRecoveryTheme();

  return (
    <html
      lang={locale}
      dir={directionFor(locale)}
      className={themePreference === "dark" ? "dark" : ""}
      data-theme-pref={themePreference}
      suppressHydrationWarning
    >
      <head>
        {/* Resolves "system" to dark/light before the first paint, exactly like the root layout does. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-dvh bg-canvas text-fg">
        <ErrorRecovery error={error} scope="global" onRetry={() => window.location.reload()} />
      </body>
    </html>
  );
}
