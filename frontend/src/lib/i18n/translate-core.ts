import type { Locale } from "./locales";
import { formatNumber } from "@/lib/ui/format";

/**
 * The catalog-free half of `t()`: key lookup plus `{placeholder}` interpolation
 * over whatever message tree it is handed. It imports NO catalog, so a Client
 * Component can use it without shipping `en.ts` + `ar.ts` (≈ 650 KB raw) to the
 * browser. `translate.ts` binds it to the full catalogs; `I18nMessagesProvider`
 * binds it to the slice of the current locale a page sent from the server.
 */
export type MessageTree = object;

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** Resolve a dotted key (e.g. "leads.stages.new") against a catalog. A miss returns the key. */
function lookup(messages: MessageTree, key: string): string {
  const value = key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages);
  return typeof value === "string" ? value : key;
}

/**
 * Build a `t()` over `messages`, with numbers formatted for `locale` (see
 * `createTranslator` in `translate.ts` for why a number and a string differ).
 */
export function translatorFor(messages: MessageTree, locale: Locale): TranslateFn {
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
