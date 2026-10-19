import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import type { Locale } from "@/lib/i18n/locales";
import { Badge } from "@/components/ui/primitives";
import { seriesAt, type Series } from "@/components/ui/charts";
import { BadgeCheckIcon, ChevronRightIcon, PackageIcon } from "@/components/ui/icons";
import { ProductMedia } from "@/features/commerce/product-media";
import { catalogCategoryLabel } from "@/features/showroom-shell/products/labels";
import { cn } from "@/lib/ui/cn";
import { formatCompactMoneyFine, formatCount, formatDate, formatMoney, formatPercent } from "@/lib/ui/format";
import type { CategorySpend, IncomingQuotation } from "@/server/queries/showroom-home";
import type { CatalogRow } from "@/server/queries/commerce";

type T = (key: string, vars?: Record<string, string | number>) => string;

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/** The arrow that follows a link: points toward the reading direction's end. */
const EndArrow = () => <span aria-hidden="true" className="inline-flex rtl:-scale-x-100"><ChevronRightIcon size={14} /></span>;

// --- Section frame -----------------------------------------------------------------------------------------

/** A titled dashboard panel: a round icon chip, title and subtitle, and an optional "view all" link. */
export function HomePanel({ id, Icon, title, subtitle, action, children, className }: {
  id: string; Icon: ComponentType<{ size?: number }>; title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-md rounded-lg border bg-surface p-md shadow-card tablet:p-lg", className)} data-testid={id}>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-solid/15 text-accent"><Icon size={20} /></span>
          <div className="flex min-w-0 flex-col">
            <h2 id={id} className="text-title text-fg">{title}</h2>
            {subtitle ? <p className="text-label text-fg-muted">{subtitle}</p> : null}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ViewAllLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-1 rounded-sm px-2 py-1 text-label font-medium text-accent transition-colors hover:bg-surface-hover", focusRing)}>
      {label}<EndArrow />
    </Link>
  );
}

const Empty = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <p className="rounded-md border border-dashed p-lg text-body text-fg-muted" data-testid={testId}>{children}</p>
);

// --- KPI cards -------------------------------------------------------------------------------------------------

export type KpiTrend =
  | { kind: "change"; pct: number }
  | { kind: "flat" }
  | { kind: "fresh" }
  | { kind: "none" }
  | { kind: "asIs" };

export type KpiCardData = {
  key: string;
  label: string;
  value: string;
  trend: KpiTrend;
  linkLabel: string;
  href: string;
  Icon: ComponentType<{ size?: number }>;
};

/**
 * The change against the previous period of the same length - computed from two real readings, never invented.
 * Both zero: nothing happened. Previous zero, now positive: a fresh start (no percentage is defined).
 * `null` previous means the figure has no period (a "right now" figure): it is shown as it is.
 */
export function trendFor(current: number, previous: number | null): KpiTrend {
  if (previous === null) return { kind: "asIs" };
  if (current === 0 && previous === 0) return { kind: "none" };
  if (previous === 0) return { kind: "fresh" };
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct === 0 ? { kind: "flat" } : { kind: "change", pct };
}

function Trend({ trend, locale, t }: { trend: KpiTrend; locale: Locale; t: T }) {
  switch (trend.kind) {
    case "change": {
      const up = trend.pct > 0;
      return (
        <span className={cn("inline-flex items-center gap-1 text-label font-medium", up ? "text-success" : "text-danger")} data-testid="kpi-trend">
          <span aria-hidden="true">{up ? "↑" : "↓"}</span>
          {t("showroomHome.v3.trend.change", { pct: formatPercent(Math.abs(trend.pct), locale) })}
        </span>
      );
    }
    case "fresh": return <span className="text-label font-medium text-success" data-testid="kpi-trend"><span aria-hidden="true">↑ </span>{t("showroomHome.v3.trend.fresh")}</span>;
    case "flat": return <span className="text-label text-fg-muted" data-testid="kpi-trend">{t("showroomHome.v3.trend.flat")}</span>;
    case "none": return <span className="text-label text-fg-muted" data-testid="kpi-trend">{t("showroomHome.v3.trend.none")}</span>;
    case "asIs": return <span className="text-label text-fg-muted" data-testid="kpi-trend">{t("showroomHome.v3.trend.asIs")}</span>;
  }
}

