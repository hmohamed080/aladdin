"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { THEME_COOKIE, resolveThemePreference, type ThemePreference } from "@/lib/theme/config";
import type { Locale } from "@/lib/i18n/locales";

/**
 * THE ALADDIN RECOVERY SCREEN - what a customer sees when a server-side exception escapes a page, instead of Next's
 * generic "Application error: a server-side exception has occurred".
 *
 * It is DEFENCE IN DEPTH and nothing more. Deployment ordering (database first, then promote) is what prevents the
 * incident this was added after. This screen exists so that an unexpected failure is calm, branded, bilingual and
 * recoverable. It deliberately:
 *   - shows NO raw error text. A Postgres / PostgREST / Supabase message can name tables, functions and columns;
 *     production already strips the message from a server error, and this never reads `error.message` at all;
 *   - shows the error's `digest`, a short opaque fingerprint, as a reference that support can match to the real
 *     server-side log (where the full exception is already recorded by Next);
 *   - logs only the error's name and digest to the console, never its message;
 *   - does not touch cookies, storage or the session: the user stays signed in, "Retry" re-asks the server, and
 *     nothing here signs anyone out;
 *   - never substitutes empty data for the failed page. It REPLACES the page with an error, it does not pretend the
 *     page loaded with nothing in it. A missing migration must stay visible (and the deployment guard still fails).
 *
 * It is self-contained on purpose (no i18n provider, no shell, no data, no design-system component that could itself
 * throw), so it stays reliable exactly when something upstream broke. The product name and copy are inline for the
 * same reason. B2B keeps its own route-level boundary (`app/b2b/error.tsx`); this one sits above everything else.
 */
const COPY = {
  ar: {
    brand: "علاء الدين",
    title: "واجهتنا مشكلة",
    body: "تعذّر تحميل هذه الصفحة. حاول مرة أخرى، وإن استمرت المشكلة عُد لاحقًا. حسابك آمن ولم يتم تسجيل خروجك.",
    retry: "إعادة المحاولة",
    home: "الرئيسية",
    reference: "رمز المرجع",
  },
  en: {
    brand: "Aladdin",
    title: "We hit a problem",
    body: "This page couldn't load. Try again, and if it keeps happening come back later. Your account is safe and you have not been signed out.",
    retry: "Try again",
    home: "Home",
    reference: "Reference",
  },
} as const;

export function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : undefined;
}

const subscribe = () => () => {};

/** The user's locale. The server (and the hydration pass) render Arabic-first; the client then reads the real cookie. */
export function useRecoveryLocale(): Locale {
  return useSyncExternalStore(
    subscribe,
    () => resolveLocale(readCookie(LOCALE_COOKIE)),
    () => resolveLocale(undefined),
  );
}

/** The stored theme preference (`system` renders light; the pre-paint script in the document corrects it). */
export function useRecoveryTheme(): ThemePreference {
  return useSyncExternalStore(
    subscribe,
    () => resolveThemePreference(readCookie(THEME_COOKIE)),
    () => resolveThemePreference(undefined),
  );
}

export type RecoverableError = Error & { digest?: string };

export function ErrorRecovery({
  error,
  scope,
  onRetry,
}: {
  error: RecoverableError;
  /** Which boundary rendered this - only used in the console line, to tell them apart. */
  scope: "app" | "global";
  /** Re-ask the server. The boundaries decide how (router refresh + reset, or a full reload). */
  onRetry: () => void;
}) {
  const locale = useRecoveryLocale();
  const t = COPY[locale];

  useEffect(() => {
    // Name and digest only: the message can carry query context. The full exception is already in the server log.
    console.error(`[${scope}] route error`, { name: error.name, digest: error.digest });
  }, [error, scope]);

  return (
    <div
      data-testid="aladdin-error-boundary"
      role="alert"
      dir={directionFor(locale)}
      lang={locale}
      className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-md px-md py-16 text-center"
    >
      <div className="flex items-center gap-sm">
        {/* A plain <img>: this screen must not depend on next/image or anything else that could fail with the page. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/aladdin-mark.png" alt="" width={28} height={41} aria-hidden="true" />
        <span className="text-label font-semibold text-fg">{t.brand}</span>
      </div>
      <h1 className="text-headline text-fg">{t.title}</h1>
      <p className="text-body text-fg-secondary">{t.body}</p>
      <div className="flex items-center justify-center gap-sm">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-9 items-center rounded-sm bg-primary px-md py-1.5 text-label font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {t.retry}
        </button>
        {/* A plain anchor on purpose: a full page load that does not depend on the client router (which may be exactly what
            failed, and which does not exist at all in global-error). "/" renders from the cookie alone, with no data. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="inline-flex min-h-9 items-center rounded-sm border border-strong px-md py-1.5 text-label font-medium text-fg hover:bg-surface-2"
        >
          {t.home}
        </a>
      </div>
      {error.digest ? (
        <p className="text-label text-fg-secondary" dir="ltr">
          {t.reference}: <span data-testid="aladdin-error-digest">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
