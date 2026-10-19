/**
 * The catalog namespaces the Landing page's Client Components look up with
 * `t()`. The landing copy itself is inline and bilingual in each section; only
 * shared controls (the header's `LanguageSwitch` reads `nav.language`) go
 * through the catalog. The page sends just these namespaces, in the current
 * locale, through `I18nMessagesProvider`, instead of bundling the full
 * English + Arabic catalog into its first load. A key outside this list renders
 * as the raw key, which `landing-messages.test.tsx` guards against.
 */
export const LANDING_MESSAGE_NAMESPACES = ["nav"] as const;
