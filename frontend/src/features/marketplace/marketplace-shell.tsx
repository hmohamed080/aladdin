"use client";

import type { ReactNode } from "react";
import { LandingFooter } from "@/features/landing-preview/landing-footer";
import { LandingHeader } from "@/features/landing-preview/landing-header";
import { useI18n } from "@/lib/i18n/context";
import { useLiveCart } from "./live/live-cart-store";
import brand from "@/styles/brand-2026.module.css";
import styles from "./marketplace.module.css";

/**
 * Page frame of the live, database-backed Marketplace: the landing header (with the guest cart of
 * real products; checkout itself is not open yet), the page, and the landing footer.
 */
export function MarketplaceShell({ children }: { children: ReactNode; showTitle?: boolean }) {
  const { dir } = useI18n();
  const liveCart = useLiveCart();
  return (
    <div className={`${brand.brand} ${styles.page}`} dir={dir}>
      <div className={`${styles.container} ${styles.headerBand}`}>
        <div className={styles.headerSlot}><LandingHeader anchorBase="/" showCart cartCount={liveCart.count} active="marketplace" /></div>
      </div>
      <main className={styles.container}>{children}</main>
      <LandingFooter anchorBase="/" />
    </div>
  );
}
