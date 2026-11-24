"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * Who is looking at the Marketplace, for the cart only (Marketplace PR 11). Provided by ./cart-viewer (rendered by the
 * /market layout while ordering is on); everywhere else, and for a guest, the default is "nobody special". Kept apart from
 * the provider so that the add-to-cart button does not pull the server action into its module graph.
 */
export type Viewer = { signedIn: boolean; ownSellers: readonly string[] };
export const GUEST: Viewer = { signedIn: false, ownSellers: [] };
export const ViewerContext = createContext<Viewer>(GUEST);

export function useCartViewer(): Viewer {
  return useContext(ViewerContext);
}

/** True when the signed-in viewer works for this showroom (so cannot buy from it). */
export function useIsOwnShowroom(sellerSlug: string | null | undefined): boolean {
  const { ownSellers } = useContext(ViewerContext);
  return Boolean(sellerSlug) && ownSellers.includes(sellerSlug as string);
}

/* what the last merge left out, shown once on the cart page */
export type CartNotice = { skipped: number; ownShowroom: number } | null;
let notice: CartNotice = null;
const noticeListeners = new Set<() => void>();
export function setCartNotice(next: CartNotice) {
  notice = next;
  for (const l of noticeListeners) l();
}
export function dismissCartNotice() {
  setCartNotice(null);
}
export function useCartNotice(): CartNotice {
  return useSyncExternalStore(
    (l) => {
      noticeListeners.add(l);
      return () => {
        noticeListeners.delete(l);
      };
    },
    () => notice,
    () => null,
  );
}
