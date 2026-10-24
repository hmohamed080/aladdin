"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Select } from "@/components/ui/controls";
import { FilterIcon, GridIcon, ListIcon, PackageIcon } from "@/components/ui/icons";
import type { Facets, PublicCard, PublicPage, PublicSort } from "./public-contract";
import { PUBLIC_PAGE_SIZE, PUBLIC_SORTS } from "./public-contract";
import type { Locale } from "../marketplace-types";
import { fmtEgp, fmtNum, liveCopy } from "./live-copy";
import { ALL_PRODUCTS_TYPES, HERO_TYPES, typeCover } from "./type-covers";
import styles from "../marketplace.module.css";
import store from "../marketplace-store.module.css";

export type CatalogParams = {
  category: string;
  type: string;
  q: string;
  sort: PublicSort;
  page: number;
  priceMin: number | null;
  priceMax: number | null;
  inStock: boolean;
  /** attribute key → option keys */
  attrs: Record<string, string[]>;
};

export function catalogHref(p: CatalogParams, patch: Partial<CatalogParams> = {}) {
  const n = { ...p, page: 1, ...patch };
  const sp = new URLSearchParams();
  if (n.category) sp.set("category", n.category);
  if (n.type) sp.set("type", n.type);
  if (n.q) sp.set("q", n.q);
  if (n.sort !== "newest") sp.set("sort", n.sort);
  if (n.priceMin !== null) sp.set("pmin", String(n.priceMin));
  if (n.priceMax !== null) sp.set("pmax", String(n.priceMax));
  if (n.inStock) sp.set("stock", "1");
  for (const [k, v] of Object.entries(n.attrs)) if (v.length) sp.set(`f.${k}`, v.join(","));
  if (n.page > 1) sp.set("page", String(n.page));
  const s = sp.toString();
  return s ? `/marketplace?${s}` : "/marketplace";
}

const name = (o: { name_ar: string; name_en: string }, locale: Locale) => (locale === "ar" ? o.name_ar : o.name_en) || o.name_ar || o.name_en;

function Section({ title, open, count, children }: { title: string; open: boolean; count?: number; children: ReactNode }) {
  return (
    <details className={store.section} open={open}>
      <summary className={store.sectionSummary}>
        <span>{title}</span>
        {count ? <span className={store.sectionCount}>{count}</span> : null}
      </summary>
      <div className={store.sectionBody}>{children}</div>
    </details>
  );
}

function Card({ item, locale }: { item: PublicCard; locale: Locale }) {
  const t = liveCopy[locale];
  const title = name(item, locale);
  return (
    <article className={styles.card} data-product-type={item.product_type_key}>
      <Link href={`/marketplace/products/${item.slug}`} className={styles.cardMedia} aria-label={title}>
        {item.image_id ? (
          // eslint-disable-next-line @next/next/no-img-element -- no-store proxy; next/image would re-cache it
          <img src={`/marketplace/media/${item.image_id}`} alt="" loading="lazy" className={styles.cardImage} style={{ width: "100%", height: "100%" }} />
        ) : (
          <span className="grid h-full place-items-center px-3 text-center text-[.8125rem] text-[var(--stone)]">{t.noImage}</span>
        )}
      </Link>
      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>
          <Link href={`/marketplace/products/${item.slug}`}>{title}</Link>
        </h3>
        <p className={styles.cardMeta}>
          {name({ name_ar: item.product_type_name_ar, name_en: item.product_type_name_en }, locale)}
          {item.variant_count > 1 ? ` · ${t.variants(fmtNum(item.variant_count, locale))}` : ""}
        </p>
        {item.colors?.length ? (
          <ul className={styles.dots} aria-hidden="true">
            {item.colors.slice(0, 8).map((hex) => (
              <li key={hex} className={styles.dot} style={{ background: hex }} />
            ))}
          </ul>
        ) : null}
        {item.from_price_egp !== null ? (
          <p className={styles.cardPrice}>
            <span className={styles.from}>{item.variant_count > 1 ? `${t.from} ` : ""}</span>
            <strong>{fmtEgp(Number(item.from_price_egp), locale)}</strong>
          </p>
        ) : null}
        <p className={`${styles.stock} ${item.in_stock ? styles.stockIn : styles.stockOut}`}>{item.in_stock ? t.inStock : t.outOfStock}</p>
        <p className={styles.cardMeta}>{t.soldBy(item.seller_name)}</p>
      </div>
    </article>
  );
}

