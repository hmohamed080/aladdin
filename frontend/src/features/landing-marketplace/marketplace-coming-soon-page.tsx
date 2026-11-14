import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nMessagesProvider } from "@/lib/i18n/context";
import { landingMessages } from "@/features/landing-preview/landing-messages";
import { MarketplaceComingSoon } from "./marketplace-coming-soon";

/**
 * What `/marketplace` serves while the release flag is closed (every environment
 * without NEXT_PUBLIC_MARKETPLACE_PREVIEW="true", Production included): the
 * landing header and footer around a "coming soon" note. Reads no catalog data.
 */
export async function MarketplaceComingSoonPage() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <I18nMessagesProvider locale={locale} dir={directionFor(locale)} messages={landingMessages(locale)}>
      <MarketplaceComingSoon />
    </I18nMessagesProvider>
  );
}
