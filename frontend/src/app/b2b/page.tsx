import { getPageContext } from "@/server/queries/page-context";
import { commerceStance } from "@/lib/workspace/supply-side";
import { BuyerDashboard } from "@/features/home/buyer-dashboard";
import { SupplyDashboard } from "@/features/home/supply-dashboard";

// Auth + organization context come from cookies, so this route is dynamic by
// construction. The declaration stays because it states the intent explicitly:
// these panels must reflect the caller's live records on every visit, and must
// never be served from a shared cache.
export const dynamic = "force-dynamic";

/**
 * The workspace dashboard — one route, one shell, two seats.
 *
 * A Showroom asks "what am I buying and what is it costing me". A Distributor,
 * Manufacturer or Importer asks "what is being asked of me and am I converting
 * it". Those are different questions over the SAME records, so they get different
 * panels rather than one dashboard that tries to answer both and ranks neither.
 *
 * The choice is derived from `organizations.org_type` and nothing else. It is a
 * presentation default: it grants no authority (capabilities and RLS decide that,
 * inside each dashboard), and every module both seats can reach stays reachable
 * from either one. Neither branch is a fork of the other — they are siblings over
 * one shared set of components.
 *
 * `getPageContext()` is `cache()`d per render, so resolving it here and passing it
 * down costs one identity/context resolution for the whole page.
 */
export default async function B2BHomePage({
  searchParams,
}: {
  // Next 15 hands search params in as a promise; the seller dashboard reads its
  // period scope and stage filter from the URL so that both survive a reload and
  // can be shared as a link. See `lib/workspace/period`.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [ctx, params] = await Promise.all([getPageContext(), searchParams]);
  if (!ctx) return null;

  return commerceStance(ctx.org.orgType) === "seller" ? (
    <SupplyDashboard ctx={ctx} period={one(params.period)} stage={one(params.stage)} />
  ) : (
    <BuyerDashboard ctx={ctx} />
  );
}

/** `?period=30d&period=90d` is legal in a URL and meaningless here — take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
