"use client";

import { useMemo, useSyncExternalStore } from "react";
import { clampQty, parseStoredCart } from "./cart-math";
import { CART_MAX_LINES, CART_MAX_QTY, type StoredCartLine } from "./public-contract";

/**
 * The guest cart of the LIVE Marketplace (DL-01: it lives in this browser). It only remembers which
 * product + variant and how many — named by public slug and SKU — and never a price, a stock level
 * or a delivery fee: those are asked of the database every time the cart is shown. No account, no
 * stock reservation, no payment.
 *
 * Read through useSyncExternalStore with an empty server snapshot so server and client markup agree
 * on first render (same reasoning as the preview cart store in ../marketplace-cart.tsx).
 */
export const LIVE_CART_KEY = "aladdin.marketplace.live-cart.v1";

const SERVER_LINES: readonly StoredCartLine[] = Object.freeze([]);
let lines: readonly StoredCartLine[] = SERVER_LINES;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function read(): StoredCartLine[] {
  try {
    return parseStoredCart(window.localStorage.getItem(LIVE_CART_KEY));
  } catch {
    return [];
  }
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  lines = read();
}

function commit(next: readonly StoredCartLine[]) {
  ensureLoaded();
  lines = next;
  try {
    window.localStorage.setItem(LIVE_CART_KEY, JSON.stringify(lines));
  } catch {
    /* private mode / blocked storage: the cart then lives for this visit only */
  }
  emit();
}

function onStorage(e: StorageEvent) {
  if (e.key !== LIVE_CART_KEY) return;
  lines = read();
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

const getSnapshot = (): readonly StoredCartLine[] => {
  ensureLoaded();
  return lines;
};
const getServerSnapshot = (): readonly StoredCartLine[] => SERVER_LINES;
const noopSubscribe = () => () => undefined;

export type AddResult = "added" | "cart_full";

function add(slug: string, sku: string, qty = 1): AddResult {
  ensureLoaded();
  const existing = lines.find((l) => l.slug === slug && l.sku === sku);
  if (existing) {
    commit(lines.map((l) => (l === existing ? { ...l, qty: Math.min(CART_MAX_QTY, l.qty + Math.max(1, qty)) } : l)));
    return "added";
  }
  if (lines.length >= CART_MAX_LINES) return "cart_full";
  commit([...lines, { slug, sku, qty: clampQty(qty, CART_MAX_QTY) }]);
  return "added";
}

function setQty(slug: string, sku: string, qty: number) {
  ensureLoaded();
  commit(lines.map((l) => (l.slug === slug && l.sku === sku ? { ...l, qty: clampQty(qty, CART_MAX_QTY) } : l)));
}

function remove(slug: string, sku: string) {
  ensureLoaded();
  commit(lines.filter((l) => !(l.slug === slug && l.sku === sku)));
}

function clear() {
  commit([]);
}

export type LiveCart = {
  /** false while the page is being hydrated (the stored cart is not readable yet) */
  ready: boolean;
  lines: readonly StoredCartLine[];
  /** pieces in the cart (the number on the header icon) */
  count: number;
  add: typeof add;
  setQty: typeof setQty;
  remove: typeof remove;
  clear: typeof clear;
  has: (slug: string, sku: string) => boolean;
};

export function useLiveCart(): LiveCart {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return useMemo<LiveCart>(
    () => ({
      ready,
      lines: stored,
      count: stored.reduce((n, l) => n + l.qty, 0),
      add,
      setQty,
      remove,
      clear,
      has: (slug, sku) => stored.some((l) => l.slug === slug && l.sku === sku),
    }),
    [stored, ready],
  );
}