export function KpiCards({ cards, locale, t, columns = 5 }: { cards: KpiCardData[]; locale: Locale; t: T; columns?: number }) {
  return (
    <ul className={cn("grid grid-cols-2 gap-md tablet:grid-cols-3 [&>li:last-child:nth-child(odd)]:col-span-2 tablet:[&>li:last-child:nth-child(odd)]:col-span-1", columns === 5 ? "desktop:grid-cols-5" : "desktop:grid-cols-6")} data-testid="showroom-kpis">
      {cards.map((card) => (
        <li key={card.key} className="min-w-0">
          <article data-testid={`kpi-${card.key}`} className="flex h-full min-w-0 flex-col gap-2 rounded-lg border bg-surface p-md shadow-card">
            <div className="flex items-start justify-between gap-2">
              <span className={cn("min-w-0 font-semibold text-fg", card.value.length > 7 ? "text-title" : "text-headline")} dir="auto" data-testid="kpi-value">{card.value}</span>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-solid/15 text-accent"><card.Icon size={21} /></span>
            </div>
            <h3 className="text-body font-medium leading-snug text-fg">{card.label}</h3>
            <Trend trend={card.trend} locale={locale} t={t} />
            <Link href={card.href} className={cn("mt-auto inline-flex w-fit items-center gap-1 rounded-sm pt-1 text-label font-medium text-accent hover:underline", focusRing)}>
              {card.linkLabel}<EndArrow />
            </Link>
          </article>
        </li>
      ))}
    </ul>
  );
}

// --- Discover new products ---------------------------------------------------------------------------------------

export type DiscoverProduct = CatalogRow & { id: string };

/**
 * Six real published products the viewer's WORKSPACE audience may see. Phones and tablets scroll the row
 * (snap, no script); desktop shows all six side by side. Supplier city is NOT shown: no public location source
 * exists for non-showroom suppliers (see docs/frontend/showroom-v2-reference-alignment.md).
 */
export function DiscoverRail({ products, imageUrls, t, href }: {
  products: DiscoverProduct[]; imageUrls: Record<string, string>; t: T; href: (id: string) => string;
}) {
  if (products.length === 0) return <Empty testId="showroom-discover-empty">{t("showroomHome.v3.discover.empty")}</Empty>;
  return (
    <ul
      className="-mx-1 flex snap-x snap-mandatory gap-md overflow-x-auto px-1 pb-2 [scrollbar-width:thin] desktop:mx-0 desktop:grid desktop:grid-cols-6 desktop:overflow-visible desktop:px-0 desktop:pb-0"
      data-testid="showroom-discover-rail" tabIndex={0} aria-label={t("showroomHome.v3.discover.title")}
    >
      {products.map((product) => (
        <li key={product.id} className="w-[14rem] shrink-0 snap-start tablet:w-[15rem] desktop:w-auto">
          <article className="flex h-full flex-col gap-2 rounded-md border border-[color:color-mix(in_srgb,var(--warm-sand)_60%,transparent)] bg-surface p-2.5 transition-colors duration-200 hover:border-accent focus-within:border-accent" data-testid="showroom-discover-card">
            <div className="relative overflow-hidden rounded-sm">
              <ProductMedia src={imageUrls[product.id] ?? null} alt={product.name ?? ""} aspect="aspect-[4/3]" />
              <span className="absolute end-1.5 top-1.5 max-w-[calc(100%-0.75rem)]"><Badge tone="neutral">{catalogCategoryLabel(t, product)}</Badge></span>
            </div>
            <h3 className="line-clamp-2 min-h-[2.6em] text-body font-semibold leading-snug text-fg" dir="auto">{product.name}</h3>
            <p className="flex min-w-0 items-center gap-1 text-label text-fg-secondary">
              <span className="truncate" dir="auto">{product.supplier_name ?? product.brand ?? ""}</span>
              {product.supplier_verified ? <span className="shrink-0 text-success"><BadgeCheckIcon size={13} /></span> : null}
            </p>
            <Link href={href(product.id)} className={cn("mt-auto inline-flex items-center justify-center gap-1.5 rounded-md border border-accent/60 px-3 py-1.5 text-label font-medium text-accent transition-colors hover:bg-accent-solid/10", focusRing)}>
              {t("showroomHome.v3.discover.view")}<EndArrow />
            </Link>
          </article>
        </li>
      ))}
    </ul>
  );
}

// --- Latest incoming quotations ---------------------------------------------------------------------------------

const QUOTE_TONE: Record<string, "info" | "success" | "danger" | "neutral"> = { submitted: "success", accepted: "success", rejected: "danger" };

