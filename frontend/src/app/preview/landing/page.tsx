import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { LandingHero } from "@/features/landing-preview/landing-hero";
import { LandingEcosystem } from "@/features/landing-preview/landing-ecosystem";
import { LandingMotion } from "@/features/landing-preview/landing-motion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Landing preview | Aladdin",
  robots: { index: false, follow: false },
};

// Presentation is intentionally private to this preview. Promotion to `/`
// requires explicit approval and a separate change.
export default async function LandingPreviewPage() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <LandingMotion>
        <LandingHero />
        <LandingEcosystem />
      </LandingMotion>
    </I18nProvider>
  );
}
