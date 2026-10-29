"use client";

import type { ReactNode } from "react";
import { LandingFooter } from "@/features/landing-preview/landing-footer";
import { LandingHeader } from "@/features/landing-preview/landing-header";
import { useI18n } from "@/lib/i18n/context";
import { MarketplaceCartProvider, useMarketplaceCart } from "./marketplace-cart";
import { useLiveCart } from "./live/live-cart-store";
import { marketplaceCopy } from "./marketplace-copy";
import brand from "@/styles/brand-2026.module.css";
import styles from "./marketplace.module.css";

/** Slim page frame for the Marketplace preview surfaces (bar, title, preview note, footer). */
/**
 * `live` = the real, database-backed catalog: no sample-data chip, and the header cart counts the
 * guest cart of real products (checkout itself is not open yet).
 */
export function MarketplaceShell({ children, live = false }: { children: ReactNode; showTitle?: boolean; live?: boolean }) {
  return (
    <MarketplaceCartProvider>
      <ShellFrame live={live}>{children}</ShellFrame>
    </MarketplaceCartProvider>
  );
}

function ShellFrame({ children, live }: { children: ReactNode; live: boolean }) {
  const { locale, dir } = useI18n();
  const t = marketplaceCopy[locale];
  const cart = useMarketplaceCart();
  const liveCart = useLiveCart();
  return (
    <div className={`${brand.brand} ${styles.page}`} dir={dir} data-marketplace-preview={live ? undefined : "true"}>
      <div className={`${styles.container} ${styles.headerBand}`}>
        <div className={styles.headerSlot}><LandingHeader anchorBase="/" showCart cartCount={live ? liveCart.count : cart.count} active="marketplace" /></div>
      </div>
      <main className={styles.container}>
        {live ? null : <p className={styles.previewChip}>{t.previewChip}</p>}
        {children}
        {live ? null : <p className={styles.previewNote}>{t.previewNote}</p>}
      </main>
      <LandingFooter anchorBase="/" />
    </div>
  );
}
