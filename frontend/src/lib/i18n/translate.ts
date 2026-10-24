import type { Locale } from "./locales";
import { en, type Messages } from "./messages/en";
import { ar } from "./messages/ar";
import { translatorFor, type TranslateFn } from "./translate-core";

export type { TranslateFn };

const CATALOGS: Record<Locale, Messages> = { en, ar };

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale];
}

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
  return translatorFor(getMessages(locale), locale);
}

/**
 * The top-level namespaces of `locale`'s catalog, and nothing else — what a
 * Server Component hands `I18nMessagesProvider` so the client receives only the
 * strings its Client Components actually look up, in one language.
 */
export function pickMessages<K extends keyof Messages>(locale: Locale, namespaces: readonly K[]): Pick<Messages, K> {
  const messages = getMessages(locale);
  return Object.fromEntries(namespaces.map((ns) => [ns, messages[ns]])) as Pick<Messages, K>;
}