/**
 * The storefront in the approved layout (hero, type strip, side filters,
 * grid/list) driven ONLY by database results: every filter is a URL parameter
 * the server turns into `marketplace_public_catalog_page` arguments, and the
 * option filters / counts come from `marketplace_public_facets`. Nothing here
 * invents products, offers, ratings or delivery promises.
 */
export function LiveCatalog({ locale, dir, params, page, facets }: { locale: Locale; dir: "rtl" | "ltr"; params: CatalogParams; page: PublicPage | null; facets: Facets }) {
  const t = liveCopy[locale];
  const router = useRouter();
  const pathname = usePathname();
  const [panelOpen, setPanelOpen] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState(params.q);
  const [pmin, setPmin] = useState(params.priceMin?.toString() ?? "");
  const [pmax, setPmax] = useState(params.priceMax?.toString() ?? "");
  useEffect(() => setQ(params.q), [params.q]);
  useEffect(() => {
    setPmin(params.priceMin?.toString() ?? "");
    setPmax(params.priceMax?.toString() ?? "");
  }, [params.priceMin, params.priceMax]);

  const go = (patch: Partial<CatalogParams>) => router.push(catalogHref(params, patch), { scroll: false });
  const total = page ? Number(page.total) : 0;
  const pages = Math.max(1, Math.ceil(total / PUBLIC_PAGE_SIZE));
  const types = facets.categories.flatMap((c) => c.types.map((ty) => ({ ...ty, category: c.key })));
  const activeType = types.find((ty) => ty.key === params.type);
  const anyPublished = facets.categories.some((c) => c.count > 0);
  const filtered = Boolean(
    params.type || params.category || params.q || params.inStock || params.priceMin !== null || params.priceMax !== null || Object.values(params.attrs).some((v) => v.length),
  );
  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)));
  const applyPrice = () => {
    const a = num(pmin);
    const b = num(pmax);
    if (a !== params.priceMin || b !== params.priceMax) go({ priceMin: a, priceMax: b });
  };

  const chips: { id: string; label: string; patch: Partial<CatalogParams> }[] = [];
  for (const f of facets.filters) {
    for (const key of params.attrs[f.key] ?? []) {
      const opt = f.options.find((o) => o.key === key);
      chips.push({
        id: `${f.key}:${key}`,
        label: `${name(f, locale)}: ${opt ? name(opt, locale) : key}`,
        patch: { attrs: { ...params.attrs, [f.key]: (params.attrs[f.key] ?? []).filter((x) => x !== key) } },
      });
    }
  }
  if (params.priceMin !== null || params.priceMax !== null) {
    chips.push({ id: "price", label: `${t.price}: ${params.priceMin ?? "…"}–${params.priceMax ?? "…"}`, patch: { priceMin: null, priceMax: null } });
  }
  if (params.inStock) chips.push({ id: "stock", label: t.inStockOnly, patch: { inStock: false } });
  if (params.q) chips.push({ id: "q", label: `“${params.q}”`, patch: { q: "" } });

  const heroArt = HERO_TYPES.map(typeCover).filter((x): x is string => Boolean(x));

  const stripItems = [
    <button
      key="all"
      type="button"
      className={`${store.stripItem} ${!params.type && !params.category ? store.stripItemActive : ""}`}
      aria-pressed={!params.type && !params.category}
      onClick={() => go({ type: "", category: "", attrs: {} })}
    >
      <span className={`${store.stripMedia} ${store.stripMosaic}`}>
        {ALL_PRODUCTS_TYPES.map((k) => {
          const src = typeCover(k);
          return src ? (
            <span key={k} className={store.mosaicCell}>
              <Image src={src} alt="" fill unoptimized sizes="60px" />
            </span>
          ) : null;
        })}
      </span>
      <span>{t.allProducts}</span>
    </button>,
    ...types.map((ty) => {
      const src = typeCover(ty.key);
      const on = params.type === ty.key;
      return (
        <button
          key={ty.key}
          type="button"
          className={`${store.stripItem} ${on ? store.stripItemActive : ""}`}
          aria-pressed={on}
          onClick={() => go({ type: ty.key, category: ty.category, attrs: {} })}
        >
          <span className={store.stripMedia}>{src ? <Image src={src} alt="" fill unoptimized sizes="120px" /> : <PackageIcon size={26} aria-hidden="true" />}</span>
          <span>
            {name(ty, locale)} <span className="text-[var(--stone)]">({fmtNum(ty.count, locale)})</span>
          </span>
        </button>
      );
    }),
  ];
  const stripRows = [stripItems.slice(0, Math.ceil(stripItems.length / 2)), stripItems.slice(Math.ceil(stripItems.length / 2))];

  return (
    <div className={styles.browser} dir={dir}>
      <section className={store.hero} dir={dir} aria-labelledby="mp-hero-title">
        <div className={store.heroText}>
          <h1 id="mp-hero-title" className={store.heroTitle}>{t.title}</h1>
          <p className={store.heroTagline}>{t.heroTagline}</p>
          <p className={store.heroLine}>{t.subtitle}</p>
          <form
            className={store.heroSearch}
            role="search"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              go({ q: q.trim().slice(0, 100) });
            }}
          >
            <label className={store.srOnly} htmlFor="mp-search">{t.search}</label>
            <input id="mp-search" type="search" value={q} maxLength={100} placeholder={t.search} onChange={(e) => setQ(e.target.value)} />
            <button type="submit">{t.searchButton}</button>
          </form>
        </div>
        <div className={store.heroArt} aria-hidden="true">
          {heroArt.map((src) => (
            <span key={src}>
              <Image src={src} alt="" fill unoptimized sizes="160px" />
            </span>
          ))}
        </div>
      </section>

      {/* Every type is visible at once: two centred rows (the second is the shorter one), wrapping further on narrow screens — nothing scrolls out of sight. */}
      <div className={store.stripRows} role="group" aria-label={t.categories}>
        {stripRows.map((row, i) => (
          <div key={i} className={store.stripRow}>
            {row}
          </div>
        ))}
      </div>

      <div className={store.body}>
        <aside className={store.side} aria-label={t.filters}>
          <h2 className={store.sideHead}>
            <FilterIcon size={18} aria-hidden="true" />
            {t.filters}
          </h2>
          <button type="button" className={store.sideToggle} aria-expanded={panelOpen} onClick={() => setPanelOpen((v) => !v)}>
            {t.filters}
            {chips.length ? ` (${chips.length})` : ""}
          </button>
          <div className={`${store.sideBody} ${panelOpen ? store.sideBodyOpen : ""}`}>
            <Section title={t.price} open count={params.priceMin !== null || params.priceMax !== null ? 1 : 0}>
              <form
                className={store.priceRow}
                onSubmit={(e) => {
                  e.preventDefault();
                  applyPrice();
                }}
              >
                <input type="number" inputMode="numeric" min={0} aria-label={t.min} placeholder={facets.price.min !== null ? String(Math.floor(facets.price.min)) : t.min} value={pmin} onChange={(e) => setPmin(e.target.value)} onBlur={applyPrice} />
                <span aria-hidden="true">–</span>
                <input type="number" inputMode="numeric" min={0} aria-label={t.max} placeholder={facets.price.max !== null ? String(Math.ceil(facets.price.max)) : t.max} value={pmax} onChange={(e) => setPmax(e.target.value)} onBlur={applyPrice} />
                <button type="submit" className="sr-only">{t.searchButton}</button>
              </form>
            </Section>

            <Section title={t.type} open count={params.type ? 1 : 0}>
              <div className={store.typeList} role="radiogroup" aria-label={t.type}>
                <label className={styles.checkRow}>
                  <input type="radio" name="mp-type" checked={!params.type} onChange={() => go({ type: "", category: "", attrs: {} })} />
                  <span>{t.allProducts}</span>
                </label>
                {types.map((ty) => (
                  <label key={ty.key} className={styles.checkRow}>
                    <input type="radio" name="mp-type" checked={params.type === ty.key} onChange={() => go({ type: ty.key, category: ty.category, attrs: {} })} />
                    <span>
                      {name(ty, locale)} ({fmtNum(ty.count, locale)})
                    </span>
                  </label>
                ))}
              </div>
            </Section>

            {facets.filters.map((f) => {
              const selected = params.attrs[f.key] ?? [];
              const toggle = (key: string) =>
                go({ attrs: { ...params.attrs, [f.key]: selected.includes(key) ? selected.filter((x) => x !== key) : [...selected, key] } });
              const isColor = f.options.some((o) => o.swatch_hex);
              return (
                <Section key={f.key} title={name(f, locale)} open count={selected.length}>
                  {isColor ? (
                    <ul className={store.colors}>
                      {f.options.map((o) => {
                        const on = selected.includes(o.key);
                        const label = `${name(o, locale)} (${fmtNum(o.count, locale)})`;
                        return (
                          <li key={o.key}>
                            <button
                              type="button"
                              aria-pressed={on}
                              aria-label={label}
                              title={label}
                              className={`${store.colorBtn} ${store.colorDot} ${on ? store.colorBtnActive : ""}`}
                              style={{ background: o.swatch_hex ?? undefined }}
                              onClick={() => toggle(o.key)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <ul className={styles.options}>
                      {f.options.map((o) => (
                        <li key={o.key}>
                          <label className={styles.checkRow}>
                            <input type="checkbox" checked={selected.includes(o.key)} onChange={() => toggle(o.key)} />
                            <span>
                              {name(o, locale)} ({fmtNum(o.count, locale)})
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              );
            })}

            <label className={`${styles.checkRow} ${store.stockRow}`}>
              <input type="checkbox" checked={params.inStock} onChange={() => go({ inStock: !params.inStock })} />
              <span>{t.inStockOnly}</span>
            </label>

            <div className={store.sideActions}>
              <button type="button" className={store.resetBtn} disabled={!filtered} onClick={() => router.push(pathname, { scroll: false })}>
                {t.reset}
              </button>
            </div>
          </div>
        </aside>

        <section className={store.main} aria-label={t.allProducts}>
          <div className={store.headRow}>
            <h2 className={store.heading}>{activeType ? name(activeType, locale) : t.allProducts}</h2>
            <div className={store.tools}>
              <div className={store.sortWrap}>
                <Select aria-label={t.sort} value={params.sort} onChange={(e) => go({ sort: e.target.value as PublicSort })}>
                  {PUBLIC_SORTS.map((s) => (
                    <option key={s} value={s}>
                      {t.sorts[s]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className={store.viewGroup} role="group" aria-label={`${t.gridView} / ${t.listView}`}>
                <button type="button" className={`${store.viewBtn} ${view === "grid" ? store.viewBtnActive : ""}`} aria-pressed={view === "grid"} aria-label={t.gridView} onClick={() => setView("grid")}>
                  <GridIcon size={18} />
                </button>
                <button type="button" className={`${store.viewBtn} ${view === "list" ? store.viewBtnActive : ""}`} aria-pressed={view === "list"} aria-label={t.listView} onClick={() => setView("list")}>
                  <ListIcon size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className={styles.resultsHead}>
            <p role="status" aria-live="polite">
              {t.results(fmtNum(total, locale))} · {t.taxNote}
            </p>
            {chips.length ? (
              <ul className={styles.chips} aria-label={t.filters}>
                {chips.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => go(c.patch)} aria-label={`${c.label} ×`}>
                      {c.label} <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {!page || page.items.length === 0 ? (
            <div className={styles.empty}>
              <h2>{filtered || anyPublished ? t.noMatchTitle : t.emptyTitle}</h2>
              <p>{filtered || anyPublished ? t.noMatchBody : t.emptyBody}</p>
            </div>
          ) : (
            <ul className={`${styles.grid} ${view === "list" ? styles.gridList : ""}`}>
              {page.items.map((item) => (
                <li key={item.slug}>
                  <Card item={item} locale={locale} />
                </li>
              ))}
            </ul>
          )}

          {pages > 1 ? (
            <nav aria-label={t.page(fmtNum(params.page, locale), fmtNum(pages, locale))}>
              <ul className={store.pager}>
                <li>
                  <button type="button" className={store.pageBtn} disabled={params.page <= 1} onClick={() => go({ page: params.page - 1 })}>
                    {t.prev}
                  </button>
                </li>
                <li>
                  <span className={store.pageBtn}>{t.page(fmtNum(params.page, locale), fmtNum(pages, locale))}</span>
                </li>
                <li>
                  <button type="button" className={store.pageBtn} disabled={params.page >= pages} onClick={() => go({ page: params.page + 1 })}>
                    {t.next}
                  </button>
                </li>
              </ul>
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}
