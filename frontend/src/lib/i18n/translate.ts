import type { Locale } from "./locales";
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

/** Build a `t()` bound to a locale, with `{placeholder}` interpolation. */
export function createTranslator(locale: Locale): TranslateFn {
  const messages = getMessages(locale);
  return (key, vars) => {
    let out = lookup(messages, key);
    if (vars) {
      for (const [name, val] of Object.entries(vars)) {
        out = out.replaceAll(`{${name}}`, String(val));
      }
    }
    return out;
  };
}
