"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./locales";
import { translatorFor, type MessageTree, type TranslateFn } from "./translate-core";

type I18nValue = { locale: Locale; dir: "ltr" | "rtl"; t: TranslateFn };

/**
 * The i18n context and `useI18n()`. This module deliberately imports NO message
 * catalog: every Client Component reads `useI18n` from here, so if it pulled in
 * `en.ts` + `ar.ts`, every page would ship both languages in full. The catalog
 * comes from whichever provider the route mounts:
 *
 * - `I18nProvider` (`./provider`) — the whole bilingual catalog, bundled into a
 *   shared client chunk. The workspace layouts use it.
 * - `I18nMessagesProvider` (below) — only the namespaces a page's Client
 *   Components look up, in the current locale, sent as props by the server. The
 *   public Landing page uses it, so its first load carries no catalog chunk.
 */
export const I18nContext = createContext<I18nValue | null>(null);

/** Provides the active locale + a `t()` over a server-picked slice of its catalog. */
export function I18nMessagesProvider({
  locale,
  dir,
  messages,
  children,
}: {
  locale: Locale;
  dir: "ltr" | "rtl";
  messages: MessageTree;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, dir, t: translatorFor(messages, locale) }),
    [locale, dir, messages],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider.");
  return ctx;
}
