import type { TranslateFn } from "./translate";

/**
 * One label for a language code, whichever of the TWO conventions it is written in.
 *
 * `profiles.languages` genuinely holds both today, and neither is wrong:
 *
 *   * the professional onboarding flow writes `arabic` / `english` / `french`
 *     (`LANGUAGES` in `lib/onboarding/persona-fields.ts`), which is what
 *     `onboarding.professional.languages.*` is keyed by;
 *   * every seeded Pilot profile — and so every professional currently in the
 *     public directory — holds ISO codes `ar` / `en`, which is what
 *     `common.languageName` is keyed by and what `directory-tables.tsx` renders.
 *
 * A surface that knows only one convention prints a raw message key at the other,
 * and a PUBLIC page is the worst place for that to happen: the visitor cannot tell
 * whether "onboarding.professional.languages.ar" means the profile is broken or
 * the platform is. So this normalizes the ISO form onto the onboarding vocabulary
 * and looks the label up once.
 *
 * Unknown codes fall back to the code itself rather than to a key path — still not
 * a translation, but at least a word rather than an internal identifier.
 */
const ISO_TO_VOCABULARY: Record<string, string> = {
  ar: "arabic",
  en: "english",
  fr: "french",
};

export function languageLabel(t: TranslateFn, code: string): string {
  const key = ISO_TO_VOCABULARY[code] ?? code;
  const messageKey = `onboarding.professional.languages.${key}`;
  const label = t(messageKey);
  // `createTranslator` returns the key itself when nothing resolves.
  return label === messageKey ? code : label;
}
