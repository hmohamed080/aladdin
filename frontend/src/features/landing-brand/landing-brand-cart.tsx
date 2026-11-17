"use client";

import { ShoppingBagIcon } from "@/components/ui/icons";
import { useLiveCart } from "../marketplace/live/live-cart-store";
import styles from "./landing-brand.module.css";

/** Header cart link with the live count of the browser cart (the same store "Add to cart" writes). Shown only while the Marketplace is open. */
export function LandingBrandCart() {
  const { count } = useLiveCart();
  return (
    <a className={styles.cartLink} href="/market/cart" aria-label={count > 0 ? `السلة (${count})` : "السلة"}>
      <ShoppingBagIcon size={20} aria-hidden="true" />
      {count > 0 ? <span className={styles.cartBadge} aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}
    </a>
  );
}
