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

const lineKey = (l: StoredCartLine) => `${l.slug}\n${l.sku}`;

/** What the buyer changed between `before` and `now`, applied on top of the server's answer. */
function rebase(before: StoredCartLine[], now: StoredCartLine[], server: StoredCartLine[]): { lines: StoredCartLine[]; changed: boolean } {
  const was = new Map(before.map((l) => [lineKey(l), l.qty]));
  const is = new Map(now.map((l) => [lineKey(l), l]));
  const removed = [...was.keys()].filter((k) => !is.has(k));
  const edited = now.filter((l) => was.get(lineKey(l)) !== l.qty);
  if (removed.length === 0 && edited.length === 0) return { lines: server, changed: false };
  const out = new Map(server.map((l) => [lineKey(l), l]));
  for (const k of removed) out.delete(k);
  for (const l of edited) out.set(lineKey(l), l);
  return { lines: [...out.values()], changed: true };
}

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

  // `before` is the cart as it was when the request left: anything changed since then stays, and stays marked for the next push.
  const adopt = (before: StoredCartLine[], lines: StoredCartLine[]) => {
    const merged = rebase(before, d.read(), lines);
    d.write(merged.lines);
    safe(() => d.storage.setItem(d.accountKey, ownerTag), undefined);
    if (merged.changed) safe(() => d.storage.setItem(d.dirtyKey, "1"), undefined);
    else safe(() => d.storage.removeItem(d.dirtyKey), undefined);
  };

  if (!mirror) {
    let key = safe(() => d.storage.getItem(MERGE_KEY_STORAGE), null);
    if (!key) {
      key = d.newKey();
      safe(() => d.storage.setItem(MERGE_KEY_STORAGE, key as string), undefined);
    }
    const before = d.read();
    const res = await d.action({ mode: "merge", key, lines: before });
    if (!res.ok) return { kind: "failed", code: res.code };
    adopt(before, res.lines);
    safe(() => d.storage.removeItem(MERGE_KEY_STORAGE), undefined);
    return { kind: "merged", skipped: res.skipped ?? 0, ownShowroom: res.ownShowroom ?? 0 };
  }

  const dirty = safe(() => d.storage.getItem(d.dirtyKey), null) === "1";
  if (dirty) {
    const before = d.read();
    const res = await d.action({ mode: "replace", lines: before });
    if (res.ok) {
      adopt(before, res.lines);
      return { kind: "pushed" };
    }
    if (res.code !== "own_showroom" && res.code !== "invalid") return { kind: "failed", code: res.code };
    // the server refused this cart (a line of the buyer's own showroom, or malformed): the account cart wins
  }
  const before = d.read();
  const res = await d.action({ mode: "pull" });
  if (!res.ok) return { kind: "failed", code: res.code };
  adopt(before, res.lines);
  return { kind: "pulled" };
}
