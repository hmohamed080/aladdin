import type { Locale } from "@/lib/i18n/locales";
import { getMessages, pickMessages } from "@/lib/i18n/translate";

/**
 * The catalog namespaces the Landing page's Client Components look up with
 * `t()`. The landing copy itself is inline and bilingual in each section; only
 * shared controls (the header's `LanguageSwitch` reads `nav.language`) go
 * through the catalog. The page sends just these namespaces, in the current
 * locale, through `I18nMessagesProvider`, instead of bundling the full
 * English + Arabic catalog into its first load. A key outside this slice renders
 * as the raw key, which `landing-messages.test.tsx` guards against.
 */
export const LANDING_MESSAGE_NAMESPACES = ["nav"] as const;

/**
 * The Landing page's message slice: the namespaces above plus ONLY
 * `onboarding.accountType` — the header's "Create account" menu names every
 * account type with its description. The rest of `onboarding` (~10× larger) is
 * not needed on the landing page and stays out of its first load.
 */
export function landingMessages(locale: Locale) {
  return {
    ...pickMessages(locale, LANDING_MESSAGE_NAMESPACES),
    onboarding: { accountType: getMessages(locale).onboarding.accountType },
  };
}
