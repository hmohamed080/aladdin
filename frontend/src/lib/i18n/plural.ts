import type { Locale } from "@/lib/i18n/locales";
import { formatCount } from "@/lib/ui/format";

/**
 * CLDR plural categories for a message whose NOUN/VERB form must agree with a
 * count, not just interpolate one. English only ever selects "one" or
 * "other" — but Arabic genuinely distinguishes all six ("لا شيء", واحد،
 * اثنان، قليل [3–10], كثير [11–99], غيره) with a different noun/verb shape
 * each time. `other` is the only category every CLDR locale defines, so it
 * is the only required key; a locale that doesn't distinguish a category
 * simply omits it and `formatPlural` falls back to `other`.
 */
export type PluralForms = { other: string } & Partial<Record<Exclude<Intl.LDMLPluralRule, "other">, string>>;

/**
 * Picks the grammatically correct form for `count` in `locale` and
 * interpolates the (locale-formatted) count into its `{count}` placeholder.
 *
 * `Intl.PluralRules` decides the CATEGORY (a `Intl.LDMLPluralRule` string);
 * it is never a substitute for a real translation of each category's text,
 * which is why this takes a full form table rather than trying to derive the
 * wording itself.
 */
export function formatPlural(count: number, locale: Locale, forms: PluralForms): string {
  const rule = new Intl.PluralRules(locale).select(count);
  const template = forms[rule] ?? forms.other;
  return template.replace("{count}", formatCount(count, locale));
}
