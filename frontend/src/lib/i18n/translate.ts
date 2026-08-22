import type { Locale } from "./locales";
import { formatNumber } from "@/lib/ui/format";
import { en, type Messages } from "./messages/en";
import { ar } from "./messages/ar";

const CATALOGS: Record<Locale, Messages> = { en, ar };

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale];
}

/** Resolve a dotted key (e.g. "leads.stages.new") against a catalog. */
function lookup(messages: Messages, key: string): string {
  const value = key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages);
  return typeof value === "string" ? value : key;
}

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Build a `t()` bound to a locale, with `{placeholder}` interpolation.
 *
 * A NUMBER interpolated into a message is formatted for the bound locale; a
 * string is substituted verbatim.
 *
 * This one line was the single largest source of Latin digits in the Arabic UI.
 * `t("execution.order.itemCount", { count: items.length })` reads as though it
 * localises the sentence, and it did — every word of it — while coercing the
 * count with `String()`, so the Arabic order page rendered "1 عنصر". The
 * distinction the translator now draws is the honest one: a `number` is a
 * QUANTITY and follows the reader's numerals; a `string` is opaque text the
 * caller has already decided the shape of.
 *
 * That is also how the identifier exception stays safe. `ORD-1256` and a UUID
 * are strings, so they pass through untouched, and a caller that genuinely wants
 * an unshaped number states it by passing `formatIdentifier(n)` — a choice that
 * is visible in the diff rather than an accident of a coercion.
 */
export function createTranslator(locale: Locale): TranslateFn {
  const messages = getMessages(locale);
  return (key, vars) => {
    let out = lookup(messages, key);
    if (vars) {
      for (const [name, val] of Object.entries(vars)) {
        const text = typeof val === "number" ? formatNumber(val, locale) : val;
        out = out.replaceAll(`{${name}}`, text);
      }
    }
    return out;
  };
}
