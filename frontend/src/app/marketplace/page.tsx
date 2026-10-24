import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LiveCatalog, type CatalogParams } from "@/features/marketplace/live/live-catalog";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { readPublicEnv } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { PUBLIC_SORTS, loadPublicCatalogPage, loadPublicFacets, type PublicSort } from "@/server/queries/marketplace-public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace | Aladdin",
  robots: { index: false, follow: false },
};

const KEY = /^[a-z0-9_]{1,64}$/;

function price(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,9}(\.\d{1,2})?$/.test(raw)) return null;
  return Number(raw);
}

/** `f.<attribute>=a,b` → { attribute: [a, b] }, keys and values validated, bounded. */
function attrs(sp: Record<string, string | undefined>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (!k.startsWith("f.") || !v) continue;
    const key = k.slice(2);
    if (!KEY.test(key) || Object.keys(out).length >= 12) continue;
    const opts = v.split(",").filter((o) => KEY.test(o)).slice(0, 30);
    if (opts.length) out[key] = [...new Set(opts)];
  }
  return out;
}

/**
 * Public Marketplace catalog — REAL data only (Migrations 09/10 public RPCs):
 * published products of approved sellers, server-side search, filters, facets
 * and pagination. No sample products and no purchase. Still closed unless
 * NEXT_PUBLIC_MARKETPLACE_PREVIEW="true", so Production exposes nothing until
 * the release flag is set on purpose.
 */
export default async function MarketplacePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (readPublicEnv().NEXT_PUBLIC_MARKETPLACE_PREVIEW !== "true") notFound();
  const sp = await searchParams;
  const params: CatalogParams = {
    category: KEY.test(sp.category ?? "") ? sp.category! : "",
    type: KEY.test(sp.type ?? "") ? sp.type! : "",
    q: (sp.q ?? "").trim().slice(0, 100),
    sort: (PUBLIC_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as PublicSort) : "newest",
    page: Math.min(10000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)),
    priceMin: price(sp.pmin),
    priceMax: price(sp.pmax),
    inStock: sp.stock === "1",
    attrs: attrs(sp),
  };
  const [page, facets] = await Promise.all([
    loadPublicCatalogPage({ ...params, query: params.q }),
    loadPublicFacets(params.type || null),
  ]);
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  return (
    <I18nProvider locale={locale} dir={dir}>
      <MarketplaceShell live>
        <LiveCatalog locale={locale} dir={dir} params={params} page={page} facets={facets} />
      </MarketplaceShell>
    </I18nProvider>
  );
}
