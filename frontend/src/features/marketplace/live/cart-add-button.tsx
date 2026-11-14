"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckIcon, ShoppingBagIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { liveCartCopy } from "./live-cart-copy";
import { useLiveCart } from "./live-cart-store";
import { liveCopy } from "./live-copy";

/**
 * "Add to cart" on a product card (Marketplace catalogue and the home page). A product with one active
 * variant goes straight into the browser cart (the header cart counts it at once); a product with
 * several variants opens its page to choose; an out-of-stock product says so. Prices are never taken
 * from here: the cart re-quotes everything from the database.
 */
export function CartAddButton({
  slug,
  sku,
  inStock,
  className,
  doneClassName,
}: {
  slug: string;
  sku: string | null | undefined;
  inStock: boolean;
  className?: string;
  doneClassName?: string;
}) {
  const { locale } = useI18n();
  const c = liveCartCopy[locale];
  const cart = useLiveCart();
  const [flash, setFlash] = useState<"added" | "cart_full" | null>(null);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 1800);
    return () => window.clearTimeout(id);
  }, [flash]);

  if (!inStock) {
    return (
      <button type="button" className={className} disabled aria-disabled="true">
        {liveCopy[locale].outOfStock}
      </button>
    );
  }
  if (!sku) {
    return (
      <Link href={`/marketplace/products/${slug}`} className={className}>
        <ShoppingBagIcon size={18} aria-hidden="true" />
        {c.chooseOptions}
      </Link>
    );
  }
  const inCartQty = cart.ready ? (cart.lines.find((l) => l.slug === slug && l.sku === sku)?.qty ?? 0) : 0;
  return (
    <>
      <button
        type="button"
        className={`${className ?? ""} ${flash === "added" && doneClassName ? doneClassName : ""}`}
        onClick={() => setFlash(cart.add(slug, sku))}
      >
        {flash === "added" ? <CheckIcon size={18} aria-hidden="true" /> : <ShoppingBagIcon size={18} aria-hidden="true" />}
        {flash === "added" ? c.addedToCart : inCartQty > 0 ? `${c.inCart} (${inCartQty}) +` : c.addToCart}
      </button>
      <span className="sr-only" role="status">{flash === "added" ? c.addedToCart : flash === "cart_full" ? c.cartFull : ""}</span>
    </>
  );
}
