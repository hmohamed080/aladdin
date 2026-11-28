import type { ReactNode } from "react";
import { CartViewerProvider } from "@/features/marketplace/live/cart-viewer";
import { SignedInViewer } from "@/features/marketplace/live/viewer-context";
import { isMarketplaceOrderingEnabled } from "@/lib/env";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser, getSessionIdentity } from "@/server/auth/session";

/** An opaque, one-way tag of the account, so the browser can tell whose cart it holds without storing the account id. */
async function ownerTagOf(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`marketplace-cart:${userId}`));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Every /market page. While ordering is off (the browse-only launch) there is no cart and no sync; a signed-in caller is
 * only told apart from a guest (from the session token) so the header stops offering sign-in. While it is on, it tells the page who is looking (signed in or not, and which showrooms they work for)
 * and keeps the browser cart and the account cart together.
 */
export default async function MarketplaceLayout({ children }: { children: ReactNode }) {
  if (!isMarketplaceOrderingEnabled()) {
    return (await getSessionIdentity()) ? <SignedInViewer>{children}</SignedInViewer> : children;
  }
  const user = await getCurrentUser();
  if (!user) return <CartViewerProvider ownerTag={null} ownSellers={[]}>{children}</CartViewerProvider>;
  const { data } = await (await getServerSupabase()).rpc("marketplace_cart_own_sellers");
  const ownSellers = Array.isArray(data) ? data.filter((s): s is string => typeof s === "string") : [];
  return <CartViewerProvider ownerTag={await ownerTagOf(user.id)} ownSellers={ownSellers}>{children}</CartViewerProvider>;
}
