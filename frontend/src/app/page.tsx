import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { readPublicEnv } from "@/lib/env";
import { LandingHero } from "@/features/landing-preview/landing-hero";
import { LandingEcosystem } from "@/features/landing-preview/landing-ecosystem";
import { LandingMotion } from "@/features/landing-preview/landing-motion";
import { LandingV2Hero } from "@/features/landing-v2/landing-v2-hero";
import { LandingV2Audience } from "@/features/landing-v2/landing-v2-audience";
import { LandingV2Products } from "@/features/landing-v2/landing-v2-products";
import { LandingV2Value } from "@/features/landing-v2/landing-v2-value";
import { LandingV2FinalCta } from "@/features/landing-v2/landing-v2-final-cta";
import { LandingV2Footer } from "@/features/landing-v2/landing-v2-footer";

export const dynamic = "force-dynamic";

/**
 * App entry — the public Aladdin Landing Page. Promoted from
 * `/preview/landing-v2` (now removed) once that composition was approved;
 * this is the same component stack, unchanged, just mounted at `/`.
 */
export default async function RootPage() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  // The approved promotion targets staging; production retains its current home.
  const staging = readPublicEnv().NEXT_PUBLIC_APP_ENV === "staging";

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      {staging ? <LandingMotion><LandingHero /><LandingEcosystem /></LandingMotion> : <main className="flex flex-col overflow-x-hidden bg-brand-plaster">
        <LandingV2Hero />
        <LandingV2Audience />
        <LandingV2Products />
        <LandingV2Value />
        <LandingV2FinalCta />
        <LandingV2Footer />
      </main>}
    </I18nProvider>
  );
}
