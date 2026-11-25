"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { syncMarketplaceCartAction } from "@/server/actions/marketplace-cart-account";
import { syncAccountCart, type SyncDeps } from "./account-cart";
import {
  LIVE_CART_ACCOUNT_KEY, LIVE_CART_DIRTY_KEY, onCartMutation, readCartLines, writeAccountCartLines,
} from "./live-cart-store";
import { setCartNotice, ViewerContext } from "./viewer-context";

/**
 * Provider rendered by the /market layout while ordering is on. `ownerTag` is an opaque tag of the signed-in account (null
 * for a guest) and `ownSellers` the public slugs of the showrooms that person works for, whose products they can never buy
 * (the button is hidden; the database refuses it anyway). It also keeps the browser cart and the account cart together
 * (see ./account-cart).
 */
function deps(): SyncDeps {
  return {
    storage: window.localStorage,
    accountKey: LIVE_CART_ACCOUNT_KEY,
    dirtyKey: LIVE_CART_DIRTY_KEY,
    action: syncMarketplaceCartAction,
    read: readCartLines,
    write: writeAccountCartLines,
    newKey: () => window.crypto.randomUUID(),
  };
}

function AccountCartSync({ ownerTag }: { ownerTag: string | null }) {
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (running.current) {
        again.current = true;
        return;
      }
      running.current = true;
      try {
        do {
          again.current = false;
          const out = await syncAccountCart(ownerTag, deps()).catch(() => ({ kind: "failed" as const, code: "failed" }));
          if (alive && out.kind === "merged" && (out.skipped > 0 || out.ownShowroom > 0)) {
            setCartNotice({ skipped: out.skipped, ownShowroom: out.ownShowroom });
          }
        } while (again.current && alive);
      } finally {
        running.current = false;
      }
    };
    void run();
    const off = ownerTag
      ? onCartMutation(() => {
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void run(), 500);
        })
      : () => undefined;
    return () => {
      alive = false;
      off();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [ownerTag]);

  return null;
}

/** Rendered where sign-out lands: a cart that mirrored an account is dropped, so the next person never sees it. */
export function ForgetAccountCart() {
  useEffect(() => {
    void syncAccountCart(null, deps()).catch(() => undefined);
  }, []);
  return null;
}

export function CartViewerProvider({ ownerTag, ownSellers, children }: { ownerTag: string | null; ownSellers: string[]; children: ReactNode }) {
  return (
    <ViewerContext.Provider value={{ signedIn: ownerTag !== null, ownSellers }}>
      <AccountCartSync ownerTag={ownerTag} />
      {children}
    </ViewerContext.Provider>
  );
}
