import { loadPublicCatalogPage } from "@/server/queries/marketplace-public";
import { LandingMarketplaceLive } from "./landing-marketplace-live";

/**
 * The section's REAL data: the newest published products of approved sellers,
 * read through the same public RPC as /marketplace. The former sample catalogue
 * (`landing-marketplace-section.tsx`) is no longer mounted anywhere.
 */
export async function LandingMarketplaceLoader() {
  const page = await loadPublicCatalogPage({ sort: "newest", page: 1 });
  return <LandingMarketplaceLive items={page?.items ?? []} />;
}
