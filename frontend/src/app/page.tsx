import { I18nMessagesProvider } from "@/lib/i18n/context";
import { LandingBrand } from "@/features/landing-brand/landing-brand";
import { readLandingStats } from "@/features/landing-brand/landing-brand-stats.server";
import { landingMessages } from "@/features/landing-preview/landing-messages";

export const dynamic = "force-dynamic";

/**
 * App entry — THE public Aladdin Landing Page, and the only one `/` ever renders.
 *
 * Brand-identity composition (design-system v1.1.0): `LandingBrand` — header, hero with live platform counts, roles,
 * services, product market preview, how it works, why Aladdin, experience, partners, FAQ, final call to action and
 * footer. It is deliberately NOT chosen by environment: a preview, Production, staging and a plain branch deployment
 * must all serve the same page. The earlier `landing-preview` (LandingMotion > LandingHero + LandingEcosystem) and
 * `landing-v2` components stay in the repo as reference only and are no longer mounted anywhere.
 */
export default async function RootPage() {
  // The landing page is Arabic-only: no language switch, no cookie lookup.
  return (
    <I18nMessagesProvider locale="ar" dir="rtl" messages={landingMessages("ar")}>
      <LandingBrand stats={await readLandingStats()} />
    </I18nMessagesProvider>
  );
}