export function IncomingQuotations({ rows, imageUrls, locale, t, href }: {
  rows: IncomingQuotation[]; imageUrls: Record<string, string>; locale: Locale; t: T; href: (id: string) => string;
}) {
  if (rows.length === 0) return <Empty testId="showroom-quotes-empty">{t("showroomHome.v3.quotes.empty")}</Empty>;
  return (
    <ul className="flex flex-col gap-2" data-testid="showroom-quotes">
      {rows.map((q) => (
        <li key={q.id}>
          <Link href={href(q.id)} className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-surface-2/30 px-2.5 py-2 transition-colors hover:bg-surface-2/60", focusRing)} data-testid="quote-row">
            <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-2 text-fg-muted">
              {q.productId && imageUrls[q.productId] ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={imageUrls[q.productId]} alt="" width={44} height={44} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : (
                <PackageIcon size={18} />
              )}
            </span>
            <span className="flex min-w-0 flex-1 basis-40 flex-col">
              <span className="truncate text-body font-semibold text-fg" dir="auto">{q.supplierName}</span>
              <span className="truncate text-label text-fg-muted" dir="auto">{q.rfqTitle}</span>
            </span>
            <span className="flex w-full items-center justify-between gap-2 min-[560px]:w-auto min-[560px]:justify-end">
              <span className="text-label text-fg-muted">{q.submittedAt ? formatDate(q.submittedAt, locale) : ""}</span>
              <span className="text-label font-semibold text-fg">{q.total !== null ? formatMoney(q.total, locale) : ""}</span>
              <Badge tone={QUOTE_TONE[q.status] ?? "neutral"}>{t(`showroomHome.v3.quotes.status.${q.status}`)}</Badge>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// --- Purchasing by category -------------------------------------------------------------------------------------

const SERIES_STROKE: Record<Series, string> = { 1: "stroke-series-1", 2: "stroke-series-2", 3: "stroke-series-3", 4: "stroke-series-4", 5: "stroke-series-5", 6: "stroke-series-6" };
const SERIES_BG: Record<Series, string> = { 1: "bg-series-1", 2: "bg-series-2", 3: "bg-series-3", 4: "bg-series-4", 5: "bg-series-5", 6: "bg-series-6" };
const CIRCUMFERENCE = 2 * Math.PI * 14.5;

/** Donut plus a ruled legend (swatch + category, amount, share). Every figure is the real sum of confirmed order lines. */
export function CategoryDistribution({ spend, locale, t }: { spend: CategorySpend[]; locale: Locale; t: T }) {
  const total = spend.reduce((sum, s) => sum + s.amount, 0);
  if (total <= 0) return <Empty testId="showroom-category-empty">{t("showroomHome.v3.category.empty")}</Empty>;
  let used = 0;
  const arcs = spend.map((s, i) => {
    const pct = (s.amount / total) * 100;
    const arc = { ...s, pct, series: seriesAt(i), start: used };
    used += pct;
    return arc;
  });
  return (
    <div className="flex flex-col items-center gap-lg tablet:flex-row" data-testid="showroom-category-chart">
      <ul className="order-2 flex w-full min-w-0 flex-1 flex-col tablet:order-1">
        {arcs.map((a) => (
          <li key={a.category} className="flex items-center gap-3 border-b py-2.5 last:border-b-0" data-testid="category-row">
            <span className="flex min-w-0 flex-1 items-center gap-2 text-body text-fg">
              <span className={cn("h-3 w-3 shrink-0 rounded-full", SERIES_BG[a.series])} aria-hidden="true" />
              <span className="truncate">{t(`commerce.categories.${a.category}`)}</span>
            </span>
            <span dir="ltr" className="shrink-0 text-label font-medium tabular-nums text-fg">{formatCompactMoneyFine(a.amount, locale)}</span>
            <span className="w-12 shrink-0 text-end text-label tabular-nums text-fg-muted">{formatPercent(Math.round(a.pct), locale)}</span>
          </li>
        ))}
      </ul>
      <div className="relative order-1 shrink-0 tablet:order-2">
        <svg viewBox="0 0 36 36" role="img" aria-label={t("showroomHome.v3.category.aria")} className="h-48 w-48 -rotate-90">
          <circle cx="18" cy="18" r="14.5" fill="none" className="stroke-surface-2" strokeWidth="5" />
          {arcs.map((a) => (
            <circle
              key={a.category} cx="18" cy="18" r="14.5" fill="none" strokeWidth="5"
              strokeDasharray={`${(a.pct / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              strokeDashoffset={-(a.start / 100) * CIRCUMFERENCE}
              className={SERIES_STROKE[a.series]}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <span dir="auto" className="mx-auto block max-w-[7rem] text-body font-semibold leading-tight tabular-nums text-fg">{formatCompactMoneyFine(total, locale)}</span>
            <span className="block text-[0.6875rem] text-fg-muted">{t("showroomHome.v3.category.center")}</span>
          </div>
        </div>
      </div>
      <span className="sr-only">{formatMoney(total, locale)} · {formatCount(spend.length, locale)}</span>
    </div>
  );
}
