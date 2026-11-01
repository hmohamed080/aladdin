import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nMessagesProvider } from "@/lib/i18n/context";
import { MarketplaceComingSoon } from "@/features/landing-marketplace/marketplace-coming-soon";
import { landingMessages } from "@/features/landing-preview/landing-messages";

export const metadata: Metadata = { title: "Marketplace · Aladdin" };
export const dynamic = "force-dynamic";

/**
 * Placeholder for the Aladdin Marketplace. Every Marketplace link on the landing
 * page (navbar, section CTA, "Add to cart") lands here until the Marketplace ships.
 */
export default async function MarketplacePage() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);

  return (
    <I18nMessagesProvider locale={locale} dir={directionFor(locale)} messages={landingMessages(locale)}>
      <MarketplaceComingSoon />
    </I18nMessagesProvider>
  );
}
