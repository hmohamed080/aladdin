import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { LandingHero } from "@/features/landing-preview/landing-hero";
import { LandingEcosystem } from "@/features/landing-preview/landing-ecosystem";
import { LandingMotion } from "@/features/landing-preview/landing-motion";

export const dynamic = "force-dynamic";

/**
 * App entry — THE public Aladdin Landing Page, and the only one `/` ever renders.
 *
 * The approved composition is `LandingMotion` > `LandingHero` + `LandingEcosystem`
 * (header, hero, process, roles, videos, brands, stories, final call to action and
 * footer all live inside those). It is deliberately NOT chosen by environment: a
 * Vercel Preview, Production, staging and a plain branch deployment must all serve
 * the same page. `NEXT_PUBLIC_APP_ENV` used to select between this and the older
 * `landing-v2` stack, which let the old page come back on any deployment that did
 * not set it to "staging"; that split is gone. The `landing-v2` components stay in
 * the repo as reference only and are no longer mounted anywhere.
 */
export default async function RootPage() {
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
