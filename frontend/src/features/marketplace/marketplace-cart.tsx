"use client";

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { previewProducts } from "./marketplace-preview-data";
import type { PreviewProduct, PreviewVariant } from "./marketplace-types";

/**
 * Guest cart for the Marketplace PREVIEW (ADR-0011: guest cart). It lives in this browser only
 * (localStorage) — no account, no server, no reservation of stock, no payment. Lines reference the
 * sample catalogue by id, so a stale or tampered entry is dropped on load instead of trusted.
 */
export type CartLine = { productId: string; variantId: string; qty: number };

export type ResolvedLine = {
  product: PreviewProduct;
  variant: PreviewVariant;
  qty: number;
  lineTotalEgp: number;
};

const STORAGE_KEY = "aladdin.marketplace.guest-cart.v1";

function resolve(line: CartLine): ResolvedLine | null {
  const product = previewProducts.find((p) => p.id === line.productId);
  const variant = product?.variants.find((v) => v.id === line.variantId);
  if (!product || !variant) return null;
  return { product, variant, qty: line.qty, lineTotalEgp: variant.priceEgp * line.qty };
}

/** Quantity must respect the product's minimum / step and what is in stock. */
export function clampQty(product: PreviewProduct, variant: PreviewVariant, wanted: number): number {
  const step = product.qtyStep || 1;
  const min = product.minOrderQty || 1;
  let q = Math.max(min, Math.round(wanted));
  q = min + Math.round((q - min) / step) * step;
  return Math.max(min, Math.min(q, Math.max(variant.stock, min)));
}

function load(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CartLine[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const { productId, variantId, qty } = item as Record<string, unknown>;
      if (typeof productId !== "string" || typeof variantId !== "string" || typeof qty !== "number") continue;
      const r = resolve({ productId, variantId, qty });
      if (!r || r.variant.stock <= 0) continue;
      if (out.some((l) => l.variantId === variantId)) continue;
      out.push({ productId, variantId, qty: clampQty(r.product, r.variant, qty) });
    }
    return out;
  } catch {
    return [];
  }
}

type CartApi = {
  /** false while the page is being hydrated (the stored cart is not readable yet) */
  ready: boolean;
  lines: ResolvedLine[];
  count: number;
  subtotalEgp: number;
  add: (productId: string, variantId: string, qty?: number) => "added" | "out_of_stock";
  setQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  /** removes every line of a product (cards add / remove a product as a whole) */
  removeProduct: (productId: string) => void;
  /** is any variant of this product in the cart */
  hasProduct: (productId: string) => boolean;
  clear: () => void;
};

/* ---------------------------------------------------------------------------------------------
   The cart is a small external store read through useSyncExternalStore.

   Why not useState + an effect: the page streams inside <Suspense> (useSearchParams), so a child can
   hydrate AFTER its parent provider's effect has already loaded localStorage. A context value that
   changed after the server HTML was produced made the card buttons mismatch ("Add to cart" in the
   HTML, "Remove from cart" on the client) and React threw a hydration error. With a server snapshot
   (always empty) every component renders the same markup as the server first, then re-renders with
   the real cart — no mismatch, in any hydration order.
   --------------------------------------------------------------------------------------------- */
const SERVER_LINES: readonly CartLine[] = Object.freeze([]);
let lines: readonly CartLine[] = SERVER_LINES;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  lines = load();
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    /* private mode / blocked storage: the cart then lives for this visit only */
  }
}

function commit(next: readonly CartLine[]) {
  ensureLoaded();
  lines = next;
  persist();
  emit();
}

function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY) return;
  lines = load();
  loaded = true;
  emit();
}

function subscribe(listener: () => void): () => void {
  ensureLoaded();
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      // Nobody is watching: the next reader re-reads the stored cart (also keeps isolated tests independent).
      loaded = false;
    }
  };
}

const getSnapshot = (): readonly CartLine[] => {
  ensureLoaded();
  return lines;
};
const getServerSnapshot = (): readonly CartLine[] => SERVER_LINES;

const noopSubscribe = () => () => undefined;

function add(productId: string, variantId: string, qty?: number): "added" | "out_of_stock" {
  const r = resolve({ productId, variantId, qty: 1 });
  if (!r || r.variant.stock <= 0) return "out_of_stock";
  ensureLoaded();
  const existing = lines.find((l) => l.variantId === variantId);
  const next = clampQty(r.product, r.variant, (existing?.qty ?? 0) + (qty ?? r.product.minOrderQty));
  commit(existing ? lines.map((l) => (l.variantId === variantId ? { ...l, qty: next } : l)) : [...lines, { productId, variantId, qty: next }]);
  return "added";
}

function setQty(variantId: string, qty: number) {
  ensureLoaded();
  commit(
    lines.map((l) => {
      if (l.variantId !== variantId) return l;
      const r = resolve(l);
      return r ? { ...l, qty: clampQty(r.product, r.variant, qty) } : l;
    }),
  );
}

const remove = (variantId: string) => { ensureLoaded(); commit(lines.filter((l) => l.variantId !== variantId)); };
const removeProduct = (productId: string) => { ensureLoaded(); commit(lines.filter((l) => l.productId !== productId)); };
const clear = () => commit([]);

/** Kept as a pass-through so existing page shells keep one clear place that "owns" the cart. */
export function MarketplaceCartProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useMarketplaceCart(): CartApi {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return useMemo<CartApi>(() => {
    const resolved = stored.map(resolve).filter((x): x is ResolvedLine => x !== null);
    return {
      ready,
      lines: resolved,
      count: resolved.reduce((n, l) => n + l.qty, 0),
      subtotalEgp: resolved.reduce((n, l) => n + l.lineTotalEgp, 0),
      add,
      setQty,
      remove,
      removeProduct,
      hasProduct: (productId) => resolved.some((l) => l.product.id === productId),
      clear,
    };
  }, [stored, ready]);
}
