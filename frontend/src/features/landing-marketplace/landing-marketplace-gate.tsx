import { readPublicEnv } from "@/lib/env";
import { LandingMarketplaceLoader } from "./landing-marketplace-loader";

/**
 * Server-side release gate for the landing "Aladdin Marketplace" section.
 *
 * Kept here, not in `app/page.tsx`: the landing page is deliberately never
 * chosen by environment (see its own guard test). This gate is a separate,
 * explicit release flag for an unreleased feature (ADR-0011): only the exact
 * value "true" renders the section; unset/false renders nothing — and reads
 * nothing — so Production is unchanged until the flag is set on purpose.
 */
export function LandingMarketplaceGate() {
  const enabled = readPublicEnv().NEXT_PUBLIC_MARKETPLACE_PREVIEW === "true";
  return enabled ? <LandingMarketplaceLoader /> : null;
}
