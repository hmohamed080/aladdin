import "server-only";

import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { loadMarketplaceSellerStatus } from "@/server/queries/marketplace-seller";
import { sellerPageAccess } from "./access";

/**
 * The page-level gate shared by every B2C seller page that WRITES: an approved
 * seller gets the page context; anyone else gets no such page. (The database
 * re-checks on every write — this only decides what is rendered.)
 */
export async function requireApprovedSeller() {
  const ctx = await getPageContext();
  if (!ctx) notFound();
  const status = await loadMarketplaceSellerStatus(ctx.supabase, ctx.org.organizationId);
  if (sellerPageAccess(status) !== "allow") notFound();
  return ctx;
}
