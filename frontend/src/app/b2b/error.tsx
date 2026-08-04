"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary for the B2B workspace. It is intentionally
 * self-contained (no i18n provider dependency, no design imports that could
 * themselves throw) so it stays reliable exactly when something upstream broke.
 * It reads the locale cookie directly and shows an Arabic-first, actionable
 * message with a retry — never a raw Postgres/Supabase error, and it logs
 * nothing that could contain customer PII.
 */
const COPY = {
  ar: {
    title: "واجهتنا مشكلة",
    body: "تعذّر تحميل هذه الصفحة. حاول مرة أخرى، وإن استمرت المشكلة عُد لاحقًا.",
    retry: "إعادة المحاولة",
    home: "الرئيسية",
  },
  en: {
    title: "We hit a problem",
    body: "This page couldn't load. Try again, and if it keeps happening come back later.",
    retry: "Retry",
    home: "Home",
  },
} as const;

function readLocale(): "ar" | "en" {
  if (typeof document === "undefined") return "ar";
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  return match && decodeURIComponent(match[1]!) === "en" ? "en" : "ar";
}

export default function B2BError({ error, reset }: { error: Error; reset: () => void }) {
  const locale = readLocale();
  const t = COPY[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    // Log only the digest/name — never the message (it can carry query context).
    console.error("[b2b] route error", { digest: (error as { digest?: string }).digest, name: error.name });
  }, [error]);

  return (
    <div dir={dir} className="mx-auto flex max-w-lg flex-col gap-md py-16 text-center">
      <h1 className="text-headline text-fg">{t.title}</h1>
      <p className="text-body text-fg-secondary">{t.body}</p>
      <div className="flex items-center justify-center gap-sm">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-9 items-center rounded-sm bg-primary px-md py-1.5 text-label font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {t.retry}
        </button>
        <a
          href="/b2b"
          className="inline-flex min-h-9 items-center rounded-sm border border-strong px-md py-1.5 text-label font-medium text-fg hover:bg-surface-2"
        >
          {t.home}
        </a>
      </div>
    </div>
  );
}
