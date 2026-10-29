"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Select } from "@/components/ui/controls";
import { FilterIcon, GridIcon, ListIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { marketplaceCopy } from "./marketplace-copy";
import {
  cmToMm,
  emptyFilters,
  filterableFields,
  listProducts,
  mmToCm,
  parseFilters,
  presentOptionKeys,
  serializeFilters,
  PAGE_SIZE,
  type Filters,
  type SortKey,
} from "./marketplace-filters";
import type { ReactNode } from "react";
import { MarketplaceCategoryStrip, MarketplaceCta, MarketplaceFlashBanner, MarketplaceHero } from "./marketplace-sections";
import { MarketplaceProductCard } from "./marketplace-product-card";
import { previewProducts } from "./marketplace-preview-data";
import { colorCatalog, fieldOptionName } from "./marketplace-schema";
import { TYPE_KEYS, type SchemaField, type TypeKey } from "./marketplace-types";
import styles from "./marketplace.module.css";
import store from "./marketplace-store.module.css";

function activeChips(f: Filters, locale: "ar" | "en") {
  const chips: { id: string; label: string; remove: (cur: Filters) => Filters }[] = [];
  const fields = f.type ? filterableFields(f.type) : [];
  for (const field of fields) {
    for (const value of f.choices[field.key] ?? []) {
      const valueLabel = field.valueType === "boolean" ? field.name[locale] : fieldOptionName(field, value, locale);
      chips.push({
        id: `${field.key}:${value}`,
        label: field.valueType === "boolean" ? valueLabel : `${field.name[locale]}: ${valueLabel}`,
        remove: (cur) => ({ ...cur, choices: { ...cur.choices, [field.key]: (cur.choices[field.key] ?? []).filter((x) => x !== value) } }),
      });
    }
    const r = f.ranges[field.key];
    if (r && (r.min !== undefined || r.max !== undefined)) {
      chips.push({
        id: `${field.key}:range`,
        label: `${field.name[locale]}: ${r.min !== undefined ? mmToCm(r.min) : "…"}–${r.max !== undefined ? mmToCm(r.max) : "…"} cm`,
        remove: (cur) => { const next = { ...cur.ranges }; delete next[field.key]; return { ...cur, ranges: next }; },
      });
    }
  }
  return chips;
}

function FilterGroup({ field, f, onChange, locale }: { field: SchemaField; f: Filters; onChange: (n: Filters) => void; locale: "ar" | "en" }) {
  const t = marketplaceCopy[locale];
  const selected = f.choices[field.key] ?? [];
  const setChoices = (vals: string[]) => onChange({ ...f, choices: { ...f.choices, [field.key]: vals } });

  if (field.valueType === "measurement") {
    const r = f.ranges[field.key] ?? {};
    const set = (patch: { min?: number | undefined; max?: number | undefined }) => {
      const next = { ...r, ...patch };
      onChange({ ...f, ranges: { ...f.ranges, [field.key]: next } });
    };
    const parse = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? undefined : cmToMm(Number(v)));
    return (
      <fieldset className={styles.group} aria-label={`${field.name[locale]} (${t.rangeCm})`}>
        <div className={styles.range}>
          <input type="number" inputMode="decimal" min={0} aria-label={`${field.name[locale]} ${t.min}`} placeholder={t.min}
            value={r.min !== undefined ? mmToCm(r.min) : ""} onChange={(e) => set({ min: parse(e.target.value) })} />
          <span aria-hidden="true">–</span>
          <input type="number" inputMode="decimal" min={0} aria-label={`${field.name[locale]} ${t.max}`} placeholder={t.max}
            value={r.max !== undefined ? mmToCm(r.max) : ""} onChange={(e) => set({ max: parse(e.target.value) })} />
        </div>
      </fieldset>
    );
  }

  if (field.valueType === "boolean") {
    const on = selected.includes("true");
    return (
      <label className={styles.checkRow}>
        <input type="checkbox" checked={on} onChange={() => setChoices(on ? [] : ["true"])} />
        <span>{field.name[locale]}</span>
      </label>
    );
  }

  const present = f.type ? presentOptionKeys(previewProducts, f.type, field) : [];
  if (present.length === 0) return null;
  return (
    <fieldset className={styles.group} aria-label={field.name[locale]}>
      <ul className={styles.options}>
        {present.map((key) => {
          const checked = selected.includes(key);
          const swatch = field.valueType === "color" ? colorCatalog.find((c) => c.key === key)?.hex : undefined;
          return (
            <li key={key}>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={checked}
                  onChange={() => setChoices(checked ? selected.filter((x) => x !== key) : [...selected, key])} />
                {swatch ? <span className={styles.swatch} style={{ background: swatch }} aria-hidden="true" /> : null}
                <span>{fieldOptionName(field, key, locale)}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** Types shown before "show more"; the active type is always visible. */
const TYPES_COLLAPSED = 6;

/**
 * One collapsible filter group. Native <details>: keyboard + screen-reader friendly, no state to keep in sync.
 * It opens by default when it holds an active choice (so a chosen filter is never hidden).
 */
function FilterSection({ title, open, count, children }: { title: string; open: boolean; count?: number; children: ReactNode }) {
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

const allPrices = previewProducts.flatMap((p) => p.variants.map((v) => v.priceEgp));
const PRICE_CEIL = Math.ceil(Math.max(...allPrices) / 50) * 50;

export function MarketplaceBrowser() {
  const { locale, dir } = useI18n();
  const t = marketplaceCopy[locale];
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [panelOpen, setPanelOpen] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [allTypes, setAllTypes] = useState(false);

  const filters = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params]);
  const items = useMemo(() => listProducts(previewProducts, filters, locale), [filters, locale]);
  const fields = filterableFields(filters.type);
  const chips = activeChips(filters, locale);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const visible = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const go = (next: Filters) => {
    const qs = serializeFilters(next).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  /** Any filter/sort/search change returns to page 1. */
  const apply = (next: Filters) => go({ ...next, page: 1 });
  const setType = (type: TypeKey | null) =>
    apply({ ...emptyFilters(), q: filters.q, sort: filters.sort, inStockOnly: filters.inStockOnly, offers: filters.offers, priceMin: filters.priceMin, priceMax: filters.priceMax, type });
  const hasAny =
    chips.length > 0 || filters.inStockOnly || filters.q.trim() !== "" || filters.offers.length > 0 ||
    filters.priceMin !== undefined || filters.priceMax !== undefined || Object.keys(filters.choices).some((k) => (filters.choices[k] ?? []).length > 0);

  const toggleOffer = (kind: "regular" | "flash") =>
    apply({ ...filters, offers: filters.offers.includes(kind) ? filters.offers.filter((x) => x !== kind) : [...filters.offers, kind] });
  const setPrice = (patch: { priceMin?: number | undefined; priceMax?: number | undefined }) => apply({ ...filters, ...patch });
  const numberOrUndef = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Math.max(0, Number(v)));

  // Colour also filters the all-types listing; with a type chosen the type's own colour field is used.
  const showGlobalColor = filters.type === null;
  const globalColors = colorCatalog.filter((c) => previewProducts.some((p) => p.variants.some((v) => v.values.color === c.key)));
  const selectedColors = filters.choices.color ?? [];

  return (
    <div className={styles.browser} dir={dir}>
      <MarketplaceHero q={filters.q} locale={locale} dir={dir} onSearch={(q) => apply({ ...filters, q })} />
      <MarketplaceCategoryStrip active={filters.type} locale={locale} onPick={setType} />
      <MarketplaceFlashBanner locale={locale} onShowOffers={() => apply({ ...filters, offers: ["regular", "flash"] })} />

      <div className={store.body}>
        <aside className={store.side} aria-label={t.filterResults}>
          <h2 className={store.sideHead}><FilterIcon size={18} aria-hidden="true" />{t.filterResults}</h2>
          <button type="button" className={store.sideToggle} aria-expanded={panelOpen} onClick={() => setPanelOpen((v) => !v)}>
            {t.filterResults}{chips.length > 0 ? ` (${chips.length})` : ""}
          </button>
          <div className={`${store.sideBody} ${panelOpen ? store.sideBodyOpen : ""}`}>
            <FilterSection title={t.priceTitle} open count={filters.priceMin !== undefined || filters.priceMax !== undefined ? 1 : 0}>
              <div className={store.priceRow}>
                <input type="number" inputMode="numeric" min={0} aria-label={t.min} placeholder={t.min}
                  value={filters.priceMin ?? ""} onChange={(e) => setPrice({ priceMin: numberOrUndef(e.target.value) })} />
                <span aria-hidden="true">–</span>
                <input type="number" inputMode="numeric" min={0} aria-label={t.max} placeholder={t.max}
                  value={filters.priceMax ?? ""} onChange={(e) => setPrice({ priceMax: numberOrUndef(e.target.value) })} />
              </div>
              <input type="range" className={store.slider} min={0} max={PRICE_CEIL} step={10} aria-label={t.priceTitle}
                value={filters.priceMax ?? PRICE_CEIL}
                onChange={(e) => setPrice({ priceMax: Number(e.target.value) >= PRICE_CEIL ? undefined : Number(e.target.value) })} />
            </FilterSection>

            <FilterSection title={t.materialTitle} open count={filters.type ? 1 : 0}>
              <div className={store.typeList} role="radiogroup" aria-label={t.materialTitle}>
                <label className={styles.checkRow}>
                  <input type="radio" name="mp-type" checked={filters.type === null} onChange={() => setType(null)} />
                  <span>{t.allTypes}</span>
                </label>
                {TYPE_KEYS.filter((key, i) => allTypes || i < TYPES_COLLAPSED || key === filters.type).map((key) => (
                  <label key={key} className={styles.checkRow}>
                    <input type="radio" name="mp-type" checked={filters.type === key} onChange={() => setType(key)} />
                    <span>{t.types[key]}</span>
                  </label>
                ))}
              </div>
              {TYPE_KEYS.length > TYPES_COLLAPSED ? (
                <button type="button" className={store.moreBtn} aria-expanded={allTypes} onClick={() => setAllTypes((v) => !v)}>
                  {allTypes ? t.showLess : t.showMore(TYPE_KEYS.length - TYPES_COLLAPSED)}
                </button>
              ) : null}
            </FilterSection>

            {showGlobalColor ? (
              <FilterSection title={t.colorTitle} open={selectedColors.length > 0} count={selectedColors.length}>
                <ul className={store.colors}>
                  {globalColors.map((c) => {
                    const on = selectedColors.includes(c.key);
                    return (
                      <li key={c.key}>
                        <button type="button" aria-pressed={on} aria-label={c.name[locale]} title={c.name[locale]}
                          className={`${store.colorBtn} ${store.colorDot} ${on ? store.colorBtnActive : ""}`} style={{ background: c.hex }}
                          onClick={() => apply({ ...filters, choices: { ...filters.choices, color: on ? selectedColors.filter((x) => x !== c.key) : [...selectedColors, c.key] } })} />
                      </li>
                    );
                  })}
                </ul>
              </FilterSection>
            ) : null}

            {fields.map((field) => {
              const active = (filters.choices[field.key]?.length ?? 0) + (filters.ranges[field.key] ? 1 : 0);
              return (
                <FilterSection key={field.key} title={field.valueType === "measurement" ? `${field.name[locale]} (${t.rangeCm})` : field.name[locale]} open={active > 0} count={active}>
                  <FilterGroup field={field} f={filters} onChange={apply} locale={locale} />
                </FilterSection>
              );
            })}

            <FilterSection title={t.offersTitle} open={filters.offers.length > 0} count={filters.offers.length}>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={filters.offers.includes("regular")} onChange={() => toggleOffer("regular")} />
                <span>{t.special}</span>
              </label>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={filters.offers.includes("flash")} onChange={() => toggleOffer("flash")} />
                <span>{t.flash}</span>
              </label>
            </FilterSection>

            <label className={`${styles.checkRow} ${store.stockRow}`}>
              <input type="checkbox" checked={filters.inStockOnly} onChange={() => apply({ ...filters, inStockOnly: !filters.inStockOnly })} />
              <span>{t.inStockOnly}</span>
            </label>

            <div className={store.sideActions}>
              <button type="button" className={store.resetBtn} disabled={!hasAny && filters.type === null}
                onClick={() => go(emptyFilters())}>{t.reset}</button>
            </div>
          </div>
        </aside>

        <section className={store.main} aria-label={t.allProducts}>
          <nav aria-label={t.breadcrumb}>
            <ol className={store.crumbs}>
              <li><Link href="/">{t.home}</Link></li>
              <li aria-hidden="true">{dir === "rtl" ? "‹" : "›"}</li>
              <li aria-current="page">{t.title}</li>
            </ol>
          </nav>
          <div className={store.headRow}>
            <h2 className={store.heading}>{filters.type ? t.types[filters.type] : t.allProducts}</h2>
            <div className={store.tools}>
              <label className={styles.srOnly} htmlFor="mp-sort">{t.sortLabel}</label>
              <div className={store.sortWrap}><Select id="mp-sort" value={filters.sort} onChange={(e) => apply({ ...filters, sort: e.target.value as SortKey })}>
                <option value="best_selling">{t.sort.best_selling}</option>
                <option value="newest">{t.sort.newest}</option>
                <option value="price_asc">{t.sort.price_asc}</option>
                <option value="price_desc">{t.sort.price_desc}</option>
              </Select></div>
              <div className={store.viewGroup} role="group" aria-label={`${t.gridView} / ${t.listView}`}>
                <button type="button" className={`${store.viewBtn} ${view === "grid" ? store.viewBtnActive : ""}`} aria-pressed={view === "grid"} aria-label={t.gridView} onClick={() => setView("grid")}><GridIcon size={18} /></button>
                <button type="button" className={`${store.viewBtn} ${view === "list" ? store.viewBtnActive : ""}`} aria-pressed={view === "list"} aria-label={t.listView} onClick={() => setView("list")}><ListIcon size={18} /></button>
              </div>
            </div>
          </div>

          <div className={styles.resultsHead}>
            <p role="status" aria-live="polite">{t.results(items.length)}</p>
            {chips.length > 0 ? (
              <ul className={styles.chips} aria-label={t.activeFilters}>
                {chips.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => apply(c.remove(filters))} aria-label={`${c.label} ×`}>{c.label} <span aria-hidden="true">×</span></button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {items.length === 0 ? (
            <div className={styles.empty}>
              <h2>{t.noResults}</h2>
              <p>{t.noResultsHint}</p>
            </div>
          ) : (
            <ul className={`${styles.grid} ${view === "list" ? styles.gridList : ""}`}>
              {visible.map((item) => (
                <li key={item.product.id}><MarketplaceProductCard item={item} locale={locale} /></li>
              ))}
            </ul>
          )}

          {pageCount > 1 ? (
            <nav aria-label={t.pagination}>
              <ul className={store.pager}>
                <li><button type="button" className={store.pageBtn} disabled={page <= 1} onClick={() => go({ ...filters, page: page - 1 })}>{t.prev}</button></li>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                  <li key={n}>
                    <button type="button" className={`${store.pageBtn} ${n === page ? store.pageBtnActive : ""}`} aria-current={n === page ? "page" : undefined}
                      aria-label={t.page(n)} onClick={() => go({ ...filters, page: n })}>{n}</button>
                  </li>
                ))}
                <li><button type="button" className={store.pageBtn} disabled={page >= pageCount} onClick={() => go({ ...filters, page: page + 1 })}>{t.next}</button></li>
              </ul>
            </nav>
          ) : null}
        </section>
      </div>

      <MarketplaceCta locale={locale} />
    </div>
  );
}
