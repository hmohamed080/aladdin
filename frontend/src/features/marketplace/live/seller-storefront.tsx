"use client";

import Link from "next/link";
import type { Locale } from "../marketplace-types";
import { fmtNum, liveCopy } from "./live-copy";
import { deliveryCopy } from "./live-delivery-copy";
import { OfficialBadge, ProductCard } from "./product-card";
import { PUBLIC_PAGE_SIZE, type PublicPage, type PublicSeller } from "./public-contract";
import styles from "../marketplace-v2.module.css";
import store from "../marketplace-store.module.css";
import base from "../marketplace.module.css";

/**
 * Seller storefront (basic): the showroom name, the Official Store mark when it is business-verified, and its products.
 * Browse-only: there is deliberately NO contact element (how a buyer reaches a showroom is not decided yet).
 */
export function SellerStorefront({ locale, seller, page, pageNo }: { locale: Locale; seller: PublicSeller; page: PublicPage | null; pageNo: number }) {
  const t = liveCopy[locale];
  const d = deliveryCopy[locale];
  const total = page ? Number(page.total) : 0;
  const pages = Math.max(1, Math.ceil(total / PUBLIC_PAGE_SIZE));
  const href = (n: number) => (n > 1 ? `/market/sellers/${seller.slug}?page=${n}` : `/market/sellers/${seller.slug}`);
  return (
    <div className={base.browser}>
      <header className={styles.storeHead}>
        <div>
          <h1 className={styles.storeName} data-plain>
            {seller.name}
            {seller.official ? <OfficialBadge locale={locale} /> : null}
          </h1>
          <p className={styles.storeCount}>{d.storeProducts(fmtNum(total, locale))}</p>
        </div>
        <Link href="/market" className={base.clear}>{t.back}</Link>
      </header>

      {!page || page.items.length === 0 ? (
        <div className={base.empty}>
          <h2>{t.noMatchTitle}</h2>
        </div>
      ) : (
        <ul className={styles.grid}>
          {page.items.map((item) => (
            <li key={item.slug}>
              <ProductCard item={item} locale={locale} />
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label={t.page(fmtNum(pageNo, locale), fmtNum(pages, locale))}>
          <ul className={store.pager}>
            <li>{pageNo > 1 ? <Link className={store.pageBtn} href={href(pageNo - 1)}>{t.prev}</Link> : <span className={store.pageBtn}>{t.prev}</span>}</li>
            <li><span className={store.pageBtn}>{t.page(fmtNum(pageNo, locale), fmtNum(pages, locale))}</span></li>
            <li>{pageNo < pages ? <Link className={store.pageBtn} href={href(pageNo + 1)}>{t.next}</Link> : <span className={store.pageBtn}>{t.next}</span>}</li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
