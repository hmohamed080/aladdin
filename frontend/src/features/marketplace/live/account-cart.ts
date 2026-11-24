import type { CartSyncInput, CartSyncResult } from "@/server/actions/marketplace-cart-account";
import type { StoredCartLine } from "./public-contract";

/**
 * Keeps the browser cart and the signed-in account's cart together (Marketplace PR 11). Pure orchestration with injected
 * storage / store / server action, so every branch is unit-testable.
 *
 *   signed out            a cart that still carries an account tag belonged to that account: it is dropped (never offered to
 *                         the next person on a shared device); a plain guest cart is left alone.
 *   signed in, guest cart merge it into the account cart ONCE: the merge key is created and stored BEFORE the call, so a
 *                         retry after a lost answer reuses the same key and the server answers "replayed".
 *   signed in, mirror     local changes made since the last sync are pushed; otherwise the account cart is pulled.
 *   cart of another user  (the tag differs) the stored cart is dropped first, then the account cart is pulled.
 *
 * The browser never sends a price; the server resolves slug + SKU itself.
 */
export const MERGE_KEY_STORAGE = "aladdin.marketplace.live-cart.merge-key.v1";

export type SyncDeps = {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  accountKey: string;
  dirtyKey: string;
  action: (input: CartSyncInput) => Promise<CartSyncResult>;
  read: () => StoredCartLine[];
  write: (lines: StoredCartLine[]) => void;
  newKey: () => string;
};

export type SyncOutcome =
  | { kind: "idle" }
  | { kind: "cleared" }
  | { kind: "merged"; skipped: number; ownShowroom: number }
  | { kind: "pushed" }
  | { kind: "pulled" }
  | { kind: "failed"; code: string };

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export async function syncAccountCart(ownerTag: string | null, d: SyncDeps): Promise<SyncOutcome> {
  const stored = safe(() => d.storage.getItem(d.accountKey), null);
  const forget = () => {
    safe(() => d.storage.removeItem(d.accountKey), undefined);
    safe(() => d.storage.removeItem(d.dirtyKey), undefined);
    safe(() => d.storage.removeItem(MERGE_KEY_STORAGE), undefined);
  };

  if (!ownerTag) {
    if (!stored) return { kind: "idle" };
    forget();
    d.write([]);
    return { kind: "cleared" };
  }

  if (stored && stored !== ownerTag) {
    forget();
    d.write([]);
  }
  const mirror = stored === ownerTag;

  const adopt = (lines: StoredCartLine[]) => {
    d.write(lines);
    safe(() => d.storage.setItem(d.accountKey, ownerTag), undefined);
    safe(() => d.storage.removeItem(d.dirtyKey), undefined);
  };

  if (!mirror) {
    let key = safe(() => d.storage.getItem(MERGE_KEY_STORAGE), null);
    if (!key) {
      key = d.newKey();
      safe(() => d.storage.setItem(MERGE_KEY_STORAGE, key as string), undefined);
    }
    const res = await d.action({ mode: "merge", key, lines: d.read() });
    if (!res.ok) return { kind: "failed", code: res.code };
    adopt(res.lines);
    safe(() => d.storage.removeItem(MERGE_KEY_STORAGE), undefined);
    return { kind: "merged", skipped: res.skipped ?? 0, ownShowroom: res.ownShowroom ?? 0 };
  }

  const dirty = safe(() => d.storage.getItem(d.dirtyKey), null) === "1";
  if (dirty) {
    const res = await d.action({ mode: "replace", lines: d.read() });
    if (res.ok) {
      adopt(res.lines);
      return { kind: "pushed" };
    }
    if (res.code !== "own_showroom" && res.code !== "invalid") return { kind: "failed", code: res.code };
    // the server refused this cart (a line of the buyer's own showroom, or malformed): the account cart wins
  }
  const res = await d.action({ mode: "pull" });
  if (!res.ok) return { kind: "failed", code: res.code };
  adopt(res.lines);
  return { kind: "pulled" };
}
